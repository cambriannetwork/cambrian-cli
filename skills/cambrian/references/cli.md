# CLI Reference

Use the CLI for agent access whenever possible.
This file is the command reference layer, not the canonical native-skill manifest.
For native skill install and routing rules, use [../SKILL.md](../SKILL.md) plus the adapter files under `agents/`.

Published package:
- install with `npm install -g cambrian` when the CLI is not already present
- the package ships the typed client, packaged skill bundle, and the same hosted API surface used below

Auth rule:
- the published package reads credentials from flags and ambient process env, not from project-local `.env`
- if there is any doubt, pass `--api-key` explicitly
- throttling surfaces as a clean CLI error; raw HTTP callers should read `X-RateLimit-*` and `Retry-After`

## Fast Path

If the goal is to make an agent productive quickly, use this order:

1. confirm `CAMBRIAN_API_KEY` is available to the runtime
2. verify one successful read
3. inspect `describe opencli` if the runtime can ingest tool metadata
4. use the routing map below, then use [workflows.md](workflows.md) for multi-step compositions

Shortest live-path check:

```bash
cambrian solana trending-tokens
cambrian solana price-current --token-address So11111111111111111111111111111111111111112
cambrian describe opencli
```

Successful setup looks like:

- `trending-tokens` returns a list of currently trending Solana tokens
- `price-current` returns a price snapshot for the given mint address
- `describe opencli` prints the machine-readable command contract without requiring hand-written HTTP docs

Execution best practice:

- treat `describe opencli` as setup metadata, not a per-task preflight step
- do not start routine reads with `cambrian --help` or `which cambrian`
- once the routing surface is known, go straight to the narrowest `cambrian <group> <resource>` command that fits the ask
- use documented named flags such as `--token-address`, `--pool-address`, `--days`; do not pass values positionally

## Start Here By Prompt

- for "what's hot on Solana?", start with `solana trending-tokens`
- for a specific Solana token price, start with `solana price-current`
- for Solana token details or metadata, start with `solana token-details`
- for Solana token holders or distribution, start with `solana tokens-holders`
- for Solana token security, start with `solana tokens-security`
- for a specific Solana pool on a known DEX, start with `solana <dex>-pool` (e.g., `solana orca-pool`, `solana meteora-dlmm-pool`, `solana raydium-clmm-pool`)
- for finding pools for a Solana token, start with `solana token-pool-search`
- for Solana OHLCV candles, start with `solana ohlcv-token` or `solana ohlcv-pool`
- for Solana pool transactions, start with `solana pool-transactions`
- for Solana token transactions, start with `solana token-transactions`
- for Solana trader rankings, start with `solana traders-leaderboard`
- for Solana wallet analysis, start with `solana wallet-balance-history` or `solana holder-token-balances`
- for Base pool metrics on a specific DEX, start with `base <dex>-v3-pool` (alias: `evm`)
- for Base LP provider analysis (Aerodrome v2), start with `base aero-v2-provider-positions`
- for supported Base chains, start with `base chains`
- for supported Base DEXes, start with `base dexes`
- for Base token price, start with `base price-current`
- for alpha tweet feeds, start with `deep42 social-data/alpha-tweet-detection`
- for influencer rankings, start with `deep42 social-data/influencer-credibility`
- for sentiment changes, start with `deep42 social-data/sentiment-shifts`
- for perp risk analysis, start with `risk perp-risk-engine`

Common mistakes:

- do not route Solana questions to `base` or vice versa
- do not pass EVM addresses to Solana endpoints or Solana mint addresses to Base endpoints
- do not guess pool or token addresses; ask the user if missing
- do not conflate Aerodrome v2 (classic AMM) with Aerodrome v3 (concentrated liquidity)
- do not use `trending-tokens` as a substitute for a specific token lookup
- do not use `pool-transactions` when `token-transactions` is the correct scope, or vice versa

## Solana Commands

### Tokens and Prices

Token list / metadata:

```bash
cambrian solana tokens
```

Token details:

```bash
cambrian solana token-details --token-address <mint>
cambrian solana token-details-multi --token-addresses <mint1>,<mint2>
```

Meaning:
- returns token metadata, supply, market cap, and descriptive fields
- use `token-details-multi` for batch lookups instead of separate per-token calls

Token holders:

```bash
cambrian solana tokens-holders --program-id <mint>
cambrian solana tokens-holders-over-time --token-address <mint> --start-block <n> --end-block <n> --interval <n>
cambrian solana tokens-holder-distribution-over-time --token-address <mint> --start-block <n> --end-block <n> --interval <n>
```

