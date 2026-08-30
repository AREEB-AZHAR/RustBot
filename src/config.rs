use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Environment {
    Development,
    Production,
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub env: Environment,
    pub host: String,
    pub port: u16,
    pub public_origin: String,
    pub database_url: PathBuf,
    pub openrouter_api_key: Option<String>,
    pub coingecko_api_key: Option<String>,
    pub session_pepper: String,
}

impl AppConfig {
    /// Loads configuration from environment variables and an optional `.env` file.
    pub fn load() -> Result<Self, String> {
        Self::load_from(Path::new(".env"))
    }

    pub fn load_from(env_file_path: &Path) -> Result<Self, String> {
        let mut env_map = std::collections::HashMap::new();

        if env_file_path.exists() {
            if let Ok(content) = fs::read_to_string(env_file_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = trimmed.split_once('=') {
                        let key = key.trim().to_string();
                        let val = val.trim();
                        // Strip quotes if present
                        let unquoted = if (val.starts_with('"') && val.ends_with('"'))
                            || (val.starts_with('\'') && val.ends_with('\''))
                        {
                            if val.len() >= 2 {
                                &val[1..val.len() - 1]
                            } else {
                                val
                            }
                        } else {
                            val
                        };
                        env_map.insert(key, unquoted.to_string());
                    }
                }
            }
        }

        let get_var = |key: &str| -> Option<String> {
            std::env::var(key)
                .ok()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| env_map.get(key).cloned().filter(|s| !s.trim().is_empty()))
        };

        let env_str = get_var("RUSTBOT_ENV").unwrap_or_else(|| "development".to_string());
        let env = match env_str.to_lowercase().as_str() {
            "production" | "prod" => Environment::Production,
            "development" | "dev" | "test" => Environment::Development,
            other => {
                return Err(format!(
                    "Invalid RUSTBOT_ENV '{other}'. Must be 'development' or 'production'."
                ))
            }
        };

        let host = get_var("RUSTBOT_HOST").unwrap_or_else(|| "127.0.0.1".to_string());
        let port_str = get_var("RUSTBOT_PORT").unwrap_or_else(|| "7878".to_string());
        let port = port_str
            .parse::<u16>()
            .map_err(|_| format!("Invalid RUSTBOT_PORT '{port_str}'. Must be a valid port (1-65535)."))?;

        let default_origin = format!("http://{host}:{port}");
        let public_origin = get_var("RUSTBOT_PUBLIC_ORIGIN").unwrap_or(default_origin);

        let database_url = get_var("RUSTBOT_DATABASE_URL")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("rustbot.db"));

        let openrouter_api_key = get_var("OPENROUTER_API_KEY");
        let coingecko_api_key = get_var("COINGECKO_API_KEY");
        let session_pepper = get_var("RUSTBOT_SESSION_PEPPER").unwrap_or_default();

        let config = Self {
            env,
            host,
            port,
            public_origin,
            database_url,
            openrouter_api_key,
            coingecko_api_key,
            session_pepper,
        };

        config.validate()?;
        Ok(config)
    }

    /// Validate configuration invariants according to the multi-user security rules.
    pub fn validate(&self) -> Result<(), String> {
        if self.env == Environment::Production {
            if !self.public_origin.starts_with("https://") {
                return Err(format!(
                    "Security violation: RUSTBOT_PUBLIC_ORIGIN ('{}') must begin with 'https://' in production.",
                    self.public_origin
                ));
            }
            if self.public_origin.contains('*') {
                return Err("Security violation: Wildcard origins are strictly forbidden in production.".to_string());
            }
            if self.session_pepper.len() < 16 {
                return Err("Security violation: RUSTBOT_SESSION_PEPPER must be set to a secure string (at least 16 characters) in production.".to_string());
            }
        }

        if self.public_origin.is_empty() {
            return Err("RUSTBOT_PUBLIC_ORIGIN cannot be empty.".to_string());
        }

        Ok(())
    }

    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn is_production(&self) -> bool {
        self.env == Environment::Production
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_development_defaults() {
        let config = AppConfig {
            env: Environment::Development,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "http://127.0.0.1:7878".to_string(),
            database_url: PathBuf::from("rustbot.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "".to_string(),
        };
        assert!(config.validate().is_ok());
        assert!(!config.is_production());
    }

    #[test]
    fn test_production_rejects_insecure_origin() {
        let config = AppConfig {
            env: Environment::Production,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "http://chat.example.com".to_string(),
            database_url: PathBuf::from("rustbot.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "a-very-long-secret-pepper-string".to_string(),
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("must begin with 'https://'"));
    }

    #[test]
    fn test_production_rejects_empty_session_pepper() {
        let config = AppConfig {
            env: Environment::Production,
            host: "127.0.0.1".to_string(),
            port: 7878,
            public_origin: "https://chat.example.com".to_string(),
            database_url: PathBuf::from("rustbot.db"),
            openrouter_api_key: None,
            coingecko_api_key: None,
            session_pepper: "short".to_string(),
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("RUSTBOT_SESSION_PEPPER"));
    }

    #[test]
    fn test_production_accepts_valid_config() {
        let config = AppConfig {
            env: Environment::Production,
            host: "0.0.0.0".to_string(),
            port: 7878,
            public_origin: "https://rustbot.duckdns.org".to_string(),
            database_url: PathBuf::from("rustbot.db"),
            openrouter_api_key: Some("key".to_string()),
            coingecko_api_key: None,
            session_pepper: "super-secret-pepper-phrase-for-auth".to_string(),
        };
        assert!(config.validate().is_ok());
        assert!(config.is_production());
    }
}
