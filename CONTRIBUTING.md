# Contributing

Thanks for improving `cambrian`.

## Requirements

- Node.js 20 or newer
- npm

## Local Setup

```bash
npm ci
npm test
npm run build
node dist/cli.js --help
```

Live API queries require credentials:

```bash
export CAMBRIAN_API_KEY=<your-api-key>
node dist/cli.js solana latest-block
```

Do not commit credentials, `.env` files, generated tarballs, `dist/`, or local agent configuration.

## Development Rules

- Keep the core CLI runtime dependency-free.
- Keep API flags in kebab-case; API query params stay snake_case.
- Add tests for CLI-visible behavior, especially parsing, output, and error contracts.
- Preserve structured JSON errors on stderr when `--json` is used.
- Keep generated command metadata in sync with `src/generated/openapi-params.json`.

## Verification Before Opening a PR

```bash
npm test
npm run build
head -n 1 dist/cli.js
test -x dist/cli.js
node dist/cli.js describe opencli
npm pack --dry-run
```

For endpoint or schema changes, also run representative live commands with a valid `CAMBRIAN_API_KEY`.
