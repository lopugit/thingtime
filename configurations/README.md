# Service configurations

Versioned, non-secret customizations for restoring Thingtime's dependencies.
Organize additions as `<platform>/<service>/<environment>/`; shared settings can
live at the service level. Start with [AWS](AWS/README.md).

Each inventory identifies its source, verification date, and unknowns. A live
snapshot is distinct from an application template: never treat an unverified
value as deployed state. Review changes in Git before restoring. Recheck drift
in the provider console after deployment and update these files together.

Never add credentials, tokens, private keys, signed URLs, account exports,
customer records, email suppression lists, or copied `.env` files. Credentials
belong in the deployment secret store or an authenticated AWS CLI profile.
Bucket names, public domains, regions and policy settings are non-secret.
These files restore configuration, not object data, databases, DNS ownership,
identity verification, service quotas, or secrets.
