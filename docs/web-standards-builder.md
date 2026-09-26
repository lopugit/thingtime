# Web standards Builder app

The `web-standards` suite installs three editable Component Things, three Action
Things and one private Webpage Thing through the ordinary suite API. Navigation,
search, filters, pagination, the workbench and save controls are component render
trees. The page contains no native app block. `/p/web-standards` resolves the
viewer's owned page; `/builder?page=<entryPageId>` opens its definition.

`app/webPlatform/catalogue.ts` supplies the pure `webstandards.browse` and
`webstandards.component` Action expressions. Saving uses an owned browser Action
and the canonical Things endpoint, preserving its ownership, ACL, schema,
quota, expected-actor and capability checks. Saved examples contain their full
program; they do not depend on an opaque example identifier.

## Inventory and coverage

The checked-in snapshot indexes WHATWG HTML, ECMA-262 2026, ECMA-402 2026 and
W3C Webref's CSS and WebIDL extracts. The manifest records package versions,
source hashes, URLs and the Webref commit. Web APIs are separate from the
ECMAScript language. Published Working Drafts, editor drafts and internal
specification clauses retain explicit labels. They are not all completed
standards or callable APIs.

The initial snapshot has 18,798 entries. Each has a source reference and an
editable program. 2,656 have interactive recipes (227 HTML, 1,059 CSS, 601
JavaScript and 769 Web API entries); the rest are
`inspection` or `requires-context`. These categories are unfinished demo
coverage, not proof of full platform coverage. Browser availability is checked
at runtime, independently of standards status. Some generated method examples
need different arguments or a browser implementation. Secure-origin, device,
network, navigation, media and worker-only contexts still need dedicated
capability-backed implementations. Inventory extraction and recipe execution
are separately tested; schema-valid programs do not prove their behavior.

## Generic runtime

The `tt-web-platform` component primitive takes a `program` object, version 1:

- `parameters`: bounded named inputs with defaults.
- `document`: an editable tree of tags, attributes and text.
- `styles`: selectors/declarations or stylesheet rules.
- `steps`: declarative expression/statement nodes compiled into ECMAScript.
- `dom`: bounded event/method bindings inside the isolated document. Omit
  `method` to observe a native event; `{op: "element", selector: "#send"}`
  arguments refer only to elements in the rendered program.
- `allowFormEvents`: explicit opt-in for native form validation/submit events.
  This never enables submission navigation or account access.
- `probe`: element, attribute, CSS, selector or interface inspection.
- `requires`: bounded global/member paths checked in the worker before running
  steps. Missing paths return `status: "unsupported"` and the missing names.
  Support detection does not invoke accessor properties. Document interface
  probes also inspect descriptors: a final accessor reports presence without
  calling it, and an intermediate accessor reports an unresolved receiver
  requirement rather than guessing availability. Standards publication
  and browser/context availability remain separate.

The primitive has no catalogue ID dispatch. Users can copy a saved Component,
edit its `render` program in Thingtime's Fields/Source editor and place it on any
Builder page. The live program editor runs an unsaved draft; **Save edited component** saves
the current program and inputs as a private reusable Component. Inputs and running workers clear across account
and component boundaries.

The runtime document has an opaque origin in an `allow-scripts` iframe.
Programs with `allowFormEvents: true` additionally enable `allow-forms` for native
validation and submit events. The response-header sandbox permits these events
but grants no same-origin, popup or account authority, even when opened directly.
`form-action 'none'` forbids submission navigation; an early capture listener
also cancels real submit events before any authored operation runs. Network and
credential storage remain unavailable. Executable
HTML attributes and embedded documents are rejected. JavaScript comes from a
bounded data compiler, with no raw-source escape or eval, and runs in a worker
terminated after two seconds of execution. Worker startup is separately bounded
at ten seconds, so process startup cannot consume the execution allowance.
Regexps execute there; native input patterns are
excluded because main-thread validation cannot be terminated. DOM methods have
an explicit allowlist and event budget. CSS/document changes remain local to the
frame. This runtime intentionally cannot demonstrate APIs needing permissions
it has not been granted.

