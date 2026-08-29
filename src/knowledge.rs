use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

const MAX_PROMPT_LENGTH: usize = 500;
const MAX_RESPONSE_LENGTH: usize = 2_000;
const MAX_PATTERNS: usize = 1_000;
const MAX_KEYWORDS_PER_PATTERN: usize = 16;
const MAX_KEYWORD_LENGTH: usize = 64;
const MAX_CATEGORY_LENGTH: usize = 32;
const MAX_MATCH_INPUT_LENGTH: usize = 2_000;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MatchMode {
    Any,
    #[default]
    All,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Pattern {
    #[serde(default)]
    pub id: u64,
    pub keywords: Vec<String>,
    pub response: String,
    #[serde(default)]
    pub match_mode: MatchMode,
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Knowledge {
    patterns: Vec<Pattern>,
}

pub struct KnowledgeStore {
    path: PathBuf,
    knowledge: Knowledge,
    next_id: u64,
}

impl KnowledgeStore {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let mut knowledge = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
            serde_json::from_str::<Knowledge>(&contents)
                .map_err(|error| format!("{} contains invalid JSON: {error}", path.display()))?
        } else {
            Knowledge {
                patterns: seeded_patterns(),
            }
        };

        if knowledge.patterns.len() > MAX_PATTERNS {
            return Err(format!(
                "{} contains more than the supported {MAX_PATTERNS} memories.",
                path.display()
            ));
        }

        let mut changed = !path.exists();
        let mut next_id = knowledge
            .patterns
            .iter()
            .map(|pattern| pattern.id)
            .max()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or_else(|| "Knowledge memory IDs are exhausted.".to_string())?;

        let mut seen_ids = HashSet::new();
        for pattern in &mut knowledge.patterns {
            if pattern.id == 0 {
                pattern.id = next_id;
                next_id = next_id
                    .checked_add(1)
                    .ok_or_else(|| "Knowledge memory IDs are exhausted.".to_string())?;
                changed = true;
            } else if !seen_ids.insert(pattern.id) {
                return Err(format!("{} contains duplicate memory IDs.", path.display()));
            }
            validate_text(&pattern.response, "Response", MAX_RESPONSE_LENGTH)?;
            let category = normalize_category(pattern.category.clone())?;
            if pattern.category.as_deref() != Some(category.as_str()) {
                pattern.category = Some(category);
                changed = true;
            }
            let normalized = normalize_stored_keywords(&pattern.keywords)?;
            if normalized != pattern.keywords {
                pattern.keywords = normalized;
                changed = true;
            }
        }

        let store = Self {
            path,
            knowledge,
            next_id,
        };

        if changed {
            store.save()?;
        }

        Ok(store)
    }

    pub fn from_memories(memories: &[crate::db::MemoryRecord]) -> Self {
        let mut patterns = Vec::new();
        let mut next_id = 1;
        for m in memories {
            let id = m.id as u64;
            if id >= next_id {
                next_id = id + 1;
            }
            patterns.push(Pattern {
                id,
                keywords: m.keywords.clone(),
                response: m.response.clone(),
                match_mode: if m.match_mode.eq_ignore_ascii_case("any") {
                    MatchMode::Any
                } else {
                    MatchMode::All
                },
                category: Some(m.category.clone()),
            });
        }
        Self {
            path: PathBuf::from("knowledge.json"),
            knowledge: Knowledge { patterns },
            next_id,
        }
    }

    pub fn reload_from_db(&mut self, db: &crate::db::Database) -> Result<(), String> {
        let memories = db.list_memories()?;
        *self = Self::from_memories(&memories);
        Ok(())
    }

    pub fn patterns(&self) -> &[Pattern] {
        &self.knowledge.patterns
    }

    pub fn patterns_by_category(&self, category: Option<&str>) -> Vec<&Pattern> {
        match category {
            Some(cat) if !cat.trim().is_empty() && cat != "all" => self
                .knowledge
                .patterns
                .iter()
                .filter(|p| {
                    p.category
                        .as_deref()
                        .map(|c| c.eq_ignore_ascii_case(cat))
                        .unwrap_or(false)
                })
                .collect(),
            _ => self.knowledge.patterns.iter().collect(),
        }
    }

    pub fn find_best_match(&self, input: &str) -> Option<&Pattern> {
        if input.chars().count() > MAX_MATCH_INPUT_LENGTH {
            return None;
        }
        let raw_tokens = unique_tokens(tokenize(input));
        if raw_tokens.is_empty() {
            return None;
        }

        let non_stopwords: Vec<String> = raw_tokens
            .iter()
            .filter(|t| !is_stopword(t))
            .cloned()
            .collect();

        let query_tokens = if non_stopwords.is_empty() {
            &raw_tokens
        } else {
            &non_stopwords
        };

        let total_patterns = self.knowledge.patterns.len();
        if total_patterns == 0 {
            return None;
        }

        let avg_doc_len: f64 = (self
            .knowledge
            .patterns
            .iter()
            .map(|p| p.keywords.len())
            .sum::<usize>() as f64
            / total_patterns as f64)
            .max(1.0);

        let k1: f64 = 1.2;
        let b: f64 = 0.75;

        let mut best_score = -1.0_f64;
        let mut best_pattern: Option<&Pattern> = None;

        for pattern in &self.knowledge.patterns {
            if pattern.keywords.is_empty() {
                continue;
            }

            let doc_len = pattern.keywords.len() as f64;
            let matched_pattern_keywords_count = pattern
                .keywords
                .iter()
                .filter(|keyword| {
                    raw_tokens
                        .iter()
                        .any(|query_term| keyword_matches_fuzzy(keyword, query_term))
                })
                .count();
            let mut bm25_score = 0.0_f64;

            let mut exact_matches = 0;
            for q_term in query_tokens.iter() {
                let mut kw_matched = false;
                for keyword in &pattern.keywords {
                    if keyword == q_term {
                        kw_matched = true;
                        exact_matches += 1;
                        break;
                    } else if keyword_matches_fuzzy(keyword, q_term) {
                        kw_matched = true;
                    }
                }

                if kw_matched {
                    let doc_freq = self
                        .knowledge
                        .patterns
                        .iter()
                        .filter(|p| p.keywords.iter().any(|k| keyword_matches_fuzzy(k, q_term)))
                        .count() as f64;

                    let idf = ((total_patterns as f64 - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0)
                        .ln()
                        .max(0.1);
                    let tf = 1.0_f64;
                    let num = tf * (k1 + 1.0);
                    let den = tf + k1 * (1.0 - b + b * (doc_len / avg_doc_len));
                    bm25_score += idf * (num / den.max(0.001));
                }
            }

            let qualifies = match pattern.match_mode {
                MatchMode::Any => matched_pattern_keywords_count > 0,
                MatchMode::All => matched_pattern_keywords_count == pattern.keywords.len(),
            };

            if qualifies && matched_pattern_keywords_count > 0 {
                let score = bm25_score
                    + (exact_matches as f64 * 3.0)
                    + (matched_pattern_keywords_count as f64 * 0.5)
                    + (pattern.keywords.len() as f64 * 0.1);
                if score > best_score {
                    best_score = score;
                    best_pattern = Some(pattern);
                }
            }
        }

        best_pattern
    }

    pub fn teach(&mut self, prompt: &str, response: &str) -> Result<Pattern, String> {
        self.teach_with_category(prompt, response, Some("general".to_string()))
    }

    pub fn teach_with_category(
        &mut self,
        prompt: &str,
        response: &str,
        category: Option<String>,
    ) -> Result<Pattern, String> {
        validate_text(prompt, "Prompt", MAX_PROMPT_LENGTH)?;
        validate_text(response, "Response", MAX_RESPONSE_LENGTH)?;
        if self.knowledge.patterns.len() >= MAX_PATTERNS {
            return Err(format!("The knowledge store is limited to {MAX_PATTERNS} memories."));
        }

        let keywords = validate_keyword_tokens(tokenize(prompt))?;
        let category = normalize_category(category)?;
        let next_id = self
            .next_id
            .checked_add(1)
            .ok_or_else(|| "Knowledge memory IDs are exhausted.".to_string())?;

        let pattern = Pattern {
            id: self.next_id,
            keywords,
            response: response.trim().to_string(),
            match_mode: MatchMode::All,
            category: Some(category),
        };

        let mut updated = self.knowledge.clone();
        updated.patterns.push(pattern.clone());
        self.commit(updated, next_id)?;
        Ok(pattern)
    }

    pub fn forget(&mut self, id: u64) -> Result<Pattern, String> {
        let index = self
            .knowledge
            .patterns
            .iter()
            .position(|pattern| pattern.id == id)
            .ok_or_else(|| format!("Memory #{id} does not exist."))?;
        let removed = self.knowledge.patterns[index].clone();
        let mut updated = self.knowledge.clone();
        updated.patterns.remove(index);
        self.commit(updated, self.next_id)?;
        Ok(removed)
    }

    #[allow(dead_code)]
    pub fn restore(&mut self, mut pattern: Pattern) -> Result<Pattern, String> {
        if pattern.id == 0 {
            return Err("A restored memory must have a non-zero ID.".to_string());
        }
        if self
            .knowledge
            .patterns
            .iter()
            .any(|existing| existing.id == pattern.id)
        {
            return Err(format!("Memory #{} already exists.", pattern.id));
        }
        if self.knowledge.patterns.len() >= MAX_PATTERNS {
            return Err(format!("The knowledge store is limited to {MAX_PATTERNS} memories."));
        }
        normalize_pattern(&mut pattern)?;

        let next_id = self.next_id.max(
            pattern
                .id
                .checked_add(1)
                .ok_or_else(|| "Knowledge memory IDs are exhausted.".to_string())?,
        );
        let mut updated = self.knowledge.clone();
        updated.patterns.push(pattern.clone());
        updated.patterns.sort_by_key(|entry| entry.id);
        self.commit(updated, next_id)?;
        Ok(pattern)
    }

    pub fn export_json(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&self.knowledge)
            .map_err(|error| format!("Could not export knowledge: {error}"))
    }

    pub fn import_json(&mut self, json_str: &str) -> Result<usize, String> {
        let imported: Knowledge = serde_json::from_str(json_str)
            .map_err(|error| format!("Invalid knowledge JSON format: {error}"))?;

        if imported.patterns.len() > MAX_PATTERNS
            || imported.patterns.len() > MAX_PATTERNS - self.knowledge.patterns.len()
        {
            return Err(format!("The knowledge store is limited to {MAX_PATTERNS} memories."));
        }

        let mut additions = Vec::with_capacity(imported.patterns.len());
        let mut next_id = self.next_id;
        for mut pattern in imported.patterns {
            normalize_pattern(&mut pattern)?;
            pattern.id = next_id;
            next_id = next_id
                .checked_add(1)
                .ok_or_else(|| "Knowledge memory IDs are exhausted.".to_string())?;
            additions.push(pattern);
        }

        if additions.is_empty() {
            return Ok(0);
        }

        let added_count = additions.len();
        let mut updated = self.knowledge.clone();
        updated.patterns.extend(additions);
        self.commit(updated, next_id)?;
        Ok(added_count)
    }

    fn save(&self) -> Result<(), String> {
        self.save_knowledge(&self.knowledge)
    }

    fn commit(&mut self, knowledge: Knowledge, next_id: u64) -> Result<(), String> {
        self.save_knowledge(&knowledge)?;
        self.knowledge = knowledge;
        self.next_id = next_id;
        Ok(())
    }

    fn save_knowledge(&self, knowledge: &Knowledge) -> Result<(), String> {
        let data = serde_json::to_string_pretty(knowledge)
            .map_err(|error| format!("Could not serialize knowledge: {error}"))?;

        let tmp_path = self.path.with_extension("json.tmp");
        fs::write(&tmp_path, &data).map_err(|error| {
            format!(
                "Could not write temporary file {}: {error}",
                tmp_path.display()
            )
        })?;

        fs::rename(&tmp_path, &self.path)
            .map_err(|error| format!("Could not save {}: {error}", self.path.display()))
    }
}

