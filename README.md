# cambrian

DeFi data, social intelligence, and perpetual risk analysis for agents -- 74 endpoints across Solana, EVM, Deep42, and Risk services.

`cambrian` is the published agent-facing surface for the Cambrian API:

- `cambrian solana <resource> [--flags]` -- 41 Solana DeFi endpoints
- `cambrian base <resource> [--flags]` -- 27 Base DeFi endpoints (alias: evm)
- `cambrian deep42 <resource> [--flags]` -- 5 social intelligence endpoints
- `cambrian risk <resource> [--flags]` -- 1 perp risk endpoint
- `cambrian pay <group> <resource> [--flags]` -- pay-per-call via x402 (Base USDC, no API key)
- `cambrian skill ...` -- packaged skill bundle management
- `cambrian mcp ...` -- hosted/local MCP setup helpers
- `cambrian describe opencli` -- machine-readable command contract
- a typed TypeScript client from `cambrian`
- shared metadata for MCP/server consumers from `cambrian/metadata`

The package does not bundle your API key.
The installed package does not read project-local `.env` files. Pass credentials with CLI flags or environment variables in the invoking process.

## Best Path

Use the package in one of three ways:

- Direct CLI: best when a human or agent can just run commands
- Packaged skill bundle: best for Claude Code or OpenCode style agent runtimes
- MCP setup helpers: best when a client supports Model Context Protocol tools
- `describe opencli`: best for tool-aware runtimes that want a machine-readable command contract

If the goal is fast agent activation, the usual order is:

1. install the package
2. expose `CAMBRIAN_API_KEY` to the process that will run the agent
3. verify one successful query
4. install or print the packaged skill, configure MCP, or load `describe opencli`

## Requires API Access

Installing the package is not enough for live reads.

- You need a valid `CAMBRIAN_API_KEY` or `--api-key <key>`
- `skill install` only installs the packaged skill bundle; it does not provision API access
- the agent or CLI process itself must see the API key in its runtime environment

Base URLs:
- Opabinia (Solana + EVM): `https://opabinia.cambrian.network`
- Deep42: `https://deep42.cambrian.network`
- Risk: `https://risk.cambrian.network`

## Persisted API Key & Shell Completion

To avoid exporting `CAMBRIAN_API_KEY` in every shell, persist it once:

```bash
cambrian config set-key <your-api-key>   # writes ~/.config/cambrian/config.json (mode 0600)
cambrian config get-key                  # print the stored key
cambrian config clear                    # remove it
```

Key precedence (highest first): `--api-key` → `CAMBRIAN_API_KEY` → stored config
file. Storage honors `XDG_CONFIG_HOME` (and `%APPDATA%` on Windows).

Shell completion delegates to the CLI's own metadata, so it stays in sync with
the endpoint list:

```bash
cambrian completion bash >> ~/.bashrc
cambrian completion zsh  >> ~/.zshrc
cambrian completion fish > ~/.config/fish/completions/cambrian.fish
```

## Pay-Per-Call With x402 (No API Key)

