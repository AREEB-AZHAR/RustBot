mod knowledge;
mod server;

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
    let knowledge_path = PathBuf::from("knowledge.json");

    if std::env::args().any(|argument| argument == "--cli") {
        return run_cli(KnowledgeStore::load(knowledge_path)?);
    }

    server::run("127.0.0.1:7878", knowledge_path)
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
