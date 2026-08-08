# PR #99 — Persisted-state, CSP, and register body-cap hardening

## Scope

This PR keeps the security improvements that are independent of registration
rate limiting:

- replaces persisted function source revival with an explicit data codec;
- preserves `Date` values with an unambiguous tagged representation;
- applies one strict application CSP in Vite and Vercel output;
- moves pre-paint theme and environment-title boot code to a same-origin file;
- caps registration request bodies at 16 KiB before JSON parsing.

## Registration cleanup

PR #167 already merged the shared, admin-tunable IP-based `auth.register` rate
limit at 10 attempts per 15 minutes. PR #99 now uses that implementation
unchanged. Its only registration-specific addition is the independent 16 KiB
streaming body cap, with a dedicated test identity so the 413 assertion cannot
be masked by a previously consumed rate-limit bucket.

## Related PR consolidation

PR #99 is the single implementation lineage for the overlapping security work:

| PR | Preserved here | Disposition |
| --- | --- | --- |
| #94 | Strict legacy Date recognition and the CSP goal | Closed; its bare-string codec and global compatibility policy are superseded |
| #96 / #98 | Holder-aware tagged Dates and invalid-Date safety | Closed; adopted with ISO-looking string escaping, exact legacy migration, malformed-tag preservation, and committed tests |
| #102 | Persisted-function `eval` removal and injected-inline-script blocking | Merged only into #94's feature branch; independently superseded by the stricter shared CSP here |
| #103 / #106 | Registration body cap and manual test intent | Closed; body cap/checklists retained, duplicate 20/15-minute limiter discarded |
| #167 | Canonical admin-tunable 10/15-minute IP register limiter | Already merged to `develop` and reused unchanged |

Open PR #92 is intentionally not folded in or closed: cross-tab synchronization
is a separate feature. It should rebase after #99 and use the extracted safe
codec rather than restoring Provider-local serialization.

## Conflict-resolver cleanup

The merge and rebase auto-resolvers no longer pause merely because a regular
text conflict is in a package manifest, lockfile, workflow, repository policy,
environment template, `.gitattributes`, or another configuration/security-
adjacent path. Those conflicts now follow the same verified file-only AI path
as other text conflicts, with a deterministic base/destination fallback when a
semantic union is uncertain. Each terminal PR comment lists the sensitive path
set for focused reviewer attention, accumulated across every rebase round.

This does not relax the real publication boundaries: unsafe paths, symlinks,
submodules, executable modes, binary/oversized inputs, executable Git drivers,
unresolved markers, detected workflow credentials, out-of-scope edits, forks,
default/protected branches, stale refs/topology, missing workflow-capable PATs,
and failed exact leases still stop publication.

## Design preview isolation

Repository-controlled design bundles still need their runtime compiler and
unpkg dependencies. Only `/docs/design-bundles/*` receives that compatibility
policy.
Those documents are served with CORS enabled and loaded in an opaque-origin
iframe sandbox without `allow-same-origin`; the ordinary application and
authorization routes retain the strict policy without `unsafe-eval`.

PR #102 deliberately kept global `unsafe-eval` so its legacy Commander/smarts
JavaScript execution paths continued to run. That exception is not carried
forward: it would weaken every application route. Normal Commander navigation,
search, and registered magic-word actions remain; arbitrary eval-backed paths
fail closed until they are replaced by an explicit safe command registry or an
isolated execution design.

## Validation

- persisted codec tests: 10 passing;
- Thingtime provider/autosave tests: 22 passing;
- focused lint, JavaScript syntax checks, and Git whitespace checks;
- full Remix/Vercel build and generated-output policy verification, including
  independent assertions that the production shell has no inline executable
  scripts and app `script-src` has neither `unsafe-inline` nor `unsafe-eval`;
- focused authentication API suite, including strict 400 and 413 assertions;
- desktop and mobile browser checks for the application shell and sandboxed
  design preview, including console/CSP inspection.

The repository typecheck ratchet passes at 138 errors versus its 143-error
baseline; this PR does not widen or rewrite that baseline.