`$ui` query controls may declare `form: true` to gather the explicitly named
`params` from their nearest fieldset inside the component. Form constraints are
checked; excluded password/file fields preserve defaults; empty text clears a
value. The existing same-page query encoder still rejects reserved parameters.
Shared HTML template fields adopt late defaults only while their current value
still matches the previous default. Reloaded search/select filters therefore
stay aligned with results, while delayed reads preserve visitor edits.

## HTML form receivers

The form recipes use typed native setters, text-selection operations, validation
state and live option/radio collections through the same generic DOM bridge.
Boolean false and fractional numbers remain typed. Overridden members resolve
from the most specific native interface; both select removal overloads work.
Collection length writes are bounded before allocation, and collection mutations
retain their originating node even when its subtree is detached.

The 212 authored form examples include inputs, textareas, selects/options,
buttons, forms, fieldsets, labels/legends, datalists, output, meter/progress,
ValidityState and form/option/radio collections. Native selection offsets and
control values are returned explicitly because HTML serialization omits dirty
control state. Missing browser members report unsupported. Constructors,
active pickers, direct submission and pattern validation still need
separate contexts. In Chromium, native form reset returns without changing
controls when the document has no frame; it is excluded from this detached
policy rather than counted as an interactive implementation.

## Live form events

`liveFormFixtures.ts` adds nine active-document recipes: reset, requestSubmit,
SubmitEvent/submitter, form check/reportValidity and badInput/tooLong/tooShort.
Seven were previously missing contexts; two form validation examples now also
allow visitor editing. Reset restores input, textarea, checkbox and select
defaults. Submission validates a required control and exposes the actual
submitter, including a referenced button passed to requestSubmit. The three
user-editing-only validity examples use real typing before reading native flags.

`liveDOM.ts` backs ordinary program bindings with bounded event observations,
prototype method lookup and scalar native node/validity projections. Named form
controls cannot replace reset, requestSubmit or listener registration. Up to ten
receipts are retained per run, with each string limited to 256 characters and
the existing 200-event budget. Immediate calls run after every listener is
registered; immediate failures remain errors. Programs and context selection
survive canonical Component save/read unchanged. `api.actions-run` 1.15.0
advertises the additive recipe and binding contract.

## Build and validation

`build:platform` builds the static runner. `build:client` includes it, and the
PM2 dev entry point builds/watches it. Vite and Vercel both apply the isolated
CSP; `verify:vercel-output` requires the runtime and its policy. Both runtime
assets use `Cache-Control: no-store`. The built document references the exact
SHA-256 of its JavaScript as a query version, so clients with a previously cached
fixed URL request the new compiler immediately. The artifact verifier checks
the digest, headers and routing order. Vite serves the same built document.

Run `pnpm --dir remix run test:web-platform`. For actual API ownership/install
checks, use a disposable local database and set `TT_STANDARDS_TEST_URL` plus
`TT_STANDARDS_TEST_DATABASE_HOST`; the test verifies the database host before
creating a temporary account, and removes only the fixture Things it created.
The browser checklist is in `TESTING.md`.

After a full build, the browser acceptance script also accepts
`TT_STANDARDS_TEST_BUILT_CLIENT=1`. It intercepts only public client build files
from `.vercel/output/static`; API calls still use the explicit managed local
stack and disposable database. This exercises the built client without starting
another app server or waiting for Vite's development module graph. The runtime
fixture applies the canonical isolated CSP; deployment headers are independently
checked by the build verifier and hosted preview checks.