fn validate_text(value: &str, label: &str, max_length: usize) -> Result<(), String> {
    let length = value.trim().chars().count();
    if length == 0 {
        return Err(format!("{label} cannot be empty."));
    }
    if length > max_length {
        return Err(format!("{label} must be {max_length} characters or fewer."));
    }
    Ok(())
}

fn normalize_pattern(pattern: &mut Pattern) -> Result<(), String> {
    validate_text(&pattern.response, "Response", MAX_RESPONSE_LENGTH)?;
    pattern.response = pattern.response.trim().to_string();
    pattern.keywords = normalize_stored_keywords(&pattern.keywords)?;
    pattern.category = Some(normalize_category(pattern.category.clone())?);
    Ok(())
}

fn normalize_stored_keywords(keywords: &[String]) -> Result<Vec<String>, String> {
    if keywords.len() > MAX_KEYWORDS_PER_PATTERN {
        return Err(format!(
            "A memory can contain at most {MAX_KEYWORDS_PER_PATTERN} keywords."
        ));
    }

    let mut tokens = Vec::new();
    for keyword in keywords {
        if keyword.trim().chars().count() > MAX_KEYWORD_LENGTH {
            return Err(format!(
                "Each keyword must be {MAX_KEYWORD_LENGTH} characters or fewer."
            ));
        }
        tokens.extend(tokenize(keyword));
    }
    validate_keyword_tokens(tokens)
}

