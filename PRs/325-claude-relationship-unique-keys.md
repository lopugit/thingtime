# PR #325 — Structural relationship uniqueness

## Included security substrate

- relationship writers stamp deterministic protected-root `uniqueKeys` for
  follow, friend, member, DM, invite, emoji, and vote families;
- the sparse unique `uniqueKeys` index remains the race-safe invariant;
- every old kind-blind crystal-path unique index becomes a non-unique lookup;
- the obsolete `things_follow_unique` marker generation is removed;
- the idempotent migration stamps legacy relationship rows and reports, but
  never rewrites or deletes, free-form data carrying relationship names.

Vote support here is migration/security substrate only. Poll product surfaces
remain explicitly deferred.

## Release sequence

1. Deploy #320's temporary root-name reservation.
2. Deploy this phase on every environment/database that can write Things.
3. Let boot-time index ensure converge and verify exact index names/options.
4. Dry-run and execute `backfill-relationship-unique-keys` on the home DB.
5. Repeat the backfill to zero pending and review every duplicate/census note.
6. Only then may #326 reopen the free-form crystal namespace.

## Required proof

- all seven legacy unique indexes and `things_follow_unique` are absent;
- all seven non-unique lookup indexes and root `uniqueKeys_1` are present;
- legacy relationship docs are stamped, rerun is idempotent, and duplicate
  slots remain untouched for operator review;
- fresh duplicate relationship races still produce E11000 on `uniqueKeys`;
- generic Things APIs cannot forge or mutate protected `uniqueKeys`.
