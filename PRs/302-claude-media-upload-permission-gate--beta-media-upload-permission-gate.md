# PR #302 — Beta media-upload permission gate + admin approval flow

- **PR**: https://github.com/lopugit/thingtime/pull/302

- **Branch**: `claude/media-upload-permission-gate` (cut from `origin/main` so the diff is clean for a hotfix merge into `main`)
- **Base**: `develop`
- **Why**: media/file attachments are now public content; during the beta every new account must be manually approved by an admin before it can upload anything, so spam raids can't publish media.

## Shape of the change

| Layer | What |
|---|---|
| User model (`api/utils/auth/users.ts`, `mediaUpload.ts`) | New per-user grant flag mirroring the `admin` flag exactly: root boolean `secureMediaUpload` on user things (queryable, outside the secure blob), `meta.mediaUpload` on legacy docs, reconstructed into `meta` by `userThingToDoc`. Pure predicate `canUploadMediaDoc` = `meta.mediaUpload === true OR isAdminDoc`. `PublicUser.canUploadMedia` stamped by `toPublicUser` (self-view only — never on `PublicProfile`). `setUserMediaUpload` mirrors `setUserAdmin`'s dual-store write. `AdminUserRow.mediaUpload` for the admin directory. |
| Upload gate (`api/utils/attachments/attachmentResponses.ts`) | `createAttachmentMutationAction` gains `requireUploadGrant`; uploads start/parts/complete opt in (403 `{ code: 'media_upload_not_granted' }`); abort/delete stay open so revoked users can clean up drafts. One choke point covers posts, comments, messenger media, custom emoji, and profile avatars/banners — all purposes flow through `startAttachmentUpload`. |
| Admin email (`api/utils/email/*`, `auth/email.ts`, `auth/registerUser.ts`) | Every registration fire-and-forgets `sendAdminMediaUploadRequestEmail` to `THINGTIME_ADMIN_EMAIL` (default `admin@thingtime.com`), template `admin.media_upload_request`, transactional stream, recorded in `email_messages`. Lives in `registerUser` (not `createUserAccount`) so service accounts and temporary users don't page the admin. |
| Admin API (`routes/api/v1/admin/set-media-upload`) | `POST { userId, granted }`, mirrors `set-admin`. Registered in the `[...].ts` import map + `apiDocs.ts` (docs entry = Nitro registration + two auto smoke tests). |
| Admin UI (`components/Admin/AdminDashboard.tsx`) | Users tab: purple `media` badge (granted or admin), per-row **Grant media / Revoke media** button with Lopu toasts. |
| Upload UI (`components/Attachments/AttachmentComposer.tsx`, `attachmentUiCore.ts`, `hooks/useCurrentUser.tsx`) | Ungranted accounts see an approval-pending card instead of the dropzone (`canUploadMedia === false` from the root loader user; `undefined` = stale cache → server still 403s). `attachmentUploadError` maps `media_upload_not_granted` to friendly copy. |
| Migration (`api/utils/migrations/migrations.ts`) | `grant-media-upload-to-existing-users` — grandfathers every account existing at run time (both stores, idempotent). **Run it once when deploying if existing users should keep uploading; skip it to force approval for everyone.** |

## Key decisions

- Flag mirrors the `admin` grant (root boolean + dual-store write + env-independent predicate) rather than the secure-blob 2FA pattern, so admins can query/list granted users and interrupted-migration twins can't resurrect stale grants.
- The gate includes profile avatars/banners and custom emoji: they are public content too. Carving out purposes later is a one-line change at `service.start` (purpose is stamped and immutable).
- Registration email fires per new user account (not per upload attempt) — the admin reviews accounts, not requests.
- PAT/app actors: uploads only run through session users (`accountKind === 'user'` gate precedes); no new PAT scope needed.

## Verification log (2026-08-18)

- `corepack pnpm --dir remix run test:attachments` — 104/104 pass (includes new gate coverage: 403 + code for ungated, pass for granted, cleanup routes stay open).
- `corepack pnpm --dir remix run test:unit` — exit 0, all 25 sub-suites pass.
- `corepack pnpm --dir remix run lint:files -- <20 changed files>` — clean.
- Live smoke (worktree dev stack, ports 16270/16272): see PR description / follow-up notes.

## Dev runbook additions

- New env var `THINGTIME_ADMIN_EMAIL` (README §fork setup): admin alert destination, default `admin@thingtime.com`.
- TESTING.md: new lines under the attachments + admin sections.
