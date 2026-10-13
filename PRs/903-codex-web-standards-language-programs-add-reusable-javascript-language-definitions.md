# PR #903 — Add reusable JavaScript language definitions

## Behavior and scope

The Web standards catalogue gains 28 complete editable language programs,
replacing three simpler examples and adding 25 interactive entries. Coverage is
2,279 interactive entries in the unchanged 18,798-entry inventory: HTML 227,
CSS 1,059, JavaScript 601 and Web APIs 392.

`javascriptDefinitions.ts` authors ordinary/async/generator function definitions,
default/rest parameters, classes with private/static fields and static blocks,
accessors, inheritance, `this`, `super`, `new.target`, and template literals/tags.
`javascriptControl.ts` authors assignment/update/delete/sequence, block scope,
labels, switch fall-through, do/for/for-in/for-of/for-await-of examples.

The generic data compiler gains the corresponding reusable nodes. It preserves
its data-only authoring and combined node/depth budgets, and executes only in
the existing terminable opaque-origin worker. Saved Components retain full
program definitions, including callbacks and members. No catalogue-ID runtime
dispatch, raw source escape, account bridge or permission grant is added.

The examples explicitly distinguish coverage from grammar completeness:
parameter destructuring, modules/imports and import.meta remain unfinished.
Template segments are cooked strings whose source escapes are generated; a tag
receives real cooked/raw arrays and uncoerced substitutions. Browser syntax
errors remain errors when authored nodes are placed in invalid language contexts.

## Runtime repairs

Production interface probes for `Element.prototype.classList` and
`Document.prototype.URL` reproduced Illegal invocation by reading prototype
getters without receivers. `interfaceProbe.ts` now traverses bounded property
descriptors, reports final accessor presence without execution, and reports an
unresolved receiver requirement for intermediate accessors. Missing properties
and present undefined values remain distinct. Unit tests prove getter side
effects do not run; a real opaque-frame Chrome check passes both original
failures and the Array.prototype.map control.

Production runtime.js was served with a four-hour max-age while the no-store
HTML referenced its fixed URL. The platform build now emits HTML whose script
URL includes the exact compiler SHA-256. Both HTML and JavaScript use no-store
on Vercel; Vite serves the same built HTML. Old clients therefore request new
code without trusting an already-cached fixed URL. The build verifier checks
the byte digest, asset existence, header order and unchanged opaque CSP. A
configuration regression executes the actual route patcher against temporary
output and checks both headers before filesystem routing.

Template encoding now explicitly escapes backslashes before template delimiters.
The CodeQL incomplete-escaping finding prompted 96 adversarial plain/tagged
worker checks across backslash parity, source-looking substitutions, control
characters, Unicode separators and lone surrogates. All preserve literal text
without execution; the rebuilt runtime passes digest/CSP/cache verification.

Repository review also tightened malformed switch-case validation and rejects
rest parameters in class setters before generating source. Both cases have
focused rejection tests and manual checklist entries.

## Validation and remaining acceptance

- All 18,798 catalogue programs compile and pass Component write validation.
- Web Platform tests at the source checkpoint: 26 pass, one opt-in API skip;
  two additional fixture tests pass all 28 JSON-round-tripped programs and
  changed-input expectations. The skip is not API acceptance.
- Compiler semantic tests cover private brands/accessors, static state,
  inheritance, function construction, generator yield/delegation, loops,
  assignment/update/delete, labels and template escaping/raw values. Malformed
  input and combined expression/statement depth are rejected.
- All 13 Vercel configuration tests pass. Targeted ES2019 module types pass.
- Runtime-only build passes and emitted HTML references its actual JavaScript
  digest. Real Chrome 153 reproductions now pass both prototype-accessor probes
  without invoking them. The all-JavaScript audit passes 590 programs and marks
  11 unsupported, with zero program/frame-load failures.
- Initial remote CI was green but its log exposed two new test-only TypeScript
  diagnostics (91 versus baseline 89). Explicit property-presence assertions
  narrow the probe result variants; targeted types and probe tests then pass.
  The final CI count is reviewed independently before merge.
- Full build/artifact verification, full typecheck count, all-JavaScript browser
  audit, local actual-page controls and saved Component API acceptance are
  reviewed before merge and recorded on the PR. The existing main TypeScript
  baseline is 89 errors; a warning-only exit zero is not a clean check.

Final source and documents are staged before the Graphify refresh. Its source
fingerprint, atomic graph/manifest pair and presence of new modules/documents
are verified before the final push. Semantic-proxy availability is checked
separately; structural output is not claimed as semantic document indexing.

## Delivery

Branch: `origin/codex/web-standards-language-programs`.
PR: https://github.com/lopugit/thingtime/pull/903.
Exact-head CI, preview provenance, final validation and production receipts are
recorded on the PR. The existing private @lopu page remains
https://thingtime.com/p/web-standards, Thing
`a5e106e6-b880-4b97-b42b-ab2bea541122`.

Before this increment, PR #902 shipped as main merge
`60b3aa39fd47dd03947046ab48f57ff9e6ad3ad7`, verified in the account page footer
and production provider status. The page displayed 2,254 interactive entries;
five event/stream programs passed against the public production opaque runner.
The authenticated Chrome automation tab held its hidden demo iframe response
open, so that in-page Run attempt is not counted as a pass.

Full DOM/document, permission/device/media and network implementations, remaining
language constructs, deeper HTML/CSS recipes and direct workbench draft saving
remain work toward the overall full-platform goal.
