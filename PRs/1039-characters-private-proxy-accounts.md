# PR 1039 — Private Characters

Characters are independent public identities controlled privately by an owner.
The owner can create switch-only, inherited-password or separate-password
accounts, choose a default session identity, or choose an author per composer.
Separate-password Characters support agent login without sharing the owner password.

## Boundaries

Ownership is stored in the existing secure user envelope and protected relational
account links, never in public profile/post fields. Admin lookup is explicit and
admin-gated. Direct Character sessions cannot manage or switch to siblings/owners.
The current owner tier is inherited; content, usage and private memberships remain
independent. Disabling revokes credentials and clears owner session defaults.

See [the contract and agent workflow](../docs/characters.md).

## Verification

- Character/auth, capability, attachments, feed, drafts, settings, account-hints,
  PAT scopes, storage, subspaces and hooks tests pass. Editor suite: 98 passed,
  one existing skipped test. Full typecheck has unrelated baseline failures.
- Disposable Mongo replica set and real built Nitro routes: three login modes,
  owner isolation, public projection privacy, no admin inheritance, session
  selection/override, tier and quota changes, exact ledgers, private membership
  denial/admission, admin ownership inspection and revoked sessions.
- Chrome for Testing, desktop and 390px: real Settings create and session
  switching, feed post, comment/reply with different authors, private subspace
  posting. Saved API values independently confirm rendered authors/content.
- macOS network sandbox denies external direct-IP requests and redirects for
  browser/backend; generated credentials and fresh database/profile only.
- Browser acceptance found early editor input could occur before change
  listeners attached. Initialization now captures that input before settling.

Production acceptance and final deployment evidence will be recorded after merge.
