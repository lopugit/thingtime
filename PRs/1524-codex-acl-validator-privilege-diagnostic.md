# PR 1524 — ACL validator Dry-run authority

## Context
Production validator provisioning returned a closed `modify/unknown` Atlas error code 8000. This change adds a read-only authority signal to the existing home-only admin Dry run so an administrator can distinguish an effective `collMod` grant from a confidently absent one without an Atlas console login. It does not classify the earlier error or attempt provisioning.

## Contract
`api.admin-migrations-run` 1.7.0 adds optional `report.collModAuthority` for the `provision-relational-acl-validator` Dry run only: `granted`, `absent`, or `unknown`. The command runs on the same home Mongo client/database as validator inspection. It validates the complete `connectionStatus(showPrivileges)` response, including an authenticated principal and all privilege entries, before reporting `absent`. Only documented collection/database scopes, `anyResource`, and the `collMod`/`anyAction` actions can grant. Unknown covers unauthenticated, denied, malformed, incomplete, and unfamiliar responses. No principal, role, action list, resource, command body, raw driver error, or cause is returned or retained.

Installed validator readiness and the normal provisioning refusal remain unchanged. A ready validator remains ready even if current authority is absent. `granted` does not prove a future Atlas `collMod` succeeds; Atlas can still reject command policy or syntax. The Dry run does no DDL or business write.

## Verification
- `corepack pnpm --dir remix run typecheck`: pass.
- `corepack pnpm --dir remix run test:api-capabilities`: 203 pass.
- Focused authority and migration tests: 9 pass, including incomplete response, documented wildcards, and ready-without-authority cases.
- Targeted lint: 0 errors, existing warnings only.
- Authenticated disposable Mongo lifecycle fixture: root granted, read-only principal absent, no principal unknown; validator lifecycle/refusal checks pass.
- Built Node handler `agent-reporting-acceptance.mjs --acl-provisioning`: 6 checks pass, including repeated read-only admin Dry run, no DDL, ready readback, custom-plane refusal, grant/revoke.

## Production follow-up
After exact-source deployment, the production administrator should run this migration's Dry run in the existing Migrations UI and record only the closed authority and readiness values. Any real provisioning remains a separate action. The original reporting task remains held until protection is verified ready and the normal private grant write succeeds.
