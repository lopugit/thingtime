# S3 restoration

`develop/` captures `thingtime-develop`; `production/` captures `thingtime-prod`.
Both are private, versioned Sydney buckets with SSE-S3, ownership enforcement,
all public access blocked, HTTPS and TLS >= 1.2 required. CORS permits only
checksum-bearing uploads from each environment's allowed browser origins.

Production's lifecycle applies to the entire bucket; development's applies to
`objects/`. Both permanently expire noncurrent versions after 30 days and abort
incomplete multipart uploads after 7 days. Current objects do not expire.
Production enables EventBridge and its Bucket Key flag; the latter has no KMS
cost effect while using SSE-S3. Development EventBridge was not verified.

## Restore an existing or replacement bucket

Use an authenticated CLI profile. Review `environment.json` and every JSON file
first. If restoring under a new globally unique bucket name, change both bucket
ARNs in `bucket-policy.json` and the environment mapping before use. Create an
empty bucket in Sydney if needed, using `LocationConstraint=ap-southeast-2`.
Restore object data and application database version references separately.

From this directory, select the intended environment explicitly:

```bash
export AWS_PROFILE=your-authenticated-profile
aws sts get-caller-identity
TT_S3_ENV=develop
TT_S3_BUCKET=thingtime-develop
TT_S3_REGION=ap-southeast-2
aws s3api head-bucket --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION"
aws s3api put-public-access-block --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION" --public-access-block-configuration "file://$TT_S3_ENV/public-access-block.json"
aws s3api put-bucket-ownership-controls --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION" --ownership-controls "file://$TT_S3_ENV/ownership-controls.json"
aws s3api put-bucket-versioning --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION" --versioning-configuration "file://$TT_S3_ENV/versioning.json"
aws s3api put-bucket-encryption --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION" --server-side-encryption-configuration "file://$TT_S3_ENV/encryption.json"
aws s3api put-bucket-policy --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION" --policy "file://$TT_S3_ENV/bucket-policy.json"
aws s3api put-bucket-cors --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION" --cors-configuration "file://$TT_S3_ENV/cors.json"
aws s3api put-bucket-lifecycle-configuration --bucket "$TT_S3_BUCKET" --region "$TT_S3_REGION" --lifecycle-configuration "file://$TT_S3_ENV/lifecycle.json"
```

For production select `production` and `thingtime-prod`. Its
`notifications.json` can be applied with `put-bucket-notification-configuration
--notification-configuration file://production/notifications.json`; that API
replaces the full notification configuration, so merge any later destinations
before applying. Likewise, compare existing lifecycle and policy rules first:
these APIs replace those configurations and retention deletes old versions.

Read back the corresponding `get-*` operations and compare JSON structurally.
Confirm SSE-C remains blocked in the console (recorded as an observation, not
encoded using an unverified CLI field). Keep account-level public access blocks
enabled. IAM permissions are intentionally not inferred from bucket policies.
Perform an authenticated application upload, preview, download and deletion
smoke test after reconnecting the deployment's private storage settings.

## Media caching and resizing

Cache-Control is object/request metadata, not a bucket-level cache toggle.
The application now sets `private, max-age=0, must-revalidate` on new uploads and
signed downloads; a response override also fixes reads of older objects without
rewriting all existing object versions. Protected redirects and authorization
receipts remain uncached. Same-origin bytes use `private, no-cache` plus ETags:
`no-cache` allows storage but requires revalidation.

The media worker stores bounded binary responses and reauthorizes every managed
read. S3 GET CORS and public bucket access are unnecessary. S3 does not resize
an object merely because a width query is appended. The protected application
content route creates WebP variants with Sharp; no CloudFront distribution,
Lambda, separate image hostname, or resize environment secret is required.