fn validate_keyword_tokens(tokens: Vec<String>) -> Result<Vec<String>, String> {
    let mut unique = HashSet::new();
    let mut keywords = Vec::new();

    for token in tokens {
        let token = token.trim().to_lowercase();
        if token.is_empty() {
            continue;
        }
        if token.chars().count() > MAX_KEYWORD_LENGTH {
            return Err(format!(
                "Each keyword must be {MAX_KEYWORD_LENGTH} characters or fewer."
            ));
        }
        if unique.insert(token.clone()) {
            keywords.push(token);
        }
    }

    if keywords.is_empty() {
        return Err("A memory needs at least one keyword.".to_string());
    }
    if keywords.len() > MAX_KEYWORDS_PER_PATTERN {
        return Err(format!(
            "A memory can contain at most {MAX_KEYWORDS_PER_PATTERN} keywords."
        ));
    }
    Ok(keywords)
}

fn normalize_category(category: Option<String>) -> Result<String, String> {
    let category = category
        .unwrap_or_else(|| "general".to_string())
        .trim()
        .to_lowercase();
    let category = if category.is_empty() {
        "general".to_string()
    } else {
        category
    };

    if category.chars().count() > MAX_CATEGORY_LENGTH
        || !category
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!(
            "Category must use letters, numbers, hyphens, or underscores and be {MAX_CATEGORY_LENGTH} characters or fewer."
        ));
    }
    Ok(category)
}

