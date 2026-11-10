# PR #99 — Persisted-state, CSP, and register body-cap hardening

## Final reconciliation against current develop

PR #99 was reconciled against the `develop` tip after PR #90 merged.
Current `develop`, not the PR's historical implementation, is the source
of truth.

The important architecture change since the original PR was an August 15
extraction of persistence into
`remix/app/Providers/thingtimeSerialization.ts`. That newer path restored
Feed composer behavior by serializing function source and compiling it during
hydration. Conflict resolution then left #99's safe
`thingtimePersistCodec.ts` beside the application but unused. The final
reconciliation:

- folds the security invariants into the active `thingtimeSerialization`
  path;
- deletes the unused parallel codec and moves its regression coverage into the
  current serializer test;
- keeps the newer autosave, atomic repair, mutation queue, temporary-user,
  Feed, `/things`, auth, and default-merge architecture intact;
- drops unrelated conflict-resolver files and documentation that accumulated
  through historical automated merges.

## Persisted state and Dates

Persisted Thingtime is data, never executable source:

- runtime functions are omitted on every write, including nested functions;
- every legacy `{ ttype: "function", code, ttScope }` object is removed
  before hydration regardless of whether the source looks syntactically valid;
- parsing never calls `eval`, `Function`, or any equivalent compiler;
- the graph-aware repair deletes inert function keys rather than leaving
  `undefined` own-properties, so the existing default merge can refill
  legitimate code-defined functions;
- the repaired snapshot is atomically written before the hydrated UI is exposed;
- flatted circular references and shared aliases remain intact.

Dates now use explicit `{ ttype: "date", iso }` tags. Every untagged string,
including an exact ISO timestamp, remains a string across repeated cycles.
Legacy snapshots made real Dates indistinguishable from identical-looking user
text; the generic hydrator deliberately preserves that ambiguous value as text
instead of guessing and corrupting one case. Any future migration of known date
fields must be schema-aware. `"Post 1"`, `"2024"`, and `"March 2024"` likewise
always remain strings.

## CSP, boot, and dynamic execution audit

Vite development and Vercel production share a single application CSP source.
Production application routes allow neither inline executable scripts nor
`unsafe-eval`. Theme/pre-paint variables and environment title prefixes
run from same-origin `/tt-boot.js`.

Current `develop` also injected preview freshness as an inline head
script. The strict policy would have silently blocked it, so the same tested
bootstrap is now emitted as `/tt-preview-freshness.js` and still loads
before the hashed application entry. Output verification rejects any executable
inline shell script and requires both external boot files.

The dynamic-execution audit classified the remaining occurrences:

- both global and nested/deprecated Commander views no longer evaluate
  `path = value` input. They parse JSON-compatible data literals,
  quoted strings, and plain text, so normal assignment/search/navigation
  behavior works under CSP and program text cannot execute;
- `smarts` retains legacy opt-in function/scoped-eval modes and one-argument
  global-lookup shortcuts. Active Thingtime provider calls use explicit
  object-plus-path arguments, never those compiler/global-lookup branches;
  they are not part of persisted hydration and remain blocked by the
  application CSP;
- repository-controlled generated Design bundles require their runtime
  compiler. Only `/docs/design-bundles/*` receives an
  `unsafe-eval`/inline/unpkg compatibility policy, inside an
  opaque-origin iframe sandbox without `allow-same-origin` or popup
  escape.

Programmable Thingtime behavior is intentionally deferred to an explicit
Action/Command/Function Thing registry or isolated runtime. This PR does not
design that system and does not weaken the global policy for it.

## Registration reconciliation

PR #167 already supplied the canonical, admin-tunable `auth.register`
policy: 10 attempts per 15 minutes per IP. PR #99 does not change or duplicate
that limiter.

The route now reads the request through shared
`readJsonBody(request, 16 * 1024)`. The shared reader enforces the real
streamed byte count and returns the standard JSON 413 response. A headless API
case uses a unique RFC 3849 test IP so a previously consumed limiter bucket
cannot mask the body-cap assertion. Registration continues to whitelist fields
and never forwards caller-controlled account metadata.

## Historical #99 work intentionally dropped or superseded

- The old standalone `thingtimePersistCodec` files were superseded by
  current `develop`'s serialization module and are removed.
- Function revival added later on `develop` to recover a retained Feed
  composer is intentionally replaced; code-defined defaults now provide those
  runtime functions without trusting browser storage.
- Duplicate historical registration limiter values remain discarded in favor
  of the current `auth.register` rule.
- Unrelated rebase-stack resolver changes carried into this branch by automated
  conflict merges are restored to `develop`.
- Cross-tab PR #92 remains a separate feature and must use the active safe
  serializer when it rebases.

## Validation

Focused regression coverage proves:

- ordinary/date-like/ISO-looking strings survive repeated cycles unchanged;
- real tagged Dates preserve their exact instant;
- valid-looking, malformed, scoped, and hostile legacy function payloads never
  execute and are removed;
- function source is absent from new snapshots, including when a Function has
  a custom `toJSON` method;
- code-defined defaults refill removed runtime properties;
- circular references and shared aliases survive;
- Commander data assignments work without dynamic execution;
- the 16 KiB registration cap returns 413 while the canonical limiter remains
  unchanged;
- strict production output contains no executable inline script and loads both
  same-origin boot scripts before the app.

Local reconciliation results:

- `npm run test:persist`: 11/11 passed;
- `npm run test:autosave`: 23/23 passed;
- `npm run test:commander`: 5/5 passed;
- `npm run test:preview-build`: 7/7 passed;
- `npm run test:rate-limit`: 1/1 passed;
- `npm run test:unit`: passed in full;
- `npm run test:api -- --base <local worktree URL>`: 423/423 passed;
- `npm run build`: passed, including the Vite client, Nitro/Vercel output,
  output patching, and CSP/output verification;
- `npm run typecheck:ratchet`: non-blocking 147-versus-143 warning, one lower
  than the 148 errors in an isolated `origin/develop` snapshot;
- touched-file ESLint: zero errors (the repository-wide command reaches six
  pre-existing `import/first` errors in unchanged
  `app/components/Kinds/kindRegistry.tsx`);
- `git diff --check origin/develop`: passed.

Rendered browser verification covered desktop and 390 x 844 mobile layouts
for `/`, `/things`, Feed, login, register, and Commander. Menus, Feed filters,
comments, and the landing-page FAQ were opened; finite pages were scrolled from
top to bottom without horizontal overflow. Feed's intentional lazy loading was
stopped after the single refresh/retry boundary. Commander rendered hostile
program text as a literal value without setting its execution marker. The
four ordinary strings above survived two UI-driven save/reload cycles. The
console contained no CSP or runtime errors (only the existing React Router
`HydrateFallback` warning).

The current Vercel preview URL and GitHub check status are added to the PR
description after the reconciled head is published.
