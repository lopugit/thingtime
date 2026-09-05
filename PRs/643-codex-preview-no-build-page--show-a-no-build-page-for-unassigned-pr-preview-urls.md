# PR #643 — Missing-build page for unassigned PR preview URLs

Date: 2026-09-05. Branch: `codex/preview-no-build-page`. Base: `github-actions`.
PR: https://github.com/lopugit/thingtime/pull/643

## Cause and scope

The two preview wildcard domains were bound to the product branches. Without
an exact PR alias, Vercel served the main/develop app, making an absent preview
look like a deployed build. This change replaces only those wildcard fallbacks
with fixed HTML. It does not modify app code, exact PR aliases, either live root
domain, deployment credentials or the untrusted secretless build boundary.

The page displays the matching PR number/environment, links directly to the PR,
and offers a manual retry. It has no functions, environment reads or automatic
polling, and uses a hashed CSP plus no-store/noindex response headers.

## Root response decision

Live staging exposed an existing Vercel project-wide directory-listing setting
that replaces root 404s with a file listing, even for function responses. The
scoped solution keeps that setting unchanged: `/` returns marked HTML with
HTTP 200; nested paths return the same HTML with HTTP 404. The publisher rejects
the explicit missing-build header at any status. An arbitrary HTTP 404 is also
no longer sufficient publication proof. Other projects may opt into a real
root 404 with `PREVIEW_FALLBACK_ROOT_STATUS=404` if directory listings are off.

## Verification before merge

- 131 focused tests passed, including hostname isolation, routing/CSP, marker
  rejection, retry behavior, two-target preflight, production/foreign-deployment
  rejection, uncertain-write reconciliation and idempotent installation.
- Develop controller: 146 self-tests passed. Admin publisher self-test,
  workflow and resolver contracts, YAML parsing and patch hygiene passed.
- Staged deployment: `dpl_CefuVbRkfYiewLTSxx6tx8m8CX5G`, content digest
  `afe65001642381428b4bf9c9fa6d42be6556542f3ecf92b0c1aee47e2eb12c96`.
  https://thingtime-2bb1uujed-lopugits-projects.vercel.app
- Live GET checks: root 200, nested page/API path 404, all with the exact missing
  marker and no-store response. No wildcard was changed during staging.
- Chrome desktop and 390 × 844 mobile checks passed: full page including footer,
  no horizontal overflow or clipping, working manual retry/PR link, no CSP errors.
- Graphify refreshed with semantic documentation and portable report/HTML output.

## Protected rollout

After exact-head CI passes and this PR is merged, wait for older publishers to
finish. Install the verified staged deployment with the scoped provisioner,
which validates both target domain identities before mutation and reads each
write back. Bind only the two preview wildcards to `github-actions`, whose
Vercel Git-deployment kill-switch remains enabled. Set protected environment
variable `PREVIEW_MISSING_BUILD_PAGE=true` after installation.

Verify an unassigned PR hostname in both namespaces, including root and nested
paths. Check that PR #596/#611 exact deployment aliases and both live roots
remain unchanged. Rerun a real preview using the new controller mode. Record
the final run IDs, read-back and browser evidence in the PR rollout comment.
