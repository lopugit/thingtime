# Developer-experience follow-ups: local attachment storage, API fixtures, feature maps, worktree bootstrap

Branch `claude/dx-local-storage-fixtures-feature-maps` → `develop`.
Requested by the owner on 20 September 2026 after PR #861; delivered by Claude (AI).

## What shipped

1. **Local stand-in for the private S3 bucket** —
   `remix/app/api/utils/attachments/localAttachmentStorage.ts` implements the
   whole `AttachmentS3` interface on the filesystem (multipart uploads, parts,
   composite checksums, versions, head/detect/tag/delete/copy-range, signed
   downloads) when `THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR` is set, and serves
   its own HMAC-signed URLs through the dev-only route
   `GET|HEAD|PUT /api/v1/attachments/local-object` (docs id
   `attachment-local-object` 1.0.0). `getPrivateS3()` picks it automatically;
   server-side readers (image variants, `cache=bytes`, archives, moderation)
   resolve signed URLs through `fetchStoredObject()` so a relative local URL is
   served in-process. Refuses to start when `VERCEL`/`VERCEL_ENV` is set; the
   route is 404 without the variable; keys/upload ids/version ids are validated
   against fixed grammars; unknown operations look like bad signatures.
2. **API-driven fixture script** — `remix/scripts/seed-fixture.mjs`
   (`create` / `resume` / `cleanup` / `list`) registers a user, creates a
   folder and a post with N stored files through the real endpoints (register,
   uploads/parts/complete with real PNG bytes, things, PATCH move), saves state
   in `remix/.fixtures/<name>.json` (0600), and tears down exactly (post
   cascade deletes the objects; folder; sign-out). Handles the upload approval
   gate: admin login via `--admin-user --admin-password-file`, or the
   `ADMIN_USERNAMES` + `resume` two-step (env-listed names cannot register).
3. **Feature maps** — `docs/feature-map/` (README + 8 domains) linked from
   `AI_ALL.md` with a read-before-exploring / update-in-the-same-PR rule.
4. **Typecheck hygiene** — merged the duplicate `serverAssets` key in
   `remix/nitro.config.ts` (the `shell` mount was silently dropped by the last
   key winning), completed 16 `registry.ts` schema fields (`description` /
   `required`), fixed a typed-array assertion in `attachmentFileTypes.test.ts`,
   and ratcheted the baseline 108 → 89.
5. **Graphify snapshot immutability** — `markSnapshotReadOnly()` in
   `scripts/graphify-cas.mjs` marks snapshot files 0444 on finalize and
   activate, so an older upstream hook writing through a root alias symlink
   fails with EACCES instead of dirtying committed bytes. Wrapper test added;
   the existing corruption-simulation test lifts the mode first.
6. **One-step worktree bootstrap** — `remix/scripts/worktree-bootstrap.cjs`
   (`npm run worktree-bootstrap`): relink deps, copy missing ignored env files
   from the main checkout, write the derived-port `.claude/launch.json`, set
   this worktree's relative `core.hooksPath`. The tracked `post-checkout` hook
   runs it in the background the first time a linked worktree lacks
   `remix/node_modules/.pnpm`. `.claude/launch.json` and
   `.claude/settings.local.json` are now ignored repo-wide.

## Why these shapes

- The stand-in sits behind the existing interface so quota, moderation, ACL,
  copy and archive code paths are exercised unchanged; nothing in product code
  branches on "local mode" except the factory.
- Signed URLs are relative: the browser PUTs/GETs same-origin through the Vite
  proxy (no CORS), and server code never needs to know the Nitro port.
- Fixtures go through the API by policy (FUNDAMENTALS §2); the script keeps
  every step idempotent so `resume` after enabling uploads never duplicates a
  folder, post or attachment.
- Hooks: `core.hooksPath` had been set to an absolute path inside one
  checkout's worktree config, so every worktree ran that checkout's (older)
  hook files; the fix is the README's relative form applied per worktree by the
  bootstrap, plus read-only snapshot files as defence in depth.

## Validation

- `npm --prefix remix run test:attachments` (9 + 256 pass, includes the new
  stand-in, seed helper and route tests), `test:api-capabilities` (72),
  `test:vercel-config` (2), root `npm run test:graphify-cas` (22).
- Lint clean on every changed file (one pre-existing `no-script-url` warning
  in `apiDocs.ts` untouched).
- `typecheck:ratchet`: 89 errors, baseline updated to 89 (none in changed
  files).
- Live, on this worktree's dev stack with the stand-in enabled: `seed-fixture
  create` → upload gate → `ADMIN_USERNAMES` + restart → `resume` uploaded three
  files (objects on disk), the post page rendered both images, `content`
  302-redirected to a signed local URL serving `image/png`, `width=64` returned
  WebP, the download-all ZIP unzipped cleanly, and `cleanup` removed the post,
  folder and every object file.
- Bootstrap smoke on this worktree: wrote `thingtime-web-18920` into
  `.claude/launch.json`, reported ports and PM2 name.

## Follow-ups

- Optional: run the headless API suite in CI with the stand-in enabled so
  upload flows get end-to-end coverage without S3.
- The main checkout `/Users/lopu/things/code/lopugit/thingtime` still runs an
  older `.githooks` version; `npm run install-git-hooks` there (or checking out
  a branch containing this PR) removes the last source of alias writes.
