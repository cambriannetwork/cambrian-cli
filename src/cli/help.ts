export function rootHelp(): string {
  return [
    'cambrian - DeFi data, social intelligence, and risk analysis CLI',
    '',
    'Usage:',
    '  cambrian solana <resource> [options]     Solana DeFi data (pools, tokens, prices, transactions)',
    '  cambrian base <resource> [options]       Base chain DeFi data (pools, TVL, prices across 6+ DEXes)',
    '  cambrian deep42 <resource> [options]     Social intelligence (alpha tweets, influencer credibility)',
    '  cambrian risk <resource> [options]       Perpetual risk simulations',
    '  cambrian pay <group> <resource> [options] Pay-per-call via x402 (Base USDC; no API key)',
    '  cambrian docs [group] [resource]         API documentation from docs.cambrian.org',
    '  cambrian config <set-key|get-key|clear>  Persist your API key (XDG config, 0600)',
    '  cambrian completion <bash|zsh|fish>      Print a shell completion script',
    '  cambrian schema <status|refresh|clear-cache> Runtime endpoint registry controls',
    '  cambrian skill <install|print|targets>   Skill bundle for AI agents',
    '  cambrian mcp <config|install|test>       MCP setup helpers (hosted by default)',
    '  cambrian describe opencli                Machine-readable CLI schema',
    '  cambrian --version                       Print version',
    '',
    'Aliases:',
    '  cambrian evm ...                         Same as cambrian base',
    '',
    'Quick start:',
    '  export CAMBRIAN_API_KEY=<your-key>',
    '  cambrian solana trending-tokens',
    '  cambrian base dexes',
    '  cambrian deep42 alpha-tweets --limit 5',
    '  cambrian risk perp-risk-engine --token-address <addr> --entry-price 100 --leverage 10 --direction long --risk-horizon 1d',
    '',
    'Get help:',
    '  cambrian solana --help                   List solana resources',
    '  cambrian solana price-current --help     Show flags for a resource',
    '  cambrian docs                            Full API documentation',
    '  cambrian docs solana                     Solana API documentation',
    '  cambrian docs solana price-current       Endpoint-specific docs',
    '  cambrian mcp config                      Print hosted MCP config for Claude',
    '',
    'Get a key: https://form.typeform.com/to/FlAoEzva',
    'Docs: https://docs.cambrian.org',
  ].join('\n');
}

export function skillHelp(): string {
  return [
    'Usage:',
    '  cambrian skill install [--tool <claude|opencode>] [--path <dir>]...',
    '  cambrian skill print [--adapter <claude|openai|opencode>]',
    '  cambrian skill targets',
    '',
    'Note:',
    '  skill install copies the packaged skill bundle only.',
    '  Agents using the installed skill still need CAMBRIAN_API_KEY',
    '  in their runtime before they can perform live reads.',
  ].join('\n');
}

export function configHelp(): string {
  return [
    'Usage:',
    '  cambrian config set-key <key>    Persist your API key',
    '  cambrian config get-key          Print the stored API key',
    '  cambrian config clear            Remove the stored API key',
    '',
    'Storage:',
    '  $XDG_CONFIG_HOME/cambrian/config.json (default ~/.config), mode 0600.',
    '',
    'API key precedence (highest first):',
    '  --api-key  →  CAMBRIAN_API_KEY  →  stored config file',
  ].join('\n');
}

export function completionHelp(): string {
  return [
    'Usage:',
    '  cambrian completion <bash|zsh|fish>',
    '',
    'Prints a shell completion script to stdout. Install with, e.g.:',
    '  cambrian completion bash >> ~/.bashrc',
    '  cambrian completion zsh  >> ~/.zshrc',
    '  cambrian completion fish > ~/.config/fish/completions/cambrian.fish',
  ].join('\n');
}

export function schemaHelp(): string {
  return [
    'Usage:',
    '  cambrian schema status [solana|base|deep42|risk]',
    '  cambrian schema refresh [solana|base|deep42|risk]',
    '  cambrian schema clear-cache [solana|base|deep42|risk]',
    '',
    'Validated runtime OpenAPI is authoritative for supported GET/query',
    'commands. Failed or invalid refreshes fall back to cache, then bundle.',
  ].join('\n');
}

export function describeHelp(): string {
  return [
    'Usage:',
    '  cambrian describe opencli',
    '',
    'Prints a machine-readable OpenCLI JSON document describing all',
    'commands, subcommands, and options. Agent runtimes can ingest',
    'this to discover the full command surface.',
  ].join('\n');
}

export function docsHelp(): string {
  return [
    'Usage:',
    '  cambrian docs                    Full API documentation',
    '  cambrian docs <group>            Group docs (solana, base, deep42, risk)',
    '  cambrian docs <group> <resource> Endpoint-specific docs',
    '',
    'Examples:',
    '  cambrian docs',
    '  cambrian docs solana',
    '  cambrian docs solana price-current',
    '',
    'Options:',
    '  --offline   Use cached/bundled endpoint metadata and schema-derived docs.',
    '',
    'Source: docs.cambrian.org/llms.txt',
  ].join('\n');
}
