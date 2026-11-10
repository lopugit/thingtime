# PR 1016: Keyless Claude model sync and workflow persistence

## Behavior

Claude discovery uses Anthropic's authenticated model list when a discovery key works, otherwise the official public lifecycle table when no key is supplied or it returns 401/403. Public results update metadata without overwriting account availability, admin enablement, or marking omitted rows unavailable. Explicit retired rows remain unavailable. Unknown model capabilities keep conservative defaults.

The workflow waterfall editor uses live models rather than intersecting a compiled list. Save & apply awaits both the saved waterfall and shared workflow-order writes; errors retain the dialog for retry. Apply waterfall stages the order as before.

## Verification (2026-10-18)

- 141 focused tests pass; changed-file ESLint and AI routing contract pass.
- Full Vercel build and output verification pass; compiled capability manifest exposes ai-models 1.6.0, admin-ai-models 1.4.0, and ai-models-sync 1.2.0.
- Official keyless lifecycle fetch returned 23 records, including Opus, Sonnet, and Haiku 5.5. An isolated Mongo replica set successfully published these through the real admin sync endpoint, with providerAvailable remaining null.
- Real saved-waterfall and workflow-order API writes/readback passed for Opus 5.5 followed by Sonnet 5.5. A clearly fake local OAuth placeholder exercised configured-but-unverified picker availability; no inference was performed.
- Raw typecheck reports the exact same 91 errors as the pristine source base; no new TypeScript errors.
- Chrome for Testing acceptance passed at 1440×1000 and 390×844: live 5.5 options, Save & apply followed by full reload and independent settings GET, ordinary Apply remaining staged, a deliberately rejected workflow write retaining the dialog, successful retry with only one saved preset, and full-page/modal scrolling without horizontal overflow. The backend writes were real; only the failure-response scenario was intercepted.
- Following the updated testing instructions, acceptance used its own Chrome process/profile and local test identity. Browser and backend ran under OS-enforced network restrictions to local test services; external hostnames, direct external IPs, and redirects were rejected. The backend used an explicit local database and JWT secret with no production credentials. Screenshots, isolation results, and a trace were retained locally.
- GitHub Web CI build/unit checks, API suite, CodeQL, and GitGuardian passed for the implementation commit. The preview at https://thingtime-fo420b5ym-lopugits-projects.vercel.app returned HTTP 200 and the expected capability versions; its Vercel metadata identifies source 67001f1b04858bca8f694a26430ef787c8918af8.
- Local test origin: http://localhost:14590. Tailscale/Funnel could not be verified because the installed wrapper points to a missing Tailscale application. The normal PM2 dev runner timed out; acceptance uses the compiled node-server build with an isolated database and local JWT secret.
- During setup, missing JWT configuration caused the existing API fallback to create one unverified disposable catalog-check account in production. Its session was revoked; no production model settings were changed. No supported self-delete API was found. Local fixture requests subsequently assert that no fallback header is present.

- Structural Graphify refresh succeeded. The local semantic proxy health request timed out, so documentation semantic indexing remains unverified.

## Review and rollout

Primary-branch merge is authorized by the user's instruction to merge this Thingtime fix into main when completed. Browser acceptance is complete. Production verification after merge must check the deployed feature versions and behavior; public metadata does not establish real account inference access.
