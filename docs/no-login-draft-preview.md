# No-login native draft preview and export

Open `/draft-preview/index.html`, or **Builder → No-login draft preview**.
Paste a portable Thing or `thingtime.transfer` v1 bundle, optionally choose a
root, edit the JSON, render, and download canonical JSON. The tab keeps an
in-memory draft only. Closing/reloading discards it. No account, temporary user,
saved draft, public page, Action, upload or database record is created.

## Audit of existing paths

Verified against main `b9ffa847e64f667a74a91070a39ae51d0ceebdbc`:

- `BuilderPagesList` gates account pages on `useCurrentUser`. `/things` can
  bootstrap a temporary user, but `temporaryUser.ts` creates an ordinary user,
  session and recoverable roster. That is account persistence, not stateless QA.
- `/api/v1/drafts` and `draftClient` implement owner-private autosave/recovery.
  They remain authenticated. Data-plane selection preserves owner identity;
  IndexedDB/device state is not a credential-free export API.
- Component previews, Builder demos and Web Standards drafts reuse real
  renderers, but do not provide a caller-supplied, dependency-complete anonymous
  render-and-artifact operation. `/api/v1/webpages/resolve` still authorizes
  stored references; anonymous drafts never call it.
- The existing transfer validator/serializer and `collectTransfer` are reused,
  along with `validateThingtimeCrystal`, the component argument resolver,
  `HtmlThingRenderer` and `WebpageBlocksRenderer`. This is an additional isolated
  host for those primitives, not a new Thing format or an HTML imitation.
- `MCP/src/server.ts` already provides stdio MCP. The hosted ChatGPT integration
  keeps account tools protected and its existing anonymous login bootstrap.
  This feature adds a local stdio tool; it does not weaken hosted OAuth.

The earlier shared design history and offline references are not proof of an
import or render. The committed acceptance fixture is validated by current
schema code and the normal importer.

## Agent connection and artifacts

Install/build from the repository root (no private settings or credentials):

```sh
npm run worktree-setup
npm --prefix remix run build:draft
npm --prefix MCP ci
npm --prefix MCP exec playwright install chromium
npm --prefix MCP run build
```

Connect an MCP host that supports **local stdio servers** to:

```json
{
  "mcpServers": {
    "thingtime-drafts": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/thingtime/MCP/dist/index.js"]
    }
  }
}
```

Use absolute paths; retain the sibling `remix/dist/draft-preview` build. Node
22+ is recommended. The tool does not need a running HTTP server, login cookie,
API token or arbitrary HTTP access in the agent host. It launches a fresh
Chromium context and fulfills only the two shipped preview files in memory.
Nothing is fetched from the apparent loopback URL.

Call `thingtime_capabilities`, then `thingtime_render_and_export`:

```json
{
  "content": "<complete Thingtime transfer JSON string, or a JSON object>",
  "root": "affirmation-page",
  "viewports": [{ "width": 1440, "height": 1000 }, { "width": 390, "height": 844 }],
  "crop": { "enabled": true, "blockId": "card" }
}
```

`content` is actual JSON, not a path or URL. A single portable Thing must include
its caller-chosen **bundle-local** `id`, `thingtime` and `crystal`; these IDs do
not claim database identity. Multi-root bundles require `root`. In-bundle
components resolve by ID or unambiguous `componentKey`. Export includes the
selected root's dependency closure and preserves templates/arguments. Schema
normalization is reported. Canonical JSON and its SHA-256 identify the content
actually rendered; separate renderer bundle hash and Chromium version identify the capture implementation. PNG bytes can differ by platform/system fonts.

Tool results contain structured diagnostics/viewport geometry, an embedded
`application/json` resource, PNG `image` blocks and embedded PNG blob resources.
`thingtime-draft://<hash>/<filename>` names an **inline resource**, not a public
URL or server-side stored file. Hosts must support saving embedded resources
(or copy their bytes into their own attachment system) for downloadable files.
No expiry service is needed: there are no retained server artifacts.

