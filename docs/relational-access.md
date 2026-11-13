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
reader and resolve older explicit ACL writers. Moving a public alias and
checking the new capability manifest do not stop immutable older deployments
from holding direct database connections.
The migrated root carries a legacy-reader deny-all audience for nonowners;
new readers authorize from its separate finite baseline and relational rows.
Ordinary content edits by old readers preserve that fence. An older writer
explicitly replacing an ACL can overwrite it; new readers fail closed on the
result. Drain or scope such legacy ACL mutations and pre-migration in-flight
writes before first production migration, while preserving unrelated running
tasks and connections.
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
