# PR #609 — Restore Lopu and preview admission

## Outcome

The protected Lopu PR manager stays below GitHub's workflow run-graph size
boundary, with a deterministic 510,000-byte contract ceiling. The preview
controller continues after GitHub drops a previously verified listener run's
pull-request association, provided the immutable same-repository SHA and ref
still match. GitHub API errors identify the failing route and error class;
proven rate limits and response-less transient 403s retry, while explicit
integration permission denials remain terminal.

GitHub can issue a declared-write `github.token` that still rejects issue
comment creation for an individual PR. The protected authorization and
publisher jobs therefore use the existing Lopu repository automation PAT when
available, with the per-run token as fallback. The exact-SHA build jobs remain
separate and secretless. Comment upserts accept the Actions bot or a marker
comment owned by the repository owner, so PAT attribution still updates one
durable comment instead of creating a comment for every phase.

## Live diagnosis

- The last-known-good 510,325-byte Lopu controller revision created a titled
  run and real job graph immediately.
- The first 514,886-byte revision and 218 later dispatches remained generically
  titled, queued, jobless, logless, and rejected both normal and force-cancel
  API requests.
- A diagnostic dispatch at the last-known-good revision started normally while
  those malformed runs remained present, isolating controller size rather than
  runner capacity as the admission failure.
- Preview failures showed both transient GitHub API rate limiting and GitHub
  removing a source run's pull-request association after the listener had
  already dispatched it.

## Security boundary

The association-loss fallback still requires the exact source run id,
pull-request-target event, trusted workflow path, repository id, triggering
actor, same-repository head, SHA, and ref. The controller then independently
reloads the live PR and revalidates its head before build or publication.
Explicit permission-denied 403 responses remain terminal.

## Validation

- Develop preview self-test: pass
- Lopu routing contract self-test: pass
- Routing contract fixtures: 10/10 pass
- Workflow control-plane contract: pass
- Workflow YAML parse and diff whitespace checks: pass
- Graphify code and semantic refresh: pass
- Live post-merge Lopu run: 33877702487, success
- Live exact-head PR #592 preview run: 33878101950, success
- Persistent PR #592 URL: https://pr-592.previews.dev.thingtime.com/
- Immutable PR #592 URL: https://thingtime-hwhh9pxrz-lopugits-projects.vercel.app/

## Follow-up acceptance repair

A clean current-SHA Lopu run admitted a complete job graph and successfully
finished both its exact PR scan and delegated repository review. That run also
exercised the separate repository-dispatch rebase path, exposing a pre-existing
credential gate that recognized only legacy static Claude slots even though the
worker passed the configured Thingtime credential-vault router secret. The gate
now treats that router secret as valid Claude credential authority, and the
routing contract prevents the mismatch from returning. The first live replay
then reached the vault fetch and exposed a second boundary: scratch preparation
correctly preserved the nested Lopu action, but not the two trusted helper
scripts that action invokes. Those helpers now participate in every trusted-tree
hash and safe-copy/restore phase, including rematerialization after the workspace
is replaced by repo-less conflict scratch. The next live replay reached the
nested Claude action, which requires a repository-local Git identity bootstrap
even when the model workspace intentionally contains no real checkout. The
scratch now receives an empty disposable Git repository for that bootstrap; it
also has a non-routable placeholder `origin` for the upstream action's checkout
credential replacement. The entire `.git` directory is removed with the
temporary action before the exact allowlist verifier runs.
