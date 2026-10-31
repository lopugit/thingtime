# AWS

Verified through the authenticated Thingtime AWS console on 2026-09-05.
S3 and the verified SES domain are in `ap-southeast-2` (Sydney). CloudFront's
console showed no distributions. AWS CLI authentication was unavailable during
capture; the console observations were transcribed into reviewable JSON rather
than exporting credentials or account data. No AWS resources were changed.

- [S3](S3/README.md): separate development and production bucket policies,
  upload CORS, encryption, ownership, versioning and retention.
- [SES](SES/README.md): verified domain customizations and separate application
  environment templates. No test email is sent by the restore instructions.

This is a scoped baseline, not a full AWS account backup. IAM, DNS records,
CloudTrail and any unlisted services must be inventoried separately. Recreated
resources can receive new provider-generated identifiers and DNS verification
records. Validate ownership and region with `aws sts get-caller-identity` and
the service console before applying any configuration.
