# Relational access entries

Growing authorization collections are relations. They do not belong in an
ever-growing array on a Thing, user or session. Processing page sizes limit
work per query; they are not limits on saved grants or memberships.

## Why private reporting reached 64

The original ACL implementation stored all entries in a Thing's `acl` array.
Its validator initially allowed 16 entries; custom audiences raised that to
64 on 27 August 2026 to keep the document bounded. Private agent reporting
later appended a separate task Character grant to each shared saved workspace
reference. The owner and custom-audience markers consumed two entries, so
62 distinct grants filled the array. The next preparation failed even though
the owning account had the correct reporting permission.

Raising that number would retain the growing-document problem. Concurrent
read/append/write preparation could also lose a different task's grant.

## ACL storage and authorization

`things/relationalAcl.ts` retains the finite audience vocabulary on the root.
Individual subject grants and exclusions are protected `acl-entry` Things
linked to their target, owner and immutable ACL generation. They cannot be
created, altered or disclosed through generic Things CRUD. Authorization
queries matching subjects through the existing unique identity index; it
does not load the complete audience to decide whether one viewer has access.
List candidates join current grants before pagination, then apply the normal
exact evaluator, exclusion precedence and other permission boundaries.

Full replacements atomically change the root generation and its child rows.
Incremental grant/revoke changes preserve unrelated entries. The public ACL
revision changes after every mutation, independently of the storage generation,
so paged reads and optional optimistic concurrency checks detect intervening
changes. Reporting retains exact generation intents and refuses explicitly
revoked grants when resuming an incomplete preparation. Concurrent preparation
can change a workspace reference between its root and grant reads; bounded
read-only retries distinguish that transient snapshot conflict from an actual
revocation. Stable denial remains denied, and retries never replay a grant or
saved Action write.

Legacy inline ACLs remain readable and migrate through the canonical writer.
Existing full-ACL response fields remain complete for old clients. That
compatibility projection may enumerate entries during serialization; it is
separate from the selective authorization query. Timeline, copies and backups
materialize the complete audience within their existing transaction/snapshot
boundary. Raw relational roots must not be mistaken for complete snapshots.

## Paged management contract

Negotiate `api.things-acl` 1.0.0 at the selected origin.

- `GET /api/v1/things/acl?id=…&family=audience&cursor=…&limit=…` returns `entries`,
  `nextCursor` and `revision`. Follow every cursor needed for an edit; a
  conflicting revision requires a fresh read.
- `POST /api/v1/things/acl` accepts `id`, `operation` (`add` or `remove`),
  `entries`, optional `family` (`audience` or `token`), and optional
  `expectedAclRevision`. It changes only those entries in the selected family.
  Applications may submit successive batches without any total grant cap.
- The owner must have the appropriate `things.read` or `things.update`
  permission. Personal-token audience/creation fences remain in force;
  app tokens cannot administer an account Thing's ACL. Responses are private
  and non-cacheable. No raw protected child record is returned.

Ordinary content edits omit ACL fields when not changing access. A deliberate
whole-audience replacement can include `expectedAclRevision`. The client's
`readCompleteThingAcl` helper refuses mixed revisions, repeating cursors and
cancelled loads before an editor can submit a partial replacement.

Token-specific sharing uses the same protected ACL entry storage with a separate
family, generation, revision and count. Token grants never become audience
grants. Exact sandbox authorization queries only that token's entry and fences
revocation against the current root; owner-facing compatibility reads stay
complete. Snapshots, transfers and copies keep their existing token-grant
stripping policy. The owner ACL API manages both families without exposing
secret token values or allowing app credentials to administer grants. Token
entries use `tt:token/<id>` subjects. Whole-token-ACL replacement accepts
`expectedTokenAclRevision` (or its compatible `tokenAclRevision` alias); the
audience and token revisions are independent.

## Other growing authorization collections

Groups already store members as relational Things. Group/member admission
ceilings and the truncated group-membership read are removed; validation,
writes and profile projection operate in batches. Social follow/friend edges, reactions
and subspace memberships likewise remain relational without count ceilings.
Subspace role reads preserve late memberships and bans, while authoritative
write gates still recheck the exact current membership.

App access to selected Things uses protected session-linked grants rather
than `session.meta.sharedThings`. A version marker distinguishes authoritative
relational state (including an empty set) from unmigrated inline sessions.
Issuance is transactional, exact-item checks reauthorize current ownership,
and shared-Thing lists are cursor-paged. Session revocation and expiry still
control access. This is independent from account-wide app Things permissions.

## Growing settings and definitions

