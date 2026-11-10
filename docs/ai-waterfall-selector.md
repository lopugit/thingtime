# Reusable AI model and endpoint waterfall

`AiWaterfallSelector` is the shared selection dialog. Its caller supplies
`value`, a redacted `endpoints` catalog, `isOpen`, `onClose`, and `onApply`.
Apply returns `AiWaterfallConfig`; Cancel discards the draft. With
`allowInherit`, Apply can return `null` to use that feature's shared defaults.
The dialog never fetches data, starts AI work, or owns credentials. Its optional
`library` prop injects saved items and a save callback; persistence stays with the caller.

```tsx
<AiWaterfallSelector
  isOpen={open}
  value={waterfall}
  endpoints={endpoints}
  onApply={setWaterfall}
  onClose={() => setOpen(false)}
/>
```

The version-1 portable configuration contains ordered entries with
`endpointId`, `modelId`, `effort` (nullable), and `speed` (`normal` or `fast`).
An endpoint/model combination can recur with distinct effort or speed. The
first row is preferred. Endpoint IDs are references, never URLs or secrets.
Use `parseAiWaterfallConfig` at transport boundaries and
`validateAiWaterfallSelection` against the feature's supported catalog.

CI stack selection and the shared Admin model-order editor both mount this
component. The latter adapts its historical composed-model-ID array to/from
the portable type, preserving its mandatory Default fallback and existing
shared-setting API. Its consumers still select compatible provider entries;
this refactor does not add custom endpoints to that legacy global setting.

## Stack execution

Saved stacks accept optional `modelWaterfall`; omission preserves the existing
choice and `null` restores inherited routing. The save/run path validates all
personal endpoint references against the current administrator's Secure Vault.
Every dispatch freezes the complete selection and actor. Subsequent edits
cannot change the running plan. The frontend requires
`api.admin-ci-feature-stacks` 1.4.0 before saving.

Custom orders produce a version-4 immutable plan. The protected
`github-actions` controller supports v3 (existing Lopu runner) and v4 (selected
HTTP model/endpoint waterfall). Its deterministic Git executor merges each
source in order; clean merges require no AI. Conflicts are sent as bounded
text to `/api/v1/integrations/ci/stack-completion`. The selected provider returns
JSON with exactly the conflict paths and their resolved text. No model-supplied
command executes. The existing independent merge-topology/conflict-scope
verifier and publication gates remain mandatory.

The gateway requires a canonical-JSON HMAC, fresh single-use nonce, exact
active GitHub run identity, latest permitted stack dispatch, and current
endpoint ownership. It loads credentials only on the server, uses the existing
public-HTTPS/DNS/redirect guards, and returns a safe unavailable receipt for
provider capacity, auth, missing-model, timeout, or connection failures.
The runner tries subsequent entries only on that receipt. Invalid output,
unauthorized selection, rejected requests, or an uncertain lost response stop
execution. Each conflict begins again at the preferred entry.

Built-in entries use Thingtime's Anthropic/OpenAI **API** keys. Personal entries
use saved Secure Vault HTTP endpoints, including supported native providers and
custom compatible hosts. Claude Code subscription/session tokens are not HTTP
endpoint keys; choose inherited routing to keep the existing CLI credential
workflow. No credential is included in the config, workflow inputs, or attempt
trace.

Current explicit-waterfall resolver limits: 32 selected attempts, 90 seconds
per model request, 90 KB per conflict file and 120,000 characters per batch.
Binary, symlink, deleted-file and oversized conflicts stop for manual resolution;
a successful provider response with invalid or incomplete resolutions also
stops, rather than trying another model. Provider success alone never proves a
stack is mergeable: the independent verifier and required CI still decide.

## Rollout and verification

Publish the controller PR to `github-actions` before enabling v4 selections on
the product deployment. Older controllers reject v4 safely. Existing inherited
v3 runs are unchanged. The runner negotiates `api.ci-stack-completion` 1.0.0 on
Thingtime before sending a conflict request. The product direct-dispatch
contract is `api.admin-ci-dispatch` 2.2.0.

Run the waterfall/config/gateway tests, CI-control tests, capability coverage,
controller self-tests and the temporary real-Git merge fixture. Verify dialog
Apply/Cancel, mixed endpoint order, keyboard controls and mobile scrolling in
Chrome. Production paid-provider execution and actual merge publication require
separate acceptance after rollout.

## Personal saved library

`SavedAiWaterfallSelector` is the connected app wrapper: a feature supplies its
current value, opens the selector, and receives a config through `onApply`.
It discovers the current account's endpoint catalog and saved waterfalls.
Callers can supply a restricted catalog and maximum entry count. The pure
`AiWaterfallSelector` remains usable with an injected `library` containing
`items`, optional `error`, and async `save({ id?, updatedAt?, name, config })`.

Settings → AI waterfalls (`/settings/ai-waterfalls`) creates and edits private
named configs. Select existing loads a draft; Save waterfall updates the selected
record; Save as new creates a separate record. Apply waterfall returns a snapshot
without saving; Save & apply waits for persistence before returning that snapshot.
Cancel discards only unsaved edits. Library edits never mutate existing feature
configs or running jobs. Incompatible endpoints remain visible and must be changed
before applying to a restricted feature. The legacy provider-default entry is
supported in Settings/global settings but not in explicit HTTP stack waterfalls.

The registered GET/POST `/api/v1/ai/waterfalls` contract is
`api.ai-waterfalls` 1.0.0. Clients negotiate it and `api.ai-models` 1.4.0.
Both library methods require authentication and `x-thingtime-expected-user` to
prevent an account switch from redirecting an in-flight operation. Updates require
the saved `updatedAt` revision; a stale edit returns 409 without overwriting data.
The editor keeps the draft and refreshes the library for reopening. Records use
owner-only ordinary data Things (`crystal.systemType: ai-waterfall-v1`) through
the generic Thing mutation/storage-accounting pipeline. Names are bounded to 80
characters, configs to 256 entries (stack consumers: 32), and libraries to 200
records. Configs contain references only; endpoint ownership is rechecked on save.
