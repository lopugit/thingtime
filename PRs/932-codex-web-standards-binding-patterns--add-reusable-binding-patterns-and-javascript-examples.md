# PR #932 — Reusable binding patterns and JavaScript examples

Saved Thingtime programs now support array, object and default pattern nodes.
The catalogue gains 20 interactive JavaScript language entries and upgrades
Parameter Lists, bringing coverage to 2,945 of 18,798 entries: 227 HTML, 1,059 CSS,
890 JavaScript and 769 Web API. JavaScript has 638 built-in, 97 language and 155
specification examples. This is incremental progress toward full coverage.

## Implementation

The shared bounded compiler emits native patterns for declarations, assignment
statements/expressions, function and rest parameters, catch clauses and
for-in/of/await-of loops. Patterns preserve undefined-only initializers,
computed-key order, property rest, symbols, iterator closing, lexical defaults,
assignment identity and partial writes. Loop declarations support const, let,
var and assignment targets. Saved Components retain full structured programs;
no source strings, feature-ID dispatch or additional runtime permissions are
introduced. The actions-run catalogue contract advances to 1.19.0.

Examples exercise object/array bindings, native assignment member targets,
property and iterator algorithms, per-iteration environments and six function
forms. Recipe limits are explicit; non-progressing numeric loops are rejected
using safe integer bounds. Older native engines can read an excluded getter
twice during object rest: the example preserves that behavior and reports the
mismatch against the published algorithm instead of normalizing the result.

## Validation — 2026-09-27

- Fourteen compiler/recipe tests passed on Node 22.23.2 and current Node;
  coverage includes nested defaults/rest, null, elisions, assignment identity,
  getter order, symbols, iterator cleanup, catch/class parameter patterns,
  closure capture, asynchronous iteration, malformed patterns and budgets.
- Full platform suite: 92 passed, one opt-in API skip. Capability suite: 83 passed.
  Changed-source lint passed; typecheck ratchet remains at its existing 89 errors.
- The opt-in actual API test passed separately: idempotent seven-Thing suite
  installation, complete binding programs and edited defaults round-trip,
  private ownership, anonymous 404 and saved Action execution.
- Local browser audit: 134 cases, 132 passed, two SharedArrayBuffer entries
  correctly unsupported in the isolated context, no failures. Includes all
  20 new defaults, Parameter Lists and 66 constructor regression entries.
- Local Builder: edited the nested array/default pattern, saved a Component,
  reopened, reloaded and ran it with edited inputs retained. Owner API readback
  matched; anonymous access returned 404. All eight exact local fixtures were
  removed from the verified disposable database afterward.
- Full production build and Vercel output verifier passed. The isolated runtime
  artifact SHA-256 is fd4f12f656faeccddfde118c135cf81926e52690212bed9989dcae28a4a30fbd.
  Local legacy and discovery capability endpoints report actions-run 1.19.0;
  runtime CSP retains the opaque sandbox without eval, same-origin or form egress.

Graph freshness and hosted preview/production acceptance are recorded in the
final PR receipt against exact commits. Structural graph freshness does not
establish semantic extraction success. These focused checks do not claim full
standards conformance.
