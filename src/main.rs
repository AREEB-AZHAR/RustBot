pub mod config;
pub mod db;
mod knowledge;
mod market_structure;
mod news_sentiment;
mod server;
pub mod timesfm_matrix;

use config::AppConfig;
use db::Database;
use knowledge::KnowledgeStore;
use std::io::{self, Write};
use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("RustBot could not start: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let config = AppConfig::load()?;
    let db = Database::open(&config.database_url)?;
    let knowledge_path = PathBuf::from("knowledge.json");

    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|arg| arg == "--bootstrap-admin") {
        return run_bootstrap_admin(&db);
    }

    if args.iter().any(|arg| arg == "--import-knowledge") {
        return run_import_knowledge(&db, &knowledge_path);
    }

    if args.iter().any(|arg| arg == "--cli") {
        return run_cli(KnowledgeStore::load(knowledge_path)?);
    }

    println!(
        "RustBot starting in {:?} mode on http://{}",
        config.env,
        config.bind_address()
    );

    // Auto-migrate legacy knowledge if database is empty but knowledge.json exists
    if knowledge_path.exists() {
        if let Ok(memories) = db.list_memories() {
            if memories.is_empty() {
                if let Ok(stats) = db.import_memories_from_json(&knowledge_path) {
                    if stats.inserted > 0 {
                        println!(
                            "Auto-migrated {} memories from knowledge.json to SQLite database.",
                            stats.inserted
                        );
                    }
                }
            }
        }
    }

    server::run(config, db, knowledge_path)
}

fn run_bootstrap_admin(db: &Database) -> Result<(), String> {
    println!("=== RustBot Administrator Bootstrap ===");

    if db.has_admin_user()? {
        println!("An active administrator already exists in the database. Bootstrap skipped.");
        return Ok(());
    }

    print!("Enter Administrator Username (min 3 chars): ");
    io::stdout().flush().map_err(|e| e.to_string())?;
    let username = read_line()?;
    if username.trim().len() < 3 {
        return Err("Username must be at least 3 characters.".to_string());
    }

    print!("Enter Administrator Email (optional, press Enter to skip): ");
    io::stdout().flush().map_err(|e| e.to_string())?;
    let email_raw = read_line()?;
    let email = if email_raw.trim().is_empty() {
        None
    } else {
        Some(email_raw.trim().to_string())
    };

    print!("Enter Administrator Password (min 8 chars): ");
    io::stdout().flush().map_err(|e| e.to_string())?;
    let password = read_line()?;
    if password.len() < 8 {
        return Err("Password must be at least 8 characters.".to_string());
    }

    let user = db.bootstrap_admin(&username, email.as_deref(), &password)?;
    println!(
        "\n✅ Success: Administrator account '{}' created with ID {}.",
        user.username, user.id
    );
    println!("You can now use these credentials to log in and manage shared memories.\n");
    Ok(())
}

fn run_import_knowledge(db: &Database, knowledge_path: &PathBuf) -> Result<(), String> {
    println!("Importing knowledge from {:?} into SQLite...", knowledge_path);
    let stats = db.import_memories_from_json(knowledge_path)?;
    println!(
        "Import summary: Total read: {}, Inserted: {}, Skipped: {}, Rejected: {}",
        stats.total_read, stats.inserted, stats.skipped, stats.rejected
    );
    Ok(())
}

fn run_cli(mut store: KnowledgeStore) -> Result<(), String> {
    println!("RustBot Knowledge Forge — terminal mode");
    println!("Type 'list', 'learn', 'forget <id>', or 'exit'.\n");

    loop {
        print!("You: ");
        io::stdout().flush().map_err(|error| error.to_string())?;

        let input = read_line()?;
        let command = input.trim();

        if matches!(command, "quit" | "exit") {
            println!("RustBot: Goodbye! 👋");
            return Ok(());
        }

        if command == "list" {
            for pattern in store.patterns() {
                println!(
                    "[{}] {} → {}",
                    pattern.id,
                    pattern.keywords.join(", "),
                    pattern.response
                );
            }
            println!();
            continue;
        }

        if command == "learn" {
            print!("Teach me to respond to: ");
            io::stdout().flush().map_err(|error| error.to_string())?;
            let prompt = read_line()?;
            print!("My response should be: ");
            io::stdout().flush().map_err(|error| error.to_string())?;
            let response = read_line()?;
            let pattern = store.teach(&prompt, &response)?;
            println!("RustBot: Saved memory #{}.\n", pattern.id);
            continue;
        }

        if let Some(id) = command.strip_prefix("forget ") {
            let id = id
                .trim()
                .parse::<u64>()
                .map_err(|_| "Please provide a valid memory id.".to_string())?;
            store.forget(id)?;
            println!("RustBot: Memory #{id} forgotten.\n");
            continue;
        }

        if command.is_empty() {
            continue;
        }

        match store.find_best_match(command) {
            Some(pattern) => println!("RustBot: {}\n", pattern.response),
            None => println!("RustBot: That isn't in my memory yet. Use 'learn' to teach me.\n"),
        }
    }
}

fn read_line() -> Result<String, String> {
    let mut value = String::new();
    io::stdin()
        .read_line(&mut value)
        .map_err(|error| error.to_string())?;
    Ok(value.trim().to_string())
}
