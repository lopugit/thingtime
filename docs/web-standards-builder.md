# Web standards Builder app

The `web-standards` suite installs three editable Component Things, two Action
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
editable program. Roughly 1,800 have interactive recipes; the rest are
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
- `dom`: bounded event/method bindings inside the isolated document.
- `probe`: element, attribute, CSS, selector or interface inspection.

The primitive has no catalogue ID dispatch. Users can copy a saved Component,
edit its `render` program in Thingtime's Fields/Source editor and place it on any
Builder page. The live program editor runs an unsaved draft; **Save example
template** saves the catalogue template. To retain a draft, update the program
on the saved Component Thing. Inputs and running workers clear across account
and component boundaries.

The runtime document has an opaque origin in an `allow-scripts` iframe, with a
matching response-header CSP even when opened directly. It has no account
bridge, credential storage, network, popup or form-submission grant. Executable
HTML attributes and embedded documents are rejected. JavaScript comes from a
bounded data compiler, with no raw-source escape or eval, and runs in a worker
terminated after two seconds. Regexps execute there; native input patterns are
excluded because main-thread validation cannot be terminated. DOM methods have
an explicit allowlist and event budget. CSS/document changes remain local to the
frame. This runtime intentionally cannot demonstrate APIs needing permissions
it has not been granted.

`$ui` query controls may declare `form: true` to gather the explicitly named
`params` from their nearest fieldset inside the component. Form constraints are
checked; excluded password/file fields preserve defaults; empty text clears a
value. The existing same-page query encoder still rejects reserved parameters.

## Build and validation

`build:platform` builds the static runner. `build:client` includes it, and the
PM2 dev entry point builds/watches it. Vite and Vercel both apply the isolated
CSP; `verify:vercel-output` requires the runtime and its policy.

Run `pnpm --dir remix run test:web-platform`. For actual API ownership/install
checks, use a disposable local database and set `TT_STANDARDS_TEST_URL` plus
`TT_STANDARDS_TEST_DATABASE_HOST`; the test verifies the database host before
creating a temporary account, and removes only the fixture Things it created.
The browser checklist is in `TESTING.md`.
