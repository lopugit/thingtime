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

## Design preview isolation

Repository-controlled design bundles still need their runtime compiler and
unpkg dependencies. Only `/docs/design/*` receives that compatibility policy.
Those documents are served with CORS enabled and loaded in an opaque-origin
iframe sandbox without `allow-same-origin`; the ordinary application and
authorization routes retain the strict policy without `unsafe-eval`.

## Validation

- persisted codec tests: 9 passing;
- Thingtime provider/autosave tests: 21 passing;
- focused lint, JavaScript syntax checks, and Git whitespace checks;
- full Remix/Vercel build and generated-output policy verification;
- focused authentication API suite, including strict 400 and 413 assertions;
- desktop and mobile browser checks for the application shell and sandboxed
  design preview, including console/CSP inspection.

The repository typecheck ratchet remains at the base-existing 149 errors versus
its 143-error baseline; this PR does not widen or rewrite that baseline.