Run the same real protocol with the supplied example client:

```sh
node MCP/scripts/render-example.mjs ./artifacts/draft-preview
```

A web-only ChatGPT host that cannot launch stdio servers is **not connected by
this change**. It needs a separately approved hosted MCP connector and artifact
transport, or a local host bridge supporting stdio and inline-resource saving.
An ordinary HTTP URL alone does not solve that connection. This PR neither
installs a connector into an existing host nor deploys a remote server.

## Supported draft scope and bounds

The first version supports `component` HTML-node templates and `webpage`
component/container/plain-text blocks. Text and a restricted CSS property set
are editable; components use existing defaults, saved arguments and block
arguments. Unsupported content fails explicitly. No raw HTML blocks, Chakra
nodes, Actions, native controls, schemas, account references, media or remote
fonts/assets are accepted, including inactive template branches. System serif
fonts are sufficient for the affirmation fixture.

Limits: 256 KiB input; 32 supplied Things; 12,000 JSON values; depth 32; 40
page blocks; 550 resolved render nodes per component; render depth 20; existing
shared resolver value/character caps. At most three requested viewports,
320–1920 by 320–1440 CSS pixels, device scale factor 1. A 320×844 check/capture
is added if absent. One active job per MCP process; concurrent calls fail busy;
30-second total deadline; worker heap 512 MiB / Chromium JS heap 256 MiB;
6 MiB aggregate image+JSON bytes before base64 (image/resource copies counted).

The opaque-origin CSP sandbox denies cookies/storage, connections, frames,
media, fonts, forms, plugins and untrusted scripts. Existing renderer
sanitization remains active. No account runtime is mounted. The local capture
worker additionally denies every request except shipped HTML/JS. Fonts and two
animation frames settle before measuring; zero-size, invisible, overflowing,
failed, CSP-blocked or blank-text output fails with **no partial artifacts**.
The preview retains its last good render on an edit error but disables export of
that stale result. A crop uses the selected block's first authored component
root; without `blockId`, the first component, or the root element for a single
component. It is captured at the first requested viewport.

Production/static hosting must serve the generated CSP headers. The existing
Vite and Vercel packaging paths set them; `dist/draft-preview/policy.json`
contains the same generated policy for the offline MCP host. Do not serve the
HTML on an account origin with a generic server that omits the sandbox header.

## Verification

```sh
npm --prefix remix run test:draft
npm --prefix MCP test
cd MCP
TT_DRAFT_BROWSER_TEST=1 TT_DRAFT_WEB_BASE=http://127.0.0.1:22460 \
  TT_DRAFT_ARTIFACT_DIR=../artifacts/draft-preview \
  node --import tsx --test test/render-export.integration.test.ts
```

The browser test is opt-in and requires the built bundle/installed Chromium;
its default skip is not acceptance. `TT_DRAFT_WEB_BASE` additionally exercises
the running app's actual editor, JSON download, empty state after reload,
opaque-origin storage denial and zero API requests in a clean browser.

For importer acceptance, start a **new disposable** loopback Mongo replica on
22463 named `draftPreview`, with a new empty dbpath. Use the canonical PM2
`pm2AppConfig` with a unique QA name, web/HMR/API ports 22460/22461/22462, and
`MONGODB_CONNECTION_STRING=mongodb://127.0.0.1:22463/thingtime?replicaSet=draftPreview`.
Use fresh local signing configuration and no copied production credentials.
Then run from `remix/`:

```sh
TT_DRAFT_TEST_BASE=http://127.0.0.1:22462 node --import tsx scripts/draft-roundtrip.integration.mts
```

The script checks the database host/replica through the real status API before
creating a synthetic account. It imports the tool's actual exported JSON,
checks fresh IDs, dependency remapping, private ACLs and anonymous 404s, then
reexports through the normal API. It removes only its imported Things and
logs out. Stop the QA PM2 stack and disposable Mongo process after verification.
No existing account is used. This is separate from the anonymous workflow,
which performs no writes at all.
