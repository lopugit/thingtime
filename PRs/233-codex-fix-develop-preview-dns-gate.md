# PR #233 — Fix develop preview wildcard DNS verification

## Problem

The trusted develop-preview controller reached its live Vercel checks after
PR #212 merged to `main`, but stopped before deployment because Vercel's domain
configuration API returned `misconfigured: true` for the externally managed
wildcard. That flag is an advisory to move the apex nameservers to Vercel; it
does not mean Thingtime's documented Cloudflare topology is broken.

Live evidence showed the intended controls were healthy:

- the wildcard probe resolves through the DNS-only CNAME to Vercel's current
  recommended target;
- the narrow ACME subtree is delegated to Vercel without moving the
  `thingtime.com` apex nameservers;
- the PR hostname presents the valid `*.previews.dev.thingtime.com`
  certificate and returns HTTP 200.

## Fix

- Keep all existing project, Custom Environment, wildcard ownership,
  branch-detachment, repository, actor, PR, and exact-SHA fences.
- Replace the advisory boolean gate with a live DNS lookup of a probe hostname
  under the controlled wildcard. Publication fails unless its CNAME exactly
  matches one of the targets Vercel currently recommends.
- After assigning the exact PR alias, perform a bounded HTTPS request before
  publishing the successful GitHub Deployment state. A DNS, certificate,
  routing, or 5xx failure removes the unpublished controller resources.
- Correct controller comments and runbooks to reflect that ordinary Vercel
  Preview intentionally shares the development runtime and that the dedicated
  controller PAT is team-scoped, with project access constrained by the
  protected Environment and exact runtime identity checks.

## Verification

- Controller self-test: 43/43.
- Node syntax check and Prettier check pass.
- `git diff --check` passes.
- Graphify reports no dangling endpoints, missing endpoints, duplicate edges,
  collapsed edges, or self-loops.
- Live pre-fix canary failure:
  <https://github.com/lopugit/thingtime/actions/runs/31354415101>.

## Activation boundary

This PR targets `develop` under Thingtime's repository policy. The controller
loads only from the default `main` branch, so the live PR #229 canary must be
rerun after this change is promoted to `main`. Production preview credentials
and `*.previews.thingtime.com` remain outside this controller.
