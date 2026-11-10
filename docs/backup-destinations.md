# Independent portable backup destinations

`api.backup-destinations` 1.0.0 provides authenticated, home-account
`GET /api/v1/backups/destinations`. Both manifests and the Nitro runtime map
register it. `useApi().backups.destinations(scope)` negotiates the exact origin
before reading and binds the response to the selected actor and home plane.
The route exposes only registered opaque IDs, labels and
`configured-unverified` status. It does not admit backup or restore work.
`executionAvailable` is deliberately false until the durable execution contract
and its deployed runner are available. No UI execution control is activated by
this discovery feature.

## Registration and fork-safe setup

Use the current administrator **External integrations** encrypted secret vault
to create one secret with fixed label `portable-backup-destinations`. The bundle
is selected by the existing `THINGTIME_DATA_ENV` deployment identity and exact
browser origin. Missing environment/origin entries refuse instead of borrowing
production, another alias or a local default. Ambiguous duplicate vault labels
also refuse through the canonical vault reader. Do not add provider secrets to
Vercel environment variables, ordinary Things, browser inputs or job records.
No new Vercel bootstrap value is required.

An AWS OIDC registration has this shape (replace placeholders through the
supported administrator vault interface, never in committed configuration):

```json
{
  "schemaVersion": 1,
  "environments": {
    "production": {
      "origins": {
        "https://example.invalid": {
          "destinations": [
            {
              "id": "independent-archive",
              "label": "Independent archive",
              "provider": "aws-s3-oidc",
              "bucket": "YOUR-INDEPENDENT-BACKUP-BUCKET",
              "region": "eu-central-1",
              "expectedBucketOwner": "YOUR-12-DIGIT-AWS-ACCOUNT-ID",
              "roleArn": "arn:aws:iam::YOUR-12-DIGIT-AWS-ACCOUNT-ID:role/YOUR-BACKUP-ROLE",
              "prefix": "portable-backups"
            }
          ]
        }
      }
    }
  }
}
```

The bucket must be separate from primary attachment storage. A different prefix
inside the primary bucket is refused. Configure a dedicated OIDC role with
access to the intended backup bucket namespace; Vercel exchanges its normal
request-scoped identity for this role. Do not create or store long-lived AWS
access keys. The AWS endpoint is derived server-side from the registered region;
request parameters cannot supply an endpoint, role, path or credential.

The provider must support immutable conditional creation and read-after-write,
and its IAM/lifecycle policy must preserve backup objects independently of
primary attachment retention/deletion. This milestone does not provision a
bucket, change IAM, purchase storage, test provider durability or assert those
operational policies. Provisioning and a real independent-byte recovery proof
are required before claiming production backup availability. No supported
non-AWS adapter is selected by this contract.

## Worker boundary

`backupDestinationRegistry.open(id, access, expectedBinding?)` is server-only.
It resolves the fixed-label vault registration, rejects primary-bucket reuse,
and returns the existing portable S3 store. Its private binding pins the current
environment, origin and registration. Current session authorization and the
registration are rechecked before provider operations, including after OIDC
credential resolution. Changed scope, missing registration, role/bucket/prefix
changes and revocation refuse. Raw credentials never enter the binding, public
projection or durable state. The store scopes objects by the canonical
origin/account/data-plane hash. That namespace is application isolation, not a
replacement for IAM.

No long-running backup is run by this HTTP handler. Durable bounded capture,
range verification, certified graph intents, canonical writer steps, the real
catalog/review/control transport and installed UI acceptance remain required.
Prepared UI composition is not a working backup workflow. Whole-account
restoration remains incomplete.

## Verification

Run `node --import tsx --test app/api/utils/backups/backupDestinations.test.ts`
from `remix/`, then `pnpm --dir remix run test:api-capabilities`. Tests cover
exact selection, primary-bucket refusal, identity/plane/origin guards, safe
projections, unavailable configuration, revoked access, registration changes and
both manifest versions. These tests intentionally perform no provider network
operations and do not establish deployed provisioning or durability.

After a canonical Nitro `node_middleware` build, run
`node remix/scripts/smoke-built-backup-destinations.mjs --bundle remix/.output`.
It loads only the compiled middleware in a fresh process with synthetic
configuration and no reachable database, proves both JSON manifests and the docs
route, and exercises the real anonymous 401/private-no-store boundary. This is
built routing evidence, not authenticated provider execution.
