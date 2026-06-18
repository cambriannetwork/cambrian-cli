# Workflow Recipes

Use this file when the user prompt requires more than one command. The goal is to keep agents on the hosted `cambrian` contract while still producing answers that feel researched, synthesized, and decisive.

When interpreting the numeric fields these workflows return — percent scales (0–1 vs 0–100 vs multiplier), USD-vs-token-unit volume pairs, NULL handling, sentiment/credibility ranges, and liquidation risk semantics — consult [conventions.md](conventions.md) so the "What to extract" judgments use the correct units.

## Workflow 1: Solana Token Research

Use this for prompts like:

- "Tell me about this Solana token."
- "Is this token safe to buy?"
- "What's the full picture on <mint>?"

Order:

1. `solana token-details` for metadata
2. `solana price-current` for latest price
3. `solana tokens-security` for security audit
4. `solana tokens-holders` for holder distribution
5. `solana trade-statistics` for trading activity

Example:

```bash
cambrian solana token-details --token-address <mint>
cambrian solana price-current --token-address <mint>
cambrian solana tokens-security --token-address <mint>
cambrian solana tokens-holders --program-id <mint>
cambrian solana trade-statistics --token-addresses <mint> --timeframe 24h
```

What to extract:

- token identity: name, symbol, supply, market cap
- current price and recent price action
- security flags: freeze authority, mint authority, top holder concentration
- holder base size and distribution health
- trading activity: volume, buy/sell ratio, unique traders
- one short judgment on whether the token looks healthy or risky

## Workflow 2: Solana Pool Analysis

Use this for prompts like:

- "Analyze this Orca pool."
- "Is this Meteora DLMM pool worth providing liquidity to?"
- "Compare these two Raydium pools."

Order:

1. `solana <dex>-pool` for the specific pool metrics (e.g. `orca-pool`)
2. `solana ohlcv-pool` for price history
3. `solana pool-transactions` for recent activity
4. for Orca: `solana orca-pools-fee-metrics` and `solana orca-pools-liquidity-map` for deeper analysis

Example:

```bash
cambrian solana orca-pool --pool-address <pool>
cambrian solana orca-pools-fee-metrics --pool-address <pool> --days 7
cambrian solana orca-pools-liquidity-map --pool-address <pool> --resolution 100
cambrian solana ohlcv-pool --pool-address <pool> --interval 1h --after-time <ISO> --before-time <ISO>
cambrian solana pool-transactions --pool-address <pool> --days 7
```

What to extract:

- pool composition: token pair, TVL, current price
- fee generation: APR, fee tier, volume-to-TVL ratio
- liquidity distribution: where liquidity is concentrated relative to current price
- recent transaction activity: swap volume, LP adds/removes
- one short judgment on LP opportunity quality

## Workflow 3: Solana Trending Token Discovery

Use this for prompts like:

- "What's hot on Solana right now?"
- "Find trending tokens and tell me about the top ones."
- "What tokens are gaining momentum?"

Order:

1. `solana trending-tokens` for the trending list
2. `solana token-details` on the top candidates
3. `solana price-current` or `solana price-volume-multi` for price context
4. `solana tokens-security` for safety check on interesting candidates
5. optionally `deep42 social-data/sentiment-shifts` for social confirmation

Example:

```bash
cambrian solana trending-tokens
cambrian solana token-details-multi --token-addresses <mint1>,<mint2>,<mint3>
cambrian solana price-volume-multi --token-addresses <mint1>,<mint2>,<mint3> --timeframe 24h
cambrian solana tokens-security --token-address <mint1>
cambrian deep42 social-data/sentiment-shifts
```

What to extract:

- which tokens are trending and why (volume spike, new listing, social buzz)
- basic token identity and market cap for the top candidates
- price action: recent moves and volume
- security posture of the most interesting candidates
- social momentum confirmation if available

## Workflow 4: Base Pool Analysis

Use this for prompts like:

- "Analyze this Uniswap v3 pool on Base."
- "What are the best Aerodrome pools on Base?"
- "Show me top TVL pools."

> **Note:** `cambrian base` is an alias for the former `cambrian evm` command group.

Order:

1. `base chains` if the chain ID is unknown
2. `base <dex>-pool` for specific pool metrics (e.g. `aero-v2-pool`)
3. for Aerodrome v2: `base aero-v2-fee-metrics` and `base aero-v2-pool-volume`

Example:

```bash
cambrian base chains
cambrian base aero-v2-pool --pool-address <pool>
cambrian base aero-v2-fee-metrics --pool-address <pool>
cambrian base aero-v2-pool-volume --pool-address <pool>
```

