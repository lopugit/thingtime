# Native multi-file import acceptance — c41befc0 package

The normal anonymous Import Things dialog imported 20 independent JSON transfers entirely offline on the immutable packaged Linux app recorded below. This package predates the later copy, linked-media and URL-draft changes. Every file deliberately reused the same portable root ID; IndexedDB contained 20 fresh local IDs with exact Unicode after a cold offline reload. The test observed zero page errors, network writes, or account records.

- Build snapshot: `c41befc0600c979d80f4912e1cdb01cb22218c834531d80088922e9d7f1d319e` (`build.json`).
- Native fixture: `remix/app/local-workspace/transferBatch.browser.test.ts`; one test passed, no skips, 46.93 seconds (`browser.log`).
- Dialog checked at 1440, 390 and 320 CSS pixels; the 320 px screenshot was visually inspected.
- `isolation-verification.json` records the hardened Linux runtime proof. The fixture independently checked network refusal before switching the browser offline.

The earlier final-build attempt timed out on the original 25-second dialog wait while progressing (11 of 20 completed). Its failure evidence remains in `../capacity-final-first-attempt/`. The successful retry changed the fixture wait to a bounded 90 seconds, without changing the immutable app. This does not establish real browser quota exhaustion, unlimited transfer capacity, CI, deployed acceptance, or installed macOS app behavior.
