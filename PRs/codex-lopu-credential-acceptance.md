# Lopu credential routing and account-switch isolation

This follow-up to merged PR #1070 addresses failures reproduced on develop
`f41cf65629fe98423405de4bea4e5894f59ccb46`. It does not merge or promote that
branch and does not establish acceptance with real credentials.

An explicit send override naming an unavailable credential now stops before a
reply request is dispatched. Previously the rejected choice retained the prior
provider and could send with Thingtime credits or another saved connection.
Already saved unavailable pins remain visible and selected.

Chat creation, rename and deletion now discard late success/failure results
after account generation changes, including switching away and back. Pending
writes fence list refresh only for their own account generation. Old operations
cannot change the current account's notices, selection, credentials or cache.

Within one account, rename responses update only their own title. Rename and
delete failures roll back only their own field or removed entry while preserving
concurrent provider saves, newly loaded messages and later chat selection.
Deleting the selected chat adopts the account's new-chat defaults. If deletion
fails, its old selection and choice return only when no later selection or
draft settings edit has occurred.

## Validation

Nine deterministic regressions failed before the fixes and pass afterward.
The focused store/credential suite passes 62 tests and the full Lopu UI suite
passes 255. ChatGPT protocol/runtime/admission tests pass 50 tests; the ordinary
run skips the separate opt-in Mongo storage integration. Changed-file lint has
zero errors and one inherited recovery-loop warning. TypeScript matches all 92
diagnostics in a clean develop comparison, with no new messages. The production
client/server build and Vercel output verification pass.

The isolated browser/HTTP fixture passes at 1440px and 390px: device defaults
survive reload, chat selection persists independently, endpoint/model/billing
labels agree, popovers scroll fully, and separately edited Builder label/select
blocks save and reload with functioning controls. Its stale capability manifest
was corrected to the required Things contract, with owner/data-plane and
revision checks enforced by the synthetic writer. The runner verified kernel
network isolation, backend direct-IP and browser redirect denial, and enabled
Chromium sandboxing. It used fresh synthetic accounts and no real credentials.

Graphify output is refreshed structurally. The local semantic proxy is absent
in the cloud environment; changed documentation is not claimed as semantically
indexed.

The provider boundary remains unchanged: model discovery uses the selected
account's visible `/v1/models` slugs, and inference uses the fixed public OpenAI
Responses endpoint with `store:false` and `stream:true`. Tokens are not accepted
as credentials for arbitrary endpoints. This matches the current
[official model/inference contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

Real saved-connection model discovery, actual provider response, reload,
explicit Thingtime-credit routing and revoked-session behavior still require
the intended authorized runtime. Synthetic tests and a hosted deployment are
not evidence of those acceptance steps. Device/provider gates from the handoff
remain open until separately observed.
