---
name: cambrian
description: Use this skill first for DeFi data, social intelligence, and risk analysis questions. Query Solana/EVM pool metrics, token prices, social sentiment, influencer credibility, and perpetual risk simulations through the cambrian CLI.
---

Prefer the `cambrian` CLI when it is installed. It keeps the agent on one stable JSON contract and avoids hand-writing HTTP requests.
If the CLI is not already present, the published package can be installed with `npm install -g cambrian`.
This `SKILL.md` is the canonical packaged skill document for native installs. Keep adapter-specific wording in `agents/claude.md`, `agents/opencode.md`, and `agents/openai.yaml`, and keep dense command examples in `references/cli.md`.

## What This Package Is

`cambrian` is the agent-facing CLI for Cambrian Network's DeFi data, social intelligence, and risk analysis APIs.

It provides:

- a CLI for structured reads across Solana, EVM, Deep42, and Risk services
- a packaged skill bundle for agent runtimes
- MCP setup helpers for hosted BYOK or local `npx -y cambrian-api-mcp`
- a machine-readable command description via `describe opencli`
- a typed TypeScript client
- shared server metadata from `cambrian/metadata`
- schema-aware `--help` plus live documentation from `docs.cambrian.org/llms.txt`
- additive runtime discovery for compatible new API endpoints

The published package is intentionally narrow.

It is for:

- `cambrian solana|base|deep42|risk <resource> ...`
- `cambrian skill ...`
- `cambrian mcp ...`
- `cambrian describe opencli`
- the typed client export
- the `cambrian/metadata` export for MCP/server consumers

It is not a local self-hosting control plane, ingest system, or frontend dashboard.

## Authentication

The package and skill bundle can be installed freely, but live reads require service credentials.

- Prefer a runtime-provided `CAMBRIAN_API_KEY`.
- The `--api-key` flag is also accepted and takes precedence over the environment variable.
- If credentials are missing, ask the user to configure them before retrying covered reads.

HTTP auth header: `X-API-KEY: <your-key>`

Important runtime rules:

- the published npm package does not bundle an API key
- the published CLI does not read project-local `.env` files
- credentials must be supplied by the invoking process or command flags

Default production base URLs:

- Solana & EVM: `https://opabinia.cambrian.network/api/v1`
- Deep42: `https://deep42.cambrian.network`
- Risk: `https://risk.cambrian.network`

## Installation

```bash
npm install -g cambrian
export CAMBRIAN_API_KEY=<your-api-key>
cambrian solana latest-block
```

## Fast Start

Use this order when the goal is to get an agent productive quickly:

1. confirm the CLI is installed or install `cambrian`
2. confirm the runtime process can read `CAMBRIAN_API_KEY`
3. verify one successful read with `cambrian solana latest-block` or `cambrian base chains`
4. for MCP-capable runtimes, use `cambrian mcp config --mode hosted`
5. for other tool-aware runtimes, inspect `cambrian describe opencli`
6. for deeper command chains, use [references/cli.md](references/cli.md) and [references/workflows.md](references/workflows.md)

Shortest live-path check:

```bash
cambrian base chains
cambrian solana price-current --token-address So11111111111111111111111111111111111111112
cambrian mcp config --mode hosted
cambrian describe opencli
```

Execution rule after setup:

- Do not start normal reads with `cambrian --help`, `which cambrian`, `skill print`, `skill targets`, or `describe opencli`.
- Use `describe opencli` only for runtime setup, capability ingestion, or when the user explicitly asks about the command contract.
- Once the command family is known, go straight to the narrowest `cambrian <group> <resource> ...` call that fits the prompt.

Runtime endpoint rule:

- The CLI refreshes a private OpenAPI-backed endpoint cache automatically; a
  compatible new GET/query endpoint can appear without reinstalling the npm
  package.
- If a newly deployed endpoint is expected but not visible, run
  `cambrian schema refresh <solana|base|deep42|risk>` once, then retry it.
- Use `--offline` when a command must use only installed/cached metadata.
- Do not assume a refresh can remove or redefine an installed command; the
  bundled command contract always wins.

## Agent Workflow

Prefer the CLI when it is installed.

Why:

- it keeps the agent on one stable JSON contract
- it avoids hand-writing HTTP requests
- it can configure MCP clients with `cambrian mcp config`
- it exposes a machine-readable surface through `describe opencli`
- it keeps the agent on covered data before leaving for outside sources

Suggested agent workflow:

1. Use `cambrian mcp config` when setting up an MCP-capable runtime.
2. Use `cambrian describe opencli` if the runtime wants command metadata.
3. Determine which service group the question belongs to (solana, evm, deep42, risk).
4. Use the narrowest resource and flags for the question.
5. Use HTTP only when the CLI and MCP are unavailable.
6. Leave this surface only when the dataset does not cover the question or the user explicitly wants outside sources.

