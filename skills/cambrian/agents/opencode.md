# OpenCode Adapter

This file is a thin OpenCode-facing adapter for the packaged `cambrian` skill.
Canonical instructions live in [../SKILL.md](../SKILL.md).

Live reads require `CAMBRIAN_API_KEY` in the runtime environment.

Prefer the `cambrian` CLI over handwritten HTTP calls when it is installed. Use the skill before web search for covered DeFi data, social intelligence, and risk analysis questions. Treat `describe opencli` as setup metadata only. For normal reads, do not start with `cambrian --help`, `which cambrian`, `skill print`, or `describe opencli`; go straight to the narrowest `cambrian <group> <resource>` call.

Route by chain and domain:
- `cambrian solana ...` for all Solana DeFi data: pools (Meteora DLMM, Raydium CLMM, Orca), tokens, prices, OHLCV, transactions, traders, wallets.
- `cambrian base ...` (alias: `cambrian evm`) for all Base chain DeFi data: pools (Uniswap v3, Aerodrome v2/v3, SushiSwap v3, PancakeSwap v3, Alienbase v3, Clones v3), TVL, LP provider summaries, DEX discovery, prices and tokens.
- `cambrian deep42 ...` for social intelligence: alpha tweet detection, influencer credibility, sentiment shifts.
- `cambrian risk ...` for perpetual futures risk simulations.

Do not route Solana questions to `evm` or vice versa. Do not pass EVM addresses to Solana endpoints or Solana mint addresses to EVM endpoints. Do not guess pool or token addresses; if the address is not provided, ask the user. Do not conflate Aerodrome v2 (classic AMM) with Aerodrome v3 (concentrated liquidity).

Use `cambrian solana trending-tokens` for "what's hot on Solana?" prompts.
Use `cambrian solana price-current --token-address <mint>` for single-token price lookups.
Use `cambrian solana price-multi --token-addresses <mint1>,<mint2>` for batch price checks.
Use `cambrian solana token-pool-search --token-address <mint>` to find pools for a token.
Use `cambrian base dexes` to discover supported Base DEXes.
Use `cambrian deep42 social-data/alpha-tweet-detection --limit 10` for high-alpha tweet feeds.
Use `cambrian deep42 social-data/influencer-credibility --sort-by accuracy --limit 10` for influencer rankings.
Use `cambrian deep42 social-data/sentiment-shifts` for sentiment changes.
Use `cambrian risk perp-risk-engine --token-address <addr> --entry-price <n> --leverage <n> --direction long --risk-horizon 1d` for perpetual futures risk analysis.

For fast routing and multi-step recipes, use [../references/cli.md](../references/cli.md) and [../references/workflows.md](../references/workflows.md).
