# Ordinary PR gateway routing with preserved develop credentials

Ordinary protected PR publication keeps Vercel's custom `develop` target and
its existing credential scope. Its gateway is explicitly a follower of the
controlled Preview master at `https://master.previews.thingtime.com`. The
logical gateway environment and the Vercel credential target are separate:

| Publication | Vercel credential target | Gateway origin |
| --- | --- | --- |
| Ordinary PR | Custom `develop` | `master.previews.thingtime.com` |
| Canonical develop | Custom `develop` | `dev.thingtime.com` |
| Canonical Preview master | Standard `preview` | `master.previews.thingtime.com` |
| Production main | `production` | `thingtime.com` |

The standard Preview target currently has unrelated runtime variables that
custom `develop` does not. Moving ordinary PRs to that target would broaden
their credential scope, so the publisher keeps `--target=develop` and the
secretless build keeps `VERCEL_TARGET_ENV=develop`. At upload, the protected
controller selects exactly one unbranched, encrypted Preview-scoped
`THINGTIME_GATEWAY_SECRET`, reads its value through Vercel's authenticated
per-variable API, and passes it only in the child process environment. CLI
arguments contain the bare `--env THINGTIME_GATEWAY_SECRET` key, never its
value. The controller rejects missing, duplicate, wrong-scope, undecryptable,
or short values before upload. It also explicitly passes the logical
`THINGTIME_GATEWAY_ENVIRONMENT=preview` and master origin as runtime keys.

The controlled master remains a read-only prerequisite: the controller checks
its project and alias ownership, trusted current `main` SHA, standard Preview
target, canonical publisher metadata, ready state, gateway manifest and live
API JSON without following redirects. The custom `develop` environment must
still have the exact ID, slug, and `develop` branch matcher; its environment
domain list must be empty, and `dev.thingtime.com` must remain a verified
project domain bound only to `develop`. An unready master stops PR publication. This controller never
promotes a PR to repair the master.

New PR deployments carry `thingtimePrPreviewPolicy=2`,
`thingtimeBuildTarget=develop`, the exact custom environment ID, and explicit
gateway metadata. Identity, list, reuse, alias and cleanup checks reject old
custom-develop deployments with the former gateway mapping. Existing
`pr-N.previews.dev.thingtime.com` aliases remain compatibility names. Old
deployments and their aliases are not deleted by the new cleanup; an exact old
alias may be replaced only after ownership validation.

Vercel CLI 59.10.0 rejects `--skip-domain` outside production. Before upload,
the controller inventories project domains and protected canonical and
compatibility aliases, rejecting any PR ref bound to a project domain. It
records their bindings, then restores only bindings that point to this exact
verified upload attempt if Vercel autoassigns an alias. Concurrent operator
changes are preserved. An uncertain upload is reconciled by exact attempt and
provenance; unresolved outcomes retain a private non-secret receipt and halt
without a blind second upload or destructive cleanup. The receipt is synced to
disk and atomically renamed before upload. Later runs inspect protected aliases
before reusing, canceling, or deleting a PR deployment and stop if an alias
still points to it. The branch binding check reduces risk but does not prove
that a custom-target upload cannot transiently assign a domain; the live
snapshot and restoration checks are the backstop.

Validation is by controller self-tests and focused recovery/workflow tests.
Live Vercel settings, deployments and production acceptance are separate
rollout checks.
