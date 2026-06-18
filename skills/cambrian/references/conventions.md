# Data Conventions

This file documents value formats, units, and score ranges across the Cambrian APIs so an agent can interpret responses correctly without guessing. **Every rule below is derived from the endpoint's machine-readable docs (`cambrian docs <group> <resource>`, sourced from `docs.cambrian.org/.../llms.txt`) and/or a live sample.** The source endpoint is cited after each rule. When in doubt for a field not listed here, fetch the endpoint's own docs with `cambrian docs <group> <resource>` rather than assuming.

## Percent and ratio formats

There is **no single percent convention** across the APIs — the format depends on the field. Always check which scale applies before formatting or comparing.

- **0–100 percent (already a percentage):**
  - Deep42 accuracy fields `trackRecordAccuracy24h` / `7d` / `30d` are "directional prediction accuracy (0-100%)". A value of `40` means 40%. *(Source: `deep42 social-data/influencer-credibility`; same fields appear on `social-data/alpha-tweet-detection` live as `userTrackRecordAccuracy24h/7d/30d`.)*
  - `bullishRatio` is the "Percentage of current-period tweets with bullish sentiment (score >=6)" on a 0–100 scale; `>60` = bullish majority, `<40` = bearish majority. A value of `67` means 67%. *(Source: `deep42 social-data/sentiment-shifts`.)*
  - `credibilityScore` is on a 0–100-style composite but is **unbounded** ("typically 5-300"): `>10` = credible, `>50` = highly credible, `>200` = top-tier. Do not treat it as a capped percentage. *(Source: `deep42 social-data/influencer-credibility`.)*

- **Signed percent return:**
  - `trackRecordAvgReturn24h` / `7d` / `30d` (and the `userTrackRecord*` equivalents on alpha-tweet-detection) are "Average directional return %". Values can be negative (e.g. live `-10.49`, `10.51`) and represent percent, not a fraction. *(Source: `deep42 social-data/influencer-credibility`.)*

- **0–1 fraction (probability / proportion), NOT a percentage:**
  - `riskProbability` is a liquidation probability in 0–1 (docs example `0.1234` ≈ 12.34%). Multiply by 100 to present as a percent. *(Source: `risk perp-risk-engine`.)*
  - `priceChangeNeeded` is a fraction of price (live `0.10007…` ≈ a 10% move to liquidation). *(Source: `risk perp-risk-engine`.)*

- **Multiplier (ratio), not a percent:**
  - `volumeChange` is "Ratio of current period tweet count to previous period. 1.0 = unchanged, 2.0 = doubled, 0.5 = halved." A value of `1.5` means +50% tweet volume; do not read it as 1.5%. *(Source: `deep42 social-data/sentiment-shifts`.)*

- **Basis points (bps):** No Cambrian field reviewed for this guide is documented in basis points. If you encounter a fee/spread field, confirm its units via `cambrian docs` before assuming bps — do not invent a bps interpretation. *(Unverified for these endpoints; stated to prevent a wrong default.)*

## Stock vs flow (point-in-time vs windowed)

Distinguish **stock** values (a snapshot at one instant) from **flow** values (accumulated over a window). They cannot be added or compared across windows naively.

- **Stock (point-in-time):** TVL/liquidity, current price (`priceUSD`), `holderCount`, `totalSupply`, `fdvUSD`, and holder balances (`balanceUi`, `balanceUSD`) describe the state right now. *(Source: `solana token-details`, `solana tokens-holders`.)*
- **Flow (windowed totals):** `volume1h` / `volume24h` / `volume7d` and their `…USD` variants, plus `trade1hCount` / `trade24hCount` / `trade7dCount`, `buyVolume24h` / `sellVolume24h`, are sums over their stated window. The `1h`, `24h`, `7d` suffix is the window length. *(Source: `solana token-details`.)*
- Deep42 `currentPeriodTweets` / `previousPeriodTweets` are flow counts over the comparison window set by `comparison_period`. *(Source: `deep42 social-data/sentiment-shifts`.)*

## USD vs native token units

Volume and balance fields come in **two parallel forms** — native token units and USD. Pick the one that matches the question; never mix them.

- `volume24h` is "Trading volume in token units" while `volume24hUSD` is "Trading volume in USD" (same for `1h`/`7d` and for `buyVolume24h`/`buyVolume24hUSD`, `sellVolume24h`/`sellVolume24hUSD`). *(Source: `solana token-details`.)*
- For holders: `balanceUi` is the decimal-adjusted token amount and `balanceUSD` is its USD value. *(Source: `solana tokens-holders`.)*

## Decimals and raw balances

- `decimals` (UInt8) is the "Number of decimal places for token precision." *(Source: `solana token-details`.)*
- `balanceRaw` (UInt64) is the "Raw token balance (without decimal adjustment)" — an integer in base units. `balanceUi` (Float64) is the "UI-friendly token balance (adjusted for decimals)." Relationship confirmed live: `balanceRaw 2355297501477846` with `balanceUi 2355297.501477846` for a 9-decimal token (Wrapped SOL). Use `balanceUi` for human display; use `balanceRaw` only when you need exact integer base units. *(Source: `solana tokens-holders` + live sample.)*

