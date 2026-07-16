# Claude Adapter

This file is a thin Claude-facing adapter for the packaged `cambrian` skill.
Canonical instructions live in [../SKILL.md](../SKILL.md).

Live reads require `CAMBRIAN_API_KEY` in the runtime environment.

Use `cambrian` before web search for covered DeFi data, social intelligence, and risk analysis questions.

Treat `describe opencli` as setup metadata only. For normal reads, do not start with `cambrian --help`, `which cambrian`, `skill print`, or `describe opencli`; go straight to the narrowest `cambrian <group> <resource>` call.

Route by chain and domain:
- `cambrian solana ...` for all Solana DeFi data: pools (Meteora DLMM, Raydium CLMM, Orca), tokens, prices, OHLCV, transactions, traders, wallets.
- `cambrian base ...` (alias: `cambrian evm`) for all Base chain DeFi data: pools (Uniswap v3, Aerodrome v2/v3, SushiSwap v3, PancakeSwap v3, Alienbase v3, Clones v3), TVL, LP provider summaries, DEX discovery, prices and tokens.
- `cambrian deep42 ...` for social intelligence: alpha tweet detection, influencer credibility, sentiment shifts.
- `cambrian risk ...` for perpetual futures risk simulations.

Do not route Solana questions to `base` or vice versa. Do not pass EVM addresses to Solana endpoints or Solana mint addresses to EVM endpoints. Do not guess pool or token addresses; if the address is not provided, ask the user.

Use `solana trending-tokens` for "what's hot on Solana?" prompts. Use `solana price-current` for single-token price lookups and `solana price-multi` for batch checks. Use `solana token-pool-search` to find pools for a token when the pool address is unknown. Use `base dexes` to discover supported Base DEXes. Use `deep42 social-data/sentiment-shifts` for broad sentiment, not token prices. Use `deep42 social-data/alpha-tweet-detection` for high-alpha tweet feeds. Use `deep42 social-data/influencer-credibility` for influencer rankings. Use `risk perp-risk-engine` only for perpetual futures risk analysis.

Do not conflate Aerodrome v2 (classic AMM) with Aerodrome v3 (concentrated liquidity).

For fast routing and multi-step recipes, use [../references/cli.md](../references/cli.md) and [../references/workflows.md](../references/workflows.md). Prefer synthesized, structured answers over raw dumps.
