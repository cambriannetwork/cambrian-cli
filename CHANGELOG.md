# Changelog

All notable changes to the `cambrian` CLI are documented here. This project
follows [Semantic Versioning](https://semver.org/). Dates are UTC.

## [Unreleased]

## [0.2.5] - 2026-07-06

### Fixed

- `cambrian pay` now validates required options, numeric bounds, and enums from
  the bundled endpoint metadata before the x402 gateway probe, so locally invalid
  requests fail before any payment flow can start.
- `cambrian pay` now records a local pending-payment guard and sends
  `Idempotency-Key` / `X-Cambrian-Idempotency-Key` headers for paid attempts.
  If a paid request times out or returns an unknown post-submission failure, an
  identical wallet/resource retry is blocked until the gateway timeout window
  expires instead of risking a silent duplicate charge.
- Successful paid responses now fall back to unfiltered JSON if local output
  formatting fails after settlement, so users still receive the data they paid
  for.

## [0.2.4] - 2026-07-06

### Added

- `cambrian pay` now supports `--timeout <ms>` (default `90000`) for both the
  unpaid x402 price probe and the SDK-paid gateway request. Paid-request
  timeouts warn that payment status may be unknown and should be checked before
  retrying.
- Public-release safety scripts now verify package metadata and reject internal
  development artifacts before staging/publishing the public mirror.

### Fixed

- x402 SDK install hints now include the directly imported `@x402/core`
  package: `npm install -g @x402/core @x402/fetch @x402/evm viem`.
- The npm `files` allowlist now enumerates public skill files instead of
  shipping the entire local `skills/` tree.

## [0.2.3] - 2026-06-18

### Fixed

- Prefix global boolean flags such as `--json` no longer consume the command
  token (`cambrian --json solana latest-block` now reaches the Solana command
  and emits structured JSON errors).
- Bare value-bearing options now fail fast with a usage error instead of being
  treated as defaults or the string `true` (`--timeout`, `--retries`,
  `--api-key`, `--base-url`, `--output`, and related MCP/pay/skill flags).
- The generated `dist/cli.js` is chmodded executable during build, preserving
  `-rwxr-xr-x` mode in the npm tarball.
- Cleared npm audit alerts in the dev/build dependency tree by updating
  `esbuild`, `vitest`/`vite`/`postcss`, and pinning the transitive `ws` version
  used through `viem`.

## [0.2.2] - 2026-06-18

Hardening from a full live-data sweep of all 74 endpoints.

### Changed

- **Default request timeout raised from 30s to 90s.** Several legitimate
  endpoints (single-pool details on Solana and Base, high-volume Solana queries
  like `traders-leaderboard`) routinely take 30–60s+ under load, producing
  avoidable `408` timeouts on valid requests. Override per call with `--timeout`.

### Fixed

- `--fields` with a mix of known and unknown columns now errors (exit 2) listing
  the unmatched fields, instead of silently dropping the unknown ones. This makes
  the array/object (dot-path) path consistent with the TableResponse path. A
  field present in only *some* elements of an array is still valid.
- `--fields` against an empty result (`columns: []`, e.g. a transient empty
  upstream response) now returns the empty result unchanged instead of erroring
  with a confusing "unknown column" message.

## [0.2.1] - 2026-06-17

### Removed

- Dropped the two undocumented Deep42 `discovery/*` endpoints
  (`discovery/project-metadata`, `discovery/search-projects`). They are hidden
  from the public docs (docs.cambrian.org/llms.txt) and return 404 on the live
  gateway, so the CLI no longer advertises them. Deep42 now exposes 5
  `social-data/*` endpoints (total endpoint count: 74). `sync-openapi` excludes
  them so they cannot reappear from the upstream OpenAPI spec.

## [0.2.0] - 2026-06-17

First release to bundle the resilience, agent-ergonomics, config, and x402
work. Everything in this release is **additive and non-breaking**: default
command output is unchanged (pretty JSON), all new flags and commands are
opt-in, and the package still ships with zero runtime dependencies.

### Added

- **Resilience**
  - `--retries <n>` (default `0`): retry transient failures (408/429/5xx) with
    full-jitter backoff that honors `Retry-After`.
  - "Did you mean…?" suggestions on unknown commands and resources.
  - Richer per-resource `--help` (example invocation, global options, docs
    pointer).
- **Agent data ergonomics** (opt-in; JSON stays the default)
  - `--output table|json|tsv`: render tabular results as an aligned table or
    TSV; non-tabular responses fall back to JSON.
  - `--fields a,b,c`: project the response to only the named columns/fields for
    smaller agent payloads.
  - `--all` / `--max-items <n>`: auto-paginate and merge pages on paginated
    resources (default cap `10000`).
- **Config & polish**
  - `cambrian config set-key|get-key|clear`: persist the API key at
    `XDG_CONFIG_HOME/cambrian/config.json` (`%APPDATA%` on Windows), mode `0600`.
    Precedence: `--api-key` → `CAMBRIAN_API_KEY` → stored config.
  - `cambrian completion <bash|zsh|fish>`: shell completion driven by the CLI's
    bundled metadata.
  - Non-blocking "update available" notice (stderr only, throttled to 24h,
    suppressed under `CI`/non-TTY/`NO_UPDATE_NOTIFIER`).
- **x402 pay-per-call**
  - `cambrian pay <group> <resource>`: pay for a single call with USDC on Base
    via x402 ($0.05/request, facilitator-settled — no gas, no API key). Prints a
    cost preview and requires `--yes`; `--max-amount <usd>` caps the price
    (default `0.10`). The signing libraries (`@x402/core`, `@x402/fetch`,
    `@x402/evm`, `viem`) are peer-installed and lazy-loaded, preserving the
    zero-runtime-dependency core. See [docs/x402.md](docs/x402.md).

## [0.1.14] - 2026

- OpenAPI-default handling in CLI metadata; preparation for MCP support.

## [0.1.13] - 2026

- Production-readiness Tier 1+2: client error normalization, `--json` and
  `--timeout` flags, and structured exit codes.

[0.2.5]: https://github.com/cambriannetwork/cambrian-cli/releases/tag/v0.2.5
[0.2.4]: https://github.com/cambriannetwork/cambrian-cli/releases/tag/v0.2.4
[0.2.3]: https://github.com/cambriannetwork/cambrian-cli/releases/tag/v0.2.3
[0.2.2]: https://github.com/cambriannetwork/cambrian-cli/releases/tag/v0.2.2
[0.2.1]: https://github.com/cambriannetwork/cambrian-cli/releases/tag/v0.2.1
[0.2.0]: https://github.com/cambriannetwork/cambrian-cli/releases/tag/v0.2.0
