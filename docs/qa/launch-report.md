# BASE JAM production launch QA

## Remediation re-test

**Final verdict: PASS**

The two player-facing findings from the independent review were fixed in commit
`9e01d1f1129fac953bda2e23ff9375fe97a62c3d` and re-tested against Vercel
deployment `dpl_B2fKqMpqRKTMaeWcuESYvkh5SykQ` on
`https://basejam.0x402.sh` at 2026-07-18T13:48Z.

| Finding | Re-test result | Production evidence |
| --- | --- | --- |
| Initial RPC recovery | **RESOLVED** | With only `GET /api/levels/latest` intercepted as HTTP 503, **Use practice plate** fetched the dedicated RPC-independent practice endpoint, requested a signed run with `practice:true`, and opened an 18-piece board labeled `Unranked practice`. [Screenshot 14](screenshots/14-fixed-practice-recovery.png) |
| Long practice identifier overlap | **RESOLVED** | The real 24-digit future-block path rendered `Practice plate` and compact label `Requested #999999…999999`. At 1280×900 the heading ended at x=289.14 and the board began at x=336.38, leaving a measured 47.24px gap. [Screenshot 15](screenshots/15-fixed-practice-label.png) |
| Public Base RPC dependency | **RESOLVED** | Production and Preview now use a server-only CDP Node Base endpoint as the primary transport and Base's official endpoint as a ranked failover. The primary returned chain ID `0x2105` and a current Base block before rollout. |

The custom hostname resolved to Vercel from both Cloudflare and Google public
DNS, served HTTPS 200 with a valid certificate, and rendered absolute
`https://basejam.0x402.sh/opengraph-image...` metadata. A fresh real Base run
also passed end-to-end on the custom domain: 24 ranked pieces, signed start
ticket, 200 replay finish, `verified:true`, `ranked:true`, and a signed share
token with no page or console errors.

