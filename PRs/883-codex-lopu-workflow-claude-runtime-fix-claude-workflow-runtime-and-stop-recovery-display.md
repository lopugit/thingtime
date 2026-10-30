# Fix Claude Workflow runtime and Stop recovery display

Follow-up [PR #883](https://github.com/lopugit/thingtime/pull/883) to
[PR #867](https://github.com/lopugit/thingtime/pull/867).
Branch: `codex/lopu-workflow-claude-runtime`. Base: `284617d8f`.

Production verification found that a Vercel-managed Claude reply failed before
provider invocation because its worker could not resolve
`@anthropic-ai/claude-code/package.json`. Successful shell/API checks and the
OpenAI reply path did not establish that the separate Workflow function carried
the pinned Claude runtime. This failure does not establish an OAuth credential
or model-allowance problem.

The follow-up discovers emitted Node functions that reference Claude, packages
the pinned runtime in each function, and verifies worker-runtime resolution
from its isolated filesystem root. The inspected Workflow output declared
arm64 independently of the x64 Linux builder’s native runtime. Packaging now
aligns each Claude-consuming function’s CPU architecture with its executable
and verifies the match; flow/webhook configuration is preserved. The existing
OAuth vault, model settings, permission checks, Stop and continuation boundaries
remain in place. Both manifests advertise
`api.lopu-chats-reply` 1.14.2; existing 1.14.0 client minimums remain compatible
because request and event shapes are unchanged. No new credential is required.

Validation must cover isolated built-function runtime resolution, missing or
corrupt packaged assets, both capability manifests, and authenticated Claude
execution in Vercel management on the deployed preview and production. Packaging
and mocked tests do not prove a provider-backed reply. The follow-up PR records
deployed acceptance and final release evidence, including commands, test results
and deployment verification.

Focused contract validation passed: `test:api-capabilities` 82/82 and the
page-context manifest regression 3/3. Packaging tests and deployed acceptance
are tracked separately on the follow-up PR.

Packaging verification passed 12/12 tests; existing runtime/OAuth regressions
passed 10/10. Repackaging the current emitted artifacts verified Claude 2.1.272
in the main server function (131.7 MiB) and Workflow step (144.1 MiB), including
function-local resolution, architecture and archive integrity. These artifact
checks precede the clean canonical build and authenticated deployed retest.

Authenticated staging on 2026-09-22 verified a real Claude reply in Vercel
management, followed by a second reply that completed after a browser reload
with exactly one read-only tool call. Stopping a third reply stayed terminal
after reload, with no further provider request. The Linux deployment packaged
Claude 2.1.272 in both functions (164.7 MiB server, 153.4 MiB step), and scoped
Workflow logs showed accepted requests and successful executors without runtime
errors. The ordinary preview had no Claude vault configured, so this acceptance
used an isolated deployment with the existing production environment.

The staging request disabled automatic custom-domain assignment. Vercel still
moved its generated project alias; that alias was restored, and all seven prior
production aliases were verified before further release work. No credential or
project setting changed.

The Stop/reload check also exposed an empty user bubble from a recovered
background turn whose saved user-message link was unavailable. Recovery must not
invent a user message for that task; genuine attachment-only messages and the
terminal assistant's manual Retry control must remain visible. This display
regression is covered alongside the runtime fix. Final-head checks and deployed
acceptance are recorded on PR #883.
