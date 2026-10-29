# Automatic iOS TestFlight releases

Native changes under `iOS/`, shared Apple widgets/passwords, and the TestFlight
workflow trigger a release after a push to `main`. Web-only changes do not
rebuild the native shell. Manual `upload` and read-only `status` remain available.
All operations require the workflow on `main` and serialize through one release
concurrency group. Only trusted main code runs with release access.

The workflow runs native tests before loading Apple credentials, reads App Store
Connect's build history to allocate a larger integer, stamps the disposable
runner's XcodeGen `project.yml`, and builds phone, Watch and widget with matching
versions, including the embedded Share extension. Nothing commits a build-number change back to the repository. Before
upload it verifies the archive and IPA, executable presence, identifiers,
signatures and shared App Group entitlements. It then waits up to ten minutes for
that exact build to reach `VALID` and `IN_BETA_TESTING`. A timeout means inspect
Apple processing before rerunning; it does not mean the upload failed.

Internal tester groups must have automatic build distribution enabled in App Store
Connect. External testers may still need Apple's Beta App Review. Real-device
widget placement and microphone acceptance remain separate checks.

The Share target uses `<iPhone bundle ID>.share` and the containing app's existing
`THINGTIME_WIDGET_GROUP`. The release lane registers its App ID/capability and
syncs a separate distribution profile. Associate that App ID with the existing
App Group through Xcode automatic signing or Apple Developer before the first
signed release; enabling the capability alone does not prove that association.
The profile check fails before archive if the signed group is missing. Archive
and IPA verification also require the embedded extension, production activation
rule, matching versions, signing identity and shared group. Never substitute the
widget's profile or omit the extension to make a release pass.

## Existing GitHub secrets and vault migration

The default credential source is `github`, preserving the existing working
release credentials. The repository variable `THINGTIME_IOS_CREDENTIAL_SOURCE`
can be `github` or `vault`. Vault mode has no fallback. Keep the old secrets
until a real vault-backed upload and tester-availability check succeeds, then
remove the retired copies as a separate deliberate step.

No Apple private key needs to pass through an assistant or be pasted into a chat.
The manual `migrate-secrets` operation copies existing GitHub secrets directly to
the encrypted **Admin → System → Thingtime Secure Vault → Integration secrets**
store. It never overwrites an existing credential bundle, and its response contains
only success metadata. The follow-up fetch verifies the stored bundle without
printing it or writing it to the job environment for a migration-only run.

1. Deploy the new API and confirm the production origin's
   `/.well-known/thingtime-capabilities.json` advertises
   `api.integration-ios-release` **1.0.0**. Publish the new workflow on `main`.
2. Using the existing admin secret form, create an integration secret labelled
   **`iOS TestFlight policy`**. Its JSON value contains only public identity and
   enablement settings, for example:

   ```json
   {
     "repository": "your-owner/your-repository",
     "repositoryId": "123456789",
     "ownerId": "987654321",
     "enabled": true,
     "allowMigration": true
   }
   ```

   Read the real immutable IDs with
   `gh api repos/OWNER/REPO --jq '{repository:.full_name,repositoryId:(.id|tostring),ownerId:(.owner.id|tostring)}'`.
   Values belong to this deployment's own home vault. No additional Vercel
   variables are needed: the existing database/vault key unlock the store,
   and Vercel's built-in `VERCEL_ENV` fences production from preview.
3. Ensure GitHub contains `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_CONTENT`
   (single-line base64 `.p8`), `IOS_DISTRIBUTION_CERTIFICATE_ID`,
   `IOS_DISTRIBUTION_CERT_P12` (single-line base64) and
   `IOS_DISTRIBUTION_CERT_P12_PASSWORD`. Use an issuer-backed App Store Connect
   API key supported by the existing Xcode upload lane. Non-secret repository
   variables `THINGTIME_APPLE_TEAM_ID` and `THINGTIME_IOS_BUNDLE_ID` override the
   existing Thingtime identity for forks. Set `THINGTIME_RELEASE_ORIGIN` to your
   HTTPS production origin; the default is Thingtime's production origin.
4. Run **iOS TestFlight → Run workflow → main → migrate-secrets**. This creates
   the encrypted **`iOS TestFlight credentials`** integration secret. Ordinary
   lists remain metadata-only; manual reveals still require fresh verification.
5. Delete and recreate the policy entry with `allowMigration: false`, set the GitHub repository variable
   `THINGTIME_IOS_CREDENTIAL_SOURCE=vault`, then run `upload` on `main`.
6. Verify the exact run/build and actual internal tester availability. Install the
   new build on an iPhone and check both widget pickers. Native pushes now use the
   vault automatically. Remove old GitHub copies only after this verification.

The credential JSON contains exactly the six secret names above plus
`DEVELOPMENT_TEAM`, `PRODUCT_BUNDLE_IDENTIFIER`, and `WATCH_BUNDLE_IDENTIFIER`
(the phone ID followed by `.watchkitapp`). To rotate it, pause release runs, delete the old entry, then save its replacement
with the same label using the existing admin form. Delivery fails closed during
that gap; a workflow cannot overwrite it. To disable delivery,
delete the policy or credential bundle (or recreate the policy with `enabled: false`). No decrypted
bundle is cached across requests. Signing material is deleted from the runner
at the end, and no signing identity archive is published as a workflow artifact.

Apple's portal must enable the widget App Group on the phone and extension IDs,
and their distribution profiles must include it. A missing entitlement stops the
release. Forks must also update `iOS/config/Base.xcconfig`'s public App Group.
Do not disable signature checks to bypass a provisioning failure.

## Trust and verification

`POST /api/v1/integrations/ios-release` accepts GitHub OIDC, not a Thingtime
session, personal token or general CI HMAC. The server verifies RS256 against
GitHub's fixed JWKS endpoint, issuer, audience `thingtime:ios-testflight`, expiry,
five-minute maximum age, repository and owner IDs, exact `ios-testflight.yml`
workflow on `main`, matching workflow/source SHA, github-hosted runner and
push/manual event. Each signed token is consumed once through the existing
unique claims store. An explicit policy additionally gates migrations, which
only accept manual dispatch. Delivery is production-only, private/no-store and
never proxied to another origin. Audit rows contain run/source metadata only.

Validation commands:

```sh
corepack pnpm --dir remix run test:ios-release
python3 iOS/scripts/test_verify_release.py
ruby iOS/fastlane/lib/release_version_test.rb
```

Tests cover real JWT signatures, wrong identities/branches/events/audiences,
expiry/replay, missing policy, preview denial, size limits, error redaction,
missing widget executables, wrong build numbers and mismatched App Groups.
A passing synthetic suite does not prove Apple provisioning or a TestFlight upload.