`audit:web-platform` executes every interactive JavaScript recipe in the actual
served opaque iframe and worker. It uses a fresh Chrome context and an empty
host page, needs no account, creates no Things, and records passed, unsupported,
failed and frame-load-failed outcomes separately. It retries a frame-load failure
once; it never retries a program error. Set `TT_STANDARDS_AUDIT_LANGUAGES` to a
comma-separated language selection, `TT_STANDARDS_AUDIT_IDS` to limit entries,
and `TT_STANDARDS_AUDIT_OUTPUT` to retain its JSON report. An explicit HTTPS
preview URL is also supported; no browser credentials are loaded. See README
for setup.

JavaScript receivers, callbacks and arguments live in `javascriptFixtures.ts`
and `javascriptRecipes.ts` as editable program data. `javascriptSyntax.ts` adds
worked operators/control-flow examples; `javascriptSymbols.ts` supplies computed
symbol members and suitable receivers. The compiler supports optional property
access and `let`/`const`/`var` declarations as reusable data operations. Exact
clause matching keeps abstract algorithms from inheriting an unrelated example.
The generic worker has no
feature-specific dispatch. Its regression tests execute the same worker source
used by the browser, including asynchronous results and missing-feature paths.

`webApiFixtures.ts` authors worker-compatible API receivers and member recipes:
URLs, name/value collections, blobs/files, request/response metadata and bodies,
text encoding, DOM exceptions and geometry. Methods that mutate a receiver
return its observed state; opaque native results are projected into meaningful
values (bytes, entries, body text or geometry coordinates). Static operations
do not first construct an unrelated receiver: invalid `URL.canParse` input can
return false and `URL.parse` can return null. Inputs are limited to parameters
actually referenced by the saved program. Browser support remains independently
checked, and Window-only matrix string parsing stays context-dependent.

`eventFixtures.ts` supplies event delivery, listener removal/once/subscription,
legacy event properties, and abort reason/composition/timeout examples.
`streamFixtures.ts` and `controllerFixtures.ts` supply readable/writable/transform
streams, reader/writer locks, queue strategies, cancellation/errors, BYOB
requests, encoding and compression. They share data-node builders in
`programBuilders.ts`; no catalogue routing or new permission is added to the
runtime. Transform streams consume their readable side concurrently with writes
to respect backpressure. Controller examples obtain actual native controllers
from stream callbacks and return queue/delivery observations, never opaque
controller objects. Unsupported members such as `ReadableStream.from` in some
browsers remain explicitly reported. Event propagation uses a standalone target;
ancestor capture/bubbling still needs a document-context example.

For runtime-only browser checks after a full build, set
`TT_STANDARDS_AUDIT_BUILT=1`. The audit serves only the two built runtime assets
on an ephemeral loopback port with the canonical isolated CSP, then closes that
fixture. This does not start an app server or validate app/API navigation.

## Reusable language definitions

`javascriptDefinitions.ts` and `javascriptControl.ts` author 28 language
examples, adding 25 interactive entries and replacing three simpler recipes.
They exercise functions, default/rest parameters, classes with private and static
fields, accessors and static blocks, inheritance, `this`, `super`, `new.target`,
sync/async generators, template literals/tags, assignment/update/delete/sequence,
block scope, labels, switch fall-through, and synchronous/asynchronous loops.

These are complete editable program nodes. The generic compiler supports
`function-expression` / `function-declaration`, arrow `function` bodies, `class`
expressions/declarations and members, `yield`, `private-get` / `private-in`,
`assign-expression`, `update`, `delete`, `sequence`, `group`, `template-literal`,
`tagged-template`, `block`, `empty`, `label`, `switch`, `for`, `do-while`,
`for-in` and `for-await-of`. Existing `for-of`, `while`, conditionals and exception
handling compose with these nodes. Parameter descriptors accept a name with a
default expression or a final rest parameter. All expression/statement nesting
shares the compiler's depth and node budgets; execution still runs in a bounded
throwaway worker. Invalid JavaScript contexts remain browser syntax errors.