## NULL interpretation

`Nullable(...)` fields may return `null`, which means **"data not available / not computed,"** not zero.

- `holderCount`, `totalSupply`, and `fdvUSD` are `Nullable` on `solana token-details`. Treat a `null` as "unknown" — do not substitute `0`, and do not compute FDV/market cap from a null supply. *(Source: `solana token-details`.)*
- For any other `Nullable(...)` type in a `TableResponse` schema, apply the same rule.

## Sentiment, alpha, and related score ranges (Deep42)

These are AI-assigned scores on **fixed 0–10 scales** unless noted.

- `sentiment` (0–10): "AI-scored sentiment direction"; `>=7` = bullish, `<=3` = bearish, `4–6` = neutral. *(Source: `deep42 social-data/alpha-tweet-detection`.)*
- `alpha` (0–10): "DeFi alpha investment insight quality"; higher = more novel, specific, tradeable. *(Source: `deep42 social-data/alpha-tweet-detection`.)*
- `legitimacy` (0–10): source/claim legitimacy. *(Source: `deep42 social-data/alpha-tweet-detection`.)*
- `technicalAccuracy` (0–10): technical correctness of crypto/DeFi claims. *(Source: `deep42 social-data/alpha-tweet-detection`.)*
- `currentSentiment` / `previousSentiment` (0–10): `0` = very bearish, `5` = neutral, `10` = very bullish. *(Source: `deep42 social-data/sentiment-shifts`.)*
- `sentimentShift` (−10 to +10): change between periods; positive = bullish shift, negative = bearish; `>2` = notable, `>5` = major. *(Source: `deep42 social-data/sentiment-shifts`.)*
- `trackRecordAvgSentiment` and `trackRecordAvgAlpha` (0–10): averages across an influencer's signals. *(Source: `deep42 social-data/influencer-credibility`.)*
- `qualityScore` (0–20): "Sum of average sentiment + average alpha for current period tweets." *(Source: `deep42 social-data/sentiment-shifts`.)*
- `volatility` (0–5): standard deviation of sentiment scores in the period; `<1` = strong consensus, `>2` = highly divided. *(Source: `deep42 social-data/sentiment-shifts`.)*
- `confidenceScore`: `log(tweet_count + 1) * abs(sentimentShift)`; `>3` = moderate, `>5` = high confidence. No fixed upper bound. *(Source: `deep42 social-data/sentiment-shifts`.)*
- `signalMagnitude`: shift magnitude normalized by volatility; `>1` = exceeds normal variance, `>2` = 2x. No fixed upper bound. *(Source: `deep42 social-data/sentiment-shifts`.)*

### Credibility / influence (Deep42 influencer-credibility)

- `credibilityScore`: composite, **unbounded**, typically 5–300 (see percent section above for thresholds). *(Source: `deep42 social-data/influencer-credibility`.)*
- `influenceScore`: reach-weighted engagement, **unbounded**, typically 0–50; `>5` = significant, `>20` = major. *(Source: `deep42 social-data/influencer-credibility`.)*
- `trackRecordPerformanceTier`: enum — `topPerformer` (accuracy >=70%), `proven` (>=60%), `unproven` (<60%). *(Source: `deep42 social-data/influencer-credibility`.)*

## Liquidation risk semantics (`risk perp-risk-engine`)

Returned by Monte Carlo simulation over historical price data. Key fields and their exact meaning:

- `riskProbability` (0–1): probability the position is liquidated within the `risk_horizon`. Present as a percent by multiplying by 100. *(Source: `risk perp-risk-engine`.)*
- `liquidationPrice` (USD): the price at which the position liquidates. *(Source: `risk perp-risk-engine`.)*
- `sigmasAway`: distance from entry to the liquidation threshold measured in **standard deviations** of the simulated price distribution. Larger = safer (the move needed is many sigmas away). Live example: `17.6` sigmas with `riskProbability 0` for a 10x long over a 1h horizon. *(Source: `risk perp-risk-engine` + live sample.)*
- `priceChangeNeeded` (0–1 fraction): fractional price move from entry to liquidation (e.g. `0.10` ≈ a 10% move). *(Source: `risk perp-risk-engine`.)*
- `volatility` and `drift`: estimated from historical data and used to drive the simulation (`simulationDetails.dataPointsUsed`, `totalSimulations`, `liquidatedPaths`, `riskHorizon`). *(Source: `risk perp-risk-engine`.)*

Interpretation rule: a **low `riskProbability` with a high `sigmasAway`** means the configured leverage is well clear of liquidation over the horizon; a **high `riskProbability` with a low `sigmasAway` and small `priceChangeNeeded`** means liquidation is likely. The simulation is horizon-sensitive — lengthening `risk_horizon` widens the distribution and generally raises `riskProbability`.

## When this file does not cover a field

Fetch the endpoint's own machine-readable docs and trust those over any assumption:

```bash
cambrian docs <group> <resource>     # e.g. cambrian docs solana token-details
```

Do not invent units, ranges, or percent scales for fields not documented above.
