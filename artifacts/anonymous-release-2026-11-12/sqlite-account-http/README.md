# Protected SQLite account API checkpoint

Local development evidence on 12 November 2026. Base commit
`5847cacbd13d04f73a2cd71e5d19032d9288b506` plus the recorded source inventories.
This is not a clean-commit CI build, installed Thingtime UI acceptance or a
production deployment.

## Actual compiled execution

The canonical build and packaged-output verification pass. Compiled Nitro SHA-256:
`c6fb3c4cc80fb7021f3a7056e5972459334090e7174a6deebd9e707e0adecfa2`.

- Local MongoDB: normal HTTP registration, private Thing CRUD/revisions,
  independent-account and anonymous refusal, and API/Mongo restart persistence
  pass. This fixture uses synthetic profile encryption; the earlier managed-local
  app replacement receipt separately proves real safeStorage on its older source.
- SQLite: actual Electron safeStorage and an encrypted disposable profile,
  compiled HTTP registration, current user, roster, logout/login and a fresh
  Electron/API process retaining the same profile/account/session pass. Both
  manifest formats advertise supported operations and refuse unsupported Things,
  passwords/root-data and foreign origins. Socket and protected-runtime closure,
  listener release and temporary-profile cleanup are separately observed.
- Email is encrypted and queued with `delivered:false`. No external delivery
  worker or provider delivery is claimed. Verification and notification route
  acceptance here uses the canonical handlers against real SQLite; the native
  HTTP fixture does not claim an actual email-link delivery journey.

[Compiled build and Mongo receipt](compiled-build/verification.json) ·
[Successful SQLite HTTP receipt](../sqlite-native-home-bootstrap/actual-manifest-shape-fix.json) ·
[SQLite run output](../sqlite-native-home-bootstrap/actual-manifest-shape-fix.log).

The combined build receipt intentionally remains `status: failed` because its
first SQLite harness attempt failed. The successful separate receipt above
supersedes that attempt on the same compiled payload; it does not rewrite history.

The first combined typecheck found manifest union-type errors. The corrected
typecheck and ratchet pass with zero diagnostics. A subsequent build discovered
a test in Nitro's automatically scanned plugin directory; the test was moved
and a regression prevents recurrence. Native fixture retries corrected two
test-only assumptions: Electron's main entry guard and the distinct manifest
formats. Failed attempts are preserved; successful execution uses the unchanged
compiled payload above and the separately hashed corrected harness.

## Checks and scope

- Document-store suite: 132 passed, no skips. Includes real file reopen,
  verification completion recovery, concurrent limits, outbox security and the
  canonical account-handler path.
- Auth introspection: 10 passed. Notifications: 55 + 14 passed.
- Capabilities: 211 passed; affected gateway regressions: 9 passed.
- Full TypeScript and zero-error ratchet pass. Full lint: 0 errors, 374 warnings.
- [Focused receipts](focused/) preserve each worker's commands, exact source
  hashes and limitations. Passing unaffected checks were reused after the
  manifest type correction and test relocation; no extra pass is inferred.
- The plan's isolated Chromium check is separate documentation UI evidence.

## Remaining acceptance

Generic Things/root-data and full SQLite product parity, native email transport,
iOS protected-key/account API integration and physical device acceptance,
installed application UI, production release trust and current hosted MCP
artifact delivery remain open. SQLite selection is currently host-only opt-in, with no user-facing provider
selector. There is no automatic provider migration,
dual write, Mongo/remote fallback or account publication. PR #1000 remains open.

## Documentation index

The scoped semantic refresh expanded to 202 slices across the large changed
manuals and screenshots. It was stopped after the initial four slices to bound
indexing cost; no partial semantic snapshot was accepted. The repository wrapper
then refreshed structural output. Full semantic coverage remains incomplete.
