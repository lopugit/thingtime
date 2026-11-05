# Account file Duplicate acceptance

Native fixture: `remix/app/local-workspace/accountFileCopy.browser.test.ts`.
Final immutable isolated Linux package:
`15e93be01ba2478f19fbdd20201bb18d72ab6c87f794e5a7c4800854b4ab85a7`.
No installed macOS app acceptance or shared Fork UI acceptance is claimed.

`acceptance.log` records one passing native scenario, zero skips, in 60.04 seconds.
`final/verification.json` identifies run `43278cb8-6333-486d-9f86-f364eab1f88e`.
The normal Things **Duplicate** action created independent private folder,
content and file identities while offline. Native ZIP exports preserved the
18,504 original Unicode bytes, unchanged source and separate copy through cold
reload. The copied ordinary content and uploaded file synchronized while the
source upload returned 503 with a 120-second retry delay. The normal **Retry
upload** control resumed the source independently. Both file metadata queues
finished; real server reads verified each file's correct folder, exact original
bytes and guest refusal. Canonical annotation and bulk **move** requests succeeded;
no server copy/import/fork fallback was used.

Offline acceptance starts only after transport disconnection,
`navigator.onLine === false` and a failed real root-data fetch. All transitions
and requests are retained in the report. There were zero requests starting
while fully offline, zero successful non-service-worker API responses while
offline and zero page errors. The three native screenshots were visually
reviewed: desktop and 390px use separate cards, 320px stacks them; labels and
menus remain visible, the floating controls do not cover the cards, and document
width equals viewport width at 1440/390/320px. `visual-review.json` records this
inspection. `build.json`, `isolation-verification.json` and `sha256.json` bind the
saved proof to its package and files.

Two failed attempts on earlier package `2f0710ac` remain under `earlier-attempts/` with matching
failure JSON, screenshot, runner log, build manifest and isolation proof:

- `transition-unclassified/`: run `e6d83f0f-efcd-48a4-8b4f-bb147c345571`
  stopped after offline Duplicate/export/reload and viewport checks because one
  algorithm-sync POST was classified offline. The fixture set its flag before
  transport and browser connectivity changed, so this evidence cannot establish
  whether that request began before or after disconnection. No product diagnosis
  is claimed from this attempt.
- `copied-file-placement/`: run `d56d5bf0-555d-4ed6-8d99-ec172900e8fa`
  used timestamped connectivity phases and a barrier requiring transport
  disconnection, `navigator.onLine === false` and a failed real root-data fetch.
  It recorded zero requests starting after that barrier and zero successful
  non-service-worker API responses while offline. Duplicate retained exact bytes,
  independent IDs and unchanged source through cold reload, with 1440/390/320px
  captures. The copied ordinary content and private file upload completed while
  the source upload deliberately returned 503. The copied attachment's real
  server read remained `folderId: null` after the bounded placement wait; the
  fixture failed rather than treating upload completion as placement completion.

The placement failure led to the reviewed same-file MIME receipt repair documented
in `../file-mime-repair/README.md`; final acceptance above uses that repair.
The generated admin bootstrap credentials are excluded from these artifacts.