Template segments are cooked strings; the compiler encodes their source escapes
and the tag receives the resulting real cooked/raw arrays and uncoerced values.
The parameter example covers default/rest rather than destructuring. The meta
property example covers `new.target`; modules/imports and `import.meta` still
need dedicated authoring support. Interactive category counts do not imply that
every grammar alternative inside a clause has been demonstrated.

## Saving edited programs

The workbench's **Save edited component** control runs the authored `save-draft`
Action. It saves the complete current program and current parameter values as
its defaults through the ordinary Things API. The reusable `tt-web-platform`
primitive exposes that validated draft through an optional named JSON form field;
it contains no save API call. Run and Save consume the same snapshot. Invalid
JSON, invalid definitions or invalid inputs prevent saving an older draft.

A saved `props.program` is opaque program data: nested arrays, nulls, `{tokens}`,
and objects resembling Component wrappers retain their exact meaning. Only a
top-level `ttArg` selects a complete program from scope. Program copying shares
the Component resolver's work and text budgets and refuses a truncated program.
The original `save-component` Action remains available to older installed pages.

Existing installations can add the new Action with `onlyMissing: true`. Updating
the owned workbench requires an explicit version-checked definition edit; the
installer does not overwrite an owner's customized Components.

## Detached DOM receivers

`domFixtures.ts` authors 158 examples for document trees, elements, text,
comments, attributes, node collections, class tokens and the applicable DOM
mixins. These programs exercise native methods and getters from the
[DOM Living Standard](https://dom.spec.whatwg.org/), checked 26 September 2026
against the standard last updated 24 September. Constructor entries are not
counted when a fixture creates an instance through a Document factory instead.
Layout, window, custom-element and shadow-root contexts remain separate gaps.

A `steps` expression `{op: "dom", action, target, key, args}` returns a Promise.
Use the ordinary `await` expression to compose it with JavaScript:

- `action: "document"` needs no target/key/args and obtains the run's detached
  HTML Document, seeded from the authored `document` tree.
- `get` reads a registered native member from a `target` handle.
- `set` writes a registered native property with one argument.
- `call` invokes a registered native method with bounded argument values.

`programBuilders.ts` has data constructors for these operations. Handles keep
identity within a run; they cannot be stored and replayed into another run.
Real DOM exceptions can be caught with ordinary program `try`/`catch`; missing
registered browser members report `unsupported`. Native undefined results remain
undefined in the worker and use the normal `[undefined]` output representation.

`domBridge.ts` invokes captured native prototype methods/accessors against a
private detached document, then projects its body into the visible surface.
The preview is a projection: browsing-context state, layout and interactions in
that projection are not state in the detached document. Existing `dom` event
bindings belong to the visible document and are a separate context. Programs
that need coordinated live events require a live-document implementation.
There is no page/account document handle or arbitrary member traversal.

Each run allows 256 requests, 32 pending worker requests, 800 handles, 600
allocated nodes (including detached clones), depth 40, 500-character selectors,
4,096-character text arguments and 65,536 characters of cumulative argument
work. Native calls accept at most eight arguments. Tree/result text is bounded
at 32,768 characters. Requests share the worker's two-second execution deadline;
cancellation and completion clear handles. Script/resource elements, event
attributes, URL writes, raw markup setters and unregistered members are refused.
The existing iframe CSP and account/network restrictions remain in force.
Internal tree inspection and projection use captured native accessors/methods:
form controls named `childNodes`, `attributes` or `getRootNode` cannot shadow
the policy checks. A cloned Document cannot become a second receiver document.
`domBoundaryFixtures.ts` provides reusable program data for real-browser
allocation, depth, named-control and document-ownership regressions.

`domProtocol.test.ts` and `workerLifecycle.test.ts` cover transport identity,
catchable exceptions, unavailable members, undefined values, late replies and
cancellation/deadline behavior. The opt-in real API test now round-trips a DOM
program through the catalogue Action and private Component update/read paths.
The browser checklist covers actual tree mutation and refusal behavior.
