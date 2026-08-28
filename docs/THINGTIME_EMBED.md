# Thingtime Embed SDK

Thingtime Embed turns one script tag into a shared, editable JSON state tree that
can be mounted anywhere in an existing website. Every mount, the floating
Thingtime popup, and the secure full editor stay connected to the same state.

The production asset is designed to live at:

```html
<script src="https://thingtime.com/embed/thingtime.min.js"></script>
```

Until the branch is deployed, use the matching preview or local Thingtime
origin in place of `https://thingtime.com`.

## Quick start

Declarative mounts work before any custom JavaScript:

```html
<div data-thingtime-mount data-thingtime-label="My website"></div>
<div data-thingtime-mount="capabilities" data-thingtime-label="Capabilities"></div>

<script
  src="https://thingtime.com/embed/thingtime.min.js"
  data-thingtime-name="My website"
  data-thingtime-initial='{"headline":"Hello","capabilities":{"search":true,"sharing":true}}'
  data-thingtime-open="true"
></script>
```

Or mount and control it imperatively:

```html
<div id="thing-here"></div>
<script src="https://thingtime.com/embed/thingtime.min.js"></script>
<script>
  Thingtime.init({
    name: 'Website capabilities',
    visibility: 'public',
    initialValue: {
      headline: 'Hello from Thingtime',
      capabilities: { editing: true, sharing: true }
    }
  });

  const mount = Thingtime.mount('#thing-here');
  Thingtime.mount(document.querySelector('#another-place'), 'capabilities');

  Thingtime.set('headline', 'Every view updates');
  console.log(Thingtime.get('capabilities.editing'));

  const unsubscribe = Thingtime.subscribe((value, { source }) => {
    console.log('Thingtime changed via', source, value);
  });

  // Later:
  mount.unmount();
  unsubscribe();
</script>
```

## Public API

`window.Thingtime` exposes:

- `init(config)` / `configure(config)` — set the API origin, initial value,
  name, visibility, editability, thing id, and auto-open/load behavior.
- `mount(elementOrSelector, path?, options?)` / `unmount(handle)` — render the
  whole thing or any nested path into a safe Shadow DOM mount.
- `get(path?)`, `set(path, value)`, `replace(value)` — read and write the shared
  JSON tree.
- `subscribe(listener)` — observe changes from page mounts, the popup, API
  loads, undo/redo, or the secure editor.
- `open()`, `close()`, `toggle()` — control the in-page Thingtime popup.
- `openSecureWindow()` — open the full Thingtime editor in a first-party
  Thingtime window.
- `undo()`, `redo()` — move through the shared host-side edit history.
- `load(id)` — load an anonymously readable public thing.
- `save()` — save directly when already on the Thingtime origin, otherwise open
  the secure first-party window and wait for the user to confirm the save.
- `getDocument()`, `getStatus()`, `destroy()` — inspect connection metadata or
  remove all listeners, mounts, popup DOM, and the global SDK object.

Configuration can also come from script attributes:

| Attribute | Meaning |
| --- | --- |
| `data-thingtime-api` | Thingtime API origin; defaults to the script URL origin. |
| `data-thingtime-id` | Existing public embedded thing id to load. |
| `data-thingtime-name` | Name used when the thing is first saved. |
| `data-thingtime-visibility` | `public` or `private`; defaults to `public` in the SDK. |
| `data-thingtime-initial` | JSON-encoded initial value. |
| `data-thingtime-editable` | `false` for read-only direct mounts. |
| `data-thingtime-auto-load` | `false` to defer loading `data-thingtime-id`. |
| `data-thingtime-open` | `true` to open the in-page popup after boot. |

## Persistence and conflicts

Embedded values are stored in the existing `thingtime.things` collection as
`kind: "embed"` documents through `/api/v1/embed/things`.

- `GET /api/v1/embed/things?id=<id>` anonymously returns public JSON data and
  permits cross-origin reads.
- An authenticated first-party `GET` without `id` lists the current user's
  embedded-thing metadata.
- Authenticated `POST` creates or updates a thing. Updates include the
  last-seen `version`; concurrent saves return `409` and the latest safe
  projection instead of silently overwriting it.
- Values are limited to 256 KiB, 32 levels, and 20,000 nodes. Non-JSON values,
  non-finite numbers, `$`/dotted Mongo keys, and prototype-polluting keys are
  rejected.

The JSON API contract is also available at
`/api/v1/embed/things-docs` and in the browser API reference.

## Security model

Direct host-page mounts deliberately use a JSON-only renderer. They do not
execute `thing.exec`, revive functions, interpret dynamic Chakra components,
inject persisted HTML, or create legacy globals such as `window.tt`,
`window.smarts`, or `window.process`.

Authenticated saving happens in a top-level Thingtime-origin window:

1. A user gesture opens `/embed/bridge.html` with a random channel in the URL
   fragment.
2. Parent and popup validate the exact window, origin, channel, and protocol on
   every `postMessage`.
3. The account cookie remains first-party and httpOnly. No account bearer token
   is placed in the host page, script URL, DOM, or message payload.
4. A cross-site page can prepare a save, but the popup always requires the user
   to review and click **Confirm save** before the API mutation.

Anything mounted into a host page is visible to that page's own JavaScript, so
only public/shareable projections should be mounted directly. Private or
executable Thingtime experiences need a separately sandboxed broker rather than
host DOM access.

For a strict CSP, allow the chosen Thingtime origin in `script-src`. The SDK
copies the loader script's nonce to its Shadow DOM style elements, so a
nonce-based `style-src` policy can use the same nonce:

```html
<script nonce="<per-response-nonce>" src="https://thingtime.com/embed/thingtime.min.js"></script>
```

The secure editor is a popup, not a third-party iframe, and browsers may require
the user to allow popups for the Thingtime origin.

## Build and verify

From `remix/`:

```sh
corepack pnpm install
corepack pnpm run build:embed
```

The command writes exactly one generated asset:

```text
remix/dist/embed/thingtime.min.js
```

`scripts/verify-embed-bundle.mjs` fails the build if the embed build *generates*
an extra JavaScript, CSS, or source-map asset, if the file is not valid classic
JavaScript, or if the expected SDK namespace is missing. It compares against the
names in `remix/public/embed/`, because the preceding client build has already
copied those into `dist/embed/` and they are hand-written pages, not chunks. The
normal client/Vercel build includes the embed build and separately verifies that
the bundle, the secure bridge, and the demo's external scripts were copied into
`.vercel/output/static/embed/`.

For local development, first build the SDK, then use the normal PM2 stack:

```sh
corepack pnpm --dir remix run build:embed
npm run web-ports
npm run web-pms
```

Open `/embed/demo.html` on the printed local or Tailscale/Funnel origin. The
demo mounts the same thing twice, opens the popup, and runs visible host-global,
stored-XSS, and prototype-path safety canaries.

The demo's own code lives in `/embed/demo-host.js` (canary globals, loaded
before the SDK) and `/embed/demo-integrity.js` (the assertions, loaded after).
Keep them external: deployed Thingtime paths are served under the strict
application CSP (`script-src 'self'`, no `'unsafe-inline'` and no hash/nonce
allowance), so an inline block is parsed into the page and then refused by the
browser — the isolation verdict would sit on "Checking host isolation…" forever.
The dev server uses `devCsp`, which *does* allow inline scripts, so this is
invisible to local QA; `scripts/verify-vercel-output.mjs` asserts it at build
time instead.
