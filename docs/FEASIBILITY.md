# BASE JAM feasibility and launch decisions

## Verdict

BASE JAM is technically feasible with high confidence as a Base-native deterministic
consumer game.

The game does not need a custom contract. Base supplies the immutable level
source; the application supplies deterministic simulation, replay verification,
identity, and sharing.

## Base data

Production source:

- dedicated server-only CDP Node endpoint as the primary provider
- Base's official endpoint as an emergency failover
- `eth_getBlockByNumber(blockNumber, true)` for canonical ordered transactions
- individual receipt enrichment for the bounded sample when receipts are
  supported and required
- block identity pinned by chain ID, number, and hash
- immutable manifest cached by digest

The public `https://mainnet.base.org` endpoint is rate-limited and documented as
unsuitable as a production primary. It remains available for local development
and as a last-resort production failover behind the dedicated provider.

Latest play uses a buffered block rather than the tip so receipts and canonical
identity are available. Prize or consequential ranking would need the `safe`
head and a stronger anti-bot policy.

## Determinism

`LevelManifestV1` is JSON-safe and versioned. A 32-byte block hash seeds a named
`xoshiro128**` PRNG. Raw RPC quantities are converted to bounded integer buckets
before entering the simulation.

The same pure package runs:

- in the player’s browser
- in unit tests
- in the server replay verifier

The renderer is disposable view state. Phaser never owns authoritative game
rules.

## Replay verification

1. Server issues an expiring HMAC-signed run ticket bound to level digest,
   number, hash, and ranked status.
2. Client submits the deterministic action replay and claimed result.
3. Server resolves the level identity and runs the replay from the beginning.
4. Only the server result is signed into a share token.

This prevents edited client scores. It does not prove a human produced the
inputs. Wallet signatures would prove account control only.

## Failure policy

| Failure | Required behavior |
| --- | --- |
| RPC timeout / 429 | retry, then explicit practice manifest |
| missing receipt | omit receipt-only fields; do not invent them |
| wrong block hash | reject level or run identity |
| expired ticket | reject and offer a new run |
| invalid replay | reject with a recoverable message |
| wallet reject | keep guest play available |
| verifier outage | preserve local result; do not label it verified |
| malformed share token | show invalid challenge recovery |

## Current constraints

- HMAC share links are durable while `RUN_TICKET_SECRET` remains stable.
- There is no global leaderboard database in the launch MVP.
- There is no human-attestation layer.
- The signed share payload must stay under the configured token size limit.
- Production and preview keep the dedicated RPC configuration server-only in
  Vercel; no provider credential is included in the browser bundle.

## Why zero contracts

A score contract that accepts a client-supplied number does not make a score
true. A broad paymaster creates a drainable sponsorship surface. Neither belongs
in this MVP.

A future event-only run receipt could accept a backend EIP-712 attestation after
product-market fit, but it would prove that the verifier attested the run—not
that the player was human.

## Base app expectations

Current Base apps are standard web apps. BASE JAM uses wagmi/viem-compatible wallet
connectivity and remains playable without a wallet. Base.dev metadata,
screenshots, builder code, and optional notifications are launch-channel tasks,
not reasons to block the core game.

References:

- [Connecting to Base](https://docs.base.org/base-chain/quickstart/connecting-to-base)
- [Base transaction finality](https://docs.base.org/base-chain/network-information/transaction-finality)
- [Flashblocks FAQ](https://docs.base.org/base-chain/flashblocks/faq)
- [Standard Base app migration](https://docs.base.org/apps/guides/migrate-to-standard-web-app)
- [Base Account overview](https://docs.base.org/base-account/overview/what-is-base-account)
