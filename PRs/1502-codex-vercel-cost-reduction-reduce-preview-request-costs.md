# PR 1502: Reduce preview request costs and bound background work

## Problem and resulting behavior

Repeated capability discovery, slow publication dependencies, and abandoned
device polls could occupy functions and transfer unchanged data unnecessarily.
This change adds a 60-second successful-manifest cache, concurrent deduplication,
exact-origin ETags and body-free 304 responses. Gateway authority still expires
after five seconds and requires fresh validation; expired authority is never used.

Publication reads have a six-second MongoDB budget and a twelve-second client
deadline that leaves room for middleware. Cached content stays usable with one
inline degraded status and Retry action. Read generations prevent an old GET
from overwriting a committed publication write. Shared MongoDB initialization
retains its independent bounds instead of inheriting one waiter's cancellation.

Device event/command/state work follows the caller's cancellation and a bounded
budget. Empty command polls avoid transactions, and snapshot conflicts have
three attempts before returning 409. The existing long-poll protocol is retained;
persistent connections should move to a separately operated service if measured
traffic justifies that migration. Keeping them open in metered functions would
still reserve function memory.

## Protection and compatibility

Server gateway requests deliver Vercel's automation credential only to the
configured validated origin. Incoming bypass headers are stripped, redirects
are refused, and the credential is never required by browser code. Same-origin
active-API discovery retains the browser's protection cookie; foreign and custom
scoped transports continue to omit cookies. Preview robots disallow cooperative
crawling while production stays indexable.

Live preview acceptance found that the shared ingress classified `robots.txt`
as data-backed and rejected its newer contract against an older gateway. Crawler
policy is now served locally without gateway discovery. A real H3 middleware
regression covers preview GET/HEAD and production policy with networking refused;
data-backed API and sitemap paths keep their gateway admission.

This PR does not activate project protection or delete deployments. The separate
controller release provides authenticated deployment checks and an explicit,
policy-checked retirement batch. Protection activation must preserve public
production and validate current gateways and retained previews. Old immutable
previews need compatible source and a fresh deployment to receive the system
credential; rebuilding an unchanged old source revision cannot add the code.

## Verification and remaining acceptance

- Full client/server builds and Vercel output verification passed before cleanup
  of disposable local build output. The final twelve-second client build passed.
- TypeScript and its zero-error ratchet passed. Full lint had zero errors and
  457 existing warnings; the final cookie correction passed focused lint.
- Capability, gateway, marketing, MongoDB, device and robots regressions passed.
  After integrating current main, the capability suite passed 189/189 checks.
- Fifteen real HTTP checks exercised compiled preview/production handlers.
  An unreachable isolated database returned an explicit 503 with Retry-After.
- Desktop and 390px mobile browser checks covered cached/degraded/retry states,
  Admin Marketing, drawer scrolling, and HEAD/OPTIONS documentation. Admin and
  cached data used synthetic fixtures. The final client consumed an actual
  compiled 503 response in 9.37 seconds without an abort or page error.
- Deployed acceptance, project protection, and retirement are distinct rollout
  gates. Synthetic browser checks do not establish production administrator or
  paired-device authentication.

Graphify's six-document semantic refresh expanded to 144 chunks and exceeded
the bounded indexing attempt. A structural attempt then met host disk
exhaustion. Source and verification evidence were preserved; only task-owned
disposable output was removed. Documentation semantic coverage is not claimed
as refreshed. Portable structural output is refreshed separately when possible.
