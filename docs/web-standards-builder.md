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
editable program. 3,273 have interactive recipes (301 HTML, 1,059 CSS, 890
JavaScript and 1,023 Web API entries); the rest are
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

## ECMAScript built-in receivers

All 638 indexed built-in entries now have worked recipes. This does not include
all language productions or internal specification clauses. The receiver and
prototype fixtures author 158 complete programs, including 136 previously
missing examples. They cover DataView byte windows and endianness, iterator
helpers and consumption, weak collection identity, weak references and registry
unregistration, Function receivers, Promise callbacks, errors, symbols and
global conversion functions. Each uses ordinary reusable language nodes.

Prototype examples inspect actual descriptors and extend a fresh local receiver
with an editable inherited label. Native intrinsic prototypes remain unchanged.
Async/generator examples invoke structured functions of the corresponding family;
constructor properties are inspected without invoking source-string constructors.
Weak-reference examples retain their targets and never promise garbage collection
or callback timing. SharedArrayBuffer remains unavailable in the isolated browser
context and reports that explicitly; newer methods likewise require native support.

The catalogue retains edition-specific ECMA-262/402 2026 source links. The
[ECMA-262 publication page](https://ecma-international.org/publications-and-standards/standards/ecma-262/)
identifies the published 17th edition; living TC39 draft changes are not silently
substituted for that edition. `api.actions-run` 1.16.0 advertises the additive
catalogue recipe contract. No compiler operation, runtime grant or storage model
was added for these examples.

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

## ECMAScript intrinsic receivers

`javascriptTypedArrayFixtures.ts` adds 40 examples for the actual shared
TypedArray intrinsic. Editable constructor choices cover all twelve numeric
and BigInt typed arrays. Native operations expose byte windows, signedness,
clamping, exact decimal-string BigInts, callback order and thisArg, mutation,
and shared versus copied backing buffers. Unsupported constructors or methods
report their actual absence; invalid bounds retain native exceptions.

`javascriptIteratorFixtures.ts` adds 27 examples for real iterator/generator
state, helper cleanup, collection and Unicode iteration, segment containment,
and well-known symbols. Hidden AsyncFromSync and ForIn iterators are exercised
through actual language constructs, with that observation boundary stated in
notes. Missing-throw cleanup is compared against
[ECMA-262 2026](https://tc39.es/ecma262/2026/multipage/control-abstraction-objects.html#sec-%asyncfromsynciteratorprototype%.throw).
An older engine can disagree: the output preserves its actual protocol trace
and reports `matchesPublishedBehavior: false`, rather than emulating compliance.

These 67 programs use existing data-language nodes and the same saved Component
path. They introduce no compiler operation, runtime permission or source-code
escape. The catalogue contract is `api.actions-run` 1.17.0 in both manifests and
client negotiation. JavaScript coverage is now 638 built-in, 77 language and 89
specification entries; 208 language and 850 specification entries still lack
worked recipes. This does not imply exhaustive standards coverage.

## Native constructor signatures

`javascriptConstructorFixtures.ts` adds 66 complete programs for the published
constructor signatures, including global constructor properties and their
specific algorithm clauses. These entries retain their distinct source links;
they do not represent 66 distinct APIs. Native invocation uses the existing
Reflect call/construct operations, with an editable new toggle. TypedArray and
NativeError are explicitly identified as specification family placeholders and
select actual native constructors. Iterator runs an actual data-defined subclass
or demonstrates its native abstract-construction rejection.

Examples expose primitive wrappers and truthiness, sparse array holes, typed
array copying and buffer sharing, zero initialization, DataView windows, Date
invalid states, error cause descriptors, collection identity, Promise executor
and job order, Proxy invariants, and RegExp identity/lastIndex. Allocation inputs
are capped at 4096 elements or bytes in the authored program. These demonstration
limits are distinct from the native standard's allocation limits. Native errors
remain visible; SharedArrayBuffer requires a context that exposes it. Weak
references and finalization examples retain their targets and make no garbage
collection or cleanup-timing promise.

The same catalogue/save/Component contracts carry all program nodes and edited
defaults. `api.actions-run` 1.18.0 is negotiated on both manifests and the client.
There are no compiler or runtime permission changes. JavaScript coverage is now
638 built-in, 77 language and 155 specification entries; 208 language and 784
specification entries remain without worked recipes. Tests distinguish source
entry coverage, native unavailability, and actual behavior.


## Native binding and assignment patterns

Array and object destructuring are reusable program nodes, supported by the
same compiler as ordinary expressions. The catalogue adds 20 examples for
binding and assignment semantics, per-iteration environments and six native
function forms. The existing Parameter Lists example now includes an object
parameter and a destructured rest array. Coverage is 2,945 of 18,798 entries;
JavaScript has 638 built-in, 97 language and 155 specification examples.

A pattern leaf is an identifier string. `array-pattern` has `items`, where null
means an elision, and an optional final `rest` target. `object-pattern` has
`entries` containing a key, target and optional `computed: true`, plus an
optional final `rest` target. `default-pattern` has a target and initializer
expression; it is valid on an element, never on a rest target. Nested patterns
retain native iterator, property, default and binding behavior.

Declarations and assignments use `pattern` instead of `name`. Function, arrow,
generator and class parameters use `{ pattern, default? }` or a final
`{ pattern, rest: true }`. A try statement can use `errorPattern` instead of
`error`. For-in, for-of and for-await-of accept a pattern and optional
`declaration`: const (default), let, var or assign. Assignment expressions
accept array/object pattern targets only with plain equals; their leaf targets
can be ordinary variable/property/private/super references. Binding patterns
require identifiers. Object rest requires a simple target; array rest can bind
a nested pattern. Existing programs remain compatible.

The bounded compiler emits native syntax with no source-string escape.
Identifiers, keys, rest placement and binding/assignment contexts are validated
under the existing size, depth and node budgets. Default evaluation is lazy and
undefined-only, trailing elisions consume iterator values, rest retains symbol
keys, and abrupt/partial assignments keep native cleanup and partial writes.

Object-rest examples report actual getter reads against the standard's expected
single read. Node 22 can read an excluded getter again; the native trace is
preserved and the mismatch is reported, never rewritten. Tests compare with an
independent native oracle. Numbered-loop demos require safe integer bounds and
at most 16 iterations; optional input copying is capped at 4096 values. These
are explicit demo constraints, not changes to JavaScript semantics.

`api.actions-run` 1.19.0 negotiates the additive catalogue and pattern grammar.
The runtime artifact hash changes with the compiler; CSP and opaque-worker
permissions remain unchanged. `bindingPatterns.test.ts` covers native semantics
and malformed data; `javascriptBindings.test.ts` covers recipes and saved edited
defaults. Hosted runtime and real saved-Component acceptance must use the new
runtime artifact, not an older cached compiler.


## Web IDL options and callbacks

`webIdlFixtures.ts` and `webIdlStreamFixtures.ts` author 132 complete programs
for dictionary, field, enum, typedef and callback entries. Dictionaries are
passed to real APIs; they are not callable globals. Every example is editable
saved Component data using the existing language compiler and isolated worker.
The additive catalogue contract is `api.actions-run` 1.21.0. No runtime
permission, source-string execution or additional endpoint is introduced.

Programs cover event initialization and callback objects; once, capture,
passive and signal listener behavior; Blob/File properties; Request/Response
metadata and body construction; HeadersInit; decoder BOM/fatal/stream behavior;
and point, rectangle and matrix dictionaries. Native values, validation errors
and engine differences are retained. Request priority, private-token and
address-space effects remain context-dependent: constructing a Request does
not demonstrate network effects or send a request.

Stream programs expose native size callbacks and desiredSize, pipe error/close/
abort propagation, BYOB reader selection, read minimum and buffer transfer,
source auto-allocation, and source/sink/transformer callback lifecycles.
Callbacks are ordinary saved function nodes. Reads and writes run concurrently
where backpressure requires it. Source/sink type and transformer reserved-type
constraints are observable errors; absent native transformer cancellation is
reported as unsupported. All resources belong only to the throwaway run.

Demo limits are explicit: at most 32 queued/written/transformed chunks and
4,096 supplied/allocated bytes. Numeric strings cannot bypass automatic byte
allocation limits, and byte-array inputs cannot silently become allocation
lengths. Geometry is verified in the real browser; missing Node geometry
interfaces are not counted as positive execution evidence.

Run `webIdlFixtures.test.ts` on Node 22 and the current runtime, the full platform
suite, the actual local API install/save round-trip test, and the browser
checklist. The native browser remains authoritative for File timestamp,
passive-listener and geometry behavior.

Observed Web IDL engine differences remain visible: the browser worker can ignore
non-null RequestInit.window, and invalid UnderlyingSource.type can throw
RangeError where Node throws TypeError. Transformer.cancel reports unsupported
when the engine omits its callback. Node File.lastModified can retain fractions
where the browser converts to an integer. These outcomes are not simulated.


### Active-document events and native on-handler properties

107 additional examples use ordinary saved DOM bindings: pointer and keyboard
interaction, editing/selection, forms, dialog cancellation/closure, popovers,
scrolling, drag/drop, local resource load/error, custom commands, CSS animation
and transition lifecycles. HTML `on…` examples bind native IDL properties through
`binding: "handler"`; inline JavaScript attributes remain rejected.

Event bindings accept `options: { capture, once, passive }` for listeners, and
`returnFalse` for IDL handlers. Both modes accept `preventDefault`,
`stopPropagation`, and `stopImmediatePropagation`. Each flag is a boolean or
`{ op: "input", name: "parameterName" }` resolving to an own boolean input;
strings and implicit truthiness are rejected. Rebinding the same native `on…`
property replaces its previous handler. Optional labels identify callbacks in
the trace. These fields survive Component edits, saving and reopening.

The trace keeps the most recent 20 observations, including dispatch-time phase,
target/currentTarget, native event-specific scalar details, and cancellation
observed in a later task after dispatch (including an IDL handler returning
false). Text fields are capped at 256 characters. It does not traverse arbitrary
event objects or read dropped files/clipboard data. A shared 200-operation budget
unbinds program listeners when exhausted; partial setup failures and missing
native handlers also clean up. Expected browser feature absence is reported as
unsupported. The opaque sandbox, no-eval policy, local resource restrictions and
form-navigation cancellation remain in force.

Use real pointer/keyboard interaction for input, drag, wheel and editing events;
method controls do not fabricate trusted events. Non-bubbling events omit the
ancestor bubble callback. Passive listeners cannot cancel a default action.
The element `onerror` example does not claim the distinct Window error callback
convention. Window lifecycle, media playback and permission-dependent events
remain outside this batch. Browser availability is separate from having an
editable recipe, and the full standards catalogue remains incomplete.


## Native media programs

The catalogue now contains 95 data-authored media programs (89 newly interactive
entries and six improved HTML attribute examples). `mediaFixtures.ts` supplies
HTML audio/video/source examples, IDL media handlers, HTMLMediaElement and
HTMLVideoElement properties/constants, and playback, load, seek, codec and
quality methods. The reference is the [HTML media standard](https://html.spec.whatwg.org/multipage/media.html#media-elements).

The one-second PCM tone and four-second purple/teal H.264 clip are original
fixture bytes copied into each saved program. Runtime code has no catalogue IDs
or special demo components. `document`, `styles`, `parameters` and `dom` remain
ordinary editable Component data served through the existing catalogue Action.
Media source URLs are restricted to bounded local data payloads on audio, video
and source elements. No network or device permission is added.

A DOM binding can name one registered `property`. Omitting `value` reads it;
providing a scalar or `{op: 'input', name: 'volume'}` writes a registered native
setter. Own input references retain numeric/boolean types, including zero and
false. Wrong types, readonly setters and unregistered properties are refused.
Native range errors are reported. TimeRanges and MediaError use bounded native
projections; unavailable members report unsupported. Setters do not expose src,
remote devices, DRM, window, or arbitrary object properties.

Controls set current `muted` and `volume` explicitly: setting the muted content
attribute on a dynamically created element only establishes its default.
`play()` reports pending, fulfilled or the actual rejected promise. An older
promise cannot overwrite a newer command or a stopped run, and later media
notifications retain the latest command outcome. Recent event receipts include
current time, readiness, playback and error state. Terminal cleanup pauses media;
programs retain the eight-media/200-operation/20-receipt limits.

Playback speed, volume, mute, seek position and the selected writable property
are editable inputs preserved by Save edited component, private storage, reopen
and reload. Permission-sensitive playback, remote devices, MediaStreams, DRM,
text tracks and video-frame callbacks remain separately unfinished coverage.
The additive API contract is `api.actions-run` 1.22.0 on both manifests and the
client requirement map. Runtime CSP remains isolated and denies external media.
