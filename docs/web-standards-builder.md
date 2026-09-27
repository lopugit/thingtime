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
editable program. 4,914 have interactive recipes (302 HTML, 1,196 CSS, 890
JavaScript and 2,526 Web API entries); the rest are
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
excluded because main-thread validation cannot be terminated. Synchronous native
callbacks use the bounded data interpreter described below; they do not execute
compiled source on the frame thread. DOM methods have
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

## Native Canvas programs

145 new editable Canvas programs bring interactive coverage to 3,418/18,798:
HTML 302, CSS 1,059, JavaScript 890 and Web APIs 1,167. They cover native 2D
state, compositing, transforms, paths, text and metrics, gradients, patterns,
image smoothing, local bitmap copies, pixels, context dictionaries and relevant
enums. The reference is the [HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html),
checked 27 September 2026 against its 25 September publication.

Programs use the existing DOM worker bridge with `action: "surface"` to obtain
the rendered program root. `document` and `surface` contexts are mutually
exclusive within one run. Surface tree reads are bounded to owned nodes;
connected nodes outside that root and the runtime Document are refused.
Only registered Canvas and SVG state/methods may mutate surface receivers. General tree
mutations continue to use detached `document` programs. This distinction matters:
fonts on a detached Document did not honor writes in the tested browser. Canvas
recipes therefore use the actual rendered surface and native pixel/text output.

`action: "construct"` accepts only Path2D and ImageData, using the same run-local
handle codec, request numbering and native error transport. Gradients, patterns,
text metrics and matrices are native receiver handles. Pixel arrays are bounded
value projections. Saved programs contain their complete document tree, typed
inputs and operations; no catalogue IDs or source-code escape exists in native
runtime backing. A hidden authored tile canvas supplies local bitmap examples.

Limits: four canvases, each edge at most 512 pixels; pixel windows at most 32 per
edge and 4,096 numeric pixel values; 32 dash entries and four corner radii;
4,096 path units per path and 16,384 cumulative path work (including addPath and
copies); font setters use absolute pixel sizes up to 128; filters reject URLs
and bound blur. Existing 256-request, handle, input-work and worker deadlines
remain. Native range/type exceptions stay observable. Engine-added output keys
are projected separately from strict input dictionaries. Unsupported text
metric getters are reported rather than simulated.

Drawings remain visible after a completed worker is released; removing the
opaque iframe releases its resources. Canvas dimensions retain native bitmap
and state reset behavior. The API contract is actions-run 1.23.0 in both
manifests and the client requirement map. Capture, asynchronous blob callbacks,
OffscreenCanvas, focus-ring contexts, WebGL and WebGPU remain unfinished work.

## Native SVG programs

