use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const MAX_PROMPT_LENGTH: usize = 500;
const MAX_RESPONSE_LENGTH: usize = 2_000;

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

        let mut changed = !path.exists();
        let mut next_id = knowledge
            .patterns
            .iter()
            .map(|pattern| pattern.id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);

        for pattern in &mut knowledge.patterns {
            if pattern.id == 0 {
                pattern.id = next_id;
                next_id = next_id.saturating_add(1);
                changed = true;
            }
            let normalized = pattern
                .keywords
                .iter()
                .flat_map(|keyword| tokenize(keyword))
                .collect::<Vec<_>>();
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

    pub fn patterns(&self) -> &[Pattern] {
        &self.knowledge.patterns
    }

    pub fn find_best_match(&self, input: &str) -> Option<&Pattern> {
        let input_words = tokenize(input);
        if input_words.is_empty() {
            return None;
        }

        self.knowledge
            .patterns
            .iter()
            .filter_map(|pattern| {
                if pattern.keywords.is_empty() {
                    return None;
                }

                let matched = pattern
                    .keywords
                    .iter()
                    .filter(|keyword| {
                        input_words
                            .iter()
                            .any(|word| keyword_matches(keyword, word))
                    })
                    .count();

                let qualifies = match pattern.match_mode {
                    MatchMode::Any => matched > 0,
                    MatchMode::All => matched == pattern.keywords.len(),
                };

                qualifies.then_some((matched, pattern.keywords.len(), pattern))
            })
            .max_by_key(|(matched, specificity, _)| (*matched, *specificity))
            .map(|(_, _, pattern)| pattern)
    }

    pub fn teach(&mut self, prompt: &str, response: &str) -> Result<Pattern, String> {
        validate_text(prompt, "Prompt", MAX_PROMPT_LENGTH)?;
        validate_text(response, "Response", MAX_RESPONSE_LENGTH)?;

        let keywords = tokenize(prompt);
        if keywords.is_empty() {
            return Err("Prompt needs at least one word.".to_string());
        }

        let pattern = Pattern {
            id: self.next_id,
            keywords,
            response: response.trim().to_string(),
            match_mode: MatchMode::All,
        };
        self.next_id = self.next_id.saturating_add(1);
        self.knowledge.patterns.push(pattern.clone());
        self.save()?;
        Ok(pattern)
    }

    pub fn forget(&mut self, id: u64) -> Result<Pattern, String> {
        let index = self
            .knowledge
            .patterns
            .iter()
            .position(|pattern| pattern.id == id)
            .ok_or_else(|| format!("Memory #{id} does not exist."))?;
        let removed = self.knowledge.patterns.remove(index);
        if let Err(error) = self.save() {
            self.knowledge.patterns.insert(index, removed.clone());
            return Err(error);
        }
        Ok(removed)
    }

    pub fn restore(&mut self, pattern: Pattern) -> Result<Pattern, String> {
        if self
            .knowledge
            .patterns
            .iter()
            .any(|existing| existing.id == pattern.id)
        {
            return Err(format!("Memory #{} already exists.", pattern.id));
        }
        validate_text(&pattern.response, "Response", MAX_RESPONSE_LENGTH)?;
        if pattern.keywords.is_empty() {
            return Err("A memory needs at least one keyword.".to_string());
        }
        self.next_id = self.next_id.max(pattern.id.saturating_add(1));
        self.knowledge.patterns.push(pattern.clone());
        self.knowledge.patterns.sort_by_key(|entry| entry.id);
        self.save()?;
        Ok(pattern)
    }

    fn save(&self) -> Result<(), String> {
        let data = serde_json::to_string_pretty(&self.knowledge)
            .map_err(|error| format!("Could not serialize knowledge: {error}"))?;
        fs::write(&self.path, data)
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

fn tokenize(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn keyword_matches(keyword: &str, word: &str) -> bool {
    if keyword == word {
        return true;
    }

    let shorter_length = keyword.chars().count().min(word.chars().count());
    shorter_length >= 4
        && (keyword.starts_with(word) || word.starts_with(keyword))
        && keyword.chars().count().abs_diff(word.chars().count()) <= 3
}

fn seeded_patterns() -> Vec<Pattern> {
    let memories = [
        (
            vec!["hello", "hi", "hey", "greetings"],
            "Hey there! How can I help you today?",
            MatchMode::Any,
        ),
        (
            vec!["how", "are", "you"],
            "I'm a small Rust program, and all systems are glowing. 🦀",
            MatchMode::All,
        ),
        (
            vec!["your", "name"],
            "I'm RustBot — a self-learning chatbot built in Rust.",
            MatchMode::All,
        ),
        (
            vec!["who", "are", "you"],
            "I'm RustBot, a local chatbot that learns new answers from you.",
            MatchMode::All,
        ),
        (
            vec!["weather"],
            "I can't check live weather yet, but I hope it's kind where you are.",
            MatchMode::All,
        ),
        (
            vec!["thanks", "thank"],
            "You're welcome. Happy to help. 😊",
            MatchMode::Any,
        ),
        (
            vec!["rust"],
            "Rust is a systems language focused on speed, memory safety, and fearless concurrency.",
            MatchMode::All,
        ),
        (
            vec!["bye", "goodbye"],
            "See you next time. I'll keep the forge warm. 👋",
            MatchMode::Any,
        ),
        (
            vec!["help"],
            "Ask me something, or teach me when I don't know the answer. Every lesson is saved to my knowledge forge.",
            MatchMode::All,
        ),
        (
            vec!["what", "can", "you", "do"],
            "I match questions to local memories, learn new replies from you, and let you review or forget what I know.",
            MatchMode::All,
        ),
    ];

    memories
        .into_iter()
        .enumerate()
        .map(|(index, (keywords, response, match_mode))| Pattern {
            id: index as u64 + 1,
            keywords: keywords.into_iter().map(ToOwned::to_owned).collect(),
            response: response.to_string(),
            match_mode,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> KnowledgeStore {
        KnowledgeStore {
            path: PathBuf::from("unused-test-knowledge.json"),
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
    fn very_short_prefixes_do_not_match() {
        let store = test_store();
        assert!(store.find_best_match("h").is_none());
    }
}
