# Anonymous native-render artifacts — 23 October 2026

These files came from the real `thingtime_render_and_export` MCP tool over
stdio, using its native Thingtime component/page renderer and Chromium
149.0.7827.55. The SDK client, MCP server and Chromium ran inside an OS network
namespace with no outbound route. No account, API server or database was
available to that render operation. Only the supplied editable JSON was used.

The refreshed artifacts use renderer SHA-256
`a6571e789f9963a79bd8a04dec4c565e1d46a0ca881b5147d27db23a71e1b32a`
from packaged application snapshot
`15e93be01ba2478f19fbdd20201bb18d72ab6c87f794e5a7c4800854b4ab85a7`.
MCP was rebuilt from the frozen source before the complete real SDK stdio
acceptance suite. The web editor, anonymous Builder and normal importer also
passed against that final snapshot in a disposable namespace. Linked-request
API checks passed on the preceding `2f0710ac` snapshot; the final product repair
changes only client file-metadata MIME normalization.
`linux-isolation/copy-repair-build.json` and
`linux-isolation/copy-repair-isolation-verification.json` record the build and full
kernel/browser isolation proof. Dependencies and the packaged application are
mounted read-only; the test has a fresh home, browser profile, configuration
and Mongo database. The standalone MCP operation has its own network namespace
with no API server or database, and only narrow MCP runtime/test mounts.

Earlier successful metadata is retained in `prior-native-verification.json`,
`prior-web-verification.json`, `prior-import-verification.json` and
`editable-blocks/prior-verification.json`. The earlier complete negative and
concurrency suite (`mcp-acceptance.log`) used renderer `648839bd…95bfa`.
The final complete suite (`mcp-copy-repair-acceptance.log`) passed with no skips
in 41.14 seconds, within its unchanged 120-second suite / 30-second tool limits.
The intervening `2f0710ac` captures are retained in `prior-integrated-render/`,
`prior-integrated-web/`, `prior-integrated-import-verification.json` and
`editable-blocks/prior-integrated/`; their logs retain the `integrated` name.

- `thingtime-draft.json`: canonical transfer JSON, including page and Component.
- `viewport-1440x1000.png`: desktop, with a 400×560 card.
- `viewport-390x844.png`: mobile, with 24px side margins.
- `viewport-320x844.png`: narrow layout, with 24px side margins.
- `card.png`: actual 400×560 native-renderer crop.
- `verification.json`: exact text, viewport bounds, diagnostics, renderer hash,
  Chromium version and content hash returned by the tool.
- `mcp-copy-repair-build.log` and `mcp-copy-repair-acceptance.log`: the final
  rebuilt MCP server returned native JSON and four PNG resources over SDK stdio.
  Exact bytes, text, bounds, renderer hash, repeated canonical export, concurrent
  busy refusal, malformed JSON, missing dependencies, remote assets, missing
  crop targets, invisible text and overflow checks passed. Rejected operations
  returned no partial resources. `mcp-integrated-positive.log` and
  `mcp-integrated-positive-verification.json` retain the preceding positive run.
- `mcp-network-isolation.json`: fresh direct IPv4, mapped IPv6 and IPv6
  connection refusals, empty routing table, absent application/MCP configuration
  and absent personal profile. `network-isolation.json` retains the earlier
  standalone proof.
- `agent-host-discovery.json`: this chat's available-tool and plugin discovery
  found no Thingtime connection. Local SDK acceptance is recorded separately.
- `render-diagnostic.log` and `cold-navigation-failure.json`: the first failed
  run and measured cause; retained separately from the successful evidence.
- `import-verification.json`: normal API importer round trip in a disposable,
  isolated backend. The actual JSON hash matches this render; fresh IDs,
  dependency remapping, private ACLs, guest refusals and canonical re-export
  passed. Imported Things were deleted and the synthetic account logged out;
  the success report is written after the cleanup responses pass.
  `import-copy-repair-acceptance.log` records the final run.
- `linked-request-api-verification.json` and `linked-api-integrated.log`:
  actual API checks on the preceding isolated `2f0710ac` package passed both
  built manifests, four
  concurrent first creates with exactly one quota charge, four exact retries
  without another charge, immutable tuple conflicts, owner/guest access fences,
  replay after binding and annotation, exact version/target deletion, pre-create
  cancellation, ordinary deletion and parent-cascade replay fences. Synthetic
  content cleanup and logouts passed; private accounted cancellation receipts
  remain only in the disposable database. `thingtime-linked-*.log` records the
  service/route/capability tests and canonical lint.
