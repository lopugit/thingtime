# 15 — Anti-abuse: global storage budgets + verification gates

Owner request (2026-07-27, during PR #151 security review): the sandbox's
~0.9GB/hour worst case per IP still feels too generous — per-IP limits scale
linearly with a botnet. Investigate a GLOBAL sandbox budget (~0.5GB/hour for
the whole app, not per IP), and treat the email-verification grace window
(7 days service / 30 days user) as a storage-abuse vector too: consider
requiring mobile-number verification within ~1 day — potentially before ANY
storage is allowed. Keep as a todo for now; collect every other anti-abuse
protection worth doing alongside.

## 1. Global sandbox storage budget (~0.5GB/hour app-wide)

Current state (PR #151): per-IP mint 10/min, 50 keys/token, 32KB/value, 1h
TTL → ~0.9GB/hr worst case PER IP. A botnet multiplies that per node; the
global ceiling is unbounded.

Direction:
- Add a **global bucket** to the rate limiter: same settings-backed config,
  key `global` instead of per-IP/user, measured in BYTES not calls — count
  `Buffer.byteLength(serialized)` on each sandbox write against a
  `sandbox.storage.global` window (0.5GB/hr default, admin-tunable via the
  existing rate-limits panel).
- Layer it, don't replace: per-IP stays (fairness), global is the emergency
  brake. **Tradeoff to design around**: a global limit is a griefing vector —
  one attacker exhausting it blocks every legitimate integrator. Mitigations:
  keep the per-IP budget low enough that reaching the global cap needs many
  IPs; alert (not just block) at ~50% burn rate; consider degrading (shrink
  per-token caps under pressure) before hard-blocking.
- Cheaper first step, worth doing regardless: cap total BYTES per sandbox
  namespace (e.g. 512KB/token instead of 50 × 32KB = 1.6MB) — cuts the worst
  case ~3× with zero griefing risk.
- Add an explicit **kill switch**: a settings flag that 503s
  POST /api/v1/oauth/sandbox entirely. NOTE: disabling the `oauth.sandbox`
  rate-limit entry makes minting UNLIMITED, not blocked — the kill switch
  must be its own flag, not the limiter's `enabled: false`.

## 2. Verification gates before storage (mobile within ~1 day)

Current state: registration is anonymous and instantly usable; service
accounts get 7 days of email-verification grace, users ~30 — all of it with
live storage access. That's a free-storage window per throwaway account.

Direction (owner proposal): mobile-number verification required within ~1
day of signup — potentially before ANY storage writes are accepted.

Design notes for the investigation:
- SMS costs money and leaks phone numbers into the db — if adopted, store
  only a hash (uniqueKeys-style, like hashed emails) so numbers are
  dedupe-able but not readable; SMS providers also get abused (SMS-pumping
  fraud), so the verify endpoint needs its own tight rate limit + country
  allowlist.
- **Progressive trust** may get most of the benefit cheaper: unverified
  accounts get a tiny storage allowance (e.g. 1MB / 50 things), email
  verification unlocks the normal quota, phone (or age/payment/passkey)
  unlocks service-account-scale writes. No hard 1-day cliff for legitimate
  slow adopters, but throwaways stay worthless for bulk storage.
- Whatever gate lands, shrink the service-account grace (7d → 1d) first —
  it's the highest-allowance tier behind the weakest gate.

## 3. Other vectors spotted during the PR #150/#151 audit

- **app-data bypasses the per-user storage quota**: things/save charges
  `storageUsedBytes`, but setAppData never does — a real (or unverified!)
  account's app-data is only bounded by 200 keys × 32KB per app, PER APP,
  and anyone can register unlimited apps. Charge app-data bytes against the
  owner's storage allowance like every other thing.
- **Rate limiter fails open**: when ensureIndexes breaks (seen locally with
  dup fixture docs), ALL limits silently no-op (`[rate-limit] enforcement
  unavailable` in logs). Anonymous endpoints (register, waitlist, sandbox
  mint, password-reset) should fail CLOSED instead; at minimum alert loudly.
- **Anonymous registration is uncapped**: /api/v1/auth/register per-IP
  limits + disposable-email-domain blocking + optional CAPTCHA/Turnstile
  when burn rate spikes. Every other gate leans on "accounts are cheap but
  not free" — today they're free.
- **Byte-accounting for every anonymous write path**: waitlist, email
  test-otp, password-reset (mail-bomb), sandbox — same global-budget
  treatment as §1, one shared mechanism.
- **Monitoring is the real fix**: admin dashboard tiles + alerts for
  sessions/things growth rate, sandbox namespace count, storage per
  collection, rate-limit burn rates. Every cap above is guesswork without
  burn-rate visibility.
- **Edge/WAF layer**: Vercel/Cloudflare bot protection in front of the
  anonymous endpoints is cheaper than any of the above and stacks with all
  of it.

## Definition of done

- Global byte-budget mechanism exists (settings-tunable, alerting, layered
  with per-IP), applied to sandbox writes at ~0.5GB/hr default.
- Sandbox kill-switch flag exists and is documented.
- Verification-gate decision made (mobile-within-1-day vs progressive
  trust), implemented for NEW accounts, service grace shrunk.
- app-data charges the owner's storage quota.
- Rate limiter fail-closed on anonymous endpoints.
- TESTING.md rows for each shipped protection.
