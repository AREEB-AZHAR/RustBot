# RustBot Knowledge Forge

RustBot is a local, self-learning chatbot with a responsive browser interface and a separate quantitative Market Lab. Its matching engine, persistent knowledge store, and secure market-data proxy stay in Rust; the browser handles conversation, teaching, feature engineering, model training, and walk-forward reporting.

## Start the visual app

```powershell
cargo run --release
```

Then open [http://127.0.0.1:7878](http://127.0.0.1:7878).

The interface lets you:

- chat with the built-in knowledge base;
- view engine response time beside every RustBot reply;
- teach an answer directly beneath an unknown response;
- open, collapse, search, and manage the knowledge side panel;
- undo an accidental deletion;
- keep learned responses in `knowledge.json`.

The original conversation remains the default workspace. **Market Lab** adds a research-only flow that can:

- fetch public candlesticks from Binance Spot, CoinGecko, or Kraken;
- train a small logistic price-direction baseline in the browser;
- keep the newest 15% of candles untouched for out-of-sample scoring;
- account for a simple 0.10% cost assumption in its test return;
- abstain when a prediction does not cross its validation-selected threshold;
- compare the experiment visually with an embedded TradingView chart.

The lab does not place orders, store exchange credentials, or promise future accuracy. Binance and Kraken public market-data requests do not require account keys. If CoinGecko requires demo authentication, set its key before starting RustBot:

```powershell
$env:COINGECKO_API_KEY="your-demo-key"
cargo run --release
```

## Terminal mode

The original terminal experience is still available:

```powershell
cargo run --release -- --cli
```

## Validate the project

```powershell
cargo fmt -- --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo build --release
```

The server binds only to `127.0.0.1` by default. The site and API are served from the same Rust binary, so no Node.js runtime or separate frontend server is required.