- `editable-blocks/verification.json` and `editable-blocks/copy-repair-acceptance.log`:
  actual anonymous Builder controls edited
  nested title, button, icon and repeated-row text; styled, reordered,
  duplicated and deleted blocks; saved and reloaded offline; exported complete
  dependencies. Screenshots cover 1440/390/320px and full scrolling. No account
  requests or page errors occurred. Its local Action fixture is separate from
  the stateless renderer, which forbids Actions.
- `web-verification.json`, `web-editor-1440.png`, `web-thingtime-draft.json`
  and `web-copy-repair-acceptance.log`:
  successful clean-browser draft editor acceptance against the complete
  packaged application. Editing JSON, native preview, canonical download,
  invalid-JSON rejection, stale-export refusal and empty state after reload
  passed. Only the HTML and renderer bundle loaded, once per navigation;
  browser API requests and cookies were absent, and opaque-origin storage
  access was denied by the unchanged sandbox policy. The actual browser
  download has the same canonical content hash as the MCP output.
- `plan/verification.json` and `plan-static-acceptance.log`: the final copied
  progress HTML passes 1440/390/320px counts (61 completed / 10 partial /
  16 planned), all five filters, case-insensitive and empty search, document
  bounds, section scrolling and visible footer checks. Screenshots were visually
  reviewed, including narrow testing/artifact links. Only the local HTML loaded;
  all other browser requests were denied. `plan/current-artifact-links.json`
  separately confirms all 24 current artifact links exist. Historical temporary
  links and external services are outside this static check.
  `plan-initial-scroll-diagnostic/` retains the initial fixture capture issue: its
  screenshots preceded smooth-scroll completion; explicit instant scrolling and
  viewport geometry assertions corrected the test without changing the HTML.
- `web-missing-runner-failure.png`: a failed web-editor check on an incomplete
  verification build that omitted the separate draft bundle. The canonical
  product build command already includes that bundle; this is setup-failure
  evidence, not a successful web-editor check.
- `web-cold-attempt-failure.json`: a later 30-second deadline failure under
  concurrent verification load. The instrumented diagnostic then loaded and
  rendered in 2.5 seconds; the full acceptance passed on rerun within its
  unchanged deadline. This failure is retained independently of success.
- `import-rate-limit-failure.json`: an additional importer run hit the normal
  signup limit on the reused synthetic backend before importing anything.
  The limiter was not changed or bypassed. The final run passed on a new
  disposable backend with its normal signup budget.

Canonical JSON SHA-256:

```text
a251642fe58ef5b1a2f32f8414591e02d6d52ebd2a50293f6b14c12464d4a06c
```

Call the tool through a connected local stdio MCP host:

```json
{
  "name": "thingtime_render_and_export",
  "arguments": {
    "content": "<the JSON object or complete JSON text in thingtime-draft.json>",
    "root": "affirmation-page",
    "viewports": [
      { "width": 1440, "height": 1000 },
      { "width": 390, "height": 844 }
    ],
    "crop": { "enabled": true, "blockId": "card" }
  }
}
```

The tool adds the 320px check automatically. `content` is JSON, not a path or
URL. Save the returned embedded resources to obtain the JSON/PNG files. The
repository example client performs that download:

```sh
npm --prefix remix run build:draft
npm --prefix MCP ci
npm --prefix MCP exec playwright install chromium
npm --prefix MCP run build
node MCP/scripts/render-example.mjs ./artifacts/draft-preview
```

The local MCP server entry is `MCP/dist/index.js`, launched with Node over
stdio. The `run-mcp-isolated.sh` evidence harness additionally enforces OS
network isolation and mounts a pinned build from
`/tmp/thingtime-draft-build-20261023`; recreate that directory from the three
built draft-preview files before reusing the harness in this workspace.

This is local SDK-client/MCP acceptance. This chat has no connected Thingtime
tool, and plugin discovery found no Thingtime connector, so downloadable
artifacts through this chat's native agent-host MCP interface remain unverified.
An HTTP endpoint or this SDK test does not establish that connection. No CI,
deployed-preview, installed Mac application or production verification is
claimed by these files.
