# PR 1520: ACL validator diagnostics and group membership batches

This PR combines the reviewed ACL validator diagnostic change from PR 1520 with the accepted group membership batch work from PR 1521. Product `main` is the release branch. PR 1521 is consolidated into this PR so the combined source has one protected CI and production release.

## Behavior

- Preserve only bounded numeric MongoDB codes and closed driver labels for failed relational ACL validator provisioning. Raw database messages, commands, causes, and arbitrary names remain discarded. The admin migration run capability advances to `1.6.1`; the validator and its privileges are unchanged.
- Add incremental group membership add/remove operations, client batching, exact group reads, and storage accounting for large membership sets. `api.groups` advances to `1.2.0`. Existing group rows require the canonical `backfill-user-storage-accounting` migration before production group writes are considered ready.
- Preserve the main branch's environment gateway `1.2.3` drain and connection changes, including its accepted protected-origin behavior.

## Verification on the combined tree

Combined source commit before graph output: `450961915ef80dc592e5c20db3b53528067db5b4` (main `6c5e228625bbbd0ff228febaa97bed6b0d777c05` plus both feature branches). Raw TypeScript, capability coverage (203), environment gateway tests (29), focused relational ACL tests (49), collection tests (8), and group client batching tests passed.

One client/template/Node server build was used for both real HTTP checks on a disposable APFS replica. Group create, add, exact read, remove, and delete produced the expected authoritative storage charges and exact refund. ACL provisioning HTTP checks passed anonymous/non-admin refusal, repeated read-only dry runs, provision/readback/idempotence, wrong-plane refusal, and grant/read/revoke. Authenticated MongoDB DDL checks passed canonical strict/error installation, nested constraint preservation, old-rule upgrade, and permission denial. The earlier full 2,500-member, legacy backfill, accounting, and desktop/mobile browser acceptance on PR 1521 remains valid for its unchanged behavior; the combined tree received the representative real HTTP check above.

Evidence is retained outside the repository under `/Volumes/Eightt/ThingtimeTaskBuilds/group-membership-batches/combined-450961915e/` and `/Volumes/Eightt/ThingtimeTaskBuilds/acl-validator-provisioning/combined-450961915e/`.

## Production readiness

The prior production validator migration attempt failed with the sanitized `modify/unknown` category. Deploying this PR exposes a safer, bounded diagnostic for the next authorized administrator operation; it does not itself provision the production database. Inspect the exact deployed capability and readiness before the administrator reruns the migration. The group accounting backfill is a separate production prerequisite for existing groups. Production migration, data backfill, and original private reporting recovery remain unclaimed until actual readback.

Graphify's structural snapshot is refreshed with this combined source and note. Earlier broad Markdown semantic extraction exceeded the bounded local run, so this note and changed Markdown are not claimed as newly semantically indexed.