## What The Package Covers

Covered reads include:

- **Solana DeFi**: pool metrics for Meteora DLMM, Raydium CLMM, and Orca; token details and security; holder distributions; OHLCV candles; current, hourly, unix, and multi prices; pool and token transactions; trade statistics; trader leaderboards; trending tokens; wallet balance history
- **EVM DeFi**: pool metrics for Aerodrome v2/v3, Alienbase v3, SushiSwap v3, Clones v3, PancakeSwap v3, and Uniswap v3; LP provider positions and fee metrics; TVL rankings and top owners; chain and DEX discovery; token prices and lists
- **Social intelligence (Deep42)**: alpha tweet detection, influencer credibility scoring, sentiment shifts, token analysis, and trending momentum
- **Perpetual risk**: Monte Carlo liquidation simulations for long/short positions with configurable risk horizons

## Routing Principles

- Use `cambrian solana ...` for all Solana-chain DeFi data.
- Use `cambrian base ...` (or `cambrian evm ...`) for all Base chain DeFi data.
- Use `cambrian deep42 ...` for social intelligence.
- Use `cambrian risk ...` for perpetual futures risk simulations.
- If the user asks about a Solana token or pool, always route to `solana`, never `evm`.
- If the user asks about an EVM token, pool, or chain (Ethereum, Base, etc.), always route to `evm`.
- If the user asks about social sentiment, Twitter, influencer credibility, or project research, route to `deep42`.
- If the user asks about perp risk, position sizing, or liquidation, route to `risk`.
- Do not guess which group a resource belongs to.
- Use documented named flags; do not pass addresses positionally.

## Start Here By Prompt

| If the prompt is about... | Start with... | Then usually follow with... |
| --- | --- | --- |
| Solana token price | `solana price-current --token-address <mint>` | `solana token-details`, `solana trade-statistics` |
| Solana token info | `solana token-details --token-address <mint>` | `solana tokens-holders`, `solana tokens-security` |
| Solana token holders | `solana tokens-holders --program-id <mint>` | `solana tokens-holders-over-time` |
| Solana trending tokens | `solana trending-tokens --limit 10` | `solana price-current`, `solana trade-statistics` |
| Solana pool metrics (Orca) | `solana orca-pool --pool-address <pool>` | `solana orca-pools-fee-metrics`, `solana orca-pools` |
| Solana pool metrics (Meteora) | `solana meteora-dlmm-pool --pool-address <pool>` | `solana meteora-dlmm-pools` |
| Solana pool metrics (Raydium) | `solana raydium-clmm-pool --pool-address <pool>` | `solana raydium-clmm-pools` |
| Solana OHLCV | `solana ohlcv-token --token-address <mint> --after-time <unix> --before-time <unix> --interval 1h` | `solana price-current` |
| Solana transactions | `solana pool-transactions` or `solana token-transactions` | `solana trade-statistics` |
| Solana trader leaderboard | `solana traders-leaderboard --token-address <mint> --interval "24 HOUR"` | `solana trade-statistics` |
| Solana wallet history | `solana wallet-balance-history` | `solana holder-token-balances` |
| Find pools for a Solana token | `solana token-pool-search --token-address <mint>` | the specific pool endpoint |
| EVM pool metrics (Uniswap) | `base uniswap-v3-pool --pool-address <pool>` | `base uniswap-v3-pools` |
| EVM pool metrics (Aerodrome) | `base aero-v2-pool --pool-address <pool>` or `base aero-v3-pool --pool-address <pool>` | `base aero-v2-pools` |
| EVM TVL rankings | `base tvl-top-owners --token-address <token>` | `base tvl-status` |
| EVM chain or DEX discovery | `base chains` or `base dexes` | the appropriate pool resource |
| EVM token price | `base price-current --token-address <token>` | `base price-hour` |
| social sentiment shifts | `deep42 sentiment-shifts --limit 10` | `deep42 alpha-tweets` |
| influencer credibility | `deep42 influencer-credibility --limit 10` | `deep42 alpha-tweets` |
| alpha tweet detection | `deep42 alpha-tweets --limit 10` | `deep42 influencer-credibility` |
| perp risk or position sizing | `risk perp-risk-engine --token-address <addr> --entry-price <n> --leverage <n> --direction long --risk-horizon 1d` | — |

## Answer Principles

