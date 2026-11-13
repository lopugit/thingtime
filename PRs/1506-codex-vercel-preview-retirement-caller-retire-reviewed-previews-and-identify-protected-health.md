# PR 1506 — Reviewed preview retirement and protected Branch health

The protected controller on `github-actions` already supports an exact deployment-ID batch and a typed dry-run flag. The product listener now forwards those optional inputs with ordinary defaults unchanged, so a policy-backed dry-run can be inspected before the same reviewed IDs are retired. The obsolete standalone promotion runner is removed; canonical promotion remains in the protected Lopu controller. The untouched-main caller contract reproduced that obsolete listener failure before its repair.

The Status footer retains its actual Branch target. Health probes stay anonymous: only an observed401/403 from the exact platform-generated branch/deployment origin becomes a redacted authentication-required result. They never send an automation bypass credential, follow a login redirect, or make a protected preview readable through a public health endpoint. Frontend text and JSON body consumption plus legacy fallback share one3.5s deadline. Redirect failures remain unavailable when their reason cannot safely be proven.

Corrective contract versions: `api.health-frontend`1.0.1, `api.health-mongodb`1.0.3, `api.health-nitro`1.3.1 and `api.health-vercel`1.0.1. Both canonical generated manifests and coverage are updated.

## Validation

- Integrated actual product merge803a5b4fa2be frommain; retained both additive changelog entries.
- Capability and health tests199/199; caller contract seven thin listeners; full lint zero errors455warnings; TypeScript ratchet zero errors.
- Focused regression covers accessible anonymous Branch, exact versus unrelated target classification, no credential forwarding, no protected legacy fallback, redirect refusal, one fallback deadline and headers-fast/body-stalled timeout.
- Desktop/mobile rendered acceptance and live deployment evidence follow below. Synthetic status fixtures establish UI projection only; actual production Branch acceptance is a separate check after deployment.
- Project protection remains disabled pending separate compatibility rollout. No deployment retirement has occurred before the canonical policy dry-run.

A bounded 120-second structural Graphify update reached all 4,510 files but did not finish. Valid immutable snapshots remain; combined-source indexing is incomplete. Local rendered checks are pending after an API-fixture matcher incorrectly intercepted Vite source modules; that matcher was corrected. No source startup failure has been established. Final live preview/production acceptance remains separate from the synthetic API tests.
