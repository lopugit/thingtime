# Isolated helper integration prerequisite

The production notification remains com.thingtime.passwords.destination-changed and the production URL scheme remains otpauth. Development notification identity derives from the signed host bundle ID; the isolated builder derives a private URL scheme. Explicit expected host/provider/team/signing identity, exclusive private Keychain group, sandbox, no App Groups, current profiles and signed metadata are checked before and after canonical snapshot inclusion.

The separate fixture target is compile-gated, development-only and excluded from the normal host scheme/dependencies. Actual built host has no synthetic seed marker; the separate fixture has it. Host and fixture were installed under their own Thingtime Dev helper directory and installed signatures verified. Stable app/vault were untouched.

Synthetic setup uses canonical PasswordSessionStore.saveIfAbsent (atomic SecItemAdd; duplicate never reads/replaces). Independent real helper proof passed fresh-process exact-session readback, wrong-origin preservation, matching HTTPS-origin retirement and empty-group readback. Real HTTP-loopback retirement was then verified on an EMPTY group. No ProviderSession HTTPS requirement was weakened, no provider server or real account was used.

The proof is serialized for its task-owned private group. Uncertain seed cleanup requires a full-session equality witness; mismatched/unavailable authority is preserved. Normal helper retirement has no atomic compare-and-delete guarantee against arbitrary concurrent external writers, which this proof does not claim.

The initial fixture verifier refused Xcode's valid macOS team-wide provisioning authorization. The corrected fixture-only profile check accepts exact private or exact expected-team wildcard authorization, while actual signed identity/group remain exact and private. AutoFill host/provider profile checks remain exact-only. The correction used no signing fallback.

Validation: 96 focused Electron tests passed; Swift package executed 68 tests, 2 skipped, 0 failures (all four new atomic insertion tests passed). source-freeze.json records all sixteen final owned source hashes; those hashes remained unchanged through actual app acceptance. helper-source-inventory.json records the original copied build inputs; final verifier recovery hashes are in source-freeze.json. Full logs and build products remain outside the repository.

This is a separate signed HTTPS synthetic-authority retirement proof. The subsequent app replacement starts with an empty private native-provider group. Neither establishes restoration of a real account/password vault or production distribution.

Post-proof correction: the developer proof CLI previously skipped its entry point when its file path contained spaces. fileURLToPath now decodes the URL correctly; the new direct-process regression failed before and passed afterward. Six focused identity/protocol/CLI tests pass. Proof body and native binaries are unchanged. Historical exact-run source-freeze/receipts remain unmodified; post-proof-verifier-correction.json records this verifier/test-only delta, also copied to the retained stopped dev workspace. No app/authority proof was repeated.
