# Reusable AI model and endpoint waterfall

`AiWaterfallSelector` is the shared selection dialog. Its caller supplies
`value`, a redacted `endpoints` catalog, `isOpen`, `onClose`, and `onApply`.
Apply returns `AiWaterfallConfig`; Cancel discards the draft. With
`allowInherit`, Apply can return `null` to use that feature's shared defaults.
The dialog never fetches data, saves settings, starts AI work, or owns credentials.

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