Saved database endpoints, linked deployments and each ordered link path rule
are separate protected `account-config-entry` Things on the home database.
Values use the existing owner- and record-bound AES-256-GCM vault cipher.
The old `secure` BinData wrapper was JSON encoding, not encryption; migration
removes those legacy arrays only when encrypted child writes and the
account marker commit together. The authoritative marker also represents an
empty collection, so deleted entries cannot return from an old array.
Exact endpoint/link selection reads only the selected record. Legacy reads
remain available if migration cannot commit; new writes require the existing
vault key and never downgrade to plaintext. Duplicate URL checks, origin and
SSRF checks, remote authentication and rate controls are preserved.

Subspace rules, post flairs, user flairs and removal reasons are ordered
`subspace-definition` child Things. A generation selects the current set;
updates preserve omitted families and account for their bytes transactionally.
Ownership transfer and deletion include the child rows. Existing clients still
receive complete arrays. Custom flair choices and owned subspaces no longer
have arbitrary count ceilings. Pinned posts remain relational; a cursor pages
all pins before ordinary posts rather than silently truncating after five.

Registered web origins and native callback URLs are protected app-linked
allowlist records. Exact matching and wildcard semantics remain unchanged;
ordinary authorization uses indexed relevant candidates. Owner-facing lists
remain complete. Revoking a co-manager conflicts with an in-flight allowlist
mutation through the same home transaction.

Learned algorithm weights are billable `feed-algorithm-weight` children with
per-bucket counts and an authoritative generation. Create, training, metadata
migration and deletion share their root's storage transaction. Ranking, decay
and numeric signal semantics remain unchanged. There is no total algorithm
or imported-weight count cap. Legacy `feedAlgorithms` collection rows retain
the existing administrative migration prerequisite before accounted Thing-era
updates; no new legacy collection data is introduced. Canonical algorithm
transfer supports complete private export/import and consented branch copies;
ordinary account backups still do not support this protected family.

Messenger community invitations already use relational records. Their total
retained-invite and full-list truncation limits are removed; administrator
checks, expiry, exact revocation and issuance rate controls remain in effect.

Owner ACL-management changes record Timeline snapshots. Agent reporting's
bounded workspace-grant maintenance deliberately uses the control-write path
without creating a full audience snapshot for every task preparation.

## Authored schema and Component declarations

Saved schemas no longer stop at 80 fields, including nested definitions.
Components no longer stop at 16 argument descriptors or 24 saved arguments.
These are authored portable definitions and retain their existing document
representation; the admission and editor count ceilings are removed.
Author-selected array constraints can exceed 1,000 while remaining exact safe
nonnegative integers. Explicit constraints and existing depth, prototype and
identifier validation remain in force. This change does not add blanket new
server validation of every schema-annotated Data write; the existing authoring
validator and provenance behavior remain compatible.

No claim is made that database/protocol size limits disappear or that every
Thingtime feature has been exhaustively audited. The growing collections and
arbitrary count ceilings addressed by this change are listed here explicitly.

## Verification and rollout

Run the focused ACL, group, social, membership, reporting, backup/Timeline and
capability suites. Real acceptance must exercise the built handlers against a
disposable replica set, including more than 64 concurrent reporting Characters,
old/new ACL reads, grant/revoke races, exclusions, private attachment access,
pagination, wrong-owner refusal and unchanged unrelated grants.

`agent-reporting-acceptance.mjs --scoped-reconnect --acl-scale` exercises the
actual API/OAuth/MCP path with synthetic workspace Things. It is separate from
production acceptance. After deployment, resume the same previously failed
external task identity, verify its existing Character, write a saved lifecycle
Action, and independently read that record back. Never create a replacement
task to conceal an incomplete preparation or bypass a revoked grant.

Before production ACL writes, verify the compatibility fence against an older
runtime and verify the selected database principal can install and read back
the collection validator. Moving a public alias and checking the new capability
manifest do not stop immutable older deployments from holding direct database
connections.
The migrated root carries a legacy-reader deny-all audience for nonowners;
new readers authorize from its separate finite baseline and relational rows.
`mongodb/aclWriteFence.ts` installs a strict, error-enforcing MongoDB validator
before the first relational write. It preserves existing validators in a
conjunction and independently verifies the installed rule. A migrated root
must retain its exact legacy audience fence and empty inline token grants.
Old explicit ACL writes and stale sandbox writes that violate it are rejected
by MongoDB, even when they come from another deployment.
An exact earlier platform-owned strict-floor expression is replaced during
provisioning so it cannot defeat the legacy-format upgrade. This recognition
is structural and limited to that known expression; unrelated or modified
constraints remain enforced, including inside existing conjunctions.

