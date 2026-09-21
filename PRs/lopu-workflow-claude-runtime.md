# Lopu Workflow Claude runtime packaging

Follow-up to [PR #867](https://github.com/lopugit/thingtime/pull/867).
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
