# PR 814 — Background AI execution and recovery

[Pull request](https://github.com/lopugit/thingtime/pull/814) · `codex/lopu-background-tasks` → `develop`

## Behavior

Signed-in Lopu chat, voice transcript replies, musings and AI completion requests
use a SharedWorker observer, with a direct page observer fallback. The canonical
Nitro handler owns execution after atomic admission. Vercel `waitUntil` keeps
it alive after the final tab closes; reconnects reuse an immutable operation ID.
The task overview lives under the Lopu drawer. Chat lists and global Lopu controls
show static stage arcs. Stop and Retry / Continue preserve partial results and
completed receipts; replay never automatically reapplies patches, navigation or
approval tokens. Different conversations can run independently.

## Contracts and boundaries

- `api.lopu-background-tasks` 1.0.0; chat reply 1.9.0; voice reply 1.4.0;
  musing 1.1.0; AI complete 1.2.0. Chat 1.9 preserves develop's 1.8 receipt links.
- Protected home control Things retain no credentials/request headers. Account,
  public origin and selected data source fence reads; chat access is rechecked.
- Output: 2 MiB maximum, seven-day read window, lazy removal afterward. A small
  immutable marker prevents repeated execution. Stop before admission records
  a cancellation marker so late network delivery cannot start inference.
- Chat/task/function budgets: 240/260/300 seconds. A killed runtime is surfaced
  as interrupted, never blindly replayed. Already-committing tools may finish.
- Live microphone capture/direct realtime audio still require an open surface.
  Existing recording/scheduled workers retain their own lifecycle. Client-only
  draft patches retain their existing save/fork semantics; saved page mutations
  finish on the server and task output retains the tool events for review.

## Validation, 2026-09-16

- Canonical Vercel build and output verifier pass, including 300-second budget.
  The built server's capability endpoint advertises the new task feature.
- Focused suites cover duplicate admission, changed payloads, account/origin/data
  source fencing, chat access revocation, concurrent chats, cancellation races,
  missing done, Unicode output pagination, retained idempotency after expiry,
  strict tool JSON, token truncation, capability negotiation and protected schemas.
- Chrome against disposable MongoDB: navigate away, close the final tab, close
  the submitting tab with another tab open, reopen saved results/chat, Stop and
  Retry / Continue. Desktop and 390px full scroll, drawer, expanded results and
  tool details checked. Mobile header account duplication was corrected.
- Actual background endpoints complete musing fallback and voice transcription;
  invalid AI completions retain their 400 result. External provider credentials
  were not configured for live paid-provider acceptance.
- Broad TypeScript diagnostics remain in unchanged baseline files. One unrelated
  timing-sensitive schema test passed on rerun. Focused tests and the build pass.
- Graphify incremental AST/semantic extraction ran through the local proxy; the
  tracked outputs use immutable snapshots and semantic CAS variants.

## Local QA and delivery

Local: http://127.0.0.1:14700 (HMR 14701, Nitro 14702), through the existing
worktree PM2 lifecycle, no restart loop. This is a synthetic account/database.
Funnel could not be inspected: the installed `tailscale` wrapper points to a
missing Tailscale.app executable. No existing Funnel mapping was changed.

The PR remains open for review; no primary-branch merge or production promotion
is part of this task. Vercel preview/check status is reported on the PR.