Migration advances `updatedAt` strictly beyond the captured version and saves
a protected `aclWriteFenceAfter` floor. The validator prevents an older writer
from restoring that captured timestamp and reopening an old full-document
conversion's compare-and-swap. Canonical Things operator updates preserve
monotonic operational timestamps; user-authored crystal dates are unchanged.
The floor is omitted from public content, backups, copies and Timeline content.
Ordinary old content edits that preserve the fence and timestamp floor remain
valid. A legacy client receiving a storage refusal must use the current server
to change its ACL; never retry by weakening the validator.

Earlier relational preview builds wrote generations and the exact negative
fence without a timestamp floor. That explicit legacy form remains writable:
only an absent floor is accepted, never a null or malformed floor, and the full
audience/token fence is still enforced. A current ordinary content edit or ACL
mutation upgrades the root atomically with a strictly advanced timestamp and
floor. Dedicated touches can retain the legacy form until that upgrade, so no
collection scan, background backfill or extra per-write query is needed. Legacy
roots do not have the timestamp floor guarantee until upgraded; the old runtime
replacement restrictions below remain part of the compatibility proof.

The validator does not compare a replacement document with its previous value.
The audited older runtime's three full-document replacement paths operate only
on protected kinds, which ACL management cannot migrate. Keep that boundary:
any future replacement of an ACL-manageable root must retain its authorization
generation, baseline and floor through the canonical write path. A new general
replacement writer requires another compatibility review.

Administrators can inspect and provision through the registered
`provision-relational-acl-validator` migration in `/migrations` (status capability
1.5.0; run capability 1.6.0). Dry run uses a separate uncached metadata read
without adoption, indexes, collection creation or validator changes. Real runs
use the canonical installer and its independent strict/error readback under the
existing migration lease. No business documents, grants or privileges change.
Custom-plane requests are refused before acquiring a lease. A failed real run
may have installed protection before verification failed; inspect with Dry run
before retrying. Closed stage/category diagnostics distinguish connection,
adoption, inspection, creation, modification and verification without exposing
raw database messages or command bodies. Unverifiable protection remains pending in the census so the recovery UI stays accessible. Existing DB authority is still needed;
this API does not expand it.

Provisioning needs `listCollections` and `collMod` on the selected home or data
plane, plus `createCollection` only if the physical Things collection does not
yet exist. Do not assume a generic read/write role includes these actions.
Missing privileges or an unverifiable validator produce a sanitized 503 before
ACL migration; there is no unguarded inline fallback. Provision outside content
transactions. A caller composing an ACL write inside an outer transaction must
use `withMongoTransaction(..., { requiresAclWriteFence: true })` (or the home
variant); nested writes verify readiness without running DDL in the transaction.
Fork setup is documented in the README's MongoDB section.
The compatibility promise for complete ACL responses applies to old clients
calling the new server. Older server deployments deliberately lose nonowner
access to migrated public/custom Things; an owner-scoped personal token on an
older server can be less precise about public/private classification for that
owner's already-public content. Use the current server for exact visibility
semantics. The fence does not grant a new private audience.
Ordinary PR previews currently advertise the development data authority;
verify the exact preview's identity before using synthetic data and do not
infer physical database isolation from the public identity alone. Preserve
existing deployments and in-flight work while assessing this boundary; do not
delete older deployments as a blanket rollout shortcut.

The integrated isolated acceptance command is:

```sh
node scripts/agent-reporting-acceptance.mjs --scoped-reconnect --acl-scale \
  --config-scale --relational-collections --algorithm-scale --token-reaction-scale
```

It requires a built server/client, MongoDB replica-set binary and an explicitly
selected isolated Playwright module/Chrome executable. Retain its evidence
outside the source tree. The deployment-link test uses a synthetic local remote
fixture, not a real external account; it honors normal issuance rate windows.

For the old/new write regression, prepare a separate fixture with
`node scripts/prepare-legacy-acl-fixture.mjs <external-new-directory>` from
`remix/`, then run the printed legacy build command. The helper archives the
audited old revision, verifies the dependency lock, copies no environment files
and records the timing-only instrumentation hashes. Set
`AGENT_REPORTING_LEGACY_SERVER` to that fixture's built server and run the current
`agent-reporting-acceptance.mjs --scoped-reconnect --mixed-legacy-acl` harness.
It starts both servers against one disposable replica with generated test auth,
uses HTTP for all business writes and reads physical metadata only to verify
the fence. `node --import tsx scripts/relational-acl-validator-acceptance.mts`
separately verifies real authenticated `collMod`/`listCollections` refusals,
idempotent provisioning and existing-validator preservation in an empty DDL
fixture. Both commands require an external `AGENT_REPORTING_EVIDENCE_DIR` and
remove their disposable database state at completion.