The remediation build passed 27 unit/API tests, 8 desktop/mobile Playwright
tests, lint, typecheck, and production build locally. GitHub CI run
[`29646668269`](https://github.com/tyler-james-bridges/base-jam/actions/runs/29646668269)
independently passed both `verify` and `browser-smoke` jobs on the same SHA.
The original review below remains intact as the audit trail for what was found.

## Findings

### Medium — Initial RPC recovery cannot actually start the advertised practice plate (resolved)

- **What the player sees:** after the initial level request fails, the recovery
  screen offers **Use practice plate**. Selecting it returns the player to the
  landing page instead of starting an unranked game.
- **Reproduction:** intercept only `GET /api/levels/latest` with a deterministic
  HTTP 503, select **Play latest block**, then select **Use practice plate**.
- **Expected:** a locally available deterministic practice manifest starts.
- **Actual:** the app returns to `JAM THE BLOCK.` because no `level` exists for
  `practiceLevel()` to reuse.
- **Why it matters:** the recovery CTA fails in the exact initial-outage case it
  appears designed to handle.
- **Likely owner:** frontend state/data recovery (`BaseJamApp`).
- **Evidence:** [RPC error state](screenshots/09-intercepted-rpc-recovery-error.png)
  and [practice CTA returned home](screenshots/10-intercepted-practice-button-no-start.png).
- **Mode:** Playwright interception, clearly simulated; normal happy-path APIs
  were not mocked.

### Medium — Long practice block identifiers overlap the desktop playfield (resolved)

- **What the player sees:** a future/unavailable numeric block correctly becomes
  an unranked practice level, but its generated identifier runs out of the left
  HUD and visibly over the board.
- **Reproduction:** open
  `/?block=999999999999999999999999`, start the returned practice level, and
  view at 1280×900.
- **Expected:** the block label wraps, truncates, or uses a compact requested
  block label without obstructing play.
- **Actual:** `Block practice-2026-07-18-for-999999999999999999999999`
  crosses the grid-column boundary and overlays the playfield.
- **Why it matters:** the fallback remains playable, but the primary game surface
  is visually obstructed in a supported sad path.
- **Likely owner:** frontend responsive HUD/layout.
- **Evidence:** [real future-block practice fallback](screenshots/11-real-future-block-practice-fallback.png).
- **Mode:** real production API and UI; no interception.

### Medium — Production is configured to use Base's public RPC endpoint (resolved)

- **What was observed:** the original deployed production environment had
  `BASE_RPC_HTTP_URL` set to `mainnet.base.org`.
- **Expected for sustained production traffic:** a dedicated, monitored Base RPC
  provider with suitable rate limits.
- **Remediation:** Production and Preview now use `BASE_RPC_HTTP_URLS` with CDP
  Node first and `mainnet.base.org` second. The server rejects public-only
  production configuration, validates HTTPS transports, retries bounded
  failures, and uses viem's ranked fallback transport.
- **Verification:** the dedicated endpoint returned Base chain ID `0x2105`, a
  current block number, and a populated latest block before deployment.
- **Why it matters:** level generation and ranked replay confirmation both depend
  on this server-side provider.
- **Likely owner:** infrastructure/operations.
- **Evidence:** provider-level JSON-RPC validation, sensitive Vercel environment
  configuration, configuration unit tests, and production ranked-flow re-test.

## Launch recommendation

**PASS**

The exact production artifact passes its core launch story: anonymous access,
real ranked Base data, pointer/touch controls, deterministic gameplay, nonzero
placement, undo/spill, server-verified replay, tamper-evident share URL, same-block
challenge, dynamic OG images, responsive mobile layout, and safe invalid-link/API
handling. The two user-facing recovery/practice findings and the dedicated RPC
hardening item are resolved.

## Artifact under test

| Field | Value |
| --- | --- |
| Review window | 2026-07-18T13:29:10Z–2026-07-18T13:35:27Z |
| Git commit | `c3526fb085d2a1f5e7ac1222d147f25f9e74fd03` |
| Expected branch | `main` |
| GitHub CI | PASS, run `29646005872`, same head SHA |
| Vercel deployment ID | `dpl_7Yv3nzQqQzQR6GMhK2Bd5e4v7TJH` |
| Vercel deployment URL | `https://base-do4t4tvlj-tjb-projects.vercel.app` |
| Canonical URL tested | `https://playbasejam.vercel.app` |
| Vercel state | Production / Ready |
| Browser | Headless Google Chrome via Playwright 1.61.1 |
| Network | Live production, except the explicitly intercepted RPC-failure tests |

## Production test matrix

| Check | Result | Mode | Timestamp / viewport / setup | Expected vs. actual | Evidence | Console / network |
| --- | --- | --- | --- | --- | --- | --- |
| Anonymous landing + real Base level | PASS | Real production | 13:29Z; 1440×1000; clean guest context | Expected useful first state and ranked Base manifest; got title `BASE JAM — Pack a real Base block`, chain 8453, 3 confirmations, 24 pieces | [01](screenshots/01-desktop-landing-real-base.png) | No page errors; `GET /api/levels/latest` 200 |
| Optional wallet UI | PASS | Real production | 13:30Z; 1440×1000; no wallet connected | Expected gameplay not gated by wallet and an obvious optional Connect button; got Connect menu with explanatory copy and injected/Coinbase options | [01](screenshots/01-desktop-landing-real-base.png) | No app console errors; Coinbase metrics request was aborted non-fatally |
| Start ranked guest run | PASS | Real production | 13:30Z; 1440×1000 | Expected signed ticket and playable board; got `POST /api/runs/start` 200, 60-second board, `Replay verified`, 24-piece queue | [02](screenshots/02-desktop-game-board.png) | No page errors |
| Rotate + valid pointer placement | PASS | Real production | 13:30Z and independent 13:34Z session; 1440×1000 | Expected rotation feedback and nonzero board; one real piece placed at center, packed 3–4%, score 300–400, cursor 1/24 | [03](screenshots/03-desktop-valid-placement.png) | No app console errors |
| One undo | PASS | Real production | 13:30Z; 1440×1000 | Expected cursor return to 0/24 and undo disabled after use; observed both | [03](screenshots/03-desktop-valid-placement.png) | No failed app API |
| Spill + finish/seal | PASS | Real production | 13:30Z; 1440×1000 | Expected remaining pieces could be spilled and result sealed; got grade F with retained 3% placed board | [04](screenshots/04-desktop-verified-result.png) | No page errors |
| Server replay verification | PASS | Real production | 13:30Z; same ranked run | Expected canonical server replay, not client score trust; `POST /api/runs/finish` returned 200, `verified:true`, `ranked:true`, 3%, signed share token | [04](screenshots/04-desktop-verified-result.png) | Finish response 200 |
| Share page + share API | PASS | Real production | 13:30Z; 1440×1000 | Expected signed run to render and API to verify; page 200, API 200, ranked block and 3% match | [05](screenshots/05-desktop-share-challenge.png) | No app console errors |
| Same-block challenge/deep link | PASS | Real production | 13:30Z; 1440×1000 | Expected CTA to preserve block 48796018; landed on `/?block=48796018&challenge=…` with `Play challenge #48,796,018` | [05](screenshots/05-desktop-share-challenge.png) | Next navigation produced only a benign aborted-document request |
| Root and share OG images | PASS | Real production | 13:29–13:30Z; HTTP inspection | Expected absolute rendered metadata and PNG endpoints; root/share `og:image` were absolute `https://playbasejam.vercel.app/...`, both 200 `image/png` | [13](screenshots/13-root-opengraph-image.png) | Root OG 52,922 bytes; share OG 200 |
| Mobile landing | PASS | Real production | 13:31Z; iPhone 13 emulation, 390 CSS px | Expected readable hierarchy, touch CTA, no horizontal overflow; scroll width equaled inner width | [06](screenshots/06-mobile-landing-real-base.png) | No app console errors |
| Mobile touch gameplay | PASS | Real production | 13:31Z and independent 13:34Z session; iPhone 13 emulation | Expected touch rotate/place and unobstructed controls; real touch placement reached 3%, all four controls remained visible | [07](screenshots/07-mobile-game-valid-placement.png) | No page errors |
| Reduced motion | PASS | Real production | 13:31Z; iPhone 13 context with `reducedMotion: reduce` | Expected animations/transitions effectively removed; computed duration was `0.001ms` | [07](screenshots/07-mobile-game-valid-placement.png) | No page errors |
| Small viewport / overflow | PASS | Real production | 13:31Z; 320×568 requested mobile viewport | Expected no horizontal scrollbar or unusable controls; layout adjusted to 345 CSS px, all four game controls were 50px high and visible | [08](screenshots/08-small-mobile-game.png) | No page errors |
| Future/unavailable block fallback | PARTIAL | Real production | 13:32Z; 1280×900; block `999999999999999999999999` | Expected unranked deterministic practice; API returned 200 with 18 pieces and UI showed `UNRANKED PRACTICE`, but long ID overlapped board | [11](screenshots/11-real-future-block-practice-fallback.png) | No page errors; see finding 2 |
| Initial RPC/offline recovery state | PARTIAL | Intercepted sad path | 13:31Z; 1280×900; only latest-level request forced to 503 | Expected actionable error and working recovery; error copy/Retry rendered, but Use practice plate did not start | [09](screenshots/09-intercepted-rpc-recovery-error.png), [10](screenshots/10-intercepted-practice-button-no-start.png) | Expected simulated 503 console messages; no page exceptions |
| Invalid share page | PASS | Real production | 13:32Z; 1440×1000; `/run/not-a-token` | Expected safe recovery without accepting score; rendered `THIS PLATE WON’T VERIFY`, fresh-game CTA, `noindex,nofollow` | [12](screenshots/12-invalid-share-token-recovery.png) | Page 200 by design; no page errors |
| Invalid share API | PASS | Real production | 13:29Z; direct HTTP | Expected rejection; got 401 `INVALID_SHARE_TOKEN` | n/a | JSON error; no secret/detail leak |
| Invalid block API | PASS | Real production | 13:29Z; `/api/levels/not-a-block` | Expected validation; got 400 `INVALID_BLOCK_NUMBER` | n/a | JSON error |
| Invalid block query | PASS | Real production | 13:32Z; `/?block=not-a-block` | Expected malformed query ignored safely; app loaded latest and showed `Play latest block` | n/a | No page errors |
| Malformed start body | PASS | Real production | 13:29Z; direct HTTP invalid JSON | Expected validation; got 400 `INVALID_JSON` | n/a | JSON error |
| Wrong API method | PASS | Real production | 13:29Z; `GET /api/runs/start` | Expected method rejection; got 405 | n/a | No state change |

## Visual and interaction review

- The first actionable desktop and mobile screens prioritize the game CTA over
  dashboard chrome.
- The normal ranked HUD does not obstruct the 10×10 playfield. Timer, packed
  percentage, score, piece count, rank state, preview, and controls remain
  readable.
- Pointer and touch placement both visibly update the board and HUD. UI buttons
  expose the same rotate/place/undo/spill verbs as the Phaser keyboard bindings
  (`R`, Space, `Z`, `X`, plus arrow nudging in source).
- The board has `role="application"` and the accessible label
  `BASE JAM packing board`; controls have visible names; live notices and replay
  verification use `aria-live`.
- Focus-visible styling is defined for buttons and links. No keyboard trap or
  blocking overlay was observed.
- Normal production sessions had no page exceptions or app console errors.
  Chrome emitted font-preload warnings and optional Coinbase metrics requests
  could be aborted; neither affected gameplay.

## Source and deployment audit

- **Brand cleanup: PASS.** No `SQSH`, Scaffold-ETH, SE2, or BuidlGuidl branding
  remains in current source/docs/assets. Title, manifest, favicon/mark, README,
  replay prefix, and visible UI use BASE JAM.
- **Metadata: PASS.** Source uses `metadataBase`; rendered root and share
  `og:image`/Twitter image URLs are absolute production URLs. Both dynamic image
  endpoints returned valid PNG content.
- **RPC architecture: PASS.** Base block/RPC calls live in server modules and use
  the server-only `BASE_RPC_HTTP_URLS` transport list; no RPC credential is
  exposed through a `NEXT_PUBLIC_*` variable. Production and Preview use CDP
  Node as the primary Base provider with the official endpoint as failover.
- **Run integrity: PASS.** Production refused malformed payloads, issued signed
  run tickets, replayed canonical inputs server-side, used timing-safe HMAC
  verification, and returned a signed share token only after verification.
- **Contracts/tokens/approvals: NOT APPLICABLE by design.** The repository has no
  Solidity/contracts directory, contract writes, token launch, approvals,
  paymaster, funds flow, or address input. `BJAM` is the BASE JAM brand acronym;
  it does not represent an app-issued token symbol or asset. Contract
  verification, contract address display, approval sequencing, token USD values,
  and wallet transaction deep-link checks are therefore not applicable rather
  than failures.
- **Wallet checklist applicability:** wallet connection is optional identity UI,
  not a prerequisite for play. No wrong-network/approve/action transaction state
  machine exists because the game has no onchain write.
- **CI/deployment integrity: PASS.** GitHub CI completed successfully for the
  reviewed SHA. Vercel inspect reported the supplied deployment ID as
  `production` and `Ready`.

## Evidence inventory

1. [Desktop landing, real Base](screenshots/01-desktop-landing-real-base.png)
2. [Desktop initial board](screenshots/02-desktop-game-board.png)
3. [Desktop valid nonzero placement](screenshots/03-desktop-valid-placement.png)
4. [Desktop verified result](screenshots/04-desktop-verified-result.png)
5. [Desktop signed share challenge](screenshots/05-desktop-share-challenge.png)
6. [Mobile landing](screenshots/06-mobile-landing-real-base.png)
7. [Mobile valid touch placement](screenshots/07-mobile-game-valid-placement.png)
8. [Small mobile game](screenshots/08-small-mobile-game.png)
9. [Intercepted RPC error](screenshots/09-intercepted-rpc-recovery-error.png)
10. [Intercepted practice CTA returned home](screenshots/10-intercepted-practice-button-no-start.png)
11. [Real future-block practice fallback](screenshots/11-real-future-block-practice-fallback.png)
12. [Invalid share recovery](screenshots/12-invalid-share-token-recovery.png)
13. [Root Open Graph image](screenshots/13-root-opengraph-image.png)
