# PR #901 — Add reusable Web API member demos and receiver fixtures

## Behavior

Web API members previously rendered availability probes rather than worked
examples: an entry could confirm that `Headers.prototype.append` exists without
ever showing what appending does. `remix/app/webPlatform/webApiFixtures.ts`
authors receiver fixtures for URLs, name/value collections, blobs and files,
request/response metadata and bodies, text encoding, DOM exceptions and
geometry. `webApiRecipe` consults those fixtures first and keeps only the two
legacy `Event`/`AbortController` examples plus the existing generated fallback.

A fixture declares one `create` receiver expression, optional `setup` steps, an
interface `summary`, per-member `properties` and per-member `operations`.
`fromFixture` selects a single member by `Feature.kind`/`Feature.member`, so the
same fixture serves the interface entry, its attributes, its constants and each
of its operations without duplicating programs.

Three properties of that construction matter:

- Mutating methods return the receiver's observed state. `Headers.append` and
  `FormData.set` run the mutation and then project `Array.from(receiver.entries())`,
  so the demo shows the effect rather than an opaque return value.
- Opaque native results are projected into meaningful values. `Blob.bytes` and
  `Blob.arrayBuffer` surface byte arrays, `Blob.stream` is read through a
  `Response`, bodies are decoded to text/JSON/entries, and geometry results are
  projected with `toJSON()`.
- Static operations do not construct an unrelated receiver first. `f.static` and
  `kind === 'const'` skip the `declare('receiver', …)` step, so `URL.canParse`
  can honestly return `false` and `URL.parse` can return `null` for invalid
  input instead of throwing while building a receiver nobody asked for.

Saved programs keep only the parameters they actually reference: `fromFixture`
walks the compiled step tree, collects `input` names, and filters the combined
fixture/operation parameter list against that set. This keeps definitions inside
the compiler's 16-parameter budget and stops unrelated editable fields from
appearing on a member demo.

Availability remains independently checked. Each recipe emits `requires` paths
(`['Headers']`, `['Headers','prototype','append']`, plus any extra globals an
operation needs) that the generic worker tests with `in` and own-property
descriptors, never by invoking an accessor. Members a browser or an isolated
context does not implement still report `unsupported` before execution, and
Window-only matrix string parsing stays `requires-context`.

No feature-specific dispatch is added to the runtime. The worker still receives
only the saved declarative program; it neither imports this catalogue nor
branches on a feature ID, and the data compiler gains no new escape.

The inventory remains 18,798 entries. Coverage is now 2,134 interactive
recipes: HTML 227, CSS 1,059, JavaScript 576 and Web APIs 272. The rest remain
explicitly `inspection` or `requires-context`. This increment does not complete
the broader all-standards goal.

## Validation

Author-reported, as recorded on the PR:

- Chrome 153 actual built opaque iframe/worker audit: all 272 Web API recipes
  passed, with zero unsupported results, program failures or frame-load failures.
- Targeted lint, local production build, and Vercel artifact/CSP verification.
- Local page checks for invalid URL parsing, edited collections, UTF-8 capacity,
  geometry inputs and mobile width; an authenticated API run covering private
  geometry save/read/update, anonymous denial and exact-fixture cleanup; and five
  hosted preview runs.
- Four type errors that initial CI exposed in the new helper are fixed without
  raising the typecheck baseline.

Reviewer validation re-run on head `81ed5ed3` (Lopu, Node 22 against the real
`compilePlatformWorker` output):

- `app/webPlatform/*.test.ts`: 13 tests, 12 passed, 1 opt-in API-install check
  skipped. The two new tests assert observed results — collection mutation
  ordering, `getSetCookie`, `Blob.slice` bytes, body JSON/form decoding,
  `encodeInto` read/written capacity truncation, invalid `URL.canParse`/`URL.parse`
  and invalid-JSON body failure — not merely successful compilation.
- Whole-family static audit over all 268 fixture-generated recipes: every program
  compiles through the real worker compiler; no program references an `input`
  name absent from its parameters; no parameter is left unused; no duplicate
  parameter names; every `requires` path is a valid bounded identifier path; and
  `featureRecipe` agrees byte-for-byte with `workerApiRecipe`. Largest program is
  1,405 bytes against the 24 KB program cap. Zero problems.
- Whole-family execution audit: every interactive Web API recipe was executed in
  the generic worker source with its default inputs. 145 completed successfully
  under Node's global set; the remaining 127 correctly reported `unsupported`
  with their exact missing paths, which is the availability mechanism working —
  Node has no `DOMMatrix`, `DOMRect`, `DOMPoint`, `Event` or `AbortController`.
  Zero runtime errors and zero thrown exceptions.
- Spot-checked results are semantically right, not just `ok: true`. Examples:
  `Headers.append` shows `x-theme: "purple, gold"` after appending to an existing
  header; `FormData.delete` removes both `color` entries; `Blob.bytes` returns the
  UTF-8 encoding of `Hello 🌈 Thingtime`; `Response.clone` returns both clone
  metadata and the consumed body; `DOMException` reports `code: 11` for
  `InvalidStateError`.
- The documented coverage counts were recomputed from the catalogue and match
  `docs/web-standards-builder.md` exactly (227 / 1,059 / 576 / 272 = 2,134).

## Delivery and remaining work

Branch: `origin/codex/web-standards-worker-api`.
PR: https://github.com/lopugit/thingtime/pull/901.

At review time the PR's build/typecheck/unit, API suite and advisory checks
passed on head `81ed5ed3`; both CodeQL analyses were still in progress, and the
trusted CodeQL snapshot for this head carried no open alerts. Results are scoped
to that head, not to later documentation or graph commits.

Graphify is refreshed structurally. Document semantic coverage is not asserted,
because the local proxy health request timed out during the author's run.
Snapshot identity must match the final source fingerprint before merge.

Remaining broader work includes DOM and browser-context adapters,
permission-dependent APIs, event and streaming interfaces beyond the projected
reads used here, deeper CSS/HTML demos, and saving edited workbench drafts as
reusable definitions.
