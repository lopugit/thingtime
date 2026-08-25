# PR #326 — Reopen the data-crystal namespace

## Dependency boundary

This is phase 2 of the relationship uniqueness migration. It must not deploy
until #325 has deployed everywhere that can write Things, boot-time index
convergence has removed every old kind-blind unique index, and the home
database backfill has converged without unresolved duplicate slots.

## Final architecture

- ordinary `data` crystals reserve no root names;
- relationship writers stamp deterministic protected-root `uniqueKeys`;
- the sparse unique `uniqueKeys` index owns race-safe dedupe;
- `crystal.followKey`, `friendKey`, `memberKey`, `dmKey`, `inviteCode`,
  `emojiKey`, and `voteKey` indexes are non-unique lookups only;
- the obsolete `things_follow_unique` marker index remains removed;
- migration census notes never rewrite free-form data and acknowledge that
  relationship-shaped names are intentional ordinary data after phase 2.

## Required release proof

- exact index-name/key/unique census on every writable deployment database;
- idempotent zero-pending relationship backfill on the home database;
- an ordinary data Thing with the exact `followKey` of a real relationship
  saves beside that relationship, neither blocking the other;
- representative member/DM/invite/emoji/vote names have the same coexistence;
- generic Things APIs still cannot supply or mutate protected `uniqueKeys`.