311 additional reusable programs cover SVG shapes, text measurements, gradients,
patterns, clipping, masks, markers, transforms, native units and typed lists.
They bring interactive coverage to 3,729/18,798. Each complete program contains
its editable document, inputs and native operations in ordinary Component data.
The source inventory retains its editor-draft labels; the published
[SVG 2 Candidate Recommendation](https://www.w3.org/TR/SVG2/) is dated 4 October
2018, not represented as a completed Recommendation.

The renderer accepts `namespace: "svg"`, an `svg` root and inherited SVG children.
It uses a closed namespace-aware tag/attribute policy. SVG receivers use the
existing owned surface context, captured prototype methods, handle codec and
native exception transport. Both legacy SVGPoint/SVGRect/SVGMatrix objects and
the corresponding Geometry interfaces are recognized where browsers return them.
`action: "constant"` reads registered primitive IDL data descriptors without
exposing constructors or invoking getters. These are generic framework operations,
not catalogue-specific source dispatch.

Limits are 128 SVG nodes, 512px viewport edges, 32 list entries, 4,096 attribute
characters and bounded numeric/unit inputs. Initial and live attribute writes
and nested viewport length setters enforce their limits before native work.
References stay local fragments; executable elements, external resources,
foreignObject, use and animation contexts remain unimplemented. Filter contexts
are described below. Surface
ownership and tree-mutation restrictions remain in force; CSP is unchanged.

Bounding-box option programs compare native fill/stroke/marker/clip measurements
on fixed authored geometry. Accepting an options object alone does not establish
support: browsers that silently ignore an option report unsupported and expose
their observed measurements. Each field has its own Boolean control. Native
readonly animated values still throw their own errors. Unit conversion checks
allow float precision loss instead of manufacturing exact geometry results.

`svgBoundaryFixtures.ts` supplies native regression programs for namespaces,
measurements, unit conversion, readonly values, transforms, constants, ownership,
allocation and resource bounds. All recipes preserve edited programs through the
canonical catalogue, private Thing storage and authored save-draft Action. The
additive contract is `api.actions-run` 1.24.0 in both manifests and the client map.

## Reusable SVG filter programs

192 additional entries (186 Filter Effects DOM entries and six animated Boolean/
Integer entries) bring interactive coverage to 3,921/18,798. Blur, shadow, blend,
compositing, colour matrices, channel transfer, convolution, lighting, displacement,
morphology, offset, merge, tile, turbulence and local images are authored graphs.
Each program shows original/filtered geometry and reads actual native values.
Inputs, filter nodes and DOM steps remain editable Component data. Transfer
function examples select the mode that uses their demonstrated value.

The backing surface permits four filters and 32 filter nodes per run, explicit
user-space filter/primitive units, region coordinates up to 512, blur up to 16,
radius up to eight, four turbulence octaves, convolution order up to five and
32 list entries. These are program-input limits, not a guarantee of exact browser
GPU allocation. Relative/object-box filter units require a future bounded context.
Both authored values and nested native setters enforce limits before work; PNG
images must be embedded, at most 128px per edge and 24,000 URI characters, with
only basic non-animated PNG chunks. No network or CSP permission is added.

All 192 examples persist through the normal catalogue, Thing and authored Action
paths. The additive contract is actions-run 1.25.0. Missing native members remain
explicitly unsupported; tested Chromium lacks Gaussian edgeMode and its four
constants, plus feImage.crossOrigin. That does not turn them into fake results.
The [published Filter Effects Level 1](https://www.w3.org/TR/filter-effects-1/)
is a Working Draft dated 18 December 2018; the inventory retains its source status.
These examples do not imply complete Web API coverage or Recommendation status.

## Reusable CSS function comparisons

106 distinct functions have concrete editable declaration contexts, covering
180 catalogue entries across function and published-value records. This adds
137 interactive entries and upgrades 43 existing examples, for 4,058/18,798
interactive entries (CSS 1,196). Matching published aliases share the worked
context; paged-media `element()` does not reuse the image function. The 14,740
remaining entries retain their existing coverage labels.

Maths, colours, gradients/images, filters, transforms, shapes, grids, easing,
counters, environment variables, sibling counting, attributes and anchor
positioning are ordinary Component document/style/input data. Two rendered
samples compare the control with the edited declaration. Easing uses a paused
animation with editable delay, 3D transformations have perspective, generated
counters use real nested scopes, and anchors have a named layout receiver.
Image examples use authored gradients/DOM sources without network access.

The generic CSS probe accepts a scoped target, optional comparison target and a
closed set of pseudo-elements. It reports the substituted property/value,
`CSS.supports` result, computed values and explicitly labelled originating
Element rectangles. Accepted syntax is `syntax-accepted`, not proof that a
substitution, cascade or rendering effect succeeded. Computed counter content
may retain functional notation; pseudo-element geometry is not invented.
Probe fields are bounded before and after parameter substitution. The existing
opaque frame, CSP, program size and storage/Action boundaries are unchanged.
Both capability manifests and client negotiation use actions-run 1.26.0.

Examples follow the indexed definitions and preserve their source status.
[Values 4](https://www.w3.org/TR/css-values-4/),
[Values 5](https://www.w3.org/TR/css-values-5/),
[Color 5](https://www.w3.org/TR/css-color-5/),
[Images 4](https://www.w3.org/TR/css-images-4/),
[Transforms 2](https://www.w3.org/TR/css-transforms-2/),
[Shapes 1](https://www.w3.org/TR/css-shapes-1/) and
[Easing 2](https://www.w3.org/TR/css-easing-2/) are separate modules, with mixed
publication maturity and browser implementation. A worked, editable unsupported
example does not establish browser support or W3C Recommendation status.

## Native CSS Typed OM programs

The `CSS Typed OM Level 1` family has editable programs for all 249 indexed
entries: unit factories and conversion, numeric operations and dimensional
records, math values, transforms and matrices, keywords and custom-property
fallbacks, inline/computed/rule style maps, and the draft colour object APIs.
These are ordinary Component program data. Browser support is checked through
native operations; absent colour constructors remain explicitly unsupported.
The latest published specification is <https://www.w3.org/TR/css-typed-om-1/>;
individual catalogue entries retain their source and publication-status labels.

`dom` expressions add a `static` operation for registered CSS factories and
parsers. `construct`, `get`, `set` and `call` use the existing run-owned receiver
bridge. `typedCSSPolicy.ts` defines the native member and argument contracts;
`typedCSSFixtures.ts` composes saved editable programs, including their output
serialization. The runtime has no catalogue IDs or example-specific dispatch.
For example, a program can construct a CSSUnitValue, set its `value`, and pass
that same handle to an element's `attributeStyleMap.set` before reading the
native `computedStyleMap` result. Transform examples apply their authored values
to the displayed sample, and map examples show before/after values.

Handles remain scoped to one opaque frame run. CSS input text is limited to
2,048 characters, input lists to 32 entries, and numbers to finite magnitudes
of at most 32,768. Expression composition has per-value and per-run budgets to
reject repeated multiplication before native expansion. Existing request,
handle, input-work and result budgets remain in force. Native CSSNumericType
results use a fixed field projection. Constructed stylesheets expose bounded
style rules and rule maps. The CSSOM extension below adds grouped rules and
scoped shadow-root adoption. No runtime document, network access or CSP
permission is added. Computed maps retain their native read-only contract.

`api.actions-run` 1.27.0 advertises these additive operations in both manifests
and client negotiation. `typedCSSTestCases.ts` supplies a second input set for
all 249 programs; `typedCSSBoundaryFixtures.ts` covers native conversions,
map writes, read-only refusals, handle isolation and resource limits. Run these
in a rendered browser: unit compilation alone cannot prove native support or
that edited inputs change the observed result.


## Native CSS Object Model programs

All 102 indexed entries sourced from [CSSOM Level 1](https://drafts.csswg.org/cssom-1/)
have editable Component programs. They cover declarations, property values and
priorities, stylesheet construction and replacement, style/grouping/import/page/
margin/namespace rules, rule and sheet lists, media queries, scoped adopted
stylesheets, `CSS.escape` and `getComputedStyle`. The catalogue preserves the
specification's draft status; browser availability is reported separately.

`cssomFixtures.ts` contains the authored programs and their observation logic.
`cssomPolicy.ts` registers generic native contracts in the existing DOM bridge;
`cssomSupport.ts` checks arguments before dispatch. A detached Document can own
style elements and expose its native sheets. Open shadow roots may be attached
only to owned sample elements, and adopted sheets remain inside that run's
opaque frame. The runtime Document and Window object are never returned.
Only the registered Window.getComputedStyle operation uses the native window.
No new endpoint, storage model, network grant or CSP allowance is introduced.

CSS text is bounded to 4,096 characters, stylesheet trees to 32 rules and eight
levels, and adoption to eight owned sheets. Existing request, receiver and
input-work limits still apply. `replace` awaits its native Promise within the
same worker deadline; Stop discards late replies. Computed declarations retain
native read-only exceptions. CSSRule.cssText's specified no-op setter is shown
as unchanged, imported sheet access can report the native SecurityError, and
unimplemented page descriptors or ignored baseURL options report unsupported.

Both manifests and client negotiation advertise `api.actions-run` 1.28.0.
Every program has default and edited native checks, and 20 boundary fixtures
cover real CSS results, async replacement, ownership and resource limits.
Programs persist through the canonical private Component and save Action path.

## Native observer programs

The 81 indexed MutationObserver, ResizeObserver and IntersectionObserver entries
are ordinary editable Component programs. Their callbacks, record projections,
DOM mutations and observation options are stored as program objects. Builders
can change these objects, save a private Component, and reference it from another
page. No observer-specific component renderer or parallel persistence path is
introduced.

`observerFixtures.ts` authors the data; `observerPolicy.ts` and
`observerSupport.ts` register bounded native receivers in the existing bridge.
A `dom-callback` expression registers an authored worker function, preserving
native record and observer identity through run-owned handles. A `dom` operation
with `action: "batch"` executes up to 16 registered get/set/call commands in one
native task, so MutationObserver queue draining can happen before delivery.
Commands use the normal ownership and argument checks. Async operations and
nested batches are rejected before dispatch; an error stops subsequent commands
without rolling back earlier writes.

MutationObservers can use an owned detached document. Resize/intersection
observers require the active opaque preview surface. Roots and targets must
belong to the current run; the runtime document and parent page remain
unavailable. Each run allows 16 observers, 32 targets per observer, 32 registered
callbacks, 64 callback deliveries and 64 records per delivery. Observer options
use closed dictionaries with bounded thresholds, margins and filters.

Callbacks share the existing two-second program deadline. Completion, errors and
Stop disconnect every observer and discard late deliveries. These examples
capture observations during a run; they do not create persistent background
subscriptions. Native unsupported fields and the not-yet-exposed
IntersectionObserverEntry constructor report browser availability explicitly.

Both capability manifests and the client negotiate `api.actions-run` 1.30.0.
Default and edited programs, queue semantics, old values, callback identity,
unobserve/disconnect, ownership and resource limits have dedicated checks.
Primary sources are the [DOM Living Standard](https://dom.spec.whatwg.org/#interface-mutationobserver),
[Resize Observer](https://www.w3.org/TR/resize-observer/) and
[Intersection Observer](https://www.w3.org/TR/intersection-observer/).

## Native live and static ranges

Forty additional Range, AbstractRange, StaticRange and StaticRangeInit entries
now have editable Component programs in `rangeFixtures.ts`. Boundary choices,
text edits, cloning, extraction, wrapping, comparison and result projections
are ordinary saved program objects. Existing active-surface Range geometry
recipes remain unchanged. The separate Selection API is still requires-context.

`rangePolicy.ts` registers native members; `rangeSupport.ts` validates bounded
fragment input and the four-field StaticRangeInit dictionary. Ranges use
run-owned nodes and handles. Relative boundary setters check the parent before
dispatch, and every range read/operation checks its current endpoints. Native
constructors initially point at their realm document; initialize them with an
owned node before reading. Concrete native prototype chains provide boundary
accessors even when an engine inserts an unnamed WebIDL mixin layer.

Document mutations operate on the existing detached-document context and render
through its checked projection. Active-surface programs retain range reads and
boundary operations; tree mutations remain unavailable there. Contextual
fragments accept up to 4,096 characters and 128 basic HTML opening/closing tags,
without attributes, resources, scripts, comments, custom elements or foreign
content. Tokens are checked before native parsing. This is a bounded fragment
input vocabulary, not unrestricted HTML parsing. Native errors remain catchable.

Static range examples insert text after taking a snapshot and compare unchanged
static offsets with live boundaries adjusted by the browser. Both capability
manifests and the client negotiate `api.actions-run` 1.31.0. See the
[DOM ranges standard](https://dom.spec.whatwg.org/#ranges) and
[HTML contextual-fragment algorithm](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-range-createcontextualfragment).

## Native Web Animation programs

111 more catalogue entries contain editable native animation programs. Each saved
Component includes its keyframe arrays or property-indexed objects, timing JSON,
preview time, ID, native operations, asynchronous callbacks and result projection.
The same `tt-web-platform` runtime executes a newly authored program or a saved
Component reference; no animation-specific Component renderer is introduced.

`animationPolicy.ts` registers Animation, KeyframeEffect, DocumentTimeline and
AnimationPlaybackEvent constructors and receiver members. This includes native
KeyframeEffect copying, playback controls, effect/timeline changes, timing and
computed-keyframe records, ready/finished promises, finish/cancel/remove handlers,
and scoped Element/Document/ShadowRoot animation queries. The existing worker
callback transport carries the authored handler function and restores its native
animation receiver as `this` (including opaque handle identity). Registered promise
reads await the browser result and are refused in synchronous DOM batches.

The program selects its owned surface before construction; target and effect
receivers are checked against that surface. Native allocation is capped at 32
objects, keyframes at 64, properties per frame at 32, and total keyframe values at
512. Dictionary keys and scalar sizes are validated before native conversion.
The shared DOM input/handle budgets, two-second execution deadline and opaque
network-denying runtime CSP still apply. Stop and normal completion cancel every
tracked animation and fence late callbacks/promises. The recipe explicitly
commits sampled element styles before completion; pseudo-element samples report
computed styles because native commitStyles refuses those targets.

Unsupported native members stay explicit. Examples probe both exposed accessors
and actual behavior: a browser that ignores getAnimations' pseudoElement option
must report unsupported instead of appearing to filter successfully. The optional
iterationComposite field is checked before invoking constructors so ignored
options cannot masquerade as implemented behavior. Event.isTrusted is read from
its unforgeable own native accessor, preserving trusted browser events versus
constructed events. Group/Sequence effects, animation triggers, scroll/view
attachment ranges and remaining Level 2 additions are still separate work.

Both origin manifests and the client require `api.actions-run` 1.32.0. The
canonical catalogue/save Actions, private Component API and storage schema are
unchanged. Test `animationBoundaryFixtures.ts` in a native browser as well as the
unit/contract suites: it checks exact interpolation, independent copied timing,
trusted finish/cancel/remove events, shadow queries, native exceptions, foreign
receivers, allocation limits and asynchronous batch refusal.

Sources: [published Web Animations](https://www.w3.org/TR/web-animations-1/),
[current Level 1 draft](https://drafts.csswg.org/web-animations-1/), and
[Level 2 additions](https://drafts.csswg.org/web-animations-2/). Inventory source
status is retained; an editable example does not imply cross-browser support or
that a draft feature has reached Recommendation status.

## Native ARIA object programs

All 53 catalogued ARIAMixin entries have editable programs: nullable string
properties, role, the active-descendant element, and seven element-reference
lists. Each saved Component holds the document, role/value inputs, selectors,
content attributes, native assignments and result projections. It compares
property assignment with content-attribute reflection and can clear the property
with null. These examples demonstrate reflection; complete accessible widgets
also require appropriate semantics and keyboard interaction.

`ariaPolicy.ts` registers bounded native Element accessors. Strings accept null
or at most 4096 characters; lists accept null or at most 64 owned Element handles.
Every reference is checked before native assignment. Reference writes require
the active owned surface because detached DOM cloning would lose explicit
relationships in the visible projection. Surface attribute mutations are limited
to role/aria-* names. Existing ownership checks reject runtime/foreign nodes,
and the shared worker deadline, request/handle limits and sandbox CSP remain.

Native FrozenArray results retain their frozen state, cached array identity and
contained element identity across worker messages. Snapshots remain unchanged
when an attribute resets a relationship. Up to 128 distinct native frozen arrays
may be transported per run. Ordinary mutable array results remain mutable.
Unimplemented native properties produce explicit unsupported results, including
ariaOwnsElements in the validated browser. The published inventory's draft/status
metadata is retained; coverage does not imply universal browser support.

The catalogue Action contract and client minimum are `api.actions-run` 1.33.0.
Canonical installation, private Component persistence and reuse on another page
continue through the existing suite, Action, Component and Webpage contracts.
`ariaBoundaryFixtures.ts` checks null versus empty lists, string false versus
null, native relationship resets, cached/frozen object identity, shadow ancestry,
wrong/stale handles, allocation limits and refusal of unrelated surface writes.

The animation example now uses content-driven stage height with a minimum, so
both tiles remain visible when text wraps. Existing saved definitions are not
silently rewritten.

Sources: [ARIA IDL interfaces](https://w3c.github.io/aria/#idl-interface) and
[HTML attribute reflection](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes).

## Native XPath object programs

Thirty XPath catalogue entries now produce editable saved programs for
`XPathEvaluator`, `XPathEvaluatorBase`, `XPathExpression`, `XPathResult` and
`XPathNSResolver`. The authored tree, expression, context selector, namespace
map, native result type, iteration/snapshot projection and mutation are ordinary
Component program data. `Document.evaluate` and a constructed evaluator share
the same policy; compiled expressions can be evaluated repeatedly with an
optional owned result argument. The bridge preserves actual native return values,
errors, node identity, snapshot retention and iterator invalidation.

Queries require the owned detached document. Even scalar queries are refused
in surface mode: checking returned Nodes alone cannot prevent a scalar query
from reading ancestors outside the program. Native Node namespace resolvers
retain identity (`createNSResolver(node)` returns that node). Alternatively,
a saved map of at most 16 prefixes to URI strings supplies a bounded synchronous
callback interface. Ordinary worker callbacks remain asynchronous and are not
accepted as synchronous resolvers. Nullable Node namespace lookup inputs are
preserved. Live native handles are run-local; the complete program that creates
and composes them is what persists in the database.

Main-thread XPath cannot be interrupted by the worker deadline. Before calling
the native parser/evaluator, the runtime bounds expressions to 512 characters
and 64 tokens, parentheses to depth 8, and refuses nested predicates and path
traversal inside predicates. Evaluation counts the whole owned document plus
any disconnected context tree, at most 128 nodes/attributes and 1,024 text and
attribute characters. A conservative syntax/tree/text work estimate caps each
evaluation at 16 million units and a run at 64 million; compiled expressions
spend that same budget every time. These are implementation limits, not XPath
standard limits. Existing native DOM and two-second execution budgets also apply.

Actions negotiate `api.actions-run` 1.34.0. No dedicated XPath Component renderer,
new storage endpoint or external configuration is required. The
[DOM Living Standard XPath interfaces](https://dom.spec.whatwg.org/#xpath) were
checked on 27 September 2026 (standard last updated 24 September). DOM's XPath
algorithms remain incompletely specified; browser behavior is exposed rather
than emulated. For example, the tested Chromium maps an unknown unsigned-short
result type to its ANY_TYPE behavior.

## Native traversal and synchronous callback programs

Forty-one entries cover `TreeWalker`, `NodeIterator`, `NodeFilter` and both
Document factories. Saved Component data includes the authored tree, roots,
starting nodes, mask, filter definition, explicit callback bindings and result
projections. The native engine supplies traversal order, skip versus reject,
iterator pointer reversal/removal adjustment, `detach()` compatibility behavior,
filter identity and recursive-filter `InvalidStateError`. Legacy node masks
can produce an empty result in an HTML tree; no retired node type is fabricated.

The generic `dom` action `callback` takes `[definition, bindings]`. Its `key`
is a callback hook name (for example `acceptNode` or `lookupNamespaceURI`), or
`function` to create a callable. `definition` uses existing expression/statement
nodes: primitive literals, variables and input bindings; own data reads; arrays
and records; conditional, binary and unary expressions; selected bounded string
and array methods; registered synchronous DOM get/set/call/constant operations;
local let/const bindings, assignment, blocks, if, while, for-of, try/catch/finally,
throw, return, break and continue. Arrow `function` definitions have lexical
undefined `this`; anonymous `function-expression` definitions receive the native
callback receiver under strict semantics. Destructuring, nested functions,
generators, async operations, globals, arbitrary source and prototype access are
outside this synchronous subset. The ordinary worker language remains separate
and terminable; it is not silently substituted for a synchronous callback.

`input` reads the callback's explicit captured bindings. The callback handle's
`bindings` property can replace those run-local inputs, including owned handles;
this lets a saved program compose a traverser and its filter without serializing
live browser objects. Reading the property returns a bounded snapshot. Native
callback identity and nested handle identity survive the worker transport.
Thrown callback data (including null, false, zero and empty text) remains
catchable as data. Native errors preserve their name. XPath namespace resolution
can reuse the same callback mechanism as well as its existing prefix maps.

Callbacks have 16 registrations per run, 256 definition nodes, depth 16,
2,048 evaluation steps per invocation, 32,768 aggregate steps, 512 invocations
per definition, call depth 8, strings of 4,096 characters and collections of
64 items. Copying callback data spends bounded work and admits at most 1,024
nodes / 65,536 text characters, including property names. Traversal inspects its owned detached tree
before native execution, with a 128-node limit. Existing DOM handle/request,
mutation and ownership checks apply to callback DOM operations too. These are
runtime limits, not limits in the standards.

Actions negotiate `api.actions-run` 1.35.0 on both manifests and through the
existing client. No new Component renderer, Thing kind or storage endpoint is
introduced. The manual acceptance checklist covers changing the filter's logic,
saving/reloading the complete Component and reusing it on another Builder page.

Sources: [DOM traversal](https://dom.spec.whatwg.org/#traversal) and
[Web IDL callback invocation](https://webidl.spec.whatwg.org/#call-a-user-objects-operation),
checked 27 September 2026 (updated 24 and 23 September respectively).
