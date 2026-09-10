# PR 754 — Personally paired recording worker

Branch: `codex/lopu-personal-recording-worker`, base: `develop`.

## Implemented

- Outbound-only origin-negotiated transport around the native local runtime.
- Local audio transcription followed by text-only native Claude Code input.
- Credential-free job projections, bounded audio and leases, heartbeat loss
  cancellation and identical completion retries without repeating inference.
- API-layer broker with exact paired-session/device ownership, current consent
  checks and transaction write fences against revocation and source changes.
- The canonical content writer creates quota-billed relational transcript
  comments and private notes/todos; client results cannot supply IDs or ACLs.
- Accepted transcripts, insight IDs and comment IDs survive interrupted work.
  Done receipts bind owner, device, session, lease and exact submitted content.
- Personal jobs never enter the cloud-provider worker, including after expiry.

## Not enabled yet

The broker is intentionally not registered as an executable HTTP route. No
capability manifest claims it is available. There is no selection UI or worker
pairing launcher yet. Do not bypass consent by seeding internal database fields.
Before enabling, add the route/docs/manifest together, validate a selected owned
device through the settings API, snapshot its identity into new jobs, and add
real-API transaction/race coverage. Then verify a real Watch upload end to end.
The native runtime and protocol unit tests do not establish physical acceptance.

## Verification

`test:ai-models` covers local runtime and transport. `test:lopu` covers the
bounded request/receipt contract, authority filters, broker lifecycle and shared
recording content writer. Broker fixtures are in-memory collaborators; they do
not access MongoDB or serve as evidence that deployment/pairing is complete.
Targeted ESLint and the typecheck ratchet also apply. Existing full-project
type errors must remain distinguished from new failures.