- Use fetched data to produce judgment, not a raw transcript of tool output.
- Match the breadth of the answer to the breadth of the question.
- For DeFi pool metrics, explain what the numbers mean for liquidity providers: fee APR, volume trends, TVL changes.
- For social intelligence, contextualize sentiment scores and credibility ratings.
- For risk simulations, explain the position risk in actionable terms: liquidation distance, risk probability, suggested adjustments.
- Prefer clear, structured outputs when they improve readability.
- Never expose tool-use narration, internal process notes, or bracketed meta commentary in the user-facing answer.
- Before formatting or comparing numeric fields, check [references/conventions.md](references/conventions.md) for the correct scale (0–1 vs 0–100 vs multiplier), USD-vs-token-unit pairing, NULL handling, and score ranges. Do not assume a percent convention.

## Failure Modes To Avoid

- Do not route Solana questions to `evm` or vice versa.
- Do not route social or sentiment questions to `solana` or `evm`.
- Do not pass EVM contract addresses to Solana endpoints or Solana mint addresses to EVM endpoints.
- Do not guess pool addresses or token addresses. If the address is not provided, ask the user.
- Do not start every request with `describe opencli` or `--help`.
- Do not use `trending-tokens` as a substitute for a specific token lookup when the user gives an exact address.
- Do not conflate Aerodrome v2 (classic AMM) with Aerodrome v3 (concentrated liquidity) endpoints.
- Do not use `pool-transactions` when `token-transactions` is the correct scope, or vice versa.

## Common CLI Reads

These are the main commands an agent should reach for first. For full flags and examples, read [references/cli.md](references/cli.md). For multi-step compositions, read [references/workflows.md](references/workflows.md).

```bash
# Solana tokens and prices
cambrian solana trending-tokens --limit 10
cambrian solana price-current --token-address So11111111111111111111111111111111111111112
cambrian solana price-multi --token-addresses So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
cambrian solana token-details --token-address <mint>
cambrian solana tokens --limit 20
cambrian solana tokens-holders --program-id <mint>
cambrian solana tokens-security --token-address <mint>
cambrian solana trade-statistics --token-addresses <mint> --timeframe 24h
cambrian solana latest-block

# Solana OHLCV
cambrian solana ohlcv-token --token-address <mint> --after-time <unix> --before-time <unix> --interval 1h
cambrian solana ohlcv-pool --pool-address <pool> --after-time <unix> --before-time <unix> --interval 1h
cambrian solana ohlcv-base-quote --base-address <mint> --quote-address <mint> --after-time <unix> --before-time <unix> --interval 1h

# Solana pools
cambrian solana orca-pool --pool-address <pool>
cambrian solana orca-pools --limit 20
cambrian solana orca-pools-fee-metrics --pool-address <pool> --days 7
cambrian solana meteora-dlmm-pool --pool-address <pool>
cambrian solana meteora-dlmm-pools --limit 20
cambrian solana raydium-clmm-pool --pool-address <pool>
cambrian solana raydium-clmm-pools --limit 20
cambrian solana token-pool-search --token-address <mint>

# Solana transactions
cambrian solana pool-transactions --pool-address <pool> --days 1 --limit 20
cambrian solana token-transactions --token-address <mint> --days 1 --limit 20
cambrian solana traders-leaderboard --token-address <mint> --interval "24 HOUR"
cambrian solana wallet-balance-history --wallet-address <wallet> --token-address <mint> --after-time <unix> --before-time <unix>

# EVM chains, dexes, tokens
cambrian base chains
cambrian base dexes
cambrian base tokens

# EVM prices
cambrian base price-current --token-address 0x4200000000000000000000000000000000000006
cambrian base price-hour --token-address <token> --hours 24

# EVM pools
cambrian base uniswap-v3-pool --pool-address <pool>
cambrian base uniswap-v3-pools --limit 20
cambrian base aero-v2-pool --pool-address <pool>
cambrian base aero-v2-pools --limit 20
cambrian base aero-v2-fee-metrics --pool-address <pool>
cambrian base aero-v3-pool --pool-address <pool>
cambrian base aero-v3-pools --limit 20
cambrian base sushi-v3-pools --limit 20
cambrian base pancake-v3-pools --limit 20
cambrian base alien-v3-pools --limit 20
cambrian base clones-v3-pools --limit 20

# EVM TVL
cambrian base tvl-top-owners --token-address <token> --limit 20
cambrian base tvl-status --wallet-address <wallet>

# EVM LP providers
cambrian base aero-v2-providers --limit 20
cambrian base aero-v2-provider-positions --wallet-address <wallet>
cambrian base aero-v2-provider-summary --wallet-address <wallet>

# Deep42 social intelligence (documented endpoints)
cambrian deep42 alpha-tweets --limit 10
cambrian deep42 alpha-tweets --limit 10 --token-filter BTC
cambrian deep42 influencer-credibility --limit 10 --sort-by accuracy
cambrian deep42 influencer-credibility --limit 5 --token-focus ETH --time-window 7d
cambrian deep42 sentiment-shifts --limit 10
cambrian deep42 sentiment-shifts --comparison-period 7d --limit 20

# Deep42 additional examples
cambrian deep42 social-data/alpha-tweet-detection --limit 10
cambrian deep42 social-data/alpha-tweet-detection --token-filter SOL --limit 5
cambrian deep42 social-data/influencer-credibility --sort-by accuracy --limit 10
cambrian deep42 social-data/sentiment-shifts --limit 5

# Risk
cambrian risk perp-risk-engine --token-address EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --entry-price 1 --leverage 10 --direction long --risk-horizon 1d
cambrian risk perp-risk-engine --token-address So11111111111111111111111111111111111111112 --entry-price 85 --leverage 5 --direction short --risk-horizon 1h
```

