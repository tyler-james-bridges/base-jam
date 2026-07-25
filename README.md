# BASE JAM

Play the chain.

BASE JAM is a wallet-optional, one-thumb browser rhythm game. It turns 10
confirmed Base blocks into a deterministic 20-second run through an octagonal
signal tunnel: tap, flick left, or flick right as each command reaches the
capture line.

## Gameplay

- Ten Base blocks expand into 31 deterministic commands: two cues in the first
  phrases, three through the middle, and four in the finale.
- Tap/Space stays on the current face; horizontal flicks or Arrow/A/D rotate
  left and right across the eight-face tunnel.
- The successful tutorial sequence is `TAP → TAP → LEFT → RIGHT`. A missed
  lesson repeats on the next cue instead of advancing silently.
- Correct direction and timing build a combo and x1–x4 multiplier. A wrong
  direction or missed cue resets combo, never the run.
- Hitting at least 75% of a block phrase activates its beat, bass, synth, or FX
  layer through the following two blocks. A failed phrase fades that channel.
- The result scores every cue, and **Run it back** replays the identical chart.

Transaction hash, calldata size, gas, transaction count, and fee data determine
the phrase pattern, energy, accents, timbre, color, and motion within bounded
musical ranges. Everyone playing the same block sequence gets the same chart.
Scores remain local and are labelled honestly.

## Architecture

```text
Base RPC (server only)
  → 10 immutable LevelManifestV1 blocks
  → 10-phrase / 31-cue deterministic pulse chart
  → pure direction, timing, combo, and phrase state machine
  → Phaser simulation bridge + Web Audio sequencer
  → React Three Fiber single-target octagonal tunnel renderer
  → React HUD, one-thumb gesture surface, and per-cue receipt
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

The pulse chart and scoring state machine have deterministic unit coverage.
Browser playtests cover desktop and mobile layouts, successful tutorial
progression, wrong-route recovery, touch drift, temporary-channel HUD state,
keyboard/touch input, practice fallback, overflow, and 3D asset failure.

## License

MIT