Meaning:
- `tokens-holders` returns the current holder list
- `tokens-holders-over-time` returns holder count history
- `tokens-holder-distribution-over-time` returns distribution brackets over time
- use these for "who holds this token?" or "how has the holder base changed?"

Token security:

```bash
cambrian solana tokens-security --token-address <mint>
```

Meaning:
- returns security audit data: freeze authority, mint authority, top holder concentration
- use for "is this token safe?" or rug-pull risk questions

Current price:

```bash
cambrian solana price-current --token-address <mint>
```

Hourly price:

```bash
cambrian solana price-hour --token-address <mint> --interval <interval>
```

Unix timestamp price:

```bash
cambrian solana price-unix --token-address <mint> --unixtime <unix>
```

Multi-token price:

```bash
cambrian solana price-multi --token-addresses <mint1>,<mint2>,<mint3>
```

Meaning:
- `price-current` for latest spot price
- `price-hour` for the last hourly candle; `--interval` is required
- `price-unix` for a price at a specific timestamp
- `price-multi` for batch price lookups; preferred over multiple `price-current` calls

Trending tokens:

```bash
cambrian solana trending-tokens
```

Meaning:
- returns currently trending tokens on Solana
- use for "what's hot?" or discovery prompts

Price and volume:

```bash
cambrian solana price-volume-single --token-address <mint> --timeframe <tf>
cambrian solana price-volume-multi --token-addresses <mint1>,<mint2> --timeframe <tf>
```

Meaning:
- combined price and volume snapshot
- `--timeframe` is required
- use `multi` for batch lookups

Trade statistics:

```bash
cambrian solana trade-statistics --token-addresses <mint> --timeframe <tf>
```

Meaning:
- aggregated trade stats for a token: buy/sell counts, volumes, unique traders
- `--token-addresses` and `--timeframe` are both required
- use for "how actively is this token trading?"

### OHLCV Candles

By token:

```bash
cambrian solana ohlcv-token --token-address <mint> --interval 1h --after-time <unix> --before-time <unix>
```

By pool:

```bash
cambrian solana ohlcv-pool --pool-address <pool> --interval 1h --after-time <unix> --before-time <unix>
```

By base-quote pair:

```bash
cambrian solana ohlcv-base-quote --base-address <mint> --quote-address <mint> --interval 1h --after-time <unix> --before-time <unix>
```

