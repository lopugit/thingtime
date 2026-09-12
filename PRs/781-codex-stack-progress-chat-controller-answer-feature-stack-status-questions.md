# PR #781 — Feature Stack action status responder

2026-09-12. Controller PR: https://github.com/lopugit/thingtime/pull/781

Feature Stack runs currently look active while their merge gates wait, and administrators cannot ask the action what it is doing. This adds an optional status responder beside the merge workers and distinguishes working, queued, waiting, failed and confirmed-merged targets in progress reports.

The responder answers from bounded job/step/target PR facts and four prior exchanges. Its Claude session has no tools, MCP servers, shared HOME, repository, GitHub token or router secret; it cannot change the merge plan. It uses existing vault credentials, negotiates the product chat capability, and retries uncertain deliveries with the original lease. Older sparse reporter checkouts keep working without the optional module. Workflow comments move to the testing runbook to preserve GitHub's guarded workflow size limit.

Validation: 24 focused Feature Stack/vault tests including a real Git conflict fixture, legacy sparse reporter test, responder credential fallback and retry tests; progress self-test; workflow control-plane and routing contracts. The workflow remains under 510,000 bytes.

Rollout: paired product/API PR: https://github.com/lopugit/thingtime/pull/782. Deploy that product change and merge this controller change into `github-actions`, then start a new stack run. Existing running actions cannot acquire chat retroactively. A live model answer through the deployed mailbox still needs this paired rollout; synthetic transport and UI tests do not claim production delivery.