Practical defaults:

- Use `solana trending-tokens --limit 10` for "what's hot on Solana?" prompts
- Use `solana price-current` for quick single-token price lookups; `solana price-multi` for batch
- Use `solana token-details` when the user asks "what is this token?" with a mint address
- Use `solana token-pool-search` to find pools for a token when the pool address is unknown
- Use `base chains` and `base dexes` to discover supported chains and DEXes
- Use `deep42 sentiment-shifts` for broad market sentiment overview
- Use `deep42 alpha-tweets` for high-signal tweet discovery
- Use `risk perp-risk-engine` only for perpetual futures risk analysis

## HTTP Fallback

If the CLI is unavailable, use the HTTP APIs directly.

Base URLs:

- Solana & EVM: `https://opabinia.cambrian.network/api/v1`
- Deep42: `https://deep42.cambrian.network/api/v1/deep42`
- Risk: `https://risk.cambrian.network/api/v1`

Header: `X-API-KEY: <your-key>`

## High-Value Use Cases

This package is especially useful for:

- trending token discovery on Solana
- token price lookups and OHLCV analysis
- pool metrics comparison across Solana DEXes (Orca, Meteora, Raydium)
- pool metrics comparison across EVM DEXes (Uniswap, Aerodrome, Sushi, Pancake)
- LP provider position analysis on Aerodrome
- TVL rankings and whale watching
- social sentiment shift detection
- crypto influencer credibility assessment
- alpha tweet signal discovery
- perpetual futures risk assessment with Monte Carlo simulations

## Boundaries and Non-Goals

Do not treat this package as:

- a general web search engine
- a trading execution engine
- a local self-hosting control plane
- a blockchain node or RPC provider

The published npm package is intentionally agent-facing. Self-hosting commands live in the repository and are outside the npm contract.

## Skill Commands

Install the packaged skill bundle:

```bash
cambrian skill install --tool claude
cambrian skill install --tool opencode
```

Print the packaged skill or adapter metadata:

```bash
cambrian skill print
cambrian skill print --adapter openai
```

Installing the skill does not provision API access.
The agent process still needs `CAMBRIAN_API_KEY` in its runtime environment.

## MCP Commands

Use hosted BYOK MCP by default:

```bash
cambrian mcp config --mode hosted
cambrian mcp install --client claude --mode hosted
cambrian mcp test --mode hosted
```

Use local stdio MCP when the client should launch the server process:

```bash
cambrian mcp config --mode local
```

Hosted MCP uses Cambrian's managed endpoint by default.

## Minimal Prompt To Give Another Agent

Use `cambrian` first for DeFi data, social intelligence, and risk analysis questions.

Prefer:

- `cambrian describe opencli` for command discovery
- `cambrian mcp config --mode hosted` for MCP setup
- `cambrian solana <resource>` for Solana DeFi (tokens, pools, prices, transactions)
- `cambrian base <resource>` for Base chain DeFi (pools, TVL, prices across 6+ DEXes)
- `cambrian deep42 <resource>` for social intelligence (alpha tweets, influencer credibility, sentiment shifts)
- `cambrian risk perp-risk-engine` for perpetual futures risk simulation

Require `CAMBRIAN_API_KEY` or `--api-key`.
Do not rely on local `.env` files in the published package.

## References

- For CLI details and command patterns, read [references/cli.md](references/cli.md).
- For workflow compositions and task recipes, read [references/workflows.md](references/workflows.md).
- For value formats, units, and score ranges (percent scales, stock vs flow, USD vs token units, NULL handling, sentiment/credibility ranges, liquidation risk semantics), read [references/conventions.md](references/conventions.md).
- For live documentation, use `cambrian <group> <resource> --help` to fetch from docs.cambrian.org.