Meaning:
- standard OHLCV candle data at configurable intervals
- `--interval` accepts values like `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
- `--after-time` and `--before-time` are required unix timestamps
- use `ohlcv-token` when you have a mint address, `ohlcv-pool` when you have a pool address, `ohlcv-base-quote` when you have a trading pair

### Solana Pools

Meteora DLMM:

```bash
cambrian solana meteora-dlmm-pool --pool-address <pool>
cambrian solana meteora-dlmm-pool-multi --pool-addresses <pool1>,<pool2>
cambrian solana meteora-dlmm-pools
```

Meaning:
- `pool` returns metrics for a single Meteora DLMM pool
- `pool-multi` returns metrics for multiple pools in one call
- `pools` returns a list/search across Meteora DLMM pools

Raydium CLMM:

```bash
cambrian solana raydium-clmm-pool --pool-address <pool>
cambrian solana raydium-clmm-pool-multi --pool-addresses <pool1>,<pool2>
cambrian solana raydium-clmm-pools
```

Meaning:
- same pattern as Meteora: single pool, multi pool, pool list

Orca:

```bash
cambrian solana orca-pool --pool-address <pool>
cambrian solana orca-pool-multi --pool-addresses <pool1>,<pool2>
cambrian solana orca-pools
cambrian solana orca-pools-fee-metrics --pool-address <pool> --days <n>
cambrian solana orca-pools-fee-ranges --pool-address <pool> --days <n>
cambrian solana orca-pools-historical-data --pool-address <pool> --days <n>
cambrian solana orca-pools-liquidity-map --pool-address <pool> --resolution 100
```

Meaning:
- `orca-pool` and `orca-pools` follow the standard pattern
- `fee-metrics` returns fee APR and fee generation data; `--days` is required
- `fee-ranges` returns fee distribution across tick ranges
- `historical-data` returns historical pool metrics; `--days` is required
- `liquidity-map` returns the liquidity distribution across price ticks

Pool search:

```bash
cambrian solana token-pool-search --token-address <mint>
```

Meaning:
- finds all pools containing a given token across supported DEXes
- use this when you know the token but not the pool address

### Transactions

Pool transactions:

```bash
cambrian solana pool-transactions --pool-address <pool> --days <n>
cambrian solana pool-transactions-time-bounded --pool-address <pool> --after-time <unix> --before-time <unix>
```

Token transactions:

```bash
cambrian solana token-transactions --token-address <mint> --days <n>
cambrian solana token-transactions-time-bounded --token-address <mint> --after-time <unix> --before-time <unix>
```

Mint and burn:

```bash
cambrian solana token-mint-burn-transactions --token-address <mint> --after-time <unix> --before-time <unix>
```

Meaning:
- `pool-transactions` returns recent swaps and liquidity events for a pool; `--pool-address` and `--days` are required
- `token-transactions` returns recent transactions for a token across all pools; `--token-address` and `--days` are required
- time-bounded variants accept `--after-time` and `--before-time` as unix timestamps
- `token-mint-burn-transactions` requires `--token-address`, `--after-time`, and `--before-time`
- use pool transactions for pool-specific analysis, token transactions for token-wide analysis

### Traders and Wallets

Trader leaderboard:

```bash
cambrian solana traders-leaderboard --token-address <mint> --interval "24 HOUR"
```

Meaning:
- returns top traders ranked by PnL or volume for a specific token
- `--token-address` and `--interval` (e.g. "24 HOUR") are both required
- use for "who are the best traders on Solana for this token?"

Wallet balance history:

```bash
cambrian solana wallet-balance-history --wallet-address <wallet> --token-address <mint> --after-time <unix> --before-time <unix>
```

Holder token balances:

```bash
cambrian solana holder-token-balances --wallet-address <wallet>
```

Meaning:
- `wallet-balance-history` returns historical balance snapshots for a wallet; `--wallet-address`, `--token-address`, `--after-time`, and `--before-time` are all required
- `holder-token-balances` returns current token holdings for a wallet address
- use for "what does this wallet hold?" or "how has this wallet's balance changed?"

Latest block:

```bash
cambrian solana latest-block
```

Meaning:
- returns the latest Solana block number and timestamp
- use for freshness checks or timestamp anchoring

## Base Commands

Note: `cambrian base` is the primary command group; `cambrian evm` is accepted as an alias.

### Pools

Uniswap v3:

```bash
cambrian base uniswap-v3-pool --pool-address <pool>
cambrian base uniswap-v3-pools
```

Aerodrome v2 (classic AMM, Base chain):

```bash
cambrian base aero-v2-pool --pool-address <pool>
cambrian base aero-v2-pools
cambrian base aero-v2-pool-volume --pool-address <pool>
cambrian base aero-v2-fee-metrics --pool-address <pool>
```

Aerodrome v3 (concentrated liquidity, Base chain):

```bash
cambrian base aero-v3-pool --pool-address <pool>
cambrian base aero-v3-pools
```

SushiSwap v3:

```bash
cambrian base sushi-v3-pool --pool-address <pool>
cambrian base sushi-v3-pools
```

PancakeSwap v3:

```bash
cambrian base pancake-v3-pool --pool-address <pool>
cambrian base pancake-v3-pools
```

Alienbase v3:

```bash
cambrian base alien-v3-pool --pool-address <pool>
cambrian base alien-v3-pools
```

Clones v3:

```bash
cambrian base clones-v3-pool --pool-address <pool>
cambrian base clones-v3-pools
```

Meaning:
- each DEX follows the same `pool` / `pools` pattern
- `pool` returns detailed metrics for one pool
- `pools` returns a list/search across pools on that DEX
- Aerodrome v2 additionally has `pool-volume` and `fee-metrics`
- all endpoints target the Base chain; there is no `--chain-id` flag
- do not conflate Aerodrome v2 (classic AMM) with v3 (concentrated liquidity)

### LP Providers (Aerodrome v2)

```bash
cambrian base aero-v2-providers
cambrian base aero-v2-provider-positions --wallet-address <provider-address>
cambrian base aero-v2-provider-summary --wallet-address <provider-address>
```

Meaning:
- `providers` lists all LPs in a given Aerodrome v2 pool
- `provider-positions` returns detailed position data for a specific LP
- `provider-summary` returns an aggregate summary across all pools for a given LP address
- use for "who provides liquidity in this pool?" or "what are this LP's positions?"

### TVL

```bash
cambrian base tvl-status --wallet-address <wallet>
cambrian base tvl-top-owners --token-address <token>
```

Meaning:
- `tvl-status` returns overall TVL status and health
- `tvl-top-owners` returns top TVL owners
- use for "what are the biggest pools?" or "who has the most TVL?"

### Chain and DEX Discovery

```bash
cambrian base chains
cambrian base dexes
```

Meaning:
- `chains` returns all supported chains
- `dexes` returns all supported DEXes with chain mappings
- use these first when the user asks about a chain or DEX you have not seen before

### Base Tokens and Prices

```bash
cambrian base tokens
cambrian base price-current --token-address <token>
cambrian base price-hour --token-address <token> --hours <n>
```

Meaning:
- `tokens` returns the token list
- `price-current` returns the latest price for a Base token
- `price-hour` returns the last hourly candle; `--hours` is required

## Deep42 Commands

### Social Data

Alpha tweet detection:

```bash
cambrian deep42 social-data/alpha-tweet-detection --limit <n> --token-filter <symbol>
```

Meaning:
- returns a feed of high-signal alpha tweets
- `--limit` (int, max 100, default 20) controls how many results to return
- `--token-filter` (string) narrows results to tweets mentioning a specific token
- use for "find alpha tweets" or "what are insiders saying about <token>?"

Influencer credibility:

```bash
cambrian deep42 social-data/influencer-credibility --min-tweets <n> --limit <n> --token-focus <symbol> --sort-by <field> --order <dir> --time-window <window>
```

Meaning:
- returns credibility rankings for crypto influencers on Twitter/X
- `--min-tweets` (int) filters out influencers below a tweet count threshold
- `--limit` (int) controls how many results to return
- `--token-focus` (string) narrows results to influencers discussing a specific token
- `--sort-by` accepts one of: `credibility`, `tweets`, `engagement`, `reach`, `alpha`, `accuracy`
- `--order` accepts `asc` or `desc`
- `--time-window` (string) sets the evaluation period
- use for "who are the most credible crypto influencers?" or "rank influencers by accuracy"

Sentiment shifts:

```bash
cambrian deep42 social-data/sentiment-shifts --comparison-period <period> --limit <n>
```

Meaning:
- returns tokens with notable sentiment changes over a comparison period
- `--comparison-period` (string) sets the lookback window for detecting shifts
- `--limit` (int) controls how many results to return
- use for "what tokens have shifting sentiment?" or "has social mood changed recently?"

Token analysis:

```bash
cambrian deep42 social-data/token-analysis --token-symbol <symbol>
```

Meaning:
- returns social intelligence for a specific token
- use for "what is the social picture around SOL?" or token-focused research

Trending momentum:

```bash
cambrian deep42 social-data/trending-momentum --limit <n>
```

Meaning:
- returns projects or tokens with notable social momentum
- use for discovery prompts before drilling into on-chain metrics

## Risk Commands

### Perp Risk Engine

```bash
cambrian risk perp-risk-engine --token-address <addr> --entry-price <n> --leverage <n> --direction <long|short> --risk-horizon <1h|1d|1w|1mo>
```

Meaning:
- runs a perpetual futures risk simulation
- accepts individual flags for position parameters: `--token-address`, `--entry-price`, `--leverage`, `--direction`, `--risk-horizon`
- returns liquidation price, margin requirements, and risk metrics
- use for "what's my liquidation price?" or "how much can I leverage?"

## Shared Options

- `--api-key` overrides `CAMBRIAN_API_KEY` from environment

Default env vars:
- `CAMBRIAN_API_KEY`

Base URLs:
- Opabinia (Solana + Base): `https://opabinia.cambrian.network`
- Deep42: `https://deep42.cambrian.network`
- Risk: `https://risk.cambrian.network`

