# BASE JAM

Play the chain.

BASE JAM is a wallet-optional browser rhythm game. It turns 15 confirmed Base
blocks into a deterministic 30-second chart: one two-second block per musical
bar, four instrument rails, and three hit columns.

## Gameplay

- Switch among DRUMS, BASS, SYNTH, and FX with A/D or the lane buttons.
- Hit each rail’s three-note phrase with J/K/L.
- Completing a phrase captures that instrument stem for four bars.
- Chain together captures, timing streaks, and a full procedural mix.
- Leave with a block-by-block performance receipt.

Transaction hash, calldata size, gas, value, and fee data determine note
placement and velocity. Everyone playing the same block sequence gets the same
chart. The current rhythm vertical slice scores locally and labels that fact
honestly; the previous packing replay APIs remain in the repository but are not
used to claim that rhythm scores are server-verified.

## Architecture

```text
Base RPC (server only)
  → 15 immutable LevelManifestV1 blocks
  → deterministic rhythm chart
  → pure timing / scoring state machine
  → Phaser rail renderer + Web Audio sequencer
  → React HUD, touch controls, and mix receipt
```

If Base data is unavailable, the app can build an explicitly unranked,
deterministic practice chart. No wallet or custom contract is required.

## Local development

Requirements: Node 22+ and pnpm 10.

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Production should provide `BASE_RPC_HTTP_URLS` with a dedicated Base node first
and a failover endpoint second. The public Base RPC fallback is intended for
local development.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The rhythm chart and scoring state machine have deterministic unit coverage.
Browser playtests cover desktop and mobile layouts, keyboard/touch controls,
full-run completion, result receipts, overflow, and console errors.

## License

MIT
