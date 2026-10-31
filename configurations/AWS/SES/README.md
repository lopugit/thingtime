# SES restoration

`account.json` records the verified Sydney domain and observed account limits.
`domain.json` captures Easy DKIM, custom MAIL FROM and feedback forwarding.
The personal email identity is omitted; the verified domain supports the
application's sender addresses. Provider-generated DKIM DNS tokens and personal
feedback data are not exported.

`develop/application.json` and `production/application.json` are explicitly
labelled **application templates**, not exports of deployed secrets or runtime
environment values. They map the application's source defaults to the verified
Sydney identity. The source falls back to `us-east-1`, so deployments using this
identity should set `AWS_SES_REGION=ap-southeast-2` explicitly.

With an authenticated profile and the intended account selected:

1. Create/verify the `thingtime.com` domain identity in SES Sydney with Easy
   DKIM and RSA 2048-bit signing. On a replacement domain change the identity,
   MAIL FROM subdomain and sender templates together.
2. Publish SES's newly generated DKIM CNAME records in authoritative DNS. Do
   not reuse old tokens blindly. Enable DKIM signing.
3. Set custom MAIL FROM to `mail.thingtime.com`, with MX failure behavior
   `USE_DEFAULT_VALUE`. Publish the SES-provided MX and SPF records and verify
   success; preserve the domain's reviewed DMARC policy rather than guessing it.
4. Enable email feedback forwarding. No SNS feedback topics were configured
   on the verified domain. Its default configuration set is
   `my-first-configuration-set` with the `default` IP pool. Recreate the set
   before assigning it to the identity. Both configured sets have no event
   destinations. Authorization policies, account-level VDM and deployed
   environment bindings were not fully audited in this snapshot;
   inspect them before restoring a production sender.
5. Add the selected template's non-secret settings to the deployment. Provision
   least-privilege sending credentials separately through the approved secret
   store; the application accepts its existing AWS/SES credential environment
   variables. Never put their values in this directory.
6. Request production sending access/quotas in a new account as needed; the
   observed 50,000/day and 14/second are not portable configuration. Verify
   domain, MAIL FROM and DKIM status, then perform an explicitly authorized
   email smoke test and check bounce/complaint handling.

AWS CLI v2 equivalents include `sesv2 create-email-identity`,
`put-email-identity-dkim-signing-attributes`,
`put-email-identity-mail-from-attributes` and
`put-email-identity-feedback-attributes`. The corresponding JSON fields are in
`domain.json`; its provenance keys are documentation, not CLI input fields.

## Configuration sets

`configuration-sets/my-first-configuration-set.json` and `thingtime.json` are
AWS `create-configuration-set --cli-input-json file://...` input documents.
The companion observations file records inherited/unset settings and provenance.
Both enable sending and reputation metrics; neither has event destinations.
The `thingtime` set selects a dedicated IP pool named `thingtime` and optional
TLS. Its pool must already exist; pool allocation and account-level inherited
settings require a separate inventory. The domain defaults to the first set,
while applications can explicitly select the other through their configuration
set environment variable. Existing sets should be compared with
`get-configuration-set`, then updated using the matching `put-configuration-set-*`
operations instead of being deleted and recreated.

References: [AWS configuration sets](https://docs.aws.amazon.com/ses/latest/dg/creating-configuration-sets.html)
and [DKIM signing attributes](https://docs.aws.amazon.com/cli/latest/reference/sesv2/put-email-identity-dkim-signing-attributes.html).
Use `SigningAttributesOrigin=AWS_SES` at the top level when updating Easy DKIM;
the signing-attributes structure supplies `NextSigningKeyLength` only.
