export function rootHelp(ethereumAvailable = false): string {
  return [
    'cambrian - DeFi data, social intelligence, and risk analysis CLI',
    '',
    'Usage:',
    '  cambrian solana <resource> [options]     Solana DeFi data (pools, tokens, prices, transactions)',
    '  cambrian base <resource> [options]       Base chain DeFi data (pools, TVL, prices across 6+ DEXes)',
    ...(ethereumAvailable
      ? ['  cambrian ethereum <resource> [options]   Ethereum mainnet DeFi data']
      : []),
    '  cambrian deep42 <resource> [options]     Social intelligence (alpha tweets, influencer credibility)',
    '  cambrian risk <resource> [options]       Perpetual risk simulations',
    '  cambrian pay <group> <resource> [options] Pay-per-call via x402 (Base USDC; no API key)',
    '  cambrian docs [group] [resource]         API documentation from docs.cambrian.org',
    '  cambrian config <status|set-key|get-key|clear> Manage your API key (XDG config, 0600)',
    '  cambrian completion <bash|zsh|fish>      Print a shell completion script',
    '  cambrian skill <install|print|targets>   Skill bundle for AI agents',
    '  cambrian mcp <config|install|test>       MCP setup helpers (hosted by default)',
    '  cambrian describe opencli                Machine-readable CLI schema',
    '  cambrian --version                       Print version',
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
    '  cambrian docs guides                     List live documentation guides',
    '  cambrian mcp config                      Print hosted MCP config for Claude',
    '',
    'Advanced:',
    '  cambrian schema <status|refresh|clear-cache> Runtime endpoint registry controls',
    '                                              (15-minute per-source request floor)',
    '',
    'Get an API key: https://console.cambrian.org/',
    'No API key? Use x402 pay-per-call: cambrian pay --help',
    'x402 guide: https://docs.cambrian.org/guides/x402/llms.txt',
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
    '  cambrian config status           Check configuration without exposing a key',
    '  cambrian config set-key <key>    Persist your API key',
    '  cambrian config get-key          Print the stored API key (compatibility command)',
    '  cambrian config clear            Remove the stored API key',
    '',
    'Safety:',
    '  Prefer "config status" to inspect setup. "get-key" prints the full secret.',
    '  A key passed to "set-key" may remain in shell history; prefer the',
    '  CAMBRIAN_API_KEY environment variable when persistence is not required.',
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
    'Prints a shell completion script to stdout. Run each append command only once:',
    '  cambrian completion bash >> ~/.bashrc',
    '  cambrian completion zsh  >> ~/.zshrc',
    '  cambrian completion fish > ~/.config/fish/completions/cambrian.fish',
  ].join('\n');
}

export function schemaHelp(): string {
  return [
    'Usage:',
    '  cambrian schema status [solana|base|ethereum|deep42|risk]',
    '  cambrian schema refresh [solana|base|ethereum|deep42|risk]',
    '  cambrian schema clear-cache [solana|base|ethereum|deep42|risk]',
    '',
    'Validated runtime OpenAPI is authoritative for supported GET/query',
    'commands. Refresh requests only run after a source\'s 15-minute cooldown',
    'has elapsed; refresh never bypasses the floor.',
    'Clear-cache removes last-known-good metadata but leaves the request cooldown intact.',
    'Failed or invalid refreshes fall back to cache, then bundle.',
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

export function docsHelp(ethereumAvailable = false): string {
  return [
    'Usage:',
    '  cambrian docs                    Full API documentation',
    `  cambrian docs <group>            Group docs (solana, base${ethereumAvailable ? ', ethereum' : ''}, deep42, risk)`,
    '  cambrian docs <group> <resource> Endpoint-specific docs',
    '  cambrian docs guides             List available guides',
    '  cambrian docs guides <name>      Fetch a guide',
    '',
    'Examples:',
    '  cambrian docs',
    '  cambrian docs solana',
    '  cambrian docs solana price-current',
    '  cambrian docs guides x402',
    '',
    'Options:',
    '  --offline   Do not fetch docs; use cached/bundled endpoint metadata instead.',
    '              Guides require an internet connection; data requests do too.',
    '',
    'Source: docs.cambrian.org/llms.txt',
  ].join('\n');
}
