# Adding or Verifying an EVM Chain

> Developer guide. The agent-runtime skill version of this document lives at
> `.agents/skills/add-evm-chain/SKILL.md` (workspace-local). Keep both in sync.
> Deterministically add or verify an EVM chain (Base, Ethereum, Arbitrum, or a
> new `chain_id`) by reading the OpenAPI `chain_id` enums.

The EVM command surface is **derived from the OpenAPI `chain_id` enum** of each
operation. There are no per-endpoint chain lists to edit. Adding a chain is a
small, deterministic change plus a spec refresh.

## The Deterministic Source of Truth

Every EVM operation declares the chain ids it accepts:

```json
{ "name": "chain_id", "in": "query", "schema": { "type": "integer", "enum": [1, 8453, 42161] } }
```

The runtime registry normalizes that to `numericEnum: [1, 8453, 42161]` (or
`min = max = id` for a single-value enum). `projectEvmMetadata()` then filters
and pins endpoints per chain.

- Raw spec: <https://api.cambrian.org/evm/openapi.json>
- Bundled snapshot: `src/generated/openapi-params.json` (key `evm`)
- Chain table: `src/cli/evm-chains.ts` (`EVM_CHAINS`)
- Audit logic: `src/cli/evm-chain-audit.ts`
- Audit command: `npm run check:chains`

## Step 0 - Audit first (always)

```bash
npm run check:chains                 # live OpenAPI vs the chain registry
npm run check:chains -- --strict     # also fail if a registry chain is absent
npm run check:chains -- --json       # machine-readable
npm run check:chains -- --file src/generated/openapi-params.json   # offline
```

If the report shows `MISSING FROM REGISTRY: <id>`, the API serves a chain the
CLI does not expose. Follow the steps below. If it shows
`Registry chains absent from this document`, the live document is stale or the
chain was removed - do not add a row.

## Step 1 - Confirm the chain in the raw OpenAPI

```bash
curl -s https://api.cambrian.org/evm/openapi.json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const doc=JSON.parse(s);
      for (const [p,item] of Object.entries(doc.paths))
        for (const [m,op] of Object.entries(item)) {
          const c=(op.parameters||[]).find(x=>x.name==="chain_id");
          if (c) console.log(p, JSON.stringify(c.schema.enum ?? [c.schema.minimum]));
        }
    })'
```

`GET https://api.cambrian.org/evm/chains` also lists the canonical
`{ id, name }` pairs the API serves. **The OpenAPI enum is authoritative for
which endpoints accept the chain.**

## Step 2 - Add one row to the chain registry

`src/cli/evm-chains.ts`:

```ts
export const ARBITRUM_CHAIN: EvmChain = {
  command: 'arbitrum',   // CLI token, lowercase, must be unique
  chainId: 42161,        // EVM chain id from the OpenAPI enum
  label: 'Arbitrum One', // human-facing name in help/opencli
  group: 'base',         // always the shared EVM metadata group
};

export const EVM_CHAINS: readonly EvmChain[] = [BASE_CHAIN, ETHEREUM_CHAIN, ARBITRUM_CHAIN];
```

That is the **only** source edit. Everything downstream derives from it:

| Surface            | Derivation |
|--------------------|------------|
| command dispatch   | `EVM_CHAINS` -> `KNOWN_COMMANDS`, `DATA_COMMANDS`, switch case |
| root/group help    | `supportedEvmChains()` + projected resources |
| shell completion   | `supportedEvmChains()`, `evmChainForToken()` |
| `describe opencli` | `projectEvmChain()` per chain |
| docs fallback      | `metadataGroupKey()` -> `projectEvmChain()` |
| `cambrian pay`      | `EVM_CHAINS` -> one pay group per advertised chain |
| `cambrian schema chains` | `projectEvmChain()` + `hasEvmChainSupport()` |

Do **not** add chain-specific code to handlers, `help.ts`, `completion.ts`,
`opencli.ts`, `docs-fetcher.ts`, or `x402-handlers.ts`. If a new chain needs a
change outside `evm-chains.ts`, the derivation is incomplete and should be
fixed generically instead.

## Step 3 - Refresh the bundled snapshot

```bash
npm run sync-openapi      # rewrites src/generated/openapi-params.json
npm run check:chains -- --file src/generated/openapi-params.json --strict
```

`sync-openapi` is required: the shipped CLI reads the snapshot when the runtime
registry is unavailable. Endpoints **and** chain enums both come from this file.

