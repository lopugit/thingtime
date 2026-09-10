# PR 747 — shared saved action contexts

Implementation: <https://github.com/lopugit/thingtime/pull/747>.
Branch: `codex/shared-saved-action-contexts` → `develop`.

## Behavior and security

- Executable references use stored argument defaults, then savedArgs, then
  each page-block override. Both the saved component and every page instance
  participate; repeated component IDs do not discard distinct arguments.
- Discovery follows authored branches and bounded stored loop scopes. Query,
  result, viewer and other runtime data cannot confer private read authority.
  Template-shaped argument data, control inputs and metadata are not edges.
- Same-author containment and fresh root authorization remain mandatory.
  Shared execution remains read-only; originals and standalone ACLs are unchanged.
- Non-owner writers need independent access to new argument-selected dependencies,
  including new instances of already included components.
- Copies preserve argument programs, labels and inputs. A bounded `ttActionRefs`
  array on each affected control maps its resolved reference to the copied
  action once, after interpolation. Unused bindings grant nothing. Copies of
  copies rebind again, and required contextual dependencies are preflighted.
- API feature versions: Things 1.9.0 (legacy 1.8.0), Things update 1.2.5
  (legacy 1.0.5), action execution 1.3.0, copying 1.2.0. Clients negotiate the
  new action/copy minimums. The canonical registry generates both manifests.

## Validation

On implementation commit `4106735f7007eec53cb25c32aadb4931c4241593`:

- Actions 76 passed; components 38 passed; capability contracts 26 passed;
  webpages 90 passed with two opt-in skips.
- Opt-in real API fixture passed, then built-client Chrome 152 passed at
  desktop 1440 and mobile 390. Both argument-selected controls worked signed
  out; copying retargeted both actions; wrong/retired keys and writer injection
  failed. Existing retry, private-copy and media transport checks also passed.
- Full client/embed/Nitro/Vercel build and output verification passed.
- Built Nitro manifest smoke passed for four changed features. It was intentionally
  database-free and printed the expected missing-database bootstrap warning.
- Focused lint passed. Full typecheck has 108 existing errors, none in changed
  files; a green full typecheck is not claimed.
- Graphify was queried and refreshed incrementally with semantic documentation
  extraction and portable outputs. It is an approximate navigation aid, not
  authorization evidence.

Develop advanced through PR 745 during validation. The reconciliation preserves
its historical action receipts and API version changes. Only changelog text
needed manual resolution. Fresh-head checks are required before merging.

Local API/browser verification: <http://localhost:12280>. Tailscale/Funnel was
unavailable because the Tailscale application binary was unavailable on this host.
Preview discovery and exact-head CI receipts remain in the PR checks/comments.

## Focused main promotion

`codex/promote-saved-action-sharing-main` carries only this sharing
implementation and its tests, API contracts, client requirements and
documentation. It does not import develop's unrelated changes, and Graphify is
refreshed for the actual promotion tree. Exact-head build, CI, security and
deployment receipts are recorded in the PR checks and comments.

## Remaining broader goal

This closes saved-argument action discovery/copying, not independent binary
upload copies, universal multi-page composition coverage, or never-settling
request timeouts. No live user content was migrated or edited by these fixtures.
