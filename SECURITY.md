# Security

## Reporting a Vulnerability

Please report security issues privately by emailing the maintainers or by opening a private security advisory in GitHub.

Do not open a public issue for vulnerabilities involving credential handling, payment signing, package publishing, or API authentication.

## Credential Handling

- API reads use the `X-API-KEY` header.
- The CLI accepts credentials from `--api-key`, `CAMBRIAN_API_KEY`, or the local config file created by `cambrian config set-key`.
- The published CLI does not read project-local `.env` files.
- x402 wallet keys are read from `CAMBRIAN_X402_PRIVATE_KEY` only at runtime and are not stored by the CLI.

Never include real API keys, wallet private keys, or payment receipts in issues, logs, tests, docs, or screenshots.