What to extract:

- pool composition and TVL
- fee generation and volume metrics
- how the pool ranks relative to peers
- one short judgment on pool attractiveness for LPs

## Workflow 5: Base LP Provider Analysis

Use this for prompts like:

- "What are this address's LP positions on Aerodrome?"
- "Show me the biggest LPs in this pool."
- "Analyze this LP's strategy."

Order:

1. `base aero-v2-providers` to list LPs in a pool, or `base aero-v2-provider-summary` for a specific LP
2. `base aero-v2-provider-positions` for detailed position data
3. `base aero-v2-pool` for pool context

Example:

```bash
cambrian base aero-v2-providers
cambrian base aero-v2-provider-positions --wallet-address <wallet>
cambrian base aero-v2-provider-summary --wallet-address <provider_address>
cambrian base aero-v2-pool --pool-address <pool>
```

What to extract:

- LP's position size, range, and share of pool
- aggregate LP performance across pools
- pool context: TVL, volume, fee tier
- one short judgment on the LP's positioning

## Workflow 6: Social Sentiment Analysis

Use this for prompts like:

- "What's the social mood around SOL?"
- "Is this token getting hyped?"
- "What are influencers saying about <token>?"

Order:

1. `deep42 social-data/sentiment-shifts` for current sentiment
2. `deep42 social-data/alpha-tweet-detection` for high-signal content
3. `deep42 social-data/influencer-credibility` for credibility context on who is talking
4. optionally pair with `solana price-current` or `solana trade-statistics` for on-chain confirmation

Example:

```bash
cambrian deep42 social-data/sentiment-shifts --comparison-period 7d --limit 10
cambrian deep42 social-data/alpha-tweet-detection --token-filter SOL --limit 10
cambrian deep42 social-data/influencer-credibility --token-focus SOL --limit 5
cambrian solana price-current --token-address So11111111111111111111111111111111111111112
```

What to extract:

- current sentiment direction and magnitude
- key social signals: influencer mentions, alpha tweets
- credibility of the voices driving the conversation
- on-chain confirmation: does price action match social signal?
- one short judgment on whether social momentum is meaningful or noise

## Workflow 7: Influencer Due Diligence

Use this for prompts like:

- "Is @handle a credible crypto influencer?"
- "Should I trust this person's token calls?"
- "Check this influencer's track record."

Order:

1. `deep42 social-data/influencer-credibility` for credibility scoring
2. `deep42 social-data/alpha-tweet-detection` for their recent alpha content

Example:

```bash
cambrian deep42 social-data/influencer-credibility --sort-by credibility_score --order desc --limit 10
cambrian deep42 social-data/alpha-tweet-detection --limit 10
```

What to extract:

- credibility score and what drives it
- recent alpha content and whether it played out
- one short judgment on whether to follow this influencer's calls

## Workflow 8: Perp Risk Assessment

Use this for prompts like:

- "What's my liquidation price for this position?"
- "How much leverage can I safely use?"
- "Analyze the risk of this perp trade."

Order:

1. `risk perp-risk-engine` with position parameters
2. optionally `solana price-current` or `base price-current` for current price context
3. optionally `deep42 social-data/sentiment-shifts` if the user wants social risk context

Example:

```bash
cambrian risk perp-risk-engine --token-address So11111111111111111111111111111111111111112 --entry-price 150 --leverage 5 --direction long --risk-horizon 1d
cambrian solana price-current --token-address So11111111111111111111111111111111111111112
cambrian deep42 social-data/sentiment-shifts --token SOL
```

What to extract:

- liquidation price and distance from current price
- margin requirements and funding rate context
- suggested position sizing for the given risk tolerance
- social sentiment as a risk overlay
- one short judgment on whether the trade setup looks safe

## Workflow 9: Cross-Chain DeFi Comparison

Use this for prompts like:

- "Compare TVL between Ethereum and Base."
- "Which chain has better DeFi opportunities?"
- "Compare Uniswap pools on different chains."

Order:

1. `base chains` to confirm chain IDs
2. `base uniswap-v3-pools` per chain for pool-level comparison
3. optionally `base tvl-top-owners` for whale comparison

Example:

```bash
cambrian base chains
cambrian base uniswap-v3-pools
cambrian base tvl-top-owners
```

What to extract:

- TVL comparison: total, top pools, concentration
- pool quality: fee tiers, volume-to-TVL ratios
- whale presence: top owners and their share
- one short judgment on relative chain attractiveness for LPs
