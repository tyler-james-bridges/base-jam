# BASE JAM

Pack a real Base block into a 10×10 square.

BASE JAM is a deterministic, wallet-optional browser game. It converts a buffered
Base mainnet block into the same ordered set of transaction shapes for every
player. Runs are replayed by the server before a signed challenge link is
issued; client-submitted scores are never trusted.

## Why this exists

Block explorers make chain activity observable. BASE JAM makes it playable.

- 60-second, one-thumb packing rounds
- Real transaction-derived pieces
- Guest-first play; wallet connection is optional
- Pure simulation shared by the browser and replay verifier
- Signed, tamper-evident result links
- Explicit unranked fallback when Base data is unavailable
- Zero custom contracts in the MVP

## Architecture

```text
Base RPC (server only)
  → immutable LevelManifestV1
  → deterministic transaction buckets
  → pure 10×10 simulation
  → Phaser presentation + DOM HUD
  → signed run ticket
  → server replay verification
  → signed challenge URL
```

The game never labels `gas` as actual gas used. Receipt-only fields are added
only when the provider returns a matching receipt. Base deposit/system
transactions (`0x7e`) do not become pieces.

See [PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) and
[FEASIBILITY.md](docs/FEASIBILITY.md) for the full decision record.

## Local development

Requirements: Node 24 and pnpm 10.

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

The public Base RPC fallback is suitable only for local development. Production
uses `BASE_RPC_HTTP_URLS` with a dedicated Base node provider first and Base's
official endpoint as failover. The legacy single `BASE_RPC_HTTP_URL` remains
supported.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Security posture

- No private keys or unrestricted paymaster
- No client-side RPC credentials
- Run and share tokens use server-only HMAC secrets
- Strict payload limits and schema validation
- Deterministic replay verification, not client score acceptance
- Anonymous local play remains available if wallet flows fail

Wallet signatures prove account control, not that a player is human. BASE JAM does
not claim bot-proof competition or guaranteed virality.

## Base resources

- [Base network connection guidance](https://docs.base.org/base-chain/quickstart/connecting-to-base)
- [Base transaction finality](https://docs.base.org/base-chain/network-information/transaction-finality)
- [Base standard app migration](https://docs.base.org/apps/guides/migrate-to-standard-web-app)
- [Base Builder Codes](https://docs.base.org/apps/builder-codes/builder-codes)

## License

MIT
