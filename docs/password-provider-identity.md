# Thingtime passkey provider identity

Thingtime's provider-model AAGUID is
`0f8e2c35-5e9e-447e-9c4a-c95cb42f4e82`. It is a single random UUID assigned to
Thingtime, shared by all accounts, devices and newly generated keys. It is not a
user identifier, trust decision, attestation certificate, platform endorsement or
Apple identifier. Do not rotate it per account, install or build.

## One source and generated artifacts

`password-provider-identity/identity.json` is canonical. Run
`node scripts/generate-password-provider-identity.mjs` after an intentional
metadata change; `--check` verifies generated Swift, TypeScript, registry entry
and icons. Both native and browser registration encoders append these same
16 bytes. Assertions retain their existing 37-byte authenticator-data format;
saved entries do not gain a field or require migration. New own-vault passkeys default to “Thingtime Passkey · site · account”; existing saved/custom titles are preserved. WebAuthn has no response field that commands an RP to label its account row “Thingtime Passkey”. No keys are deleted,
replaced or rewritten.

`password-provider-identity/registry-entry.json` is a concrete one-entry patch for
[the community registry](https://github.com/passkeydeveloper/passkey-authenticator-aaguids).
Its friendly name is **Thingtime**. Both square, self-contained vector SVGs are
copied from the existing official `remix/public/branding/generated/icon/thingtime-icon.svg`.
The same transparent official colors serve light and dark backgrounds; no raster,
external reference or invented logo is embedded. The entry embeds both as base64
SVG data URIs. This mapping is display metadata, not a FIDO certification claim.

## Acceptance and limitations

[Google's AAGUID guidance](https://web.dev/articles/webauthn-aaguid) describes how
relying parties can identify a provider from registration authenticator data.
They control their own labels, icons, mapping updates and fallback heuristics.
Adding this UUID or a community entry does **not** guarantee Google's adoption.
An existing zero-AAGUID registration cannot be retrofitted by a normal assertion
or by renaming the row. Keep working credentials; do not delete or replace one
just to change its icon.

[Apple's registration API](https://developer.apple.com/documentation/authenticationservices/aspasskeyregistrationcredential)
accepts an attestation object, but a successful core encoder test does not prove
that the OS/browser preserves its AAGUID. An
[unanswered Apple developer forum report](https://developer.apple.com/forums/thread/814547)
describes macOS replacing third-party AAGUIDs with zeros. This is an unresolved
report, not an Apple guarantee. Actual signed-native registration transport and
site readback remain separate acceptance; no OS behavior is bypassed here.

## Focused verification

- `pnpm --dir remix exec tsx --test app/passwords/passwordProviderIdentity.test.ts`
  independently verifies browser registration AAGUIDs, different accounts/keys,
  registry drift, and legacy zero-AAGUID registration plus unchanged assertion.
- Export only synthetic public native ceremony outputs:
  `THINGTIME_PASSKEY_FIXTURE_PATH=/tmp/native-public-ceremony.json swift test --package-path apple/Passwords --filter CoreTests.testWebAuthnInteroperabilityFixture`.
  Then run the browser test with
  `THINGTIME_NATIVE_PASSKEY_FIXTURE=/tmp/native-public-ceremony.json` to exercise
  the native envelope and signature through the independent SimpleWebAuthn verifier.
  The private key never leaves the Swift test.
- Run `ProviderIdentityTests` for native value semantics and saved-entry assertion
  compatibility. These checks do not establish real Google/OS acceptance.

## Registry submission status

The local entry was validated against the upstream JSON schema and checked for
an existing matching UUID. Icons were inspected on light/dark backgrounds. Before
an authorized external submission, revalidate against the current registry and
schema, merge this one-entry object into upstream `aaguid.json`, and attach the
public-ceremony evidence. Follow the upstream README's organization/contact
profile requirements; the parent inspected the public `lopugit` profile company “Thingtime” and
`thingtime.com` website without editing it. Registry maintainers may still ask
for additional representative/contact verification. No external PR, profile change, registry acceptance or Google rollout
has been performed or claimed.
