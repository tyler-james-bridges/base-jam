# SQSH product specification

## Product thesis

SQSH turns Base blockspace into a fair, daily, 60-second spatial puzzle. A real
buffered Base block produces an ordered bag of up to 24 polyomino pieces. Every
player receives the same bag and 10×10 board. Their final arrangement becomes a
signed challenge artifact.

“Guaranteed viral” is not a technically verifiable requirement. The measurable
launch targets are:

- first-session run completion
- immediate replay rate
- result-share completion
- challenge-link open-to-play conversion
- next-day daily challenge return

## Player promise

> Same block. Same pieces. Your best SQSH.

The app never requires a wallet before the player experiences the game.

## Core loop

1. Fetch a buffered Base block and cut up to 24 transaction pieces.
2. Move the placement ghost, rotate, and press the current piece onto a 10×10
   board.
3. Build adjacency and complete rows/columns for score.
4. Use one undo or spill an impossible piece.
5. Finish the bag or hit the 60-second limit.
6. Seal the board, replay the inputs server-side, and issue a signed challenge
   URL.

## Controls

| Action | Pointer / touch | Keyboard |
| --- | --- | --- |
| Move ghost | hover or tap target cell | arrow keys |
| Rotate | Rotate button | `R` |
| Place | tap board or Press here | `Space` |
| Undo | Undo once | `Z` |
| Spill | Spill piece | `X` |

No action requires a precision-only gesture. The DOM controls remain available
alongside the canvas.

## Data-to-game mapping

| Base field | Game effect |
| --- | --- |
| block hash | full deterministic PRNG seed |
| ordered sampled transactions | fixed piece order |
| transaction gas limit | compact gas bucket |
| max fee per gas | fee bucket |
| calldata byte length | input bucket |
| transferred value | value bucket |
| compact buckets + hash entropy | piece kind and color |
| receipt status, when available | future cracked/clean material treatment |

All authoritative score math is integer-only. No `Math.random`, frame timing,
or wall clock participates in scoring.

## Scoring and grades

- 100 points per placed cell
- 25 points per adjacent edge to already placed cells
- 1,000 points for each newly completed row or column
- 25-point penalty per spilled cell

Grades use packed board percentage:

- S: at least 90% with zero spills
- A: at least 80%
- B: at least 70%
- C: at least 60%
- D: at least 45%
- F: below 45%

## Modes

Launch:

- Latest block: buffered Base block, guest-first
- Practice fallback: explicit unranked manifest when RPC is unavailable
- Challenge replay: signed shared result and rematch

Post-launch candidates:

- Daily UTC block
- Block archive search
- Weekly districts and cosmetic print materials
- Verified wallet identity and notification opt-in

## Brand

Name: **SQSH** (pronounced “squish”)

Ticker-style identity: **$SQSH**. This is brand architecture only. The MVP does
not create or imply a tradeable token.

Visual language:

- warm uncoated paper
- cobalt, coral, acid, violet, and near-black inks
- tactile register-offset print texture
- dense modern editorial typography
- procedural transaction mosaics

Avoid neon cyber grids, token coins, explorer-dashboard chrome, and using the
Base logo as SQSH’s own identity.

## Accessibility

- pointer, touch, and keyboard parity
- DOM buttons around the canvas
- text and pattern cues in addition to color
- reduced-motion media query
- high-contrast ink/paper theme
- game status announced through polite live regions
- safe-area and narrow-height layouts

## Out of scope for MVP

- token launch
- custom Solidity contracts
- paid prizes
- unrestricted gas sponsorship
- claims of human-only or bot-proof ranking
- legacy Farcaster MiniKit integration
