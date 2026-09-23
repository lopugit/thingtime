# PR #902 — Add reusable event and stream lifecycle demos

## Behavior and scope

Event and stream catalogue entries previously had availability probes or small
constructor examples. This change supplies 124 complete editable programs,
replacing four earlier recipes and adding 120 interactive entries. Coverage is
2,254 interactive entries in the unchanged 18,798-entry inventory: HTML 227,
CSS 1,059, JavaScript 576 and Web APIs 392.

`eventFixtures.ts` implements Event/CustomEvent/EventTarget delivery, cancellation,
listener removal/once/subscription, legacy event properties and abort signal
reasons/composition/timeouts. Delivery snapshots distinguish event state before,
during and after dispatch. `stopPropagation` retains other listeners on the same
target; `stopImmediatePropagation` stops them. Standalone EventTarget examples
do not claim DOM ancestor capture or bubbling.

`streamFixtures.ts` and `controllerFixtures.ts` implement readable, writable and
transform streams, readers/writers, controllers, BYOB requests, queue strategies,
encoding across chunk boundaries and compression. They obtain real controllers
from stream callbacks, show observed queue/delivery/closure/error state and
release reader/writer locks. Transform readers and writers run concurrently to
respect backpressure. BYOB examples fill a real request view and observe its
invalidation after responding. Missing browser implementations such as
ReadableStream.from remain unsupported; malformed input remains an error.

The shared expression constructors in `programBuilders.ts` author ordinary
versioned program data. Every saved Component retains its complete callbacks,
steps and used parameters. Existing bounded compiler, opaque iframe, worker
deadlines and CSP execute the programs without a catalogue-ID dispatcher, new
account bridge, permission or remote request.

This is incremental coverage. DOM/document contexts, permission/device/media
and network lifecycles, remaining language constructs, deeper HTML/CSS examples
and persistent saving of workbench drafts remain work toward the full goal.

## Validation and limits

- All 18,798 catalogue definitions compiled and passed Component write
  validation. The Web Platform suite passed 21 tests with the separate opt-in
  API test skipped; after adding exact parameter/program-roundtrip coverage,
  all 12 worker-source tests passed. The skip is not API acceptance.
- Changed-input worker assertions cover cancelability, listener identity and
  lifetime, abort selection/reasons/timeouts, queues/locks/cancellation,
  concurrent transforms, BYOB capacity, split UTF-8, invalid UTF-8, compression
  and controller failure/termination. All 124 authored programs preserve exactly
  their used parameters and compile after a JSON round trip.
- Real local API acceptance passed on the existing disposable account and
  replica set: reinstall preserved all six suite IDs; a private
  ReadableStreamBYOBRequest.respondWithNewView Component retained its program
  through save/read/update; anonymous read returned 404. The exact created
  fixture was deleted through the API. No production definitions were replaced.
- Actual local Builder page checks passed changed checkbox inputs, once-only
  delivery, abort selection, writer chunks, BYOB capacity and compression.
  Desktop and 390px screenshots were inspected with no horizontal overflow.
  This used the existing generic built client and current local recipe API;
  the runtime and surface source are unchanged in this PR.
- Targeted lint and ES2019 helper/module type checks passed. The full production
  build, CSP/artifact verification, exact-source Chrome audit and full typecheck
  count are reviewed before merge and recorded on the PR. The current main
  baseline is 89 TypeScript errors; warning-only CI exit zero is not a clean
  typecheck and the baseline is not raised by this change.

The final Graphify refresh follows staged source and documentation changes.
Its graph/manifest pair, source fingerprint and new source/document presence
are verified. The local semantic proxy health request timed out, so structural
output is retained without asserting document semantic indexing.

## Delivery

Branch: `origin/codex/web-standards-events-streams`.
PR: https://github.com/lopugit/thingtime/pull/902.
Final-head checks, preview provenance and production receipt are recorded there.

The existing private @lopu page is https://thingtime.com/p/web-standards,
Thing `a5e106e6-b880-4b97-b42b-ab2bea541122`. Before this batch, PR #901 was
verified on main merge `ccfbf7d581d4e4d151cca1ae73becbc0ce511ce2`, Vercel
deployment https://vercel.com/lopugits-projects/thingtime/9k2fxMhHxoVY2AN4P4fFSqmxkUwr.
Its production public runner returned true/false for valid/invalid URL.canParse
inputs. The authenticated Chrome automation tab held a hidden iframe response
open; that particular in-page Run is not counted as a pass. Fresh browser
contexts against the public production runner and the local actual page passed.