fn unique_tokens(tokens: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    tokens
        .into_iter()
        .filter(|token| seen.insert(token.clone()))
        .collect()
}

pub fn tokenize(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn stem_word(word: &str) -> String {
    let mut w = word.to_lowercase();
    if w.len() <= 3 {
        return w;
    }
    if w.ends_with("ing") && w.len() > 5 {
        w.truncate(w.len() - 3);
        if (w.ends_with("nn") || w.ends_with("mm") || w.ends_with("tt") || w.ends_with("pp")) && w.len() > 3 {
            w.pop();
        }
    } else if (w.ends_with("ed") || w.ends_with("es")) && w.len() > 4 {
        w.truncate(w.len() - 2);
    } else if w.ends_with('s') && !w.ends_with("ss") && w.len() > 3 {
        w.pop();
    } else if w.ends_with("ly") && w.len() > 4 {
        w.truncate(w.len() - 2);
    } else if w.ends_with("tion") && w.len() > 6 {
        w.truncate(w.len() - 4);
        w.push_str("te");
    }
    w
}

fn is_stopword(word: &str) -> bool {
    matches!(
        word,
        "a" | "an"
            | "the"
            | "is"
            | "are"
            | "was"
            | "were"
            | "be"
            | "been"
            | "being"
            | "in"
            | "on"
            | "at"
            | "to"
            | "for"
            | "of"
            | "with"
            | "by"
            | "from"
            | "up"
            | "about"
            | "into"
            | "over"
            | "after"
            | "and"
            | "or"
            | "but"
            | "if"
            | "it"
            | "this"
            | "that"
            | "these"
            | "those"
    )
}

#[allow(clippy::needless_range_loop)]
fn damerau_levenshtein(s1: &str, s2: &str) -> usize {
    let a: Vec<char> = s1.chars().collect();
    let b: Vec<char> = s2.chars().collect();
    let len_a = a.len();
    let len_b = b.len();

    if len_a == 0 {
        return len_b;
    }
    if len_b == 0 {
        return len_a;
    }

    let mut dp = vec![vec![0usize; len_b + 1]; len_a + 1];

    for i in 0..=len_a {
        dp[i][0] = i;
    }
    for (j, item) in dp[0].iter_mut().enumerate().take(len_b + 1) {
        *item = j;
    }

    for i in 1..=len_a {
        for j in 1..=len_b {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);

            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                dp[i][j] = dp[i][j].min(dp[i - 2][j - 2] + cost);
            }
        }
    }

    dp[len_a][len_b]
}

