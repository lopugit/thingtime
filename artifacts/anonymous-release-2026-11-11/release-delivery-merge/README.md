# Main integration and native delivery checkpoint — 11 November 2026

This checkpoint combines fetched main `b3374a16d23994dd3c1c355d75d3fe730321a284`
with the feature branch and its preserved native update work. It does not merge
PR #1000 into main, activate production or replace the stable Thingtime app.

## Current capabilities

- No-login editable transfer input, actual Thingtime rendering and portable
  canonical JSON pass fresh clean-browser acceptance. The final runner is
  `c3063417eadbefdcf8b5ad0981e378c67a1fa47c7377b634a5814014dcc484d4`.
  [Editable JSON](browser/thingtime-draft.json), [desktop PNG](browser/viewport-1440x1000.png),
  [phone PNG](browser/viewport-390x844.png), [320px PNG](browser/viewport-320x844.png),
  [card PNG](browser/card.png) and [browser receipt](browser/verification.json).
  Exact wording, two-Thing dependency closure, 24px phone margins, real
  Render/Download controls, invalid input, retained last-good preview and reload
  clearing pass. The context had zero cookies/API requests; owned browser/server
  cleanup passed. Prior normal-importer/Builder evidence retains its own revision.
- Native release catalogue/content APIs and the actual native downloader pass a
  synthetic signed publication integration over task-owned HTTP. Downloads use
  negotiated capabilities, exact ranges/hashes, cancellation, resumable staging,
  rate-limit backoff and cleanup. Streaming archive packaging reuses the canonical
  Thing transfer ZIP writer. Shipped production trust keys remain empty.
- The rebuilt isolated development app executes the real Nitro/React candidate,
  then recovers a deliberately broken signed server update in a fresh process.
  The origin and sequence floor survive, and cleanup is verified.
  [Native receipt](native-startup-final/verification.json),
  [confirmed screenshot](native-startup-final/confirmed-update.png),
  [recovery screenshot](native-startup-final/recovered-update.png).
  Signing is synthetic. This does not prove deployed download/update delivery.
- iOS ran Node 24 and genuine bcrypt in a disposable simulator; importing the
  canonical Nitro payload stopped at missing sharp/libvips. The API did not start,
  local transactional storage was not tested and the final reusable probe has
  not itself been rerun end to end. [iOS evidence](../ios-native-runtime/README.md).

## Verification

[Checks and source hashes](checks.json) retain exact commands and log digests.
Raw TypeScript, zero-error ratchet, full lint (0 errors / 371 warnings), canonical
Vercel/native builds, native inventory and 25 built manifest/docs contracts pass.
The Electron test directory passes 497 checks with five explicit skips; the
separate focused [native/API/renderer batches](tests/verification.json) pass
71 and 255 checks. The combined workspace aggregate passes 956 checks with
113 explicit opt-in skips using `--test-concurrency=1`; all five offline-shell
checks pass. The prior concurrent timeout is not reproduced here and its cause
remains unconfirmed. Counts overlap across focused batches and must not be added
as a claim of unique coverage.

The merge combines individually editable password/Component controls with local
storage and identity fences. Both older independent `api.things` 1.62 variants
are refused by clients needing the combined 1.63 contract. Queued Component
argument bindings now negotiate before remote writes. The final nine password browser cases pass: account editor, anonymous device
vault and account-scoped device vault at 1440px, 390px and 320px. They verify
nested edits/save/reload, actual encrypted file bytes, identity/Lock boundaries
and missing-file refusal. The narrow icon input fix preserves custom CSS.
[Password receipt](passwords/verification.json). The progress plan passes full-page
scrolling, counts, filters/search and navigation at all three widths.
[Plan receipt](plan/verification.json).

## Remaining delivery

1. Activate a matching hosted renderer and verify actual downloadable artifacts,
   refusals and cleanup through the canonical connected Thingtime tool. Production
   discovery still advertises MCP 2.2.0, without render/export or native release
   capabilities, and this chat has no render/export tool.
2. Verify resulting-head CI/preview. Earlier previews and tests do not prove this
   new head is deployed. Keep the prior concurrent-suite timeout as a test follow-up.
3. Provision real native release trust/publication and test deployed delivery.
   Background staging and next-normal-start activation work; automatic reload that
   preserves unsaved edits, full cold-offline/reconnect and external frozen-process
   recovery remain unfinished.
4. Complete the remaining device-vault surfaces: icon upload/receipt mapping and
   fully local global verification preferences. Synthetic local browser testing
   observed inherited account-preference requests; core encrypted entries/files
   remain separate from those settings. The no-login draft renderer has its own
   independently verified zero-API-traffic evidence.
5. Finish iOS native image processing, in-process transactional persistence,
   bundled Nitro/WKWebView startup and simulator/device/offline/update acceptance.

The retained development app is `/Users/lopu/Applications/Thingtime Dev native-bundle-qa-pr1000.app`.
Its isolated resources are under `/Users/lopu/Library/Application Support/Thingtime Dev/native-bundle-qa-pr1000/`.
Task-owned test servers and browser processes are closed after acceptance; no
persistent development/Funnel URL is supplied by this batch.