As an alternative to an API key, `cambrian pay <group> <resource>` pays for a
single call with USDC on Base via the [x402](https://x402.org) protocol — $0.05
per request, settled by a facilitator (you pay no gas). Works for every data
group (`solana`, `base`/`evm`, `deep42`, `risk`).

This path is opt-in and keeps the core install dependency-free, so the signing
libraries are **not bundled** — install them once alongside the CLI:

```bash
npm install -g @x402/fetch @x402/evm viem
export CAMBRIAN_X402_PRIVATE_KEY=0x<base-mainnet-key-funded-with-usdc>

# Preview the price first (no spend) — then authorize with --yes:
cambrian pay deep42 social-data/alpha-tweet-detection --limit 1
cambrian pay deep42 social-data/alpha-tweet-detection --limit 1 --yes
cambrian pay base price-current --token-address 0x4200000000000000000000000000000000000006 --yes
```

Safeguards: every call prints a cost preview and requires `--yes` before
spending; `--max-amount <usd>` caps the price (default `0.10`); the wallet key is
read only from `CAMBRIAN_X402_PRIVATE_KEY` at runtime and is never stored or
logged. See [docs/x402.md](docs/x402.md) for the full protocol details.

## Features

- **Solana DeFi**: pool metrics for Meteora DLMM, Raydium CLMM, and Orca; token details, holders, security audits; OHLCV candles; prices (current, hourly, unix, multi); pool and token transactions; trade statistics; trader leaderboards; trending tokens; wallet balance history
- **EVM DeFi**: pool metrics for Aerodrome v2/v3, Uniswap v3, SushiSwap v3, PancakeSwap v3, Alienbase v3, Clones v3; LP provider positions and fee metrics; TVL rankings; lending protocols; chain and DEX discovery; EVM token prices and lists
- **Social intelligence**: alpha tweet detection with multi-dimensional scoring, influencer credibility rankings with track records, sentiment shift detection for identifying market-moving changes
- **Perpetual risk**: risk engine simulations for position sizing and liquidation analysis
- Agent-friendly CLI with clean error output, scoped subcommand help, and self-description via `cambrian describe opencli`
- Packaged skill bundle for Claude and OpenCode installs
- Typed TypeScript client from the root package export
- MCP setup helpers for hosted BYOK and local `npx -y cambrian-api-mcp` usage

## Coverage

| Service | Endpoints | Coverage |
|---------|-----------|----------|
| Solana (Opabinia) | 41 | Pools (Meteora, Raydium, Orca), tokens, prices, OHLCV, transactions, traders, wallets |
| EVM (Opabinia) | 27 | Pools (7 DEXes), TVL, LP providers, lending protocols, chain/DEX discovery, prices, tokens |
| Deep42 | 5 | Alpha tweet detection, influencer credibility, sentiment shifts, token analysis, trending momentum |
| Risk | 1 | Perp risk engine |

## Agent Setup In 60 Seconds

```bash
npm install -g cambrian

export CAMBRIAN_API_KEY=<your-api-key>
cambrian solana trending-tokens
cambrian solana price-current --token-address So11111111111111111111111111111111111111112
cambrian base chains
cambrian deep42 social-data/alpha-tweet-detection --limit 3
cambrian describe opencli
cambrian mcp config --mode hosted
```

Live reads accept:

- `--api-key <key>`
- `CAMBRIAN_API_KEY`

The published CLI reads those values from the current process environment only.

What success looks like:

- `trending-tokens` returns a list of currently trending Solana tokens
- `price-current` returns a price snapshot for the given mint
- `chains` returns supported Base chains with chain IDs
- `alpha-tweet-detection` returns high-alpha tweets with multi-dimensional scoring
- `describe opencli` prints the machine-readable CLI contract that tool-aware runtimes can ingest

Execution best practice after setup:

- treat `describe opencli` as setup metadata, not a per-task preflight step
- do not start routine reads with `cambrian --help`, `which cambrian`, `skill print`, or `skill targets`
- once the route is clear, go straight to the narrowest `cambrian <group> <resource> ...` command
- use documented named flags; do not pass values positionally

## Start Here By Task

| If the prompt is about... | Start with... | Then usually follow with... |
| --- | --- | --- |
| Solana token price or info | `solana price-current` or `solana token-details` | `solana tokens`, `solana trade-statistics` |
| Solana token holders or security | `solana tokens-holders` or `solana tokens-security` | `solana tokens-holders-over-time` |
| Solana trending tokens | `solana trending-tokens` | `solana token-details-multi`, `solana price-volume-multi` |
| Solana pool metrics | `solana <dex>-pool` | `solana ohlcv-pool`, `solana pool-transactions` |
| Solana OHLCV candles | `solana ohlcv-token` or `solana ohlcv-pool` | `solana price-current` |
| Solana transactions | `solana pool-transactions` or `solana token-transactions` | `solana trade-statistics` |
| Solana trader rankings | `solana traders-leaderboard` | `solana trade-statistics` |
| Solana wallet analysis | `solana wallet-balance-history` | `solana holder-token-balances` |
| Base pool metrics | `base <dex>-v3-pool` | `base <dex>-v3-pools` |
| Base TVL rankings | `base tvl-status` | `base tvl-top-owners` |
| Base LP provider analysis | `base aero-v2-provider-positions` | `base aero-v2-provider-summary` |
| Base chain or DEX discovery | `base chains` or `base dexes` | the appropriate pool resource |
| Base token price | `base price-current` | `base price-hour` |
| social sentiment or trending | `deep42 social-data/sentiment-shifts` | `deep42 social-data/alpha-tweet-detection` |
| influencer credibility | `deep42 social-data/influencer-credibility` | `deep42 social-data/alpha-tweet-detection` |
| alpha tweet detection | `deep42 social-data/alpha-tweet-detection` | `deep42 social-data/influencer-credibility` |
| perp risk analysis | `risk perp-risk-engine` | -- |

Routing rules that matter:

- do not route Solana questions to `base` or vice versa
- do not pass Base addresses to Solana endpoints or Solana mint addresses to Base endpoints
- do not guess pool or token addresses; ask the user if missing
- do not conflate Aerodrome v2 (classic AMM) with v3 (concentrated liquidity)
- Deep42 supports 5 endpoints under `social-data/*`

## Quick Start

```bash
# Solana
cambrian solana trending-tokens
cambrian solana price-current --token-address <mint>
cambrian solana price-multi --token-addresses <mint1>,<mint2>
cambrian solana token-details --token-address <mint>
cambrian solana tokens-holders --program-id <mint>
cambrian solana tokens-security --token-address <mint>
cambrian solana ohlcv-token --token-address <mint> --interval 1h --after-time <unix> --before-time <unix>
cambrian solana ohlcv-pool --pool-address <pool> --interval 1h --after-time <unix> --before-time <unix>
cambrian solana meteora-dlmm-pool --pool-address <pool>
cambrian solana orca-pool --pool-address <pool>
cambrian solana raydium-clmm-pool --pool-address <pool>
cambrian solana pool-transactions --pool-address <pool> --days <n>
cambrian solana token-transactions --token-address <mint> --days <n>
cambrian solana trade-statistics --token-addresses <mint> --timeframe <tf>
cambrian solana traders-leaderboard --token-address <mint> --interval "24 HOUR"
cambrian solana wallet-balance-history --wallet-address <wallet> --token-address <mint> --after-time <unix> --before-time <unix>

# Base (alias: evm)
cambrian base chains
cambrian base dexes
cambrian base uniswap-v3-pool --pool-address <pool>
cambrian base uniswap-v3-pools
cambrian base aero-v2-pool --pool-address <pool>
cambrian base aero-v2-pools
cambrian base aero-v2-fee-metrics --pool-address <pool>
cambrian base aero-v2-provider-positions --wallet-address <address>
cambrian base aero-v2-provider-summary --wallet-address <address>
cambrian base tvl-status --wallet-address <wallet>
cambrian base tvl-top-owners --token-address <token>
cambrian base price-current --token-address <token>

# Deep42
cambrian deep42 social-data/alpha-tweet-detection --limit 10
cambrian deep42 social-data/alpha-tweet-detection --token-filter SOL --limit 5
cambrian deep42 social-data/influencer-credibility --sort-by accuracy --limit 10
cambrian deep42 social-data/sentiment-shifts
cambrian deep42 social-data/token-analysis --token-symbol SOL
cambrian deep42 social-data/trending-momentum --limit 10

# Risk
cambrian risk perp-risk-engine --token-address <addr> --entry-price 100 --leverage 5 --direction long --risk-horizon 1d

# Skill management
cambrian skill install --tool claude
cambrian skill install --tool opencode
cambrian skill print

# MCP setup
cambrian mcp config --client claude --mode hosted
cambrian mcp config --client claude --mode local
cambrian mcp install --client claude --mode hosted
cambrian mcp test --mode hosted
cambrian describe opencli
```

## Global Flags

These apply to every data command (`solana` / `base` / `deep42` / `risk`). The
default output is unchanged (pretty JSON), so all flags are opt-in.

| Flag | Effect |
| --- | --- |
| `--output table\|json\|tsv` | Render tabular results as an aligned table or TSV (default `json`; non-tabular data falls back to JSON) |
| `--fields a,b,c` | Project the response to only these columns/fields (smaller payloads for agents) |
| `--all` | Auto-paginate and merge all pages (paginated resources only) |
| `--max-items <n>` | Cap total rows when paginating (default `10000`) |
| `--retries <n>` | Retry transient failures (408/429/5xx) with jittered backoff (default `0`) |
| `--json` | Machine-readable output; errors emit structured JSON on stderr |
| `--timeout <ms>` | Per-request timeout (default `90000`) |
| `--api-key <key>` | API key for this call (else `CAMBRIAN_API_KEY`) |

```bash
cambrian solana trending-tokens --output table
cambrian solana trending-tokens --fields symbol,currentPriceUSD --output tsv
cambrian solana tokens --all --max-items 500
```

Unknown commands and resources get a "did you mean…?" suggestion.

## Commands

| Command | Description |
| --- | --- |
| `cambrian solana <resource> [--flags]` | Solana DeFi data (41 endpoints) |
| `cambrian base <resource> [--flags]` | Base DeFi data (27 endpoints; alias: evm) |
| `cambrian deep42 <resource> [--flags]` | Social intelligence (5 endpoints) |
| `cambrian risk <resource> [--flags]` | Perp risk analysis (1 endpoint) |
| `cambrian pay <group> <resource> [--flags]` | Pay-per-call via x402 (Base USDC; no API key) |
| `cambrian config set-key\|get-key\|clear` | Persist, print, or remove the stored API key |
| `cambrian completion <bash\|zsh\|fish>` | Print a shell completion script |
| `cambrian skill install` | Install the packaged skill bundle |
| `cambrian skill print` | Print the packaged skill or adapter metadata |
| `cambrian mcp config` | Print hosted/local MCP client configuration |
| `cambrian mcp install` | Install Cambrian MCP into supported clients |
| `cambrian mcp test` | Smoke-test hosted/local MCP setup |
| `cambrian describe opencli` | Emit machine-readable CLI metadata for agents |

## Agent Integration

Agents only need one of these setups:

- CLI-native: give the agent shell access plus `CAMBRIAN_API_KEY`
- MCP-native: configure hosted BYOK MCP or local `npx -y cambrian-api-mcp`
- Skill-native: install the packaged skill bundle for the agent runtime
- Tool-native: load `cambrian describe opencli` and let the runtime call commands directly

Claude and OpenCode install path:

```bash
cambrian skill install --tool claude
cambrian skill install --tool opencode
```

MCP config path:

```bash
cambrian mcp config --mode hosted
cambrian mcp install --client claude --mode hosted
cambrian mcp config --mode local
```

Local mode launches `npx -y cambrian-api-mcp`, which requires the `cambrian-api-mcp` package to be published to npm. Until it is published, use the hosted MCP mode or run the MCP server from a local checkout. Hosted mode works today.

OpenAI-style adapter output:

```bash
cambrian skill print --adapter openai
```

Machine-readable command contract:

```bash
cambrian describe opencli
```

The strongest packaged combination for agents is:

1. packaged skill for routing and prompt steering
2. `describe opencli` for tool-aware runtimes
3. direct `<group> <resource>` commands for execution

For end-to-end command compositions, read:

- [CLI Reference](skills/cambrian/references/cli.md)
- [Workflow Recipes](skills/cambrian/references/workflows.md)

Example agent prompts after install:

```text
Use cambrian to find trending Solana tokens and analyze the top one.
Use cambrian to detect recent high-alpha tweets and check the credibility of those influencers.
Use cambrian to find the best Aerodrome v2 pools on Base by TVL and fee generation.
Use cambrian to assess the risk of a 5x leveraged SOL perp position.
Use cambrian to check sentiment shifts and compare to on-chain trading activity.
```

Installing the skill bundle does not provision API access. The agent process itself still needs `CAMBRIAN_API_KEY` in its runtime environment.

## TypeScript Client

```ts
import { CambrianData } from "cambrian";

const client = new CambrianData({
  apiKey: process.env.CAMBRIAN_API_KEY!,
});

// Solana (via OpabiniaClient)
const trending = await client.opabinia.getSolanaTrendingTokens();
console.log(trending);

const price = await client.opabinia.getSolanaPriceCurrent({
  token_address: "So11111111111111111111111111111111111111112",
});
console.log(price);

const tokenDetails = await client.opabinia.getSolanaTokenDetails({
  token_address: "<mint>",
});
console.log(tokenDetails);

const pool = await client.opabinia.getSolanaOrcaPool({
  pool_address: "<pool>",
});
console.log(pool);

// Base (via OpabiniaClient)
const chains = await client.opabinia.getEvmChains();
console.log(chains);

// Deep42
const sentiment = await client.deep42.query('/api/v1/deep42/social-data/sentiment-shifts', { limit: 10 });
console.log(sentiment);

const credibility = await client.deep42.query('/api/v1/deep42/social-data/influencer-credibility', { limit: 10 });
console.log(credibility);

// Risk
const risk = await client.risk.getLiquidationRisk({
  token_address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  entry_price: 1,
  leverage: 10,
  direction: "long",
  risk_horizon: "1d",
});
console.log(risk);
```

## Rate Limits

The hosted API returns standard rate-limit headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After` on `429`

When the CLI is throttled, it prints a clean retry message instead of a stack trace.

## Package Scope

The published npm package is intentionally limited to agent-facing surfaces. Repository-specific tooling, local development workflows, and self-hosting setups live in the GitHub repository, not in the npm contract.

## License

MIT
