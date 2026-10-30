# PR #938 — Add reusable native SVG programs

2026-09-27. Branch `codex/web-standards-svg`, base `main`.
The user explicitly requested ongoing main merges and production @lopu delivery.

## Behavior and boundaries

311 editable SVG programs replace unfinished contexts, bringing coverage to
3,729/18,798: HTML 302, CSS 1,059, JavaScript 890, Web APIs 1,478. Shapes, paints,
text measurements, units, transforms and typed lists use native owned receivers.
Complete document/input/operation data persists through existing private Component
and authored Action contracts. There is no catalogue-specific native source.

The renderer adds a closed SVG namespace. Limits include 128 nodes, 512px viewport
edges, 32 list entries and bounded text/numeric inputs. Initial attributes,
compact signed point lists, newline language lists, live attributes and nested
native viewport writes retain allocation limits. References remain local;
foreign content, executable elements, external resources and surface escapes are
refused. No account/network/device permission or CSP expansion is introduced.
The DOM transport exposes registered primitive IDL constants without constructors
or accessor calls. Native legacy SVG geometry objects are handled explicitly.

Bbox dictionaries can be silently ignored by an engine. These examples compare
actual native fill/stroke/marker/clip measurements on fixed authored geometry and
report unsupported fields. Editable inputs cannot invalidate the support probe.
Readonly animated values preserve native exceptions; conversion assertions allow
native float precision. Rotation viewBoxes include the drawing at tested angles.
Both capability manifests and client negotiation advance to actions-run 1.24.0.
Published SVG 2 Candidate Recommendation and inventory editor-draft status remain
separate; this does not claim full standards or browser implementation coverage.

## Validation

- 123 platform tests pass; one opt-in integration skip. 83 capability tests pass.
  Targeted lint clean; typecheck returns the existing 89-error baseline. Full
  build and Vercel output verifier pass.
- 375 native browser checks: 369 pass, six explicit unsupported entries, zero
  failures. The unavailable entries are the bbox dictionary/four fields and
  SVG_MARKER_ORIENT_AUTO_START_REVERSE. Includes 25 SVG boundary fixtures and
  existing Canvas plus DOM/form regressions.
- All 311 edited programs round-trip through the canonical API; modified bbox
  programs checked again after probes were added. The two reference programs
  were also checked after adding inherited paint; their extra fixture was removed. Suite install creates seven
  records then zero on retry. Authored save-draft works and anonymous reads 404.
- SVGTransform.setRotate edited to colour #0ea5e9, width 150, angle 35, saved,
  reopened and fully reloaded. Native angle remains 35 and matrix begins
  a=0.8191520442889918, b=0.573576436351046. Saved defaults verified by owner API;
  anonymous 404 verified. Ten exact disposable suite/UI/API records cleaned up.
  One temporary API cleanup got 503 during a dev rebuild; that exact remaining
  fixture was included in the final successful cleanup, without repeating writes.
- Desktop screenshot and 390px layout reviewed (page scrollWidth 390, frame 350).
  Rotated geometry now fits its viewBox. Completed drawings persist; Stop removes
  the frame and rerunning produces a fresh native result.

Structural graph refreshed, with every new source verified in graph/manifest.
Semantic extraction was attempted through the local Codex proxy: all six chunks
failed with 502 codex_execution_failed (31 uncached files). No semantic freshness
is claimed. Exact hosted deployment acceptance receipts are recorded in the PR
body after verification. The full coverage goal remains active.
