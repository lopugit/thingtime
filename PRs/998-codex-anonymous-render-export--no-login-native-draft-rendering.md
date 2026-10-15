# PR #998 — No-login native draft rendering and MCP artifact export

2026-10-15. Branch `codex/anonymous-render-export`, based on main
`b9ffa847e64f667a74a91070a39ae51d0ceebdbc`; PR targets develop under repository
policy. Draft status intentionally prevents automatic preview deployment.

## Outcome and boundaries

The existing guest path persists normal temporary accounts. Account drafts and
local data planes preserve authenticated owner scope. This change adds only an
in-memory host for existing Thingtime schema validation, component resolution,
native HTML/page rendering and canonical transfer collection/serialization.
The stdio MCP tool returns real PNGs and inline JSON/file resources without HTTP
access from the agent host. See [audit and usage](../docs/no-login-draft-preview.md).

Opaque-origin CSP denies account cookies/storage and all data connections.
Caller input cannot invoke Actions or native controls, resolve private Things,
fetch assets or publish. This first scope is text/CSS components and plain
component/container/text pages. The browser UI and MCP worker use the same
built renderer. Worker requests are intercepted and fulfilled only for the two
shipped files. Concurrent calls fail busy; deadlines and input/DOM/output caps
fail without partial artifacts. No artifact service/storage is introduced.

## Local evidence

Committed [actual exported JSON](../artifacts/draft-preview/thingtime-draft.json),
[desktop](../artifacts/draft-preview/viewport-1440x1000.png),
[phone](../artifacts/draft-preview/viewport-390x844.png),
[narrow phone](../artifacts/draft-preview/viewport-320x844.png) and
[card crop](../artifacts/draft-preview/card.png) came from tools/call over a real
stdio MCP SDK connection. The same SDK example saves the embedded resources to
files. [Viewport report](../artifacts/draft-preview/verification.json) includes
content and renderer hashes, browser version, exact text and measured bounds.

- Exact wording and authored line breaks retained. Desktop card 400×560; phone
  card 342×478.797; 320px card 272×380.797; phone margins 24px; no overflow.
- Clean browser against the PM2 app on 22460: JSON entry/render/download;
  zero account/API requests and cookies, denied storage in the sandbox, and no
  saved state after reload. Last good preview stays visible after invalid input,
  but stale export is refused.
- Dedicated fresh Mongo replica `draftPreview` at 22463 and API at 22462:
  ordinary registration/import/read/export/delete/logout APIs only. Import
  assigned fresh IDs, rewrote component references, preserved private ACLs,
  returned anonymous 404s and reexported canonical editable content. Only new
  synthetic account data was touched; imported fixture Things were removed.
  [Import report](../artifacts/draft-preview/import-verification.json).
- Two opt-in live browser/protocol tests passed, including busy, invalid JSON,
  missing dependencies, missing crop, unsupported viewport, network assets,
  transparent text and overflow errors with no artifacts.
- Four draft unit tests, 62 existing renderer/transfer regressions, 37 MCP unit
  tests and 14 packaging tests passed. Client build, MCP build/typecheck and
  targeted lint passed. MCP's default two browser skips were separately run.
- Remix raw TypeScript reports 91 diagnostics; a fresh archived starting-main
  source tree with the same dependencies reports the identical 91 diagnostics.
  No added diagnostics; this is not a clean full-project typecheck.

A concurrent client rebuild briefly removed the renderer bundle during one QA
run; capture failed closed. Tests passed after the build completed. The sandbox
check also caught Vite rewriting the HTML response header; the dedicated static
middleware now serves the opaque-origin document directly and the live test
asserts storage denial. Existing application headers remain unchanged.

## Delivery status

Local acceptance is complete for the documented scope. CI status is available
on the PR and is separate from local verification. No deployment, publication,
merge or existing-account mutation was performed. Keep the PR draft until
separate deployment approval. No preview URL is claimed.

The tool is usable by a configured local stdio MCP host. This chat/web-only
ChatGPT is not automatically connected: hosts without stdio need a separately
approved hosted connector or local bridge that can save inline resources. This
connectivity boundary does not relax Thingtime authentication.

Graphify: the initial AST update refused missing saved semantic nodes. A full
wrapper extraction through the local Codex proxy then succeeded (22 changed
semantic files; 52,904 nodes). Both new documents and the new renderer/tool source
were verified in the graph and manifest. Existing legacy-cache, duplicate-ID
and Swift-parser warnings remain repository-wide indexing limitations. No force
overwrite or manual graph merge was used. The final note is included in the
subsequent incremental refresh.
