# Main integration and foundation checkpoint — 11 November 2026

Merge fetched `main` **eab8158055d8f9f9dabe22eafeac7f051a5ab901** into the
existing PR #1000 feature branch, preserving separate unfinished local work.
Incoming PR #1463 provides shared Archive/Restore and lazy menu loading; #1471
provides sync publication/scan receipt recovery. Conflicting Things/search
capability variants are reconciled to **1.64.0 / 1.8.0**, with clients refusing
older ambiguous variants. No primary merge or deployment is included.

## Verification

[Machine-readable checks](verification.json) distinguish source, local fixtures,
previous-head CI and production discovery. TypeScript and ratchet: zero errors;
full lint: zero errors / 370 warnings; web and node-server builds pass.
204 capability, 170 focused integration and 47 native sync tests pass, plus 26
compiled manifest contracts. Initial stale version assertions were corrected;
the initial failures remain in local logs rather than being called green runs.

[Fresh no-login browser receipt](browser/verification.json): actual bundled
Thingtime renderer, clean account-free context, exact text and canonical JSON,
complete two-Thing dependency closure, desktop 1440×1000, phone 390×844, narrow
320px and card-only crop; invalid-input and reload checks pass. Browser/server
cleanup is verified. [JSON](browser/thingtime-draft.json),
[desktop](browser/viewport-1440x1000.png), [phone](browser/viewport-390x844.png),
[320px](browser/viewport-320x844.png), [card](browser/card.png).
The shared renderer sources match the earlier checkpoint, but the rebuilt runner
hash changed; these are fresh captures, not a claim based solely on parity.

[Progress-plan receipt](plan/verification.json) covers all filters, search,
navigation, full scrolling and layout at1440/390/320px. The tracker retains
historical evidence and marks remaining coverage separately.

## Restore regression found during integration

The first full browser run reproduced a restored child missing from its original
folder even though the canonical API read confirmed Restore. The account facade
returned a cached empty page, then discarded the fresh background membership.
List callbacks now reconcile the page through the existing identity, cancellation
and per-folder sequence fences. Cached paint remains usable; no membership is
invented. A controlled regression reproduced the failure before the fix and the
focused account API/sync suite passes41/41. The unchanged full real API/Chrome rerun passes at1440px and375px, including
return to the original folder after Restore. Builder apps, public post/comment
menus, private message metadata, refusal/retry and delayed-response cases pass.
[Browser acceptance log](archive/acceptance.log).

## Remaining delivery

- P0: activate a matching hosted renderer through the canonical Thingtime
  integration and prove actual downloadable JSON/PNG artifacts in this chat.
  Current production discovery still advertises MCP2.2.0 and this host exposes
  no render/export tool. Private provider/local SDK evidence is a separate layer.
- P0: complete the new merge's CI and preview acceptance. Previous-head CodeQL
  failed because GitHub installation API rate limits were exceeded.
- P1: finish desktop automatic activation without losing edits or interrupting
  local jobs; production signing trust/publication and actual update recovery.
  The separate local activation work has85 focused passes but is not integrated
  into this merge or accepted in the installed app.
- P1: integrate the separate genuine iOS Sharp/libvips and Nitro-import proof,
  then start the actual API, implement transactional on-device storage and
  verify WKWebView/offline/update behavior on simulator and physical device.
- P1: remaining local vault icon/receipt and verification-preference paths,
  Character workspaces and full offline/reconnect/identity coverage. Scoped
  local acceptance does not certify all Thingtime capabilities offline.

Posting independent of draft completion is already in main through PR #999;
renderer foundations came through PR #998. This checkpoint preserves both.
