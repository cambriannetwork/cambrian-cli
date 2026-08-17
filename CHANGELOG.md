# Changelog

All notable changes to the `cambrian` CLI are documented here. This project
follows [Semantic Versioning](https://semver.org/). Dates are UTC.

## [Unreleased]

## [1.3.0] - 2026-08-17

### Added

- Added the conditional `cambrian ethereum` command group. It appears when the
  active EVM OpenAPI schema advertises `chain_id=1` on a visible operation.
- Added exact support for OpenAPI numeric enums that contain more than one
  value. The runtime cache now preserves and validates all supported values.

### Changed

- Base commands remain fixed to `chain_id=8453`. Ethereum commands use
  `chain_id=1` and include only operations that explicitly support Ethereum.
- Deprecated the `evm` command. Help, completion, docs lists, suggestions, and
  OpenCLI no longer advertise it. Existing calls still use Base and print a
  warning.
- Kept `pay base` fixed to Base. This release does not add `pay ethereum`.
- Updated the packaged agent skill and public documentation for Base and
  Ethereum command selection.

## [1.2.0] - 2026-08-07

### Added

- OpenCLI self-description now covers every top-level command, nested resource,
  and supported option, including x402, configuration, completions, and MCP.
- `cambrian mcp test --mode local` now performs a real MCP initialize and
  `tools/list` exchange and verifies a representative public tool.
- Added `cambrian config status` for checking API-key configuration without
  printing either environment or stored secrets.

### Changed

- EVM and Solana endpoint discovery now prefer their chain-specific OpenAPI
  documents. Either can use the legacy combined Opabinia document when its
  primary is unavailable, then a last-known-good cache or bundled snapshot.
- OpenAPI attempts, validators, caches, and concurrent refreshes are isolated by
  physical source URL while preserving the 15-minute request floor across
  failures, explicit refreshes, processes, and both shared fallback groups.
- `--all` uses each endpoint's maximum supported page size to minimize requests,
  and help text clarifies that `--offline` only disables metadata refreshes.
- x402 help discovers and previews gateway pricing at request time instead of
  advertising a hardcoded price.
- Schema controls are documented as advanced commands with explicit cooldown
  behavior, and completion installation warns that shell-file appends are one-time.
- `config get-key` remains compatible but warns before printing the full secret;
  help recommends safe status checks and warns that `set-key` can enter shell history.

### Fixed

- Commands now reject ignored positional arguments and subcommand-inapplicable
  options instead of appearing to accept them.
- Custom API and hosted MCP URLs must be valid HTTP(S) URLs, and MCP rejects a
  hosted-only `--url` when local mode would otherwise ignore it.
- Retained compatible deprecated client request types for launch stability,
  removed the unused `--discover` flag and duplicate contracts, and ensured MCP
  subprocesses receive the caller-injected runtime environment.

## [1.1.8] - 2026-08-06

### Added

- `cambrian docs guides` now discovers the guide catalog from the live
  `docs.cambrian.org/llms.txt` index, and `cambrian docs guides <slug>` fetches
  any indexed guide without requiring another CLI release.

### Changed

- API-key guidance now links to `console.cambrian.org` and also points users to
  the separate x402 pay-per-call flow.
- Dynamically discovered `lending-*` Base resources are grouped under Lending
  in command help.

## [1.1.7] - 2026-08-05

### Fixed

- OpenAPI discovery now enforces a strict 15-minute request floor per physical
  schema URL across normal lookups, explicit refreshes, unknown commands,
  failures, concurrent callers, and separate CLI/MCP processes. Solana and Base
  share one refresh because they use the same gateway document.
- Invalid or empty cache files can no longer hide the bundled command registry,
  and a valid service group from a shared schema remains available if the other
  group is absent.

### Added

- Published the validated runtime schema resolver as `cambrian/schema` so the
  MCP package can share the same cache, cooldown, and fallback behavior.

### Changed

- Runtime discovery recognizes the public, unprefixed paths now emitted by
  `docs.cambrian.org` while retaining compatibility with upstream OpenAPI paths.

## [1.1.6] - 2026-08-05

### Fixed

- Explicit `skill install --path` targets no longer also modify auto-detected
  skill directories.
- Deep42 endpoint discovery now uses the configured client request path and
  returns only concrete Deep42 GET endpoints from the consolidated schema.
- Typed requests with no optional arguments no longer emit a trailing `?`, and
  the required `order_by` parameter for Solana trending tokens is reflected in
  the client type.

## [1.1.5] - 2026-08-05

### Changed

- Routed Solana, Base, Deep42, Risk, OpenAPI discovery, and endpoint-docs
  requests through their public hosts without the upstream `/api/v1` prefix.
- Moved paid calls to `x402.cambrian.org`; this separate gateway retains its
  payable `/api/v1` routes.
- Runtime discovery now accepts gateway-style OpenAPI paths and retains bundled
  commands when a live schema temporarily omits an entire service group.

## [1.1.4] - 2026-07-28

### Documentation

- Replaced "BYOK" wording in the README, the packaged skill bundle, and the
  `cambrian mcp --help` authentication block. Hosted and local MCP usage both
  require a caller-supplied Cambrian API key; BYOK read as a product mode the
  CLI does not have.
- Linked the `cambrian-mcp` getting-started agent skill from the CLI skill.

## [1.1.3] - 2026-07-17

### Documentation

- Updated MCP setup guidance to reflect that `cambrian-api-mcp` is published
  and available for local mode through npm.

## [1.1.2] - 2026-07-16

### Fixed

- Hosted MCP configuration, installation, help, and smoke tests now use the
  canonical `https://mcp.cambrian.org/mcp` endpoint and verify a public tool.
- If `llms.txt` is unavailable before any valid inventory is cached, live
  OpenAPI contracts remain usable but visibility falls back to the bundled
  public endpoint inventory instead of exposing intentionally hidden routes.
- Bumped the disposable schema cache format so older unfiltered outage caches
  cannot survive the safer visibility fallback.

## [1.1.1] - 2026-07-16

### Fixed

- Validated production OpenAPI is now authoritative for compatible runtime
  commands, including updates and removals of existing operations. The bundled
  snapshot is used only for explicit bundled mode or when no valid live/cache
  registry is available.
- Replaced the sticky additive cache overlay with atomic authoritative schema
  replacement. Failed, timed-out, oversized, or structurally invalid refreshes
  still preserve the last-known-good cache without partially applying metadata.
- Applied the `llms.txt` visibility threshold to the complete live registry:
  five or more documented compatible operations expose the documented
  intersection; fewer than five expose the compatible OpenAPI list.
- Bumped the registry cache format so installations cannot retain definitions
  pinned by the `1.1.0` additive-only merge.
- Runtime help, completion, OpenCLI, docs fallback, validation, execution, and
  x402 resource validation now consume updated existing-operation metadata.
  Production `token-analysis`, for example, exposes the current 1–730 day range
  and flexible `<N>h`/`<N>d` granularity from OpenAPI.
- Online endpoint docs now lead with the active OpenAPI executable contract and
  remove stale `llms.txt` parameter sections while retaining narrative examples
  and response semantics as supplementary guidance.
- Refreshed the installed offline snapshot through the runtime interpreter and
  visibility policy: 41 Solana, 23 public Base, 5 Deep42, and 1 Risk command.
  Existing CLI convenience defaults remain only while the active OpenAPI schema
  accepts them; an OpenAPI-declared default always takes precedence.
- `schema status` now accepts the global `--offline` flag because it is already
  a cache-only operation.

## [1.1.0] - 2026-07-15

### Added

- Compatible new API endpoints are now discovered from pinned production
  OpenAPI documents at runtime, so ordinary `GET`/query additions can appear
  without reinstalling the CLI or publishing another npm version.
- Added `cambrian schema status|refresh|clear-cache [group]`, the `--offline`
  metadata flag, and the `CAMBRIAN_SCHEMA_MODE=bundled` compatibility switch.
- Runtime endpoint metadata now feeds execution, help, shell completion,
  endpoint docs fallback, x402 resource validation, and `describe opencli`.

### Safety

- The installed 74-endpoint snapshot remains authoritative for every existing
  command. Live metadata is additive only and cannot remove or redefine bundled
  behavior.
- Runtime discovery accepts only concrete `GET` operations with supported query
  parameter schemas. It rejects request bodies, path parameters, catch-all
  routes, unsupported methods/serialization, ambiguous names, and malformed or
  unsafe metadata.
- Schemas use a 15-minute XDG-compatible, private, atomic, last-known-good cache
  with conditional HTTP revalidation and a five-second refresh timeout. Failed
  refreshes fall back to cache or bundle without blocking existing commands.
- A successful schema refresh remains usable for the current invocation when
  cache persistence fails, reports a warning, and performs best-effort cleanup
  of failed atomic-write temporary files.
- `schema status` identifies cached runtime additions that are missing from the
  current OpenAPI document or have drifted incompatibly, while continuing to
  execute their last-known-good definition.
- Runtime additions use the `llms.txt` intersection when it contains at least
  five compatible operations for a group; otherwise they fall back to the
  compatible OpenAPI list. Bundled commands are never filtered.
- The public release safety check rejects accidental runtime dependencies,
  preserving the package's zero-runtime-dependency contract.

## [1.0.0] - 2026-07-08

First stable release. The CLI surface (command groups, global flags, exit-code
contract, `--json` error schema, `describe opencli`) and the TypeScript client
are now considered stable; breaking changes will bump the major version.

### Fixed

- A rejected API key (HTTP 401) now prints clear guidance — check
  `CAMBRIAN_API_KEY`, replace the stored key with `cambrian config set-key`,
  where to get a key — instead of the sanitized upstream-gateway text
  ("Upstream returned a non-JSON (HTML) error response"), which read like a
  network fault. The structured `--json` error contract (`AUTH_REQUIRED`,
  status 401) is unchanged.
- Aligned the `cambrian mcp` row in the top-level `--help` output (was off by
  one space).

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
