# Integrated native multi-file import acceptance

The normal anonymous Import Things dialog imported 20 independent JSON transfers offline on immutable package `2f0710ac20e67675e56271dd5607a7a32c2e038853e40ebd62dbf40c9e310e59`. This package includes the reviewed copy, linked-media and URL-draft changes. All 20 files deliberately reused one portable root ID; the cold offline reload retained 20 fresh local IDs and exact Unicode.

One test passed with zero failures or skips in 67.30 seconds (`browser.log`). The test observed no page errors, network writes or account records. The dialog fits 1440, 390 and 320 CSS pixels; the 320 px screenshot was visually inspected. The import control and dialog contents are reachable within that viewport.

`build.json` identifies the immutable package, `isolation-verification.json` records enforced Linux isolation, and `source-comparison.json` pins the surrounding source/build comparison. The fixture independently checked direct IPv4/mapped IPv6 and browser egress refusal before going offline. Its exact source is copied here; SHA-256: `d874222c88de406fb23a50bb0c2cb49c18bf8ab6917e2e9965265e30c565f3fd`.

This proves the ordinary 20-file selection path on the recorded Linux package. It does not establish real browser quota exhaustion, unlimited single-transfer/clipboard capacity, CI, deployed acceptance or installed macOS behavior. Earlier c41befc0 results and their initial timing failure remain in separate directories. No failure occurred in this integrated run.