fn keyword_matches_fuzzy(keyword: &str, word: &str) -> bool {
    if keyword == word {
        return true;
    }
    let k_stem = stem_word(keyword);
    let w_stem = stem_word(word);
    if k_stem == w_stem {
        return true;
    }

    let k_len = keyword.chars().count();
    let w_len = word.chars().count();
    let shorter_length = k_len.min(w_len);

    if k_len.abs_diff(w_len) > 3 {
        return false;
    }

    if shorter_length >= 4
        && (keyword.starts_with(word) || word.starts_with(keyword))
        && k_len.abs_diff(w_len) <= 3
    {
        return true;
    }

    if k_len >= 4 && w_len >= 4 && damerau_levenshtein(keyword, word) <= 2 {
        return true;
    }

    false
}

fn seeded_patterns() -> Vec<Pattern> {
    let memories = [
        (
            vec!["hello", "hi", "hey", "greetings"],
            "Hey there! How can I help you today?",
            MatchMode::Any,
            "greetings",
        ),
        (
            vec!["how", "are", "you"],
            "I'm a small Rust program, and all systems are glowing. 🦀",
            MatchMode::All,
            "general",
        ),
        (
            vec!["your", "name"],
            "I'm RustBot — a self-learning chatbot built in Rust.",
            MatchMode::All,
            "general",
        ),
        (
            vec!["who", "are", "you"],
            "I'm RustBot, a local chatbot that learns new answers from you.",
            MatchMode::All,
            "general",
        ),
        (
            vec!["weather"],
            "I can't check live weather yet, but I hope it's kind where you are.",
            MatchMode::All,
            "general",
        ),
        (
            vec!["thanks", "thank"],
            "You're welcome. Happy to help. 😊",
            MatchMode::Any,
            "greetings",
        ),
        (
            vec!["rust"],
            "Rust is a systems language focused on speed, memory safety, and fearless concurrency.",
            MatchMode::All,
            "tech",
        ),
        (
            vec!["bye", "goodbye"],
            "See you next time. I'll keep the forge warm. 👋",
            MatchMode::Any,
            "greetings",
        ),
        (
            vec!["help"],
            "Ask me something, or teach me when I don't know the answer. Every lesson is saved to my knowledge forge.",
            MatchMode::All,
            "general",
        ),
        (
            vec!["what", "can", "you", "do"],
            "I match questions to local memories, learn new replies from you, evaluate math, check market prices, and let you review or export memories.",
            MatchMode::All,
            "general",
        ),
    ];

    memories
        .into_iter()
        .enumerate()
        .map(
            |(index, (keywords, response, match_mode, category))| Pattern {
                id: index as u64 + 1,
                keywords: keywords.into_iter().map(ToOwned::to_owned).collect(),
                response: response.to_string(),
                match_mode,
                category: Some(category.to_string()),
            },
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> KnowledgeStore {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("System clock should be after the Unix epoch")
            .as_nanos();
        KnowledgeStore {
            path: std::env::temp_dir().join(format!(
                "rustbot-knowledge-test-{}-{unique}.json",
                std::process::id()
            )),
            knowledge: Knowledge {
                patterns: seeded_patterns(),
            },
            next_id: 11,
        }
    }

    #[test]
    fn greeting_synonyms_match_individually() {
        let store = test_store();
        assert_eq!(
            store.find_best_match("Hello!").map(|pattern| pattern.id),
            Some(1)
        );
        assert_eq!(
            store.find_best_match("goodbye").map(|pattern| pattern.id),
            Some(8)
        );
    }

    #[test]
    fn phrase_memories_require_every_keyword() {
        let store = test_store();
        assert!(store.find_best_match("what can you").is_none());
        assert_eq!(
            store
                .find_best_match("What can you do?")
                .map(|pattern| pattern.id),
            Some(10)
        );
    }

    #[test]
    fn phrase_matching_keeps_required_stopwords() {
        let store = test_store();
        assert_eq!(
            store
                .find_best_match("How are you?")
                .map(|pattern| pattern.id),
            Some(2)
        );
        assert_eq!(
            store
                .find_best_match("Who are you?")
                .map(|pattern| pattern.id),
            Some(4)
        );
    }

    #[test]
    fn repeated_query_terms_do_not_satisfy_phrase_matching() {
        let store = KnowledgeStore {
            path: std::env::temp_dir().join("rustbot-knowledge-duplicate-query-test.json"),
            knowledge: Knowledge {
                patterns: vec![Pattern {
                    id: 1,
                    keywords: vec!["hello".to_string(), "world".to_string()],
                    response: "Hello world".to_string(),
                    match_mode: MatchMode::All,
                    category: Some("general".to_string()),
                }],
            },
            next_id: 2,
        };
        assert!(store.find_best_match("hello hello").is_none());
    }

    #[test]
    fn fuzzy_typo_matching_works() {
        let store = test_store();
        assert_eq!(
            store.find_best_match("greting").map(|pattern| pattern.id),
            Some(1)
        );
    }

    #[test]
    fn oversized_match_input_is_rejected_before_scoring() {
        let store = test_store();
        assert!(store.find_best_match(&"hello ".repeat(400)).is_none());
    }

    #[test]
    fn stemming_works() {
        assert_eq!(stem_word("running"), "run");
        assert_eq!(stem_word("walked"), "walk");
    }

    #[test]
    fn edit_distance_works() {
        assert_eq!(damerau_levenshtein("hello", "helo"), 1);
        assert_eq!(damerau_levenshtein("rust", "rsut"), 1);
    }

    #[test]
    fn category_filtering_works() {
        let store = test_store();
        let tech = store.patterns_by_category(Some("tech"));
        assert_eq!(tech.len(), 1);
        assert_eq!(tech[0].keywords, vec!["rust"]);

        let all = store.patterns_by_category(Some("all"));
        assert_eq!(all.len(), 10);
    }

    #[test]
    fn export_and_import_json_works() {
        let mut store = test_store();
        let path = store.path.clone();
        let exported = store.export_json().expect("Export should succeed");
        assert!(exported.contains("RustBot"));

        let imported_count = store.import_json(&exported).expect("Import should succeed");
        assert_eq!(imported_count, 10);
        assert_eq!(store.patterns().len(), 20);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_import_does_not_change_the_store() {
        let mut store = test_store();
        let before = store.patterns().len();
        let long_keyword = "x".repeat(MAX_KEYWORD_LENGTH + 1);
        let invalid = serde_json::json!({
            "patterns": [{
                "id": 1,
                "keywords": [long_keyword],
                "response": "Invalid memory",
                "match_mode": "all",
                "category": "general"
            }]
        });

        assert!(store.import_json(&invalid.to_string()).is_err());
        assert_eq!(store.patterns().len(), before);
    }

    #[test]
    fn stored_keywords_are_deduplicated_and_bounded() {
        assert_eq!(
            normalize_stored_keywords(&["Hello".to_string(), "hello".to_string()]).unwrap(),
            vec!["hello"]
        );
        assert!(normalize_stored_keywords(&[("x".repeat(MAX_KEYWORD_LENGTH + 1))]).is_err());
    }
}