## Step 4 - Update tests (expectations are deterministic)

```bash
npm test
```

Tests that encode exact counts or chain sets will need their expected values
updated to match the new snapshot. Known guards:

- `tests/evm-chains.test.ts` - registry projection per chain
- `tests/evm-chain-audit.test.ts` - audit logic (raw + normalized)
- `tests/params-match-openapi.test.ts` - bundled snapshot endpoint set and
  the exact Arbitrum-capable resource list
- `tests/runtime-discovery.test.ts` - multi-chain CLI discovery/projection
- `tests/completion.test.ts` - chain tokens in completion
- `tests/docs-fetcher.test.ts`, `tests/docs-fallback.test.ts` - help/doc
  formatting when param ranges change

Add the new chain to `evm-chains.test.ts` and the discovery fixture. Never
weaken a guard to make it pass; update the expected value to the real one.

## Step 5 - Build and live-test

```bash
npm run build
export CAMBRIAN_API_KEY=<key>

# registry view (offline, deterministic)
node dist/cli.js schema chains
node dist/cli.js <chain> --help
node dist/cli.js describe opencli --offline | node -e '...'

# live sweep: run every advertised resource for the chain
node -e '...'   # see "Live sweep" below
```

At minimum, verify against the live API:

```bash
node dist/cli.js <chain> tokens --limit 1
node dist/cli.js <chain> tokens --chain-id <wrong-id>   # must exit 2
node dist/cli.js <chain> docs <resource> --offline      # must not error
```

## Step 6 - Document and release

- Update `skills/cambrian/SKILL.md` and `skills/cambrian/references/cli.md`
  (chain semantics + routing).
- Update `AGENTS.md` and `.agents/skills/cambrian-api/SKILL.md` verified notes.
- Bump the version and add a `CHANGELOG.md` entry.
- Rebuild, `npm run pack:dry-run`, commit, tag, and push; publish to npm and
  sync the public release repo per `docs/release.md`.

## Adding a New Endpoint (no chain work)

New endpoints need **no code**: they appear after `npm run sync-openapi` because
metadata is derived from the spec. Missing a new endpoint almost always means
the snapshot is stale or the path failed the visibility/validation policy -
check `npm run sync-openapi` output for `hidden incompatible operation`.

```bash
npm run sync-openapi && npm run build
node dist/cli.js <chain> <new-resource> --help
```

## Live Sweep Recipe

Runs every normalized resource for a chain, adding only params the spec marks
required. Keep it dependency-free:

```bash
node -e '
const { CAMBRIAN_METADATA_GROUPS } = await import("./dist/metadata.js");
const chainId = 42161;
const spec = CAMBRIAN_METADATA_GROUPS.base.spec;
const { spawnSync } = require("child_process");
let pass = 0, fail = 0;
for (const [res, ep] of Object.entries(spec)) {
  const c = ep.params.chain_id;
  const ok = c && ((c.numericEnum||[]).includes(chainId) || (c.min===chainId && c.max===chainId));
  if (!ok) continue;
  const args = ["arbitrum", res];
  for (const [n,p] of Object.entries(ep.params)) {
    if (n === "chain_id" || n === "limit" || n === "offset") continue;
    if (p.required) args.push("--" + n.replace(/_/g,"-"), "0x" + "1".repeat(40));
  }
  if (ep.params.limit) args.push("--limit", "1");
  const out = spawnSync("node", ["dist/cli.js", ...args, "--output", "tsv"], { encoding: "utf8" });
  const bad = out.status !== 0 || ((out.stdout||"")+(out.stderr||"")).includes("Bad Request");
  bad ? fail++ : pass++;
  if (bad) console.log("FAIL", res, (out.stderr||out.stdout||"").slice(0,120));
}
console.log("pass=" + pass + " fail=" + fail);
' 2>/dev/null || echo "run from the repo with the API key exported"
```

Adjust the placeholder addresses for endpoints whose required params are not
addresses (the metadata `required` list tells you which).

## Anti-Patterns

- Hardcoding a chain list in a handler/help/completion file instead of `EVM_CHAINS`.
- Editing `src/generated/openapi-params.json` by hand - always regenerate.
- Claiming support without `npm run check:chains` passing and a live sweep.
- Adding a chain id that is not in the live OpenAPI `chain_id` enum.
- Skipping `sync-openapi` (runtime works, but the shipped bundle stays stale).