## Skill Commands

Install into the Claude skill directory:

```bash
cambrian skill install --tool claude
```

Install into the OpenCode skill directory:

```bash
cambrian skill install --tool opencode
```

Install into a custom directory:

```bash
cambrian skill install --path /custom/skills/cambrian
```

Print the packaged skill:

```bash
cambrian skill print
```

Print a thin platform adapter:

```bash
cambrian skill print --adapter openai
cambrian skill print --adapter claude
cambrian skill print --adapter opencode
```

Inspect supported skill targets:

```bash
cambrian skill targets
```

## MCP Commands

Print hosted MCP configuration:

```bash
cambrian mcp config --client claude --mode hosted
```

Print local stdio MCP configuration:

```bash
cambrian mcp config --client claude --mode local
```

Install hosted MCP into Claude:

```bash
cambrian mcp install --client claude --mode hosted
```

Smoke-test hosted MCP:

```bash
cambrian mcp test --mode hosted
```

Meaning:
- hosted mode uses BYOK auth against Cambrian's managed endpoint
- local mode launches `npx -y cambrian-api-mcp`
- live MCP tests require `CAMBRIAN_API_KEY` or `--api-key`

## Machine-Readable Contract

Print the OpenCLI document:

```bash
cambrian describe opencli
```

## Workflow Recipes

For repeatable multi-step agent chains, use [workflows.md](workflows.md).
