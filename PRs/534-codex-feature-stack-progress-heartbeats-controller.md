# PR #534 — Feature Stack progress heartbeat controller

## Outcome

One trusted non-matrix reporter observes the real Feature Stack target workers
and posts progress immediately, on phase transitions, every ten minutes while
unchanged, and once all workers are terminal. It stops with the workers and is
non-blocking, so a telemetry outage cannot fail or prolong a valid merge.

## Safety and cost

- Runs only after the immutable plan and model configuration succeed.
- Checks out only the reporter from protected `github-actions`.
- Has `actions: read` and `contents: read`; it receives no push credential.
- Uses the existing stable `THINGTIME_CI_ROUTER_SECRET` solely to HMAC-sign a
  bounded status payload.
- One reporter covers the full target matrix, avoiding an idle runner per
  target.

## Validation

- Reporter self-test: pass
- Resolver routing contract: pass
- Workflow control-plane contract: pass
- Workflow YAML parse: pass
- Graphify refreshed; hooks and merge driver verified
