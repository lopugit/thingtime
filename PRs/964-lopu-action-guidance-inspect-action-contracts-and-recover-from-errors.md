# PR #964 — Help Lopu inspect Action contracts and recover from errors

PR: https://github.com/lopugit/thingtime/pull/964
Branch: `codex/lopu-action-guidance`

## Problem and behavior

The observed Equipment import guessed a lowercase category, tried a nonexistent
form ID and repeatedly read large forms to discover valid inputs. PR #960 made
large Thing reads lossless and category errors explicit. This follow-up gives
Lopu a direct discovery path before execution.

- `inspect_action` resolves the exact authorized ID or owner-scoped actionKey
  through the existing executor, returning runtime, declared inputs and direct
  effects without executing steps, creating a run or asking for approval.
- Optional candidate inputs use the same declared-type validator as execution.
  This does not simulate downstream APIs, validate run budgets or grant access.
- Large contracts are explicitly incomplete and provide the canonical Thing ID
  and `/inputs` pointer for lossless authorized reads.
- Ask mode checks declared inputs before creating a confirmation card. A
  corrected request still needs approval; Full and scheduled restrictions stay
  unchanged.
- Failed completed runs retain their run ID when one exists and tell Lopu to
  inspect current records before retrying partially completed writes.
- New workspace compositions derive select choices, numeric bounds and reference
  hints from `SERVICE_FIELDS`. Existing installed Actions and records are not
  rewritten. Their existing validator errors and lossless reads still apply.
- Working guidance discovers IDs, reuses inspected contracts, distinguishes
  validation/access/revision failures and preserves identity on uncertain writes.

The additive chat reply capability is `api.lopu-chats-reply` **1.19.0**.

## Validation

- `test:lopu`: 180 TypeScript and 155 module-mock tests passed.
- `test:lopu-chat-streaming`: 55 passed, including provider tool advertisement
  and complete enum contract transport.
- `test:actions`: 156 passed; the existing opt-in fork integration test skipped.
- `test:schemas`: 261 passed, including saved descriptor sanitization, exact
  canonical choices/bounds, leading-zero serials and optional empty controls.
- `test:api-capabilities`: 90 passed across both manifests.
- Production-shaped `npm --prefix remix run build` and focused ESLint passed.
- Raw TypeScript checking is tracked separately from the repository's existing
  baseline; required CI performs the combined-tree typecheck ratchet.
- Explicit disposable loopback replica/API check passed real registration,
  owner-scoped key inspection, private Action refusal, candidate validation,
  invalid-input confirmation ordering, signed approval, Full/Ask transitions,
  nested browser execution, stable-ID workspace upsert/readback, server Action,
  stale reply refusal and session revocation. The named QA processes were stopped.
- Reviewed the relevant `TESTING.md` Action/Lopu checklists. No layout or new
  browser interaction was changed. Real provider reasoning quality/speed and
  automatic upgrading of previously saved Action descriptors are not claimed.

Graph maintenance uses the repository Graphify wrapper and coherent snapshot
pair. Structural freshness is checked against the final source fingerprint;
semantic extraction availability is separate from code/test verification.
