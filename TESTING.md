# TESTING.md — per-area manual test checklists

Run the checklist for every area a PR touches, in a live browser against the
local dev stack (`npm run web-pms`, worktree stacks get their own port trio —
see `AI_ALL.md`). Each list is the distilled regression history of that area:
every line exists because it broke once. Add a line whenever a new bug class
is fixed, and cite the checklist you ran in the PR description.

## Public upload approval (new-signup permissions)

- [ ] Register a brand-new account. `POST /api/v1/auth/register` returns
      `publicUploadsEnabled: false` AND `privateUploadsEnabled: false`;
      `POST /api/v1/attachments/uploads` answers `403` with
      `code: "public_uploads_not_approved"` for public purposes (`post`,
      `comment`, `custom-emoji`, or no purpose) and
      `code: "private_uploads_not_approved"` for private ones (`message`,
      `profile-avatar`, `profile-banner`).
- [ ] Open the verification link. `emailVerified` flips to `true` while both
      `*UploadsEnabled` flags stay `false` — verifying an email must never be
      what grants uploads.
- [ ] Scopes stay independent: approve only `private`
      (`POST /api/v1/admin/users/public-uploads` with `scope: "private"`) and
      confirm `profile-avatar`/`message` starts pass the gate while `post`
      still 403s; approve only `public` on another account and confirm the
      reverse; `scope: "all"` enables both, and a request without `scope`
      keeps the legacy public-only behavior.
- [ ] At desktop and 390px mobile widths, withheld post/comment/custom-emoji
      composers show the public approval card while withheld message/profile
      composers show the private card. Approving only one scope unlocks only
      its matching pickers after revalidation; there is no one-boolean alias.
- [ ] Revoke a scope while a draft upload is already selected. The picker stops
      accepting new files, but the current rows and their finish/retry/remove
      controls remain reachable so lifecycle cleanup still works after
      revocation. Once the draft is empty, the approval card replaces it.
- [ ] Confirm the `admin.new_user` message reaches
      `THINGTIME_ADMIN_NOTIFICATION_EMAIL` (default `admin@thingtime.com`) with
      the username, display name, email, user id, and signup time. In dev read
      it from the `email_messages_v2` outbox.
- [ ] Stop the mail provider (or set an unroutable recipient) and verify again:
      verification still succeeds and still redirects to `/login?verify=success`
      — a mail outage must never fail a committed verification, nor grant the
      permission.
- [ ] In **/admin → Users**, the account shows a `pending` Uploads badge and
      the warning banner counts it. Use the **Approve ▾** menu: "Enable public
      uploads" / "Enable private uploads" flip only that scope (badge shows
      `public` or `private`), "Enable all" turns the badge green `all` — each
      optimistically with a Lopu toast — and the matching upload starts stop
      403ing.
- [ ] Withhold from the same menu: that scope 403s again ("Withhold all"
      returns the badge to `pending`). An account that predates the change (no
      `meta.publicUploads`/`meta.privateUploads`) shows `all`, and an admin row
      shows `all` with no menu.
- [ ] Non-admins calling `POST /api/v1/admin/users/public-uploads` get `403`;
      a missing `userId`, non-boolean `enabled`, or unknown `scope` gets `400`;
      an unknown user gets `404`.
- [ ] Run `npm run test:attachments` (it carries the public-upload permission
      unit tests alongside the upload-gate regression test).

## Canonical AI instruction links (`AI_ALL.md`)

- [ ] Root `AGENTS.md` and `CLAUDE.md` are relative symlinks whose target is
      exactly `AI_ALL.md`.
- [ ] `cmp -s AI_ALL.md AGENTS.md` and `cmp -s AI_ALL.md CLAUDE.md` both pass,
      and root `CODEX.md` is absent.
- [ ] In a fresh Git checkout, `git ls-files -s AGENTS.md CLAUDE.md` reports
      mode `120000` for both links and both still resolve to `AI_ALL.md`.

## Repository-root Vercel builds

- [ ] Run `npm run test:vercel-root`: it proves root `vercel.json` owns the
      build, the nested config is absent, ordinary product commits build,
      `github-actions` and generic Preview duplicate SHAs skip, the `develop`
      Custom Environment still rebuilds an already-previewed SHA, a valid Nitro
      artifact is staged at root, and invalid source output preserves the prior
      artifact.
- [ ] Run `npm run build:vercel` from the repository root. Confirm both the
      existing Remix verifier and the root wrapper pass, then inspect
      `.vercel/output/static/index.html` and `.vercel/output/config.json` rather
      than an `outputDirectory` selected by the dashboard.
- [ ] In Vercel, clear the old `remix` Root Directory and all Build, Install,
      Output Directory, and Ignored Build Step overrides; select Other as the
      framework. Confirm a product-branch commit builds from root and serves
      `/`, one `/assets/...` file, and `/api/root-data` from the same deployment.
- [ ] Confirm the literal `github-actions` branch and a disposable branch made
      from the thin control plane create no Vercel deployment. The product
      config must map `github-actions` to `false`, while the thin branch config
      must set `git.deploymentEnabled` to `false` and retain `ignoreCommand` as
      a second fail-safe.

## Develop-target Vercel PR previews

- [ ] Confirm `.github/workflows/develop-pr-preview.yml` and its controller
      listener are present on the default `main` branch, while the reusable
      implementation and controller script are present on the protected
      `github-actions` branch, before expecting `pull_request_target` to run; a
      listener present only on the feature PR is deliberately inactive.
- [ ] On a product branch, run
      `node remix/scripts/workflow-caller-contract.mjs` and
      `node --test remix/scripts/vercel-config.test.mjs`: the thin listener
      calls the trusted implementation on `github-actions`, `.github/scripts/`
      is empty, and every Vercel cron `(path, schedule)` pair appears exactly
      once.
- [ ] Manually run `Develop S3 PR preview` from `main` with a valid develop PR
      number: the caller converts the dispatch string to the reusable
      workflow's numeric `pr_number`, creates the controller job instead of a
      zero-job failure, and performs the requested publish or cleanup.
- [ ] Inspect an eligible PR's two runs: the `pull_request_target` dispatcher
      has no GitHub Environment/Vercel secret, checks out no code, and emits one
      bounded `repository_dispatch`; only the downstream default-branch run
      enters `vercel-develop-pr-control`, checks out `main`, and receives the
      controller secret. Neither GitHub job executes the PR head.
- [ ] Replay or forge a dispatch payload with a wrong source run id, workflow
      path, repository, PR, action, actor, or head SHA: the privileged job fails
      closed before any Vercel mutation. A stale legitimate dispatch also no-ops
      after the live PR SHA fence.
- [ ] Inspect the private `vercel-develop-pr-control` GitHub Environment
      without printing values: only the `main` deployment branch is allowed,
      `VERCEL_CUSTOM_ENVIRONMENT_ID` contains the exact immutable develop ID,
      `DEVELOP_PREVIEW_TRUSTED_ACTORS` is explicit, the Vercel token is the
      fresh dedicated `VERCEL_DEVELOP_DEPLOY_TOKEN` environment secret, the two
      domain variables match controlled domains, the masked
      `THINGTIME_DEVELOP_S3_CORS_PROBE_URL` secret is an unsigned exact
      develop-bucket HTTPS object URL with no query, and no live `env_*` ID,
      bucket name, or token appears in tracked controller files or workflow
      logs.
- [ ] Confirm the active `main` `Basic Protection` ruleset has no bypass,
      requires a pull request with resolved review threads, both strict Web CI
      jobs, and the CodeQL Analyze checks for actions and javascript-typescript,
      and blocks deletion and force-pushes. Confirm the controller Environment
      has no required reviewer so event cleanup and six-hour reconciliation
      remain automatic. CODEOWNERS presence alone is not an enforcement check;
      independent CODEOWNER approval is optional future hardening once a second
      trusted collaborator can review changes.
- [ ] In Vercel, confirm `dev.thingtime.com` is bound to the literal `develop`
      Git branch and has no domain `customEnvironmentId`, rather than being
      bound to the whole Custom Environment; the Custom Environment's own domain
      list is empty. Confirm a newly built generic Preview has all current
      `develop` variables plus the six existing Preview-only values, while
      production MongoDB/JWT/S3 values remain absent.
- [ ] On a `develop` Custom Environment deployment, confirm `/api/root-data`
      reports `THINGTIME_VERCEL_ENV=develop` and
      `THINGTIME_SHOW_DEPLOYMENT_STATUS=true`; `/api/v1/vercel/status` returns
      JSON with HTTP 200, and `/status` renders the deployment status instead of
      the React Router 404 boundary. Repeat on an ordinary Preview deployment.
- [ ] Open or update a same-repository, trusted-author PR targeting `develop`:
      the `Develop S3 PR preview` workflow deploys the exact head SHA, the
      one marker comment moves through deploying to ready, the GitHub Deployment
      reaches success, and the comment links
      `https://pr-<number>.previews.dev.thingtime.com`; verify the deployed SHA again
      after the build completes.
- [ ] For an exact SHA that already has a READY generic Preview, run the
      controller again and confirm its `develop` Custom Environment deployment
      builds instead of ending `CANCELED`; the PR alias, GitHub Deployment, and
      marker comment must reach the ready state for that exact SHA.
- [ ] Confirm the wildcard Vercel domain is verified and detached, its
      Cloudflare `*.previews.dev` CNAME targets `cname.vercel-dns.com` with
      DNS-only proxying, and `_acme-challenge.previews.dev` has NS delegations
      to both `ns1.vercel-dns.com` and `ns2.vercel-dns.com` without moving the
      apex nameservers or delegating a broader subtree. Confirm its Git branch
      and Custom Environment bindings are empty. Do not require Vercel's
      external-DNS advisory to report `misconfigured: false`: independently
      confirm a probe hostname resolves to Vercel's currently recommended
      CNAME target and the published PR alias presents a valid certificate.
- [ ] From that alias, sign in and upload/remove a small attachment: the direct
      S3 `PUT` preflight permits only that exact origin pattern, `PUT`, and
      `x-amz-checksum-sha256`; it exposes no headers, the bucket remains private,
      and storage usage returns to its original value. Repeat from
      `https://dev.thingtime.com` and a newly built generated
      `https://thingtime-*-lopugits-projects.vercel.app` Preview; reject an
      unrelated origin.
- [ ] Update the PR twice: the same alias moves to the newest successful SHA,
      the comment is edited rather than duplicated, and older workflow-created
      develop deployments are deleted. A canceled/superseded run must not move
      the alias after the newer SHA wins.
- [ ] A fork PR, draft PR, non-allowlisted author/actor, read-only collaborator,
      and PR targeting `main` never receive a controller-managed develop alias.
      If Vercel builds their ordinary Preview, confirm it uses only the shared
      development role/data plane and cannot assume the production AWS role.
      Retargeting or converting an eligible PR to draft cleans its existing
      controller-managed alias/deployment.
- [ ] Confirm `*.previews.thingtime.com` is not used by the develop controller.
      Until a separately protected production-preview controller exists, no
      ordinary Preview can assume the production role or publish a trusted
      production-preview alias.
- [ ] With two eligible PRs open, use disposable accounts and verify that their
      aliases intentionally see the same development data/quota plane; do not
      describe either alias as an isolated sandbox.
- [ ] Close the develop-target PR: its alias is removed, its transient GitHub
      Deployment becomes inactive, and workflow-created Vercel deployments are
      deleted without moving `dev.thingtime.com`.
- [ ] Simulate a missed close/interrupted cleanup with workflow-tagged test
      resources, then run/wait for the six-hour scheduled reconciliation: it
      removes stale alias/deployments idempotently while preserving unmarked
      deployments and the stable `develop` branch deployment. Manually dispatch
      one PR number and verify the bounded per-PR recovery path separately.

## iOS web destination drawer

- [ ] At a phone-width native WebView destination, open the web app navigation
      drawer from the top-left menu icon. The same fixed icon used by mobile web
      stays inside the drawer header while the page and top nav move aside; no
      duplicate icon appears at the drawer's outside edge. Close it, scroll from
      the page top to bottom, reopen it, and confirm the icon remains tappable.
- [ ] From any media composer in the native iOS app, choose Add Media → Take
      Photo or Video. The system requests camera access instead of terminating
      the app; photo capture returns a selectable file. Repeat with video and
      confirm microphone permission is requested, then verify Photo Library
      selection still returns media without a crash.
- [ ] Confirm
      `https://thingtime.com/api/v1/vercel/deployments?limit=50&history=10`
      reports `source: "api"`, `hasError: false`, and `deploymentGroups` with
      up to ten newest-first deployments per branch before testing the native
      picker. The compatibility `deployments` array must still expose one
      latest row per branch. A tokenless response or `Vercel API returned 403`
      means the Vercel project token must be repaired and a fresh deployment
      built before the app can discover previews.
- [ ] Launch the iOS app with at least twelve returned destinations, open the
      left-edge Web destination drawer, and scroll from the first row to the
      final row and back. The header, refresh, and close controls stay pinned;
      rows do not clip or overlap the home indicator in portrait or landscape.
- [ ] Drag vertically over a destination row and confirm the list scrolls
      without dismissing the drawer. Then swipe predominantly left and confirm
      the drawer closes; reopen it, select an off-screen preview, and confirm
      the web view loads that exact URL.
- [ ] Find a branch whose newest deployment is queued/building and whose prior
      deployment is ready. Expand the branch row, confirm both deployments are
      shown newest first and the ready child is labelled `Last successful`,
      then select that child and verify the WebView loads its immutable URL
      rather than the queued branch alias. Reopen the drawer and confirm the
      selected branch expands automatically with the child checkmark visible.
- [ ] Expand and collapse several branches while scrolling to the bottom and
      back in portrait and landscape. Nested deployment rows remain inside
      their branch cards, disclosure controls stay tappable, and vertical
      scrolling never triggers the horizontal drawer-close gesture.

## Worktree dependency bootstrap (`remix/scripts/ensure-dependencies.js`)

- [ ] In a fresh linked worktree with no copied `node_modules`, run
      `npm run worktree-setup`: every direct Remix dependency is linked and
      `npm --prefix remix run ensure-deps -- --check` passes.
- [ ] With the pnpm virtual store present but top-level `eslint` and `vite`
      links removed, run `npm run worktree-setup`: both links are restored
      without copying dependency files from another checkout.
- [ ] Run `npm run worktree-setup` again: it exits successfully without
      reinstalling, then `corepack pnpm --dir remix run lint:files --
  scripts/ensure-dependencies.js scripts/dev.mjs` starts ESLint normally.
- [ ] In a disposable worktree, remove one transitive pnpm link required by
      ESLint while leaving every direct dependency link present, then run the
      targeted lint command: the startup probe performs one forced relink and
      ESLint starts. `npm --prefix remix run ensure-deps -- --check` also proves
      both ESLint and the directly declared Prettier CLI can start.

## Composer — Thingtime tab (`remix/app/components/Feed/PostComposer.tsx`)

- [ ] Seed the `thingtime` LocalForage value with valid-looking hostile and
      malformed legacy function tags plus root `set` / `get` runtime
      methods, then load `/feed` ONCE: no payload executes, the code-defined
      editor factory is restored, the
      collapsed “What's on your mind?” control opens, Editor.js accepts focus
      and typing, Latest / Filters and the global search remain interactive,
      and the repaired stored snapshot already contains neither runtime method
      nor any function source before a second navigation.
- [ ] Open the feed composer → Thingtime tab: the editor shows exactly ONE
      root property, `New Thing`, with no default children (no `name`).
- [ ] The draft path is session-scoped (`tmp.<sessionId>.New Thing`): add a
      field, reload the page, reopen the tab → the draft is EMPTY again and
      the store's `tmp` branch holds only the new session.
- [ ] Post button stays disabled until the thing has real content (empty
      strings don't count; numbers/booleans/nulls do).
- [ ] Photos toggle ON requires ≥1 valid image URL before Post enables;
      Marketplace toggle ON requires valid listing fields. Toggling either
      off re-enables Post on thing content alone.
- [ ] Posting a thing + photo + listing renders the card as thing → photo
      grid → listing, with the first photo appearing exactly once.
- [ ] Change type on the `New Thing` root (context menu → change type):
      string shows a text editor that accepts input; boolean shows a boolean
      editor; the seed effect must NOT clobber the converted value back to {}.
- [ ] Rename the `New Thing` root TWICE in a row (click the key, type, Enter;
      repeat) on a FRESH page load: both renames must land in the store, not
      just the visible text. Regression class: memoized JSX pinning a
      mount-time `updatePath` whose `parent` was undefined pre-seed, and
      string path bindings (editor leaf, composer draftPath) not following
      the first rename (`path-renamed` bus event).
- [ ] The in-post editor height-drags via the bottom handle (mouse and touch)
      with no upper limit, and never below the small floor.

## Post and comment attachments (`remix/app/components/Attachments/`)

- [ ] With `THINGTIME_MODERATION_PROVIDER=test`, upload an image named
      `tt-test-nsfw.png` to a post: after analysis it renders heavily blurred
      with a red border, light red wash, centered NSFW badge, and a
      `Show Anyway` button that reveals it (per attachment, per page view).
      An image named `tt-test-illegal.png` disappears from public payloads and
      its `/api/v1/attachments/content` URL 404s for non-admins, while a
      `moderationFlag` row appears in `/admin` → Moderation.
- [ ] Deliberately hold a just-completed attachment in `pending`: it is absent
      from another account's attachment projection and content returns not
      found, while its owner and an admin can still open the exact evidence.
      Run the moderation sweep after restoring the deterministic provider and
      confirm it releases the item to `clear`, `nsfw`, or `blocked`.
- [ ] Generic Things create/update requests cannot set the root `moderation`
      field or create a `thingtime: moderationFlag` record. Pre-create an
      ordinary Thing with the deterministic `modflag-<target>` id, analyze a
      flagged target, and confirm the ordinary Thing remains byte-for-byte
      ordinary while the target remains `flagPending` for operator review.
- [ ] With `THINGTIME_MODERATION_PROVIDER=openai+claude` (+ both API keys), a
      clearly clean image stamps `clear` with provider `openai` (free omni
      screen, no Claude spend) while an explicit image stamps via provider
      `claude` (escalated) — check the provider column in `/admin` →
      Moderation. With `ANTHROPIC_API_KEY` removed, an omni-flagged image still
      lands `nsfw` (blur + flag) instead of staying pending.
- [ ] `/admin` → Moderation → AI moderation settings: switching Media uploads
      to "OpenAI omni only (free)" updates the "running:" label and subsequent
      uploads stamp provider `openai`; switching either surface to Off stops
      new stamps. Choices survive a reload (settings collection, not local
      state).
- [ ] With an OpenAI key configured, a post/comment containing threatening
      harassment vanishes from feeds/threads for everyone shortly after
      creation and a `text` flag row (with excerpt, no View button) appears in
      `/admin` → Moderation; Clear restores the post, Block re-hides it.
      Editing a clean post to add flagged text re-screens it.
- [ ] Hybrid create gate: with text moderation on, posting text that omni
      flags as block-worthy never appears in any feed/thread — even a refresh
      fired immediately after posting (the doc is born blocked; a `text` flag
      row appears for admins). With `TT_TEXT_SCREEN_BUDGET_MS=0` (or omni
      unreachable) the post is born pending and owner-private until the async
      verdict or sweep releases it.
- [ ] Fail-closed pending flow: with text moderation on and omni unreachable
      (or `TT_TEXT_SCREEN_BUDGET_MS=0`), a new post appears for its author but
      NOT for other accounts; once omni is reachable again (queue retry or
      cron sweep) the post appears for everyone and follower notifications
      arrive at release time. Turning text moderation Off releases any
      stranded pending posts on the next sweep.
- [ ] URL-photos moderation: a post created through the multi-URL photo flow
      pointing at an explicit external image gets flagged (nsfw advisory row
      with the URL in the excerpt) without any text in the post; editing the
      listing title or tags of a clean marketplace post to violating text
      re-screens it.
- [ ] Text sweep safety net: with text moderation on, manually strip the
      `moderation` field from a flagged post (simulating a mid-flight death),
      then hit `/api/v1/moderation/sweep` with the CRON_SECRET bearer (or the
      admin Run analysis sweep button) — the post gets stamped/flagged and the
      "text post(s) awaiting analysis" count in `/admin` → Moderation drops.
- [ ] Top-level post, rich comment, and reply composers use the same responsive
      attachment gallery and `🏞️ Add Media` tile. The existing multi-URL photo
      flow remains available as a quota-saving alternative on every rich
      post/comment surface.
- [ ] In Photos, add one public image URL, then paste several newline-separated
      URLs. Valid unique URLs become responsive preview tiles in stable order,
      duplicates are skipped, invalid/credentialed URLs remain editable with an
      accessible error, and linked images use `referrerPolicy=no-referrer`.
- [ ] The visual upload area uses responsive thumbnail tiles plus a real
      `🏞️ Add Media` control. At desktop and 390px mobile widths it has no
      horizontal overflow; the URL fallback panel and every lower composer
      control remain reachable after scrolling top-to-bottom.
- [ ] Pick and drag/drop raster images, a supported video, and an arbitrary
      file. Safe image/video previews appear immediately; each row reports
      progress; Post stays disabled until every selected file is Ready; and a
      26th unique file is rejected with the fixed 25-attachment limit message.
- [ ] With two or more selected files, drag the ⠿ grip (mouse AND touch) to
      reorder media tiles and file rows; arrow keys on a focused grip move one
      step, Home/End jump to the edges. Tiles reorder live while dragging, a
      tile drag never triggers the panel's file-drop styling, and the posted
      card renders images and files in exactly the chosen order after reload.
- [ ] Edit a post with 2+ attachments: the composer shows the read-only
      reorderable gallery (no upload panel), dragging or arrow keys reorder it,
      Save persists the order (card + `/post/:id` + reload agree), and saving
      with no changes sends no attachment reorder. A stale edit saved after the
      post's attachments changed fails with the refresh-and-reorder 409 rather
      than half-applying.
- [ ] Cancel an in-flight file, remove a completed draft file, and retry both a
      failed part upload and a failed completion. No file is silently omitted,
      duplicated, charged twice, or left in a permanent uploading state.
- [ ] Drop the upload-start response after the server reserves storage, then
      retry/remove: the stable request id resolves the same owner-scoped upload
      without a second charge. A different account using that request id gets
      its own opaque attachment id and learns nothing about the first.
- [ ] Remove an MPU before any part URL is issued: its empty reservation refunds
      promptly. Remove after a part URL was issued: the UI explains that bytes
      remain reserved while lifecycle-backed cleanup settles, without exposing
      server or S3 error text.
- [ ] Post an attachment without body text, then post URL photos and uploaded
      attachments together. The optimistic card receives stable metadata only
      and survives a later reload without persisting a presigned URL.
- [ ] Add an attachment-only comment, a text-plus-files comment, and a reply
      containing an image, video, and generic download. Each renders inline or
      as a safe download exactly like the parent post, survives reload and its
      `/post/:id` permalink, and never persists a presigned URL.
- [ ] Build a 6+-deep reply chain and attach a file at multiple depths. An
      authorized viewer can open each file through the inherited root ACL;
      logged-out, unauthorized, broken-chain, and custom-Mongo collision reads
      return not found without revealing attachment metadata.
- [ ] Simulate a lost attachment-comment response, then retry. The immutable
      shareId, comment payload, and exact attachment set reconcile once without
      a duplicate comment or second quota charge. A definitive first-attempt
      rejection returns the composer to an editable state.
- [ ] Delete an attached reply, an attached comment subtree, and finally the
      root post. Every descendant object's exact S3 version is removed before
      its attachment Thing and quota charge; a partial remote failure keeps the
      remaining tombstone billed and retryable rather than orphaning bytes.
- [ ] Feed, profile, nested repost, and permalink cards render vetted raster
      images and videos inline. SVG, HTML, script, and unknown types render only
      as named download rows; their bytes never execute inline.
- [ ] Upload a QuickTime screen recording (a `.mov`, or a QuickTime container
      misnamed `.mp4` — check for `ftypqt` magic bytes) plus an MKV or M4V.
      Each finalizes as its sniffed `video/*` type and plays inline in feed and
      permalink cards; the decision follows magic bytes, never the filename
      extension.
- [ ] Upload a non-web-playable container (for example an AVI) and confirm its
      download row labels the real sniffed container (for example "AVI video"
      from `detectedContentType`) instead of `application/octet-stream`, while
      the bytes still download as opaque octet-stream.
- [ ] In a browser missing the codec inside an allowed container (for example
      HEVC QuickTime in Firefox), the failed `<video>` degrades to the named
      download row instead of an inert black player.
- [ ] For a ready upload finalized before magic-byte detection (crystal
      `application/octet-stream`, no `detectedContentType`, renders as a file
      card), run the admin `POST /api/v1/attachments/backfill-detected-types`
      sweep — `dryRun: true` first, then for real, following `nextCursor` while
      `hasMore` — and confirm the already-posted attachment flips to inline
      video (or gains its sniffed download label) without re-uploading, with
      name, size, and any owner-authored title/description unchanged. A repeat
      run reports zero changes.
- [ ] Let a content URL expire at the storage provider and open the attachment
      again: the stable authenticated `/api/v1/attachments/content?id=…` route
      issues fresh access. A private post's attachment fails closed for another
      account and logged-out browser.
- [ ] Exhaust the active account tier, then select a file larger than the
      remaining allowance. Every post, comment, message, reply, emoji, avatar,
      and banner picker shows the fixed account-quota message with delete-media
      or upgrade-tier recovery; it must never call this an unavailable
      environment or echo ledger/provider detail. Removing the draft or
      deleting the bound content reconciles usage, and `ready` / `reconciling`
      / `unavailable` storage labels never present unknown accounting as
      unlimited capacity.
- [ ] Switch Thingtime accounts during prepare, hashing, direct upload, and
      completion. Requests and XHRs cancel, local previews clear, and no draft
      attachment ID or storage content crosses into the new account.
- [ ] Simulate a lost post-create response: the exact first payload becomes
      inert, retry uses the same post id and attachment set, and an exact GET
      readback completes once without duplicating the post. A first-attempt
      attachment 409 does not freeze an otherwise editable draft.
- [ ] At desktop and narrow mobile widths, long filenames truncate without
      horizontal overflow, multi-sentence errors span the available row width
      instead of wrapping one or two words per line, controls remain at least
      44px touchable, keyboard users can add/retry/cancel/remove files, and
      progress/error updates are announced without stealing focus.
- [ ] Through the local Vite proxy or a trusted reverse proxy, attachment and
      profile-media mutations succeed only when `Origin` matches the forwarded
      public host/protocol. A mismatched origin or `Sec-Fetch-Site: cross-site`
      request remains forbidden even if forwarded headers are spoofed.
- [ ] In the production AWS account, all four account-level and bucket-level
      Block Public Access switches are on, Object Ownership is Bucket Owner
      Enforced, versioning is enabled, default encryption is on, and no bucket
      ACL or public-access policy is present.
- [ ] The Vercel OIDC role trust policy matches the exact team audience and
      `owner:<team>:project:<project>:environment:production` subject. A
      production function can assume it; preview/development tokens cannot.
- [ ] The Vercel Custom Environment named `develop` has an exact `develop`
      branch matcher, owns the verified `https://dev.thingtime.com` domain,
      and is the only non-production scope containing the four Sensitive S3 /
      cleanup variables. Generic Preview contains none of them.
- [ ] On an ordinary feature-branch Preview, selecting a file fails before
      quota reservation with the fixed client-authored “private uploads are
      unavailable in this environment” guidance and offers the public image URL
      fallback. Never expose Vercel, proxy, AWS, role, bucket, or request text.
- [ ] The develop role trusts only
      `owner:<team>:project:<project>:environment:develop`. A deployed develop
      function can assume it, while a feature-branch
      `environment:preview` token and local `environment:development` token
      are both denied.
- [ ] The attachment role is limited to `objects/*` and the documented eight
      version-aware multipart/object actions. Confirm `s3:ListBucket`,
      `s3:DeleteObject`, ACL, and bucket-administration actions are denied.
- [ ] The bucket policy denies HTTP and TLS below 1.2 for non-service
      principals. CORS preflight succeeds only for the production origin's
      `PUT` with `x-amz-checksum-sha256`; a different origin, method, or header
      is denied, and no response header is unnecessarily exposed.
- [ ] Repeat the bucket controls against develop: only
      `https://dev.thingtime.com` can preflight its checksum-locked `PUT`, and
      neither environment's role can read, write, list, or delete objects in
      the other environment's bucket.
- [ ] The enabled `objects/` lifecycle rule aborts incomplete multipart uploads
      after seven days and permanently expires noncurrent versions after 30
      days. Account and bucket settings still match after a fresh console load.
- [ ] Upload a tiny production attachment, record its S3 VersionId and storage
      usage, then delete its post. That exact version is permanently absent
      before the Thingtime ledger refunds the bytes; no delete marker or hidden
      noncurrent copy stands in for deletion.
- [ ] Call `/api/v1/attachments/cleanup` with no bearer, a Thingtime user token,
      and an incorrect cron secret: every request fails closed. The exact
      production `CRON_SECRET` succeeds only through the scheduled cleanup
      path, and a cleanup retry never exposes the secret or raw S3 errors.
- [ ] After this PR's routes are deployed to `develop`, confirm the develop
      EventBridge rule invokes
      `https://dev.thingtime.com/api/v1/attachments/cleanup` at minute 17 each
      hour through its one-purpose API Destination/role. Its exact develop
      secret succeeds, missing/wrong secrets fail, and EventBridge reports no
      failed invocation.
- [ ] After the same deployment, upload a tiny attachment on
      `dev.thingtime.com`, complete it, render or download it, then remove the
      draft or delete its post. The exact S3 version disappears and the account
      storage meter returns to its starting value without touching the
      production bucket.

## Media thing pages — masonry, lightbox, `/media/:id`, annotate (`remix/app/components/Attachments/`, `remix/app/routes/media.tsx`)

- [ ] A post with 3+ images renders the image section as a CSS-columns masonry
      (natural aspect ratios, `break-inside` avoided) with 1/2/3 responsive
      columns; at desktop and 375px mobile widths there is no horizontal
      overflow, and video/file sections keep their existing layouts.
- [ ] Clicking (and keyboard-activating) a masonry image opens the lightbox:
      full image, title/description when present, prev/next across only that
      post's images, an Open-page link to `/media/:id`, a download link, and
      Esc/backdrop close. Error-state tiles never open a broken lightbox.
- [ ] `/media/:id` renders inside the Thingtime UI shell (nav, centered
      max-width): large media, title/description, author, a link back to the
      parent post, plus working reactions and comments on the media thing
      itself. Comments/reactions persist after reload, an unknown or private id
      404s safely, and `GET /api/v1/things?id=<attachmentId>` leaks no private
      object fields.
- [ ] As the owner, use the pencil affordance on a ready composer tile, an
      edit-gallery tile, and the `/media/:id` page to set/edit title (≤200) and
      description (≤2000). The editor saves via `/api/v1/attachments/annotate`,
      updates optimistically (revert + Lopu toast on failure), clears fields
      when emptied, and the saved values survive reload on card, lightbox, and
      media page. A non-owner and an unauthenticated caller get no pencil and a
      403/401 from the endpoint.
- [ ] Annotate a legacy opaque attachment that already has a server-written
      `detectedContentType`. Title/description edits and clears preserve that
      field exactly, so #319/#321's detected label and accounting survive; a
      malformed pre-existing crystal fails closed instead of being rewritten.
- [ ] On `/media/:id`, the timestamp, owner-menu Copy link, and outward Share
      all resolve to `/media/:id` (never the blank `/post/:id` attachment
      projection). Repost/quote controls are absent until attachment-target
      shares have a real renderer, so the media card cannot create an empty
      feed share.
- [ ] Media layout editor: on a post with 3+ images, switch Layout between
      Auto 🧱 / Rows 🥞 / Grid 🔳 in the composer AND in edit mode. Rows accepts
      a pattern like 1-2-3 (hero, two, three; extras repeat the last row size),
      Grid gets a 1-6 column stepper plus per-tile size badges cycling
      normal → wide → tall → big. Saved layouts persist through create, edit,
      reload, and render identically for a non-owner viewer; Auto clears
      `mediaLayout` from the crystal. Layout controls only appear with 2+
      visual attachments and never break the drag-reorder grips.
- [ ] Media layout transport: after creating a post or rich comment through
      `useApi`, reopen the editor and confirm the selected Rows/Grid mode,
      columns/pattern, and non-default spans survived the client request. A
      correct pre-submit preview is not sufficient evidence of persistence.
- [ ] Server bounds: `mediaLayout` rejects pattern rows over 25 entries or
      outside 1..6, columns outside 1..6, spans maps over 25 entries, and
      non-object payloads with a 400; unknown keys are stripped; legacy posts
      without the field stay valid; Auto removes the `mediaLayout` key rather
      than storing `null`; lightbox order stays attachment order in every mode;
      desktop and 375px render every mode with no horizontal overflow.
- [ ] Drag-resize canvas editor (grid mode): dragging a tile's edge handle
      resizes it snap-to-cell (wide/tall/big), including via touch, with a
      keyboard fallback on a focused tile; the column slider relayouts live;
      the resulting layout matches what non-edit viewers see after save.
- [ ] Deleting the parent post (and separately a single attachment) cascades:
      the media thing's own comments/reactions are removed, its `/media/:id`
      404s, and no orphan child things remain.

## Profile avatar and banner media (`remix/app/components/Profile/`)

- [ ] Open both Edit profile and Settings → Profile. With no saved image, each
      avatar/banner field shows a responsive `🏞️ Add Media` tile and a separate
      “Use public image URL” fallback; all controls remain at least 44px.
- [ ] Select JPEG, PNG, GIF, WebP, and AVIF files. A local preview paints
      immediately, progress/retry/remove remain usable, Save stays disabled
      until the image is ready, and SVG/non-image/empty/>64 MiB files fail with
      fixed client-authored guidance before upload.
- [ ] Save a managed avatar and banner, reload, and verify profile, feed cards,
      search, notifications, Messenger/account navigation, and the owned-account
      roster render the stable same-origin content URL without exposing an S3
      key, upload id, version id, or presigned URL.
- [ ] Load a public profile logged out and verify its current managed avatar and
      banner render. A replaced, unbound, cross-account, wrong-slot, custom-Mongo
      collision, or arbitrary attachment id must return not found.
- [ ] Replace a saved managed avatar/banner, clear it, and switch it to one
      credential-free http(s) URL. The user-slot update and new attachment bind
      are atomic; the old object stays charged until exact-version deletion and
      then the storage meter refreshes to the correct value.
- [ ] Paste a valid external image URL: it previews with no referrer, remains a
      quota-saving remote link, and is never server-fetched. Credentialed,
      protocol-relative, whitespace/control-character, and non-http(s) URLs are
      rejected without raw server/proxy text.
- [ ] Close the editor, navigate away, or switch accounts while a profile upload
      is preparing/uploading/ready-but-unsaved. Requests cancel, local object
      URLs clear, unbound drafts are cleaned safely, and no filename, preview,
      attachment id, or storage state flashes into the next account.
- [ ] Simulate a lost profile-save response and retry the same attachment ids.
      An already-bound exact owner/slot succeeds idempotently; a mismatched slot
      or changed attachment fails closed without deleting another current image.

## Editor windows & layer system (`remix/app/components/Thingtime/EditorSplit.tsx`)

- [ ] Every toolbar control on a FLOATING frame (splits, edit toggle, reader/
      code toggle, pop-out, dock-in, ▲▼ layer arrows, …) fires its action on
      click — none of them start a frame drag. Dragging empty toolbar space
      still moves the frame.
- [ ] The composer's pop-out button duplicates the window into a native
      floating frame (traffic lights + toolbar); the in-post editor stays and
      both live-sync through the store.
- [ ] New frames layer ABOVE the drawer; hovering the drawer brings it to
      front, mouse-leave hands it back.
- [ ] ▼ on the top below-drawer frame / ▲ on the bottom above-drawer frame
      crosses the drawer WITHOUT changing relative window order; ⇧-click is
      bring-to-front / send-to-back.
- [ ] Close or dock a below-drawer frame: the frames stacked above it must
      STAY above the drawer (layer divider accounting).
- [ ] Open a dropdown (feed Filters, Algorithm menu) and a drawer modal with
      a frame floating: menus (10220) and modals (10240/10250) render ABOVE
      the frame; the chrome z ladder is documented in
      `remix/app/components/Nav/Drawer/useDrawer.tsx`.
- [ ] Dragging a window from one editor instance over ANOTHER instance's
      window must not dock (and must never lose the window) — drop targets
      are instance-scoped.
- [ ] `/editor` still opens with its two-window default and the drawer's
      Editor section still lists/saves/restores layouts (embedded composer
      editors must never appear there).

## Multi-editor focus (`remix/app/components/Editor/LongTextEditor.tsx`)

- [ ] With the popout open (same path in two editors), click into an
      editor.js field, type, wait ~1s (autosave echo remounts the OTHER
      instance), keep typing WITHOUT re-clicking: the caret must stay exactly
      where it was — no jump to block start, no focus loss. Test typing in
      the popout and in the in-post editor.
- [ ] Single-editor echo: typing continuously through several autosaves in
      one editor never remounts or resets it (signature echo acknowledgment).

## Feed thing rendering (`remix/app/components/Thingtime/ThingView.tsx`)

- [ ] A thingtime post renders its thing as the NATIVE Thingtime tree in view
      mode — right-click opens the thing context menu, Toggle Edit Mode makes
      values editable (numbers get steppers, booleans a switch, Editor.js
      docs the block editor), and edits stay LOCAL: reloading the feed
      restores the server value, and neither the viewer's persisted
      thingtime blob nor the composer's tmp draft branch is touched.
- [ ] A thing that resolves a kind renderer (a `render:` prop naming a kind,
      an explicit kind, or a structural match — in that priority order)
      shows the RENDERED form by default, with a small corner 🌀 icon back
      to the Thingtime view and ✨ back again; things resolving no renderer
      show the tree with no corner icon.
- [ ] Editor.js docs render as rich text by default everywhere: a rich-text
      post body (feed + profile), a nested rich-text value inside a tree,
      and /search crystal chips (plain-text preview, never raw block JSON).
- [ ] Untrusted (other users') things are only auto-rendered for the
      vetted-safe kinds (rich-text, image, audio, playlist, podcast, article,
      quote, book, movie, link, file, code, repository); every other kind —
      including the arbitrary-markup `chakra`/`element` kinds — falls back to
      the sanitising native tree with no rendered toggle.
- [ ] SECURITY (feed + search): a thing shaped as `kind:'link'` with
      `url:'javascript:…'` renders a card that is NOT a clickable link (no
      anchor, no "Open link"); a `chakra`/`element` thing with
      `props:{position:'fixed',inset:0,zIndex:99999,…}` renders as a data
      tree, NOT a viewport overlay; image/audio/cover URLs with unsafe schemes
      fall back to the emoji placeholder. Verify via DOM: no `a[href^=
"javascript:"]`, no fixed/absolute high-z overlay from post content.
- [ ] Editing a feed thing (context menu → Toggle Edit Mode) and pressing
      Cmd/Ctrl+Z does NOT undo the viewer's own persisted tree — the keydown
      is contained to the sandbox (native field undo still works).
- [ ] A very large thing (deeply nested, hundreds of nodes) mounts COLLAPSED
      and scrolls within a bounded box — it never mass-mounts nodes or
      wall-of-texts the feed.

## Post interactions & inherit chains (`remix/app/api/utils/things/things.ts`)

- [ ] Reacting, commenting, saving, sharing, and opening the `/post/:id`
      permalink all work on a comment nested DEEP in a reply chain (build a
      6+-deep comment-on-comment chain via the UI or API and interact with the
      deepest one) — visibility resolves through the whole `tt:inherit` chain,
      never "Post not found" for a legitimately deep reply. Chain resolution
      is bounded by cycle detection (`aclChainCore.ts`, `npm run test:acl`),
      NOT by a small depth cap: a depth cap silently orphaned deep replies
      while the feed still rendered them.
- [ ] A comment whose parent chain is broken (target deleted) fails closed:
      not viewable, not reactable, permalink 404s.

## Thing context menu (`remix/app/components/Thingtime/ContextMenu/`)

- [ ] Open the hover (popover) menu from a row inside a SMALL editor box: the
      menu must overflow the box freely (portal) and stay anchored to its
      trigger through page scroll, window resize, and layout shifts (e.g.
      height-dragging the composer editor while open).
- [ ] The menu renders above floating frames and drawer modals (z 10260).
- [ ] Drag-move and corner-resize the menu; near the right viewport edge it
      clamps inside the viewport without jitter.
- [ ] The design-system anatomy stories (/docs/design-system →
      thing-context-menu) still lay out statically inside their canvases
      (`inline` mode).

## Post engagement row & comment threads (`remix/app/components/Feed/PostCard.tsx`)

- [ ] The action row is icon + count ONLY (no text labels): 💬 comments with
      the merged react button DIRECTLY beside it, then 🔁 repost and ↗ share.
      Comment rows mirror the pattern — reply icon then react control inline
      under the bubble (no right-edge column) — and the react popup + full
      picker open without clipping from the left-side positions.
- [ ] The merged react button shows ALL the viewer's own reaction tokens
      FIRST, then the crowd's top remaining tokens by count (+ total; heart
      outline at zero), and tints accent when the viewer holds a reaction.
      Click, hover, and touch-and-hold all open the quick-react popup on the
      POST button; picking an emoji applies optimistically (no wait), and ＋
      opens the full custom picker.
- [ ] Threads that mount OPEN (the two-level ship, drill-panel roots)
      revalidate in the background even when the cache already covers their
      reply count — reactions/edits made elsewhere reconcile in within a
      beat. Regression: cache-complete threads skipped the mount refetch and
      froze reply reactions at the cached snapshot forever.
- [ ] RACE (devtools: delay `/api/v1/things?id=` responses ~3s): tap a
      reaction while a thread/feed/permalink fetch is in flight — the tap
      must survive the stale response landing (no disappear/reappear, no
      wrong counts), and a fresh reload must converge on the server truth.
      All server-copy ingestion merges through `reactionOverlay` stamped
      with the fetch START time; every local mutation notes itself there.
      Regression class: background refetches snapshotted pre-tap clobbered
      optimistic (even acked) reactions wholesale on ingest.
- [ ] ERROR CONTEXT (devtools: fail `/api/v1/things/react` once with a Nitro
      `{error:true,status:500,unhandled:true}` response): Lopu shows a readable
      “couldn’t confirm” title plus server/refresh guidance — never a lone 🌧️.
      The client refetches that thing before deciding whether the optimistic
      reaction stuck; if the truth fetch also fails, it keeps the optimistic
      copy and warns the viewer to refresh before retrying instead of blindly
      toggling the reaction back. An authored 4xx/503 message remains visible
      verbatim and safely reverts a server-marked rejection. A malformed or
      truncated 2xx mutation response is commit-unknown and follows the same
      truth-reconciliation path. Login `reason` and account-switcher `accounts`
      fields still survive the shared error normalization.
- [ ] Comment rows: reply is an icon-only toggle under the bubble with the
      merged react control right beside it — a SINGLE tap hearts the comment
      (❤️, optimistic, tap again to unheart) while hover / touch-and-hold
      opens the quick-react popup (the POST button's click still opens the
      popup). The thread reveal is a "View N replies / Hide replies" text
      link BELOW the comment; "Show previous replies/comments" reveals from
      BELOW the lists. Reply avatars (20px) are smaller than parent comment
      avatars (28px).
- [ ] The "Write a comment… / Reply to…" pills are subdued: house grey
      border + muted placeholder (never Chakra's default near-black
      outline).
- [ ] Threads never flatten and have NO max depth: opening replies (or the
      reply input) at visual depth 4 slides that comment in as the panel's
      new top-level row (slide-right animation; the back arrow slides left to
      return one level), with its replies restarting at depth 1 — repeatable
      indefinitely. Closing comments exits the drill-down back to the root.
- [ ] The server never caps thread depth either: replying at depth 65+ still
      creates, and a deep comment's permalink resolves its parent AND walks
      all the way back to the root post. Cycle safety in the visibility and
      parent-chain walks is a visited set, never a depth rail (regression
      class: 4-hop, then 64-hop caps 404ing deep replies as "Post not
      found").
- [ ] Repost is a menu: instant "Repost" posts immediately (toast + count
      bump); "Quote post" opens the caption + circle popover. Share is
      OUTWARD only: native share sheet where available, otherwise copy-link
      with the Lopu toast — logged-out users can still share, while react /
      repost nudge them to log in.
- [ ] The owner's ⋯ menu is Edit ✏️ / Copy link 🔗 / a Privacy radio group
      (current circle checked) / Delete 🗑️ — not Delete alone. Copy link
      always copies to the clipboard (never the native share sheet); a
      privacy pick updates the header circle badge optimistically and
      persists (server acl follows, e.g. friends → `-tt:all`,
      `tt:userFriends`, `tt:user`).
- [ ] Edit ✏️ mounts the FULL composer suite inside the card, pre-filled
      from the post: type tabs (text/photos/marketplace/thingtime), text,
      image rows, listing fields, thingtime draft seeded with the post's
      existing thing, tags, and the post's CURRENT circle. Save persists
      text + circle and swaps the card to the server copy; the close X
      cancels without changes. Shares edit their caption only (the nested
      original stays visible below the textarea).

## Drawer navigation & settings (`remix/app/components/Nav/Drawer/`)

- [ ] Clicking a NAVIGATING drawer item (top-level or sub-item) closes the
      drawer after navigating on BOTH desktop and mobile; items without a
      destination only select their submenu and keep it open. Search keeps
      its own "Search closes drawer" setting on desktop.
- [ ] Settings → Drawer → "Close after click" lists every menu item (auth
      filtered, children nested under their top item) with per-item
      switches defaulting ON; turning one off keeps the drawer open for
      that item's clicks and persists across reloads.
- [ ] The drawer footer avatar, composer avatars, and account switcher rows
      show the user's avatar IMAGE when one is set — the rainbow initial
      circle is only the no-avatar fallback (regression: UserAvatarCircle
      ignored avatarUrl entirely).
- [ ] The drawer account footer splits: clicking the avatar/name row goes to
      /profile (drawer dismisses on both viewports) while the gear button
      opens the settings modal (desktop centred modal, mobile bottom sheet)
      WITHOUT navigating. Logged out, the row reads "Log in" and opens the
      settings modal (account switcher hosts log-in) instead of navigating.

## Profile page (`remix/app/components/Profile/ProfilePage.tsx`)

- [ ] The self-profile action row is Edit profile ✏️ / All settings ⚙️ /
      Log out 🗝️ (+ Resend verification when unverified): All settings
      navigates to /settings, and the buttons wrap cleanly on mobile with no
      overflow.

## Required Web CI contexts (`.github/workflows/web-ci.yml`)

- [ ] On a PR that changes `remix/`, confirm the real build and API jobs report
      `Build + typecheck ratchet + unit tests` and `API suite (headless /tests
      runner)`, while both required-context companion jobs have distinct
      skipped names and cannot satisfy a failed real job. Reusable callers keep
      the same inner names under their existing `control-plane /` prefix.
- [ ] On a PR with no `remix/` or `.github/workflows/web-ci.yml` changes,
      confirm the lightweight companions report both exact required-context
      names successfully and the expensive build/API jobs have distinct
      skipped names. Neither context may remain in Expected/Pending state.
- [ ] Break the path-classification job deliberately in a disposable branch.
      Confirm neither exact required-context name is emitted and branch
      protection blocks the PR instead of treating a skipped job as proof.
- [ ] Break either product workflow/topology contract in a disposable branch.
      Confirm neither command runs inside `test:unit`, build/API keep their
      real result, and the protected `github-actions` advisory updates one
      warning comment without producing a failing or required status.

## AI merge-conflict resolver (`.github/workflows/resolve-pr-conflicts.yml`)

- [ ] Create standalone same-repository merge-conflicting PRs targeting
      `main` and a non-default base. Confirm both are detected and updated,
      while a clean PR, a fork PR, a protected head, and the default branch
      are never resolver push targets.
- [ ] Exercise a base-branch push, a head-branch push, PR opened/reopened, the
      scheduled repository scan, a blank manual scan, and exact PR/base/head
      manual selectors. Push detection must find PRs both targeting and
      originating from the pushed branch. A global scan spanning three
      conflicted PRs must dispatch exactly three trusted per-PR workers to the
      fixed `develop` workflow revision. Human/manual and legacy
      `repository_dispatch` runs must stay detector-only; only a bot-authored
      internal handoff on `develop` with a positive PR, blank branch, and valid
      depth may load the model or resolve.
- [ ] Give a manual exact-PR/base/head selector that matches no open PR and
      confirm the detector fails with actionable log and step-summary output.
      Give one that matches only clean, UNKNOWN, fork, protected/default-head,
      paused, or rebase-owned PRs and confirm it succeeds with a visible
      no-worker warning/summary rather than silently skipping downstream jobs.
- [ ] Create a normal two-PR stack and confirm its members are excluded before
      either ownership label exists. Add `no-ai-rebase` and confirm that member
      becomes merge-owned. Add a fresh `ai-rebase-in-progress` mutex and confirm
      the merge resolver abstains. Confirm a pause label alone never determines
      ownership: if topology/verdicts transition the PR to merge ownership, the
      merge resolver verifies and clears stale `ai-rebase-paused` before work.
- [ ] Force an unchanged eligible merge-resolution failure and confirm it adds
      `ai-merge-paused`; scheduled, push, PR-target, and blank-manual scans must
      abstain afterward. An exact PR/base/head manual run must carry internal
      retry intent, clear the hold, and retry. A failure after the
      head/base/topology/ownership changes must not leave a stale pause label on
      the newly owned state. Verify the hidden pause marker is accepted only
      from `github-actions[bot]`, requires the complete strict schema, and
      round-trips the exact refs, SHAs, owner, and topology.
- [ ] Feed a mocked global scan more than 1,000 open PRs across GraphQL pages.
      Confirm every page is combined exactly once and conflicting PRs on every
      base remain eligible for their unique per-PR handoff. Give one resolved
      head more than 30 direct child PRs and confirm the cascade's explicit high
      limit dispatches every child number to `develop` without truncation.
- [ ] Move the head, move the base, change stack topology or ownership labels,
      close the PR, or protect the head while a run is resolving. Every case
      must refuse publication. An exact-head lease must preserve concurrent
      work; if `git push` reports a transport error after the exact commit
      lands, the live-ref check must classify it as published rather than
      retrying it.

## Per-feature develop → main promoter (protected `.github/scripts/promote-features-to-main.mjs`)

- [ ] Merge a standalone source PR whose exact promotion patch conflicts with
      `main`. Confirm the thin `develop` caller contains no executable behavior,
      retains `actions: write`, and invokes the protected promoter. The promoter
      must first prove the historical source patch is still effective at the
      current `develop` tip, then create one immutable reservation branch,
      dispatch one bot-authored worker to the fixed `github-actions` resolver
      revision, and continue processing unrelated groups. The worker must
      re-derive the source plan and live base/branch SHAs, resolve the conflict,
      replace the reservation with an exact-lease push, and open the promotion
      PR without any manual cherry-pick or follow-up promoter run.
- [ ] Confirm an automatically resolved promotion PR has the `promotion`,
      `ai-conflict-resolved`, and `review-ai-resolution` labels plus an upserted
      comment naming the immutable source/base SHAs, resolver run, and exact
      files that require review. Its merged source PR must link to the created
      promotion PR. A Graphify-only collision must say it was resolved
      deterministically without invoking a model.
- [ ] Put a creation-time conflict in the middle of a three-member promotion
      stack. The first member must remain the verified base, the conflicting
      member must be queued exactly once, and a trusted follow-up promoter run
      must resume the final dependent member on the resolved promotion branch.
      A failed worker may defer only its dependent members; unrelated clean and
      conflicting groups must continue independently.
- [ ] Race the worker by moving the source tip, target base, or reservation
      branch before resolution and immediately before push. Every stale worker
      must stop without overwriting newer work, then permit a changed snapshot
      to be planned automatically. Repeat after crashes following reservation
      push, resolved-branch push, and PR creation; reruns must converge on one
      branch, one promotion PR, and one current status comment.
- [ ] Attempt the internal promotion handoff manually, from a feature workflow
      revision, with malformed SHAs/refs, or with mismatched source/base/plan
      metadata. No secret-bearing worker may start. During a valid run, make the
      model leave conflict markers, edit a clean/non-planned path, introduce an
      unsafe file type, or alter the trusted workflow/action copy. Verification
      must reject publication and leave an exact-snapshot `ai-promotion-paused`
      review comment instead of repeatedly spending model budget.
- [ ] Promote a source whose diff includes `graphify-out/**`. Source-side
      Graphify artifacts must never be cherry-picked or supplied to the model;
      regenerate them from the exact promotion base plus selected feature and
      verify the portable graph pair is coherent before publication.
- [ ] Replace the Graphify executable in the worker fixture with one that
      changes `HEAD` while leaving a clean worktree. Refresh and publication
      must fail closed. A legitimate derived Graphify commit must be exactly
      one direct child of the already-verified source head and may change only
      the approved Graphify output paths.
- [ ] Set `conflict-marker-size=10` for a planned text path and leave real
      10-character start/base/end markers after the model round; verification
      must reject them. A standalone Markdown `=======` divider must remain
      valid and must not be treated as an unresolved conflict.
- [ ] Exercise both conflict-free and AI-resolved promotions that change
      `.github/**` after source authority is positively verified. Confirm their
      bot-authored content commits carry `[skip ci]` rather than executable
      historical commit messages, the promotion PR is created by
      `GITHUB_TOKEN`, and an empty non-skip review-checkpoint child produces
      approval-gated `pull_request` checks without executing the edited
      automation automatically. Crash before/after checkpoint push and leave
      duplicate pending comments: the next promoter run must recover the one
      live checkpoint, make the latest final attestation authoritative, and
      repair all review labels/comments idempotently.
- [ ] Move the promotion base after the resolved content branch is published.
      Confirm the bot records an exact durable retirement, closes and
      lease-deletes only its unchanged stale branch, and requeues the source.
      Stop after close and before delete, then repeat with a concurrently moved
      branch and a transient reopen failure: recovery must resume exact cleanup
      or preserve/reopen the moved branch, cancel every stale retirement event,
      and respect a later intentional reviewer closure.
- [ ] Merge a feature PR into `develop`, record its two-parent merge SHA, then
      force-rewrite `develop` to an equivalent cherry-pick so that merge object
      is no longer advertised by any ref. From a fresh full clone, confirm the
      promoter's self-test first proves the object is absent, fetches it by
      exact SHA with both parents, proves a stable patch-equivalent commit is
      still effective at the current `develop` tip, performs the mainline
      cherry-pick, and gets the expected tree. Repeat after a later revert and
      with overlapping source edits that make both forward and reverse checks
      inconclusive: the exact patch must remain mechanically recoverable, but
      the promoter must classify the full aggregate range, not only its last
      commit, as removed or ambiguous and block visibly before creating any
      reservation, branch, AI worker, or promotion PR.
- [ ] Exercise both a mechanically clean replay and a potentially conflicting
      replay whose recovered source patch is removed or ambiguous at current
      `develop`. Each must create no reservation, branch, immutable promotion
      plan, AI worker, or promotion PR; the blocked summary must name the checked
      `develop` tip and lineage classification. Defer only later members of that
      promotion group while unrelated groups continue, and confirm no review
      branch or PR is opened.
- [ ] Move `develop` so a previously ambiguous blocked source becomes
      verifiably present. A later run may proceed only after freshly proving
      source authority and must create a new verified plan rather than upgrading
      the blocked result in place. Conversely, a still-removed or ambiguous
      patch, missing merge object, unreadable or empty exact patch, Git
      inspection failure, or unknown lineage enum must create no reservation,
      branch, worker, or PR and remain visible in the blocked summary. A worker-
      observed classification mismatch after verified dispatch must stop before
      publication and leave a visible blocked result.
- [ ] Run the orphaned-history self-test with the clone's Git author name
      deliberately empty. The attempted mainline cherry-pick must return an
      operational error, abort the sequencer, leave `HEAD` at the target base,
      and clean both the index and tracked worktree instead of treating the
      words `empty ident name` as an empty source patch.
- [ ] Configure a valid Git identity, apply the recovered source pick, then
      apply that identical pick again. The second, genuinely empty pick must
      be skipped from verified sequencer/index state and leave the promoted
      tree unchanged.
- [ ] Give one standalone source PR an invalid or unavailable historical merge
      object between two valid standalone PRs. A dry run must report that PR as
      blocked, continue to plan the later independent PR, and publish both the
      block and partial plan in the step summary without exiting early.
- [ ] Repeat with the unavailable PR in the middle of a named promotion stack.
      The failed member and only its later dependent stack members must be
      deferred while the next unrelated group continues. Force an unexpected
      group-local Git error as well and confirm later groups still run.
- [ ] Re-run after a partial batch has already created promotion PRs. Existing
      `promotion-of` markers and branches must prevent duplicates, including
      records older than the first 200 repository PRs, while `MAX_NEW_PRS`
      counts reused branches as newly opened PRs too. Force-update an open
      promotion branch between runs and confirm the promoter fetches its live
      OID before stacking the next member rather than using a stale local ref;
      a repurposed branch, same-path/whitespace drift, duplicate provenance,
      or an OPEN promotion targeting the wrong stack base must be blocked. For
      an external stack, validate every OPEN link back to `main` and every
      CLOSED source merged before the current group; any unshipped earlier
      CLOSED member must stop dependents, while a later successor must not be
      misclassified as their prerequisite.

## PR conflict resolver model waterfall (`remix/app/components/Admin/`)

- [ ] Logged out, `GET /api/v1/settings/pr-conflict-auto-resolver-model-waterfall`
      returns the public key, ordered waterfall, and curated model catalog;
      `POST` returns 401. A signed-in non-admin `POST` returns 403, while an
      admin can save a valid reordered waterfall.
- [ ] Settings → Admin paints the last-known waterfall immediately, then
      reconciles in the background. Add Fable 5 and Opus 5, drag a row by its
      dedicated handle, use the Up/Down controls, remove a non-default row,
      save, reload, and confirm the exact order persists. `default` stays
      present and cannot be removed.
- [ ] Exercise the editor at desktop and mobile widths from the top to the
      bottom of `/settings`: model names, Max-effort badges, handles, fallback
      copy, and save/add/remove controls never clip, overlap, or create
      horizontal scrolling.
- [ ] Resolver workflow config parsing accepts only `default`,
      `claude-fable-5`, and `claude-opus-5`, preserves their public order, and
      appends `default` defensively. An unavailable endpoint, malformed JSON,
      duplicate/unknown model, wrong key, or empty array emits a warning and
      selects only `--model default`; no stored value can inject another CLI
      flag.
- [ ] Save a new Admin order, then issue GETs through separate warm app
      instances immediately (no 15-second wait): both must read the new
      home-DB value. With Mongo unavailable, a warm instance may return its
      last-known-good order and a cold instance must return only `default`.
- [ ] Put `claude-opus-5` first and exercise a merge conflict, a replay/rebase
      conflict, and each workflow's semantic Graphify refresh. Logs must show
      the same Admin-selected primary for every Claude/Graphify invocation;
      no refresh may inject literal Sonnet. Repeat with `default` first and
      confirm Graphify leaves its backend default unforced. Run
      `node remix/scripts/workflow-caller-contract.mjs --self-test` in the
      product branch and `node .github/scripts/workflow-control-plane-contract.mjs
      --self-test` in the `github-actions` control plane to prove both the
      delegated callers and every AI runtime remain bound to the contract.
- [ ] Request an AI-backed Lopu musing with an Anthropic key and confirm its
      Anthropic request uses the same current Admin primary. Reorder from Opus
      to Fable without restarting the app; the next musing must use Fable.
- [ ] Put `default` first and request an Anthropic-backed Lopu musing. It must
      use the provider-valid `LOPU_CLAUDE_MODEL` fallback, never send the
      literal Claude Code `default` sentinel to Anthropic. With OpenAI first,
      the OpenAI call must retain `LOPU_OPENAI_MODEL`; if it falls through to
      Claude, that Claude call must still resolve the current Admin preference.
- [ ] With an availability failure on the first configured model, Claude
      Code tries the ordered native fallback chain. A completed run that still
      leaves conflict markers stops for manual review; it does not silently
      spend another model attempt.

## AI PR/stack rebase resolver (`.github/workflows/rebase-pr-stacks.yml`)

- [ ] Create standalone same-repo PRs against `main` and against a non-default
      branch whose heads are `mergeable: true` but `rebaseable: false`.
      Confirm automatic, scheduled, push-triggered, PR-triggered, and blank
      manual scans leave both histories untouched: they are not stacks and
      already merge cleanly. An explicit PR-number retry may still replay one
      deliberately. Then make a standalone PR genuinely merge-conflicting and
      confirm only **Resolve PR conflicts (AI)** owns it. Regression class:
      standalone replay failures were incorrectly force-rebased and could
      ping-pong with a merge-resolver update.
- [ ] Create a two-PR stack (child PR based on the root PR's head). After the
      root is rebased, confirm the child dispatch receives the old and new
      parent SHAs, replays with onto semantics, and completes root-to-leaf
      without duplicating the parent's commits. Confirm a stack member with
      either `mergeable: false` or `rebaseable: false` remains rebase-owned,
      while a clean stack is left alone.
- [ ] Exercise detection from a branch push, PR opened/reopened event, the
      scheduled scan, and a manual PR-number dispatch. Automatic scans evaluate
      every same-repo PR regardless of base branch, never dispatch a
      standalone history rewrite, route standalone merge conflicts to the
      merge workflow, do not race a blocked child ahead of its parent, and
      terminate after resolution instead of looping on the workflow's own
      push. A blank manual dispatch must perform the same repository-wide scan.
- [ ] Return unknown merge/rebaseability for several PRs at once and confirm
      polling proceeds round-robin, giving every candidate an API check in each
      bounded round. Exercise a stack deeper than eight PRs and confirm it is
      still ordered and cascaded root-to-leaf (the hard loop guard is 64).
- [ ] Add `no-ai-rebase` before detection and confirm the PR is skipped. Force
      a resolver failure, confirm `ai-rebase-paused` is added and automatic
      scans leave the exact failed snapshot alone, then change a ref or topology
      and confirm the stale hold is cleared and re-detected. Review an unchanged
      run and confirm a deliberate manual retry is available. Transition a PR
      from merge-owned/`ai-merge-paused` to rebase-owned and vice versa; the new
      owner must clear only the opposing pause after proving ownership, while a
      fresh `ai-rebase-in-progress` mutex always blocks publication. Queue a
      retry, then add a fresh same-snapshot pause or change its resolver owner;
      the queued run must not erase that newer hold. Publication must require
      pauses to be absent, and post-push cleanup must preserve any pause created
      for the newly published snapshot. While a parent is
      paused, actively owned, protected,
      or still has unknown rebaseability, confirm an automatically detected
      conflicting child is held back; once that same parent is confirmed
      rebaseable, the child may become the next root. Confirm stack members are
      excluded from the merge-based resolver before ownership labels exist;
      `no-ai-rebase` deliberately routes a merge-conflicting member back to it.
- [ ] Leave an `ai-rebase-in-progress` label behind for more than 90 minutes.
      Confirm a still-conflicting PR is recovered into a new exact dispatch,
      while a now-clean PR has the orphaned lock removed without a rewrite. A
      manual clean retry should also clear a stale `ai-rebase-paused` label.
- [ ] While a run is resolving, push another commit to the PR head. The exact
      force-with-lease must reject the stale rewrite; no partial rebase may
      reach the remote branch and the concurrent commit must remain intact.
- [ ] Present a fork PR, the default branch, and a protected branch. Each is
      refused before Claude or a force push runs. A conflict file that attempts
      prompt injection cannot make Claude edit outside the recomputed conflict
      set or invoke Git/shell; trusted verification rejects unresolved markers,
      unmerged index entries, and out-of-scope changes before any push.
- [ ] Resolve a PR whose final diff touches `remix/` using only `GITHUB_TOKEN`.
      Confirm the rewritten SHA receives an explicit **Web CI** workflow run;
      a non-web diff should not spend a redundant CI dispatch.
- [ ] Add a non-conflicted tracked symlink targeting `.git/config`, plus a
      conflict prompt that asks Claude to read/write through it. Confirm the AI
      workspace contains only regular copies of the exact conflict files and no
      repository, symlink, trusted action, or Git metadata. Add an external or
      `.git`-targeting tracked symlink and confirm graphify validation refuses it
      before semantic extraction or publication.
- [ ] Change the repository default branch while a resolver fixture is paused,
      and simulate a push whose server-side ref update succeeds but whose client
      exits nonzero. The adjacent pre-push default-branch check must prevent a
      default ref rewrite, while post-push ref inspection must report the actual
      published state rather than claiming the remote stayed unchanged.

## Data crystals & nesting depth (`remix/app/schemas/registry.ts`)

- [ ] Post a thingtime post whose thing contains an Editor.js document (or
      any structure) nested well past 6 levels: it must save. There is NO
      validator depth rail (the walk is iterative, so nesting never touches
      the JS call stack); the only depth bound is MongoDB's physical BSON
      limit (MAX_STORABLE_NESTING, probed at 179 crystal levels on mongod
      8.0; crystal.thing payloads get one less), reported as a precise 400
      naming MongoDB — never a raw driver 500. Circular or repeated object
      references also 400 loudly (identity WeakSet).
- [ ] Oversized payloads still fail loudly: >10000 nodes, >1000 array items,
      or a key with `$`/dots must 400 with a precise message, never silently
      drop data.
- [ ] `["post","data"]` combinations still 400 (data crystals stand alone);
      a thingtime post's free-form payload lives ONLY under `crystal.thing`.
- [ ] Unique-slot squat class (closed structurally): relationship dedupe
      rides the server-only root `uniqueKeys` namespace
      (`<crystalField>:<key>` BinData, stamped in `messenger/shared.ts`
      `newThingDoc` + the friend writer): after a follow/friend/DM/join/
      invite/emoji create, the doc must carry `uniqueKeys`, a duplicate
      insert of the same key must E11000 on the `uniqueKeys` index, and the
      seven crystal-path indexes (including `voteKey`, even while the poll
      product remains deferred) must be the non-unique `things_*_lookup`
      generation (old `things_*_unique` names dropped by the boot-time
      ensure swap, including the superseded `things_follow_unique` marker
      generation — verify with `getIndexes()`). Legacy docs get stamped by
      the idempotent `backfill-relationship-unique-keys` migration, whose
      notes also census (never modify) data things carrying relationship
      names from the pre-fix era. Unit coverage:
      `remix/app/api/utils/messenger/relationshipUniqueKeys.test.ts`.
- [ ] The data-crystal namespace reserves NO names: a data thing carrying
      `followKey`, `memberKey`, `dmKey`, `inviteCode`, `emojiKey`,
      `friendKey`, or `voteKey` at its crystal root (any nesting, any value
      type) saves as ordinary data, collides with nothing, and never blocks
      or is blocked by real relationship flows — verify a data thing with
      `crystal.followKey` equal to a real pair key coexists with that real
      follow. New unique indexes over crystal paths reachable by free-form
      data crystals are forbidden (see KIND-BLIND HISTORY in
      `collections.ts`); dedupe belongs in `uniqueKeys`. API coverage:
      `things-data-relationship-names-open` in the /tests suite.

## Feed & profile advanced filters (`remix/app/components/Feed/AdvancedFilters.tsx`)

- [ ] Filters ▸ Advanced opens the panel between the controls row and the
      composer; applying keeps the last-known posts rendered while loading
      (no skeleton flash); a FAILED search clears to the honest empty state.
- [ ] A sort-only search (e.g. oldest, nothing else) applies; relevance with
      no text does NOT activate advanced mode.
- [ ] Shortcuts round-trip: tags, by-user (unknown user = empty result, not
      an error), min reactions/comments (bounded-window mode), text length.
- [ ] Profile panels are locked to the profile's user (no By-user field) and
      the header post count stays the profile total, not the filtered count.

## Search page (`remix/app/components/Search/SearchPage.tsx`)

- [ ] Visiting plain `/search` fires NO search request (check the network
      tab): last-cached results still paint instantly, and with no cache the
      empty state invites a search ("then hit Search"), never claims
      "Nothing matched".
- [ ] Deep links still auto-run their search: `/search?q=…` (Commander's
      "Search things for…") and `/search?schema=…` (from /schemas).
- [ ] Submit a search and navigate to another page BEFORE it resolves: you
      stay on that page — the resolving search must never replace-navigate
      back to `/search` (or eat the destination's history entry). This
      includes loader-bearing destinations (`/login`, `/welcome`, `/status`)
      where /search stays mounted while the departure is pending, and Back
      from `/search?q=…` to plain `/search` (must not be undone).
- [ ] With a cache-restored query (input pre-filled from a previous session,
      no search run yet), Commander's "Search things for…" with that same
      text still fires a fresh search — the ?q= echo guard compares against
      the last q the page itself synced, never live input state.
- [ ] A submit rejected by number-validation, or a failed request, keeps the
      invite empty state ("then hit Search") — only a RESOLVED search may
      claim "Nothing matched". A failed first page also must not poison
      Load more: it continues the previous result set's query, not the
      failed one's params.
- [ ] A dead `?schema=` deep link (unknown/invisible shareId) toasts, strips
      the param from the URL, and fires NO fallback search; while a live
      `?schema=` resolves, no empty-state copy shows at all.

## Admin migrations & collection generations (`remix/app/components/Schemas/MigrationsPanel.tsx`)

- [ ] As an admin (register a throwaway user, restart dev with
      `ADMIN_USERNAMES=<user>`), the census table shows every registry
      collection with its logical name AND physical `<name>_v<N>` name.
- [ ] The Storage generations table lists every physical collection with a
      current / stale / ahead badge, and doc counts.
- [ ] After first boot against a pre-versioning db, adoption has renamed
      unversioned collections in place (`things` → `things_v2`) — data (users,
      sessions, posts) is still all there, no re-login required.
- [ ] `merge-legacy-collections` dry-run reports per-collection copy counts and
      writes nothing; the real run copies only docs missing at the destination
      (re-run reports 0) and never deletes a legacy collection.
- [ ] Against a disposable replica-set database, the first registered and
      sandbox app-storage counter can be created without MongoDB code 224:
      the ensure upsert uses only the deterministic `shareId`, while the
      returned document must still pass the complete protected-envelope check.
      A malformed Thing occupying that id remains untouched and returns the
      authored storage-invariant error.
- [ ] Remove `storageClass` from existing reserved, system-owned `schema-*`
      builtin schema Things. `seed-builtin-schemas` reports each as pending and
      restores `storageClass: "control"`; running
      `backfill-user-storage-accounting` directly invokes that repair first.
      A community/user-owned `thingtime: ["schema"]` Thing remains billable.
- [ ] Force a migration runner exception once: the public error field remains
      a safe exception class/code (never a raw Mongo message, query, document
      id, host, or credential), and Lopu renders contextual text beneath the
      migration id — never a title-only/decoration-only toast. A failed real
      run refreshes pending counts because an idempotent subset may have landed;
      a failed dry run does not claim that a write outcome is ambiguous.
- [ ] On a failed real migration, the private response carries a validated
      `migration-diagnostic-*` id and Lopu shows “View full migration
      diagnostic”. The link opens `/thing/:id` at the top of the page, reloads
      successfully, shows the bounded redacted stack/detail as plain text, and
      identifies its capture/expiry time. A different admin, a signed-in
      non-admin, and an anonymous caller cannot read it; missing, expired, and
      inaccessible ids share the same 404 shape.
- [ ] Force the `orphan_billable_thing` error with a Mongo ObjectId. The normal
      diagnostic GET and `/thing/:id` detail contain only a numbered
      `[redacted MongoDB ObjectId #…]` placeholder plus a value-free reveal
      descriptor; the raw id is absent from `crystal`, normal GET JSON, generic
      Thing get/list/search, and the redacted detail. A legacy v1 diagnostic
      remains readable and shows no Reveal controls.
- [ ] On `/thing/:diagnostic-id`, click Reveal, enter the current owning admin's
      correct password, and confirm exactly the selected ObjectId appears. Hide
      it, switch account, navigate away, and background the tab; each clears the
      transient value. Every later Reveal prompts for and verifies the password
      again. A wrong/old password returns the same generic failure, another
      admin or non-admin receives no value, and five confirmation requests
      (including successes) in 15 minutes hit the fixed fail-closed ceiling.
      Success and every error carry `private, no-store` and `Pragma: no-cache`.
- [ ] Throw diagnostics containing a 24-hex password/token/authorization value,
      structured password/token values, a multi-value Cookie header, a
      connection-string credential, a sensitive URL query value, and an
      unlabelled 24-hex string. Each is irreversibly redacted and none appears
      in the private reveal table. No reveal request accepts a caller-selected
      owner, kind, field name, JSON path, or raw `secure` blob selector.
- [ ] On a failed migration dry run, no diagnostic Thing is written and the
      complete bounded redacted detail appears in a long-lived, scrollable
      Lopu toast. Force diagnostic persistence to fail on a real run and verify
      the same inline fallback appears without replacing the original migration
      status, summary, or mutation outcome.
- [ ] Confirm migration diagnostics use `storageClass: "control"`, owner-only
      ACL, an opaque binary `secure` detail, a root `expiresAt`, the home data
      plane, a 30-day home-only TTL index, and best-effort newest-25 per-admin
      retention.
      Generic Thing get/list/search/create/update/delete must neither expose nor
      forge them; custom Mongo endpoints must never receive the diagnostic TTL.
- [ ] Force each typed migration operator failure once: the response uses the
      closed lease/concurrency/prerequisite/repair/invariant message catalogue,
      includes only registered migration ids and aggregate counts, and keeps
      Mongo `_id`, ownerId, appId, shareId, query text, hosts, and stacks out of
      the public response. Only ObjectIds supplied through an explicitly
      authored server-side context may enter the protected diagnostic reveal
      table; all other private context stays in server logs. Recoverable
      conflicts return 409 while still marking a real
      run commit-unknown so the panel refreshes potentially changed counts.
- [ ] `drop-stale-collection-generations` shows the red destructive badge;
      dry-run lists exactly what would drop with doc counts; a non-dry run
      without `confirm: true` is rejected by the API (the panel sends it after
      the inline Really run? confirmation); the run refuses to drop a legacy
      collection that still has unmerged docs and says so in the notes.
- [ ] Raw admin Mongo queries (`/api/v1/mongodb/raw-results`) still take
      LOGICAL collection names ('things'), including `$lookup`/`$unionWith`
      pipeline targets and collectionStats, and hit the versioned physical
      collections.

## Docs code windows & embed SDK preview (`remix/app/routes/docs/docsCode.tsx`, `remix/app/routes/docs/embed.tsx`)

- [ ] Shell samples with bare URLs (`curl -X POST https://…`) highlight the
      URL as plain text — never as a `//` comment from the protocol slashes
      onward; real `//` and `#` comment lines still render muted.
- [ ] JSON samples color negative numbers as numbers (yellow), not as CLI
      flags (blue); shell flags (`-H`, `--data`) stay flag-blue.
- [ ] On /docs/embed, blocking `/sdk/thingtime-login.js` (devtools request
      blocking) swaps "Loading the SDK…" for the failure notice with the
      standalone-demo link within ~10s — the preview must never show a
      permanent loading state.

## Installed-app Login with Thingtime (loopback + PKCE)

- [ ] Register a disposable app with the exact callback origin
      `http://127.0.0.1:<port>`, bind a loopback receiver before opening
      `/authorize`, and pass `redirect_uri`, a random `state`, and an S256
      `code_challenge`. Approving redirects to the exact callback path with only
      `code` + the original `state`; no app access token appears in the browser
      URL, page storage, or postMessage.
- [ ] Exchange the code once at `POST /api/v1/oauth/token` with the original
      verifier, clientId, and the same normalized redirectUri; call
      `/api/v1/oauth/userinfo` with the returned Bearer token and confirm the
      selected account/scopes. Replaying the code or changing the verifier,
      clientId, redirect URI/path/port, or registered origin must return the same
      bounded `invalid/expired/used/mismatched` 400 and mint no app session.
- [ ] Reject HTTPS, `localhost`, `0.0.0.0`, non-loopback hosts, missing or
      privileged ports, callback credentials/query/fragments, `plain` PKCE, and
      malformed verifier/challenge lengths. Cancellation redirects with
      `error=access_denied` and the original state but no code.
- [ ] Present an `oauth-code` JWT as an Authorization Bearer token to
      `/api/v1/auth/me`, `/api/v1/auth/accounts`, and an account-authenticated
      write including `/api/v1/things`: it must never resolve as a
      browser/account credential. Delete or
      suspend the app, remove the callback origin, or delete the user between
      issuance and exchange; exchange must fail closed.

## Commander desktop launcher

- [ ] Launch the installed `~/Applications/Commander.app`, verify the signed
      app starts its bundled Node daemon and Rust search child, then open/close
      the launcher repeatedly with the configured global shortcut. The search
      input must already be focused and no blank WebKit frame may flash.
- [ ] Force-terminate the Commander host and verify its parent watchdog stops
      the Node/Rust children and releases port 47820. A subsequent verified
      install must start a new host-owned daemon rather than accept stale health.
- [ ] Search `settings`, press Return, and verify the separate native Settings
      window. Exercise every General option, record a custom shortcut, quit and
      relaunch, and confirm hotkey/menu-bar/login-item state is restored.
- [ ] Search apps with prefix, substring, keyword, and fuzzy queries; navigate
      with arrows, execute with Return, open Command-K, traverse actions, and
      dismiss actions/launcher with Escape. Long names must not clip or create
      horizontal scroll in default or compact mode.
- [ ] Search typo variants such as `settngs`, `extensoin`, and `raycsat` across
      apps, commands, extensions, files, and folders. Repeatedly choose a lower
      equivalent result, rerun the same query, and verify device-local learned
      ranking promotes it after a full Commander relaunch without changing an
      unrelated query.
- [ ] Open Search Settings. Verify hidden files and unlimited entries are the
      migrated defaults, the SQLite database footprint uses B/KB/MB/GB, and a
      custom cap persists and can be cleared back to Unlimited. Index a hidden
      file, extensionless executable, broken symlink, special Unix file, and
      nested `.app`; verify each reference is searchable without following links
      or recursively indexing package contents.
- [ ] With more than one million indexed records, leave Search Settings open
      across at least four two-second polls. Counts and database size must remain
      populated without a five-second timeout or zero-state flash. Search a long
      nonexistent term and verify the reader remains responsive or self-recovers
      before the next status request.
- [ ] Search `accessibility`; verify Accessibility Settings is the first
      `System` result and Return opens the exact Privacy & Security →
      Accessibility pane without changing any permission. Repeat with Screen
      Recording, Full Disk Access, Login Items, and Displays; non-macOS
      bootstrap catalogs must omit these platform-only entries.
- [ ] Drag an application result into a disposable Terminal prompt and verify
      the exact `.app` path is inserted through a native file-URL drag without
      opening it. Clear the prompt without executing it; single and double click
      on that result must still preserve normal selection/execution behavior.
- [ ] In Extensions Settings, record, invoke, rebind, and Delete-clear a global
      command shortcut. A duplicate command binding or collision with the
      launcher hotkey must fail before persistence and restore the complete
      previously working native registration set.
- [ ] Bind Search Emoji & Symbols to Command-E. From another app, press
      Command-E and immediately type `heart`; the picker must remain visible
      and focused. Dismiss it, press Command-Space once, and verify the normal
      launcher reappears. Hide Commander with Command-H and verify one
      Command-Space press unhides and presents it again.
- [ ] In Search Emoji & Symbols, type `ear` and verify WebKit/macOS shows no
      spelling or autocorrection pill. With the input still focused, use every
      arrow direction and verify only the emoji selection moves. Search `haert`
      and `hert` and verify typo-tolerant heart results remain relevant.
- [ ] Search `heart`, choose a non-leading heart twice, reopen the picker, and
      repeat the query. The selected emoji must be promoted; quit/relaunch and
      verify the same query-specific preference persists while unrelated
      queries retain their own ranking.
- [ ] Type a unique launcher query, launch a result, then hide and reopen with
      the global shortcut. Verify the field clears while the launched command
      is the first History row and its search term follows as a separate
      full-width top-level row. Return on the command reruns it; Return on the
      query restores it.
      Create nine searches and verify the initial eight-session cap plus
      interactive Show More/Show Less. History survives a complete
      quit/relaunch without entering cloud-synced settings.
- [ ] Run Close Commander Window and verify only the floating launcher hides;
      then run Close Commander and verify the native host, daemon, and Rust
      child exit and release port 47820. From Raycast, run
      `Commander/extensions/raycast/`'s Open Commander no-view command and
      verify it relaunches the installed app.
- [ ] Browse the latest live Raycast Store feed, search a term, open the full
      web catalog, and sideload a valid source folder. Malformed manifests and
      unsupported view commands must show explicit compatibility errors; they
      must never be reported as successfully executable.
- [ ] Complete Thingtime PKCE login with two accounts, switch between them,
      relaunch, and sync appearance/window preferences. Inspect the WebView and
      loopback UI API: no Bearer token may be returned to React; Keychain items
      must be separated by issuer, client ID, and user ID.
- [ ] Resize Settings through its minimum and full-screen-adjacent sizes, visit
      every tab, scroll top-to-bottom, and exercise Store, account, sync, and
      Advanced dynamic states in light, dark, default-text, and large-text
      modes. No content may overlap, clip, or escape the native window.

## Register request body cap (`remix/app/routes/api/v1/auth/register/_register.tsx`)

- [ ] Register rejects an oversize body with 413 (`readJsonBody` 16 KiB cap)
      before validation, bcrypt, or account writes; the existing limiter still
      consumes the request first, and a normal signup from a fresh IP returns
      200 with a session cookie.

## Persisted-state codec (`remix/app/Providers/thingtimeSerialization.ts`)

- [ ] `npm run test:persist` passes (tagged Dates, untagged ISO-lookalike user
      strings including ambiguous legacy values, malformed tag
      preservation, circular/shared data, invalid Dates, no serialized function
      source, hostile legacy functions inert, and code-defined default refill).
- [ ] Live: type a post whose text is a full ISO timestamp (e.g.
      `2026-01-01T00:00:00.000Z`), reload twice — the text must stay a string
      (older builds turned it into a Date and rewrote it permanently).
- [ ] Live: app hydrates under the CSP with no `unsafe-eval`; theme pre-paint
      and `[LC]`/env title prefix still work from `/tt-boot.js`.
- [ ] `npm run verify:vercel-output` rejects app `script-src` policies that add
      `unsafe-inline`/`unsafe-eval`, an inline executable shell script, or a
      missing `/tt-boot.js` or `/tt-preview-freshness.js`. On a
      built/Vercel preview, append an inline script
      element that sets a harmless test variable — CSP blocks it and the
      variable remains unset.
- [ ] Commander search/navigation, registered magic-word actions, and data-only
      assignments (`path = 42`, JSON objects/arrays, quoted/plain strings)
      work under the strict policy. Program text is stored as text and never
      executes; never restore global `unsafe-eval` for programmable commands.
- [ ] A `/docs/design-bundles/<slug>/index.html` prototype still renders: its
      repo-controlled generated runtime gets the path-scoped `unsafe-eval` +
      unpkg compatibility policy, while `/`, `/authorize`, and ordinary app
      routes keep the strict policy without `unsafe-eval`.

## MongoDB data endpoint (`/mongodb-status`, `remix/app/components/MongoDB/MongoEndpointConfig.tsx`)

- [ ] Logged OUT: paste a reachable `mongodb://` URL → "Use for this session"
      flips the page to the Custom endpoint badge, the footer indicator reads
      "MongoDB (custom)", and the feed/search read from that DB. "Use" on the
      Thingtime row returns everything to default.
- [ ] An unreachable URL is rejected at activation (422 toast, e.g.
      `MongoServerSelectionError (ECONNREFUSED)`) and the previous endpoint
      stays active — a bad URL must never brick the session's data calls.
- [ ] A non-mongodb scheme (`http://…`), whitespace, or a >2048-char URL is
      rejected with a clear validation message.
- [ ] Logged IN: "Save to my endpoints" persists the endpoint (survives
      logout/login and other browsers); the raw URL/credentials NEVER appear
      in any API response, page, or error — only host + db name.
- [ ] While a custom endpoint is active: login/logout, profile, themes,
      account switcher and saved-endpoint management still work (identity is
      home-pinned); posts created land in the CUSTOM db; admin routes
      (migrations especially) still operate on the home DB.
- [ ] Removing the saved endpoint the session currently uses also clears the
      override (page falls back to Thingtime default without a reload).
- [ ] The `tt_mongo` cookie is httpOnly + session-scoped: closing the browser
      drops the override; document.cookie can't read it.
- [ ] Secret inputs: the connection URL and every "Individual fields" input
      (user/password/host/port/database) render as type=password, hidden by
      default, each with its own 👁 show/hide toggle that reveals ONLY that
      field (autoComplete=new-password keeps password managers out).
      Placeholders stay readable — values never render on a shared screen
      until deliberately revealed.
- [ ] Fields mode composes the URL live through the same activate/save
      buttons: user/password/database URI-encode (e.g. "p@ss:word" →
      p%40ss%3Aword), mongodb+srv:// disables + clears the port, switching
      modes round-trips (a pasted URL parses into the fields, the fields
      compose back byte-identical), and all inputs clear after a successful
      activate/save.
- [ ] No secret persistence: values live only in component state and the
      POST body — the tt-mongo-endpoint localCache entry (and all of
      localStorage) carries only host/db summaries, never a mongodb:// URL,
      credentials, or field values.
- [ ] LOCAL DEV footer parity: with an override active, the footer indicator
      reads "MongoDB (custom)" on the local stack too. Regression class: the
      vite /api proxy's changeOrigin hid the web origin from nitro, so
      resolveStatusTarget classified "Current Tab" as REMOTE and health routes
      re-fetched themselves WITHOUT cookies (session state invisible). The
      proxy must forward x-forwarded-host/-proto (vite.config.ts) — verify
      /api/v1/health/mongodb?targetOrigin=<web origin> returns custom:true
      with the cookie, while a real remote target (e.g. thingtime.com) still
      server-side fetches.

## Docs search (`remix/app/routes/docs/DocsSearch.tsx`, `docsSearchIndex.ts`)

- [ ] Searching "acl" in the /docs drawer ranks the Thing schema (its `acl`
      field section) first; results highlight the matched terms and show an
      area badge + mono meta path; the nav list hides while a query is
      active and returns on clear (× button or Escape).
- [ ] Anchored results deep-link AND scroll on client-side navigation:
      "scopes" → Enter lands on /docs/embed#permissions-scopes with the
      heading at the sticky-header offset, not the page top (DocsLayout's
      scroll-to-top must skip hash navigations); schema results scroll to
      their /docs/schemas#schema-<id> card.
- [ ] ArrowUp/Down move the active row, Enter opens it (query-param entries
      like design mockups/components select the exact entry), and on mobile
      tapping a result closes the drawer.
- [ ] The query lives in the URL (?q=) with replace-style updates: typing
      never stacks history entries, refresh restores the search, /docs?q=acl
      deep-links it, result clicks carry ?q= along (so the landed URL is
      shareable with its search context), and × strips it.
- [ ] Typing is instant and never drops keys: the input is locally
      controlled and the URL syncs on a ~200ms debounce — fast typing on
      /docs/api (the heaviest page) must not lag, and the ?q= write lands
      once after the pause (the static drawer lists are memoized so
      keystrokes don't re-render the 78-endpoint menu).
- [ ] The desktop drawer never shows an internal scrollbar: content renders
      full height, sticks under the top nav only while it fits the viewport,
      and taller content (search results, expanded endpoint lists) flows with
      the page scroll — the bottom of the menu stays reachable.

## Shared app-data (`/api/v1/app-data/shared`, `api/utils/apps/appData.ts`)

- [ ] POST /api/v1/app-data with `visibility: 'app'` on a token WITHOUT the
      `app-data.shared` scope returns 403 and writes nothing; with the scope
      the entry's acl becomes `["tt:user", "tt:app/<clientId>"]`.
- [ ] A plain `{ key, value }` rewrite of an existing shared entry keeps it
      shared (audience only changes when the write names one); `visibility:
'private'` flips the acl back to `["tt:user"]`.
- [ ] GET /api/v1/app-data/shared returns other users' `visibility: 'app'`
      entries for the SAME app only — never private entries, never another
      app's entries — newest first, and `key=post:*` prefix-filters.
- [ ] Author objects honour each AUTHOR's own grant: displayName/avatarUrl
      appear only when that author granted the profile field.
- [ ] Revoking a user's grant (disconnect in settings) removes their entries
      from the shared feed on the next read while `GET /api/v1/app-data`
      still shows the entries to the owner.
- [ ] The consent screen lists "Shared app storage" as its own line, and a
      grant of plain `app-data` does NOT cover `app-data.shared` (exact
      consent — no ancestor coverage).
- [ ] GET /api/docs returns the whole API reference as text/markdown, and
      /api/docs-docs + every `<endpoint>-docs` route (including
      /api/v1/app-data/shared-docs) return their JSON doc payloads.
- [ ] App-token things CRUD stays inside the namespace: POST/PUT/PATCH/DELETE
      /api/v1/things (and /things/search, /things/update, /things/delete)
      with an app token only ever touch docs carrying the app's root `appId`
      stamp; reads, updates, and deletes aimed at a first-party thing's id
      (or another app's doc) all 404.
- [ ] App writes are acl-clamped: an acl beyond `tt:user` / `tt:app/<own
clientId>` (tt:all, other apps, other users, exclusions) 400s; an
      insert that omits visibility/acl lands PRIVATE (never the generic
      route's public default); `save`/`share` thingtimes 403 as first-party
      surfaces; protected kinds stay refused.
- [ ] Byte allowances replace key counts: keys keep writing past 200 until
      either the effective (user, app) allowance (50 MiB app default, or its
      custom sub-tier) or the app's aggregate plan (5 GiB Free by default) is
      spent. The corresponding over-limit
      write 507s and writes nothing; concurrent users never overshoot either
      guarded counter. GET /api/v1/app-data/usage returns userStorage and
      appStorage with exact used/allowance/remaining arithmetic while keeping
      usedBytes/budgetBytes as user-ledger aliases. A write raises both by its
      serialized size, an update charges only the delta, and a delete refunds
      both.
- [ ] App allowance ownership + migration: POST /api/v1/apps stores the Free
      tier, storageAllowanceBytes=5 GiB, storageUsedBytes=0, and the 50 MiB
      default user cap; /apps/update cannot change them. Tier + runtime
      aggregate allowance live on that same app Thing. A legacy app fails
      writes closed until backfill-app-storage-allowances reconciles
      per-user sums and initializes aggregate last; two migration runners
      cannot overwrite a now-live aggregate.
- [ ] Canonical account storage: create, grow, shrink, and delete first-party
      Things, comments/reactions, themes, algorithms, and registered app data.
      Each mutation changes the protected subscription ledger by exactly the
      UTF-8 byte delta of `JSON.stringify({ crystal, extended, tags })` in the
      same transaction. App data changes the account, whole-app, and app-user
      counters by the same delta while appearing only once in the account
      total. Stale/malformed stamps and ledgers fail growth closed; deletes
      fence for repair instead of guessing. Settings/admin/app surfaces show
      the same canonical value and exact bytes, with `reconciling` or
      `unavailable` never rendered as zero. Rerun the interrupted global
      migration and confirm it converges without double charging.
- [ ] Registered app lifecycle stays on its dedicated surface: generic
      /api/v1/things POST/PUT/PATCH/DELETE cannot create, replace, edit, or
      remove an `app` control Thing. /api/v1/apps/delete atomically removes
      exactly that control row and revokes all live app sessions; retrying an
      already-completed delete succeeds, while users' namespace data and
      protected app-storage counters remain browseable/reconcilable.
- [ ] Run `node scripts/verify-app-storage.mjs <local base URL>` against a
      disposable local database: all 30 app-manager + registered-ledger checks
      pass for two users, including owner plan/default/single/bulk/reset flows,
      authorization, same-key CAS races, and first-party owner updates/deletes.
      The script refuses non-local URLs so it cannot seed verification accounts
      into production by accident.
- [ ] KV listing grammar: GET /api/v1/app-data with key=post:\* or prefix=
      filters, limit=/cursor= page, and nextCursor walks the whole set; KV
      entries also appear via GET /api/v1/things?thingtime=app-data with the
      same token (one namespace).
- [ ] Cross-user comment/reaction via the inherit chain: with
      app-data.shared, user B's app token can comment/react on user A's
      app-audience doc; the child is auto-stamped into the namespace and its
      visibility resolves through tt:inherit to the shared ancestor; without
      the scope (or after A revokes) the target 404s.
- [ ] Revoking the author's grant removes their shared entries from EVERY
      app read on the next request — the KV shared feed and the app-token
      things reads alike — while the docs stay owned and browsable
      first-party.
- [ ] Session browse: GET /api/v1/apps/data-summary lists the namespace
      (appName null after the app is deleted, data still counted);
      GET /api/v1/things?appId=<clientId> narrows the own-things list to one
      namespace; POST /api/v1/apps/data/delete-all wipes the namespace +
      cascaded children and zeroes usage (works with no live grant);
      GET /api/v1/apps/data/shared?appId= mirrors the app's own view
      (sharedRead reflects the grant) and 403s with the plain no-live-grant
      explanation after disconnect.

## Sandbox tokens (`/api/v1/oauth/sandbox`, `api/utils/apps/sandbox.ts`)

- [ ] POST /api/v1/oauth/sandbox (no auth, any clientId) returns a Bearer
      token that works against /app-data set/get/list/delete, the shared
      pool, and /oauth/userinfo — resolving to the synthetic `sandbox-you`
      user, never a real account.
- [ ] Sandbox app-data docs carry `sandboxExpiresAt` (TTL-reaped) and are
      namespaced per token: a second sandbox token sees NONE of the first's
      entries (private or shared).
- [ ] A sandbox token can never act as an account credential:
      /api/v1/auth/me (and any cookie/session path) rejects it.
- [ ] GET /api/v1/apps/public?sandbox=1 returns a mock app (flagged
      `sandbox: true`) for an unregistered clientId instead of 404; without
      sandbox=1 the 404/403 behaviour is unchanged.
- [ ] The consent popup's sandbox approve hands back a REAL minted token
      (falls back to the inert `tt-sandbox-token` only if the mint call
      fails), and scope gating on the handoff user object still matches the
      selection.
- [ ] Feed-pollution fence: a sandbox token minted with a REAL app's
      clientId can write shared entries, but that real app's
      /app-data/shared feed never scans them (`sandboxExpiresAt` excluded)
      — real pages stay full-size even with fresh sandbox junk on top.
- [ ] Sandbox storage budget: writes 507 once the sandbox namespace's 5 MiB
      byte budget is spent (no key-count cap remains); deleting entries
      refunds bytes and unblocks; real grants get the 50 MiB budget.
- [ ] Explicit sandbox KV/things deletes refund only the ephemeral sandbox
      ledger. Even when a sandbox uses a real clientId, its delete never
      decrements that registered app's standing aggregate or a real user's
      ledger.
- [ ] Global sandbox byte brake: the `sandbox.storage.global` rule (limit is
      MEGABYTES per window, default 512MB/hour, fail-closed) burns on every
      sandbox write app-wide and 507s all sandbox writes once spent; a
      write refused by the per-namespace budget refunds its global charge;
      an unavailable ledger 503s instead of waving writes through.
- [ ] Sandbox tokens exercise the full things surface identically (CRUD,
      search, react, comment); every doc written through one carries
      `sandboxExpiresAt` (+ `sandboxSpace` in a space) whatever its kind,
      real app-token reads never see sandbox docs, and the TTL reap removes
      them with the token.
- [ ] Sandbox spaces: tokens minted with the same `space` see each other's
      visibility-'app' entries in /app-data/shared, each authored by its own
      `sandbox-<username>` pretend user; PRIVATE entries stay per-token even
      in a shared space; a different space (or no space) sees nothing; real
      feeds still exclude all sandbox docs.
- [ ] Space validation: space shorter than 8 chars 400s; usernames are
      always 'sandbox-' prefixed so pooled feeds can't impersonate real
      accounts.

## Token minter — personal access tokens (`remix/app/components/Settings/TokenMinter.tsx`, `api/utils/auth/patTokens.ts`)

- [ ] Settings → Token minter (auth only): mint with default "Full things
      access" — the returned token appears ONCE in the reveal card (token +
      curl example + copy buttons); after reload the reveal is gone and the
      token is unrecoverable, but the row lists in "Your tokens" (painted
      instantly from the `tt-pat-tokens-<userId>` local cache, server
      reconciles behind).
- [ ] Permissions selector: with Full things access on, unticking one leaf
      (e.g. Delete) converts the selection to "every leaf except that one"
      and the hint lists exactly the granted scopes; minting with zero
      scopes is blocked with a toast.
- [ ] Expiry dials stay in sync: preset chips (1h…1y, Never ∞), the
      log-scale slider (1ms → 10y, far right = never), and the value+unit
      inputs all drive the same expiresInMs; the human date preview updates.
- [ ] Uses dials: Unlimited / 1 / 10 / 1000 / custom; a use-limited token
      consumes exactly one use per authenticated call — the (maxUses+1)-th
      call 401s "no uses remaining", and a 403 (missing scope) consumes
      NOTHING. Two racing final calls can never both spend the last use
      (atomic usesRemaining > 0 decrement).
- [ ] A PAT works ONLY where wired: things CRUD/search/feed/user/save/
      comment/react/share by scope (PUT upsert needs create+update), plus
      free introspection at /api/v1/tokens/self. It must 401 on
      /api/v1/tokens (list/mint), /tokens/revoke, /auth/me, themes,
      algorithms, oauth — and be rejected when smuggled via the auth
      COOKIE (Bearer-only).
- [ ] Sub-second expiry is real: a 1500ms token works immediately and 401s
      after 2s (session expiresAt is the authoritative ms check; the JWT
      exp is ceiled to seconds).
- [ ] Revoke (session-only) kills the token immediately, is idempotent,
      flips the row optimistically (reverts on failure), and gives a
      never-expiring token a reap date so the TTL index eventually clears
      it. Expired tokens vanish from the list once Mongo's TTL sweep runs.
- [ ] Permissions selector "Select all ✅ / Unselect all 🧹" buttons: all →
      the single Full-access chip state; none → zero chips + mint blocked.
- [ ] Sandbox ("Only its own things 🧸", onlyCreatedThings) — the tt:token
      grant system: every PAT-created thing carries the creator's
      tt:token/<id> entry in tokenAcl; a sandboxed token CAN patch/PUT-
      replace/delete/comment/react/save/share things carrying its entry and
      gets 403 "sandboxed … tt:token grant" on everything else (the 403 is a
      post-auth target check, so it DOES consume a use — only missing-scope
      403s are free) — including reaction/save REMOVAL on ungranted things
      and re-sharing a token-created share of a foreign root. Delete stays
      one atomic filter op on success (tokenAcl OR legacy createdByTokenId)
      and returns the sandbox 403, not a phantom 404, when the thing exists
      but carries no grant.
- [ ] Grant layering: owner PATCHes a thing's tokenAcl to [A, B] → BOTH
      sandboxed tokens mutate it; removing A's entry cuts A off immediately
      while B keeps working; owner can CREATE a thing pre-granted to a
      token that never touched it; a sandboxed token can re-grant (add
      peers to) things it holds a grant on, and can lock itself out by
      dropping its own entry (session always recovers it). tokenAcl
      replaces WHOLE (null clears), max 32 entries, entries must match
      tt:token/<id> (400 otherwise), and a tokenAcl replacement also clears
      the legacy createdByTokenId stamp so removed grants can't resurrect
      through the back-compat read.
- [ ] tokenAcl is owner-only in projections: the owner (and their tokens)
      see it on GET /things?id=; anonymous viewers and other users never
      receive the field. Legacy round-2 docs (createdByTokenId, no
      tokenAcl) still honor their creator via the read shim.
- [ ] Non-sandboxed tokens and full sessions ignore tokenAcl entirely; the
      settings list row shows "🧸 its own things only" + a "Grant 🆔"
      copy button (copies tt:token/<id>).
- [ ] PAT × app-token coexistence on the shared things routes (one resolver,
      three credential kinds): a PAT ignores Origin (no app binding), the
      OPTIONS preflight for app SDKs still serves with Authorization allowed,
      a PAT with things.read can browse `GET /things?appId=` (first-party
      read), a PAT 401s on the app-token-only app-data surface, an app token
      401s on /api/v1/tokens, and the oversized-payload 413 fires BEFORE
      actor resolution so it never consumes a PAT use. One command re-checks
      all of this: `node scripts/verify-pat-tokens.mjs <nitro base url>`
      (companion to `scripts/verify-app-namespaces.mjs`).

## Admin dashboard, subscription tiers & ownership links (`/admin`, `api/utils/subscriptions/`, `api/utils/accounts/accountLinks.ts`)

- [ ] `/admin` → Moderation lists flags (unreviewed first) with status badges;
      `View` opens the raw media (blocked media opens for admins only);
      `Clear` / `NSFW` / `Block` override the verdict with a Lopu toast and
      stamp reviewedBy; exercise all three overrides on deterministic clear,
      nsfw, and blocked uploads. `Run analysis sweep` reports
      analyzed/flagged/skipped counts and drains pending attachments plus
      verdicts whose flag write was interrupted.
Dev bootstrap: register a throwaway user via `POST /api/v1/auth/register`, then
restart the dev stack with `ADMIN_USERNAMES=<that username>` (registering a
name already on the allowlist is refused, so register FIRST). One command
re-checks the whole management plane end-to-end:
`TT_VERIFY_ADMIN_USER=<user> TT_VERIFY_ADMIN_PASS=<pass> node scripts/verify-admin-subscriptions.mjs <nitro base url>`.

- [ ] `/admin` renders the 🔐 gate card for anonymous/non-admin visitors and
      the dashboard (Users / Apps / Tiers / CI Control / System tabs) for admins; the drawer's
      Account section shows the 🛠️ Admin item only for admins.
- [ ] Users tab: free-text query searches every safe projected field; typed
      filters cover created-day ranges, tier id/name/version, booleans, quotas,
      storage, and every count; multiple filters combine with AND and sorting
      is deterministic. Each row shows created time, tier badge (+ `custom`
      badge when overrides exist), storage used/allowance, app-namespace bytes,
      and app/PAT/connected counts. With more than 400 mixed Things/legacy
      users, confirm the UI drains every 200-row cursor page without gaps or
      duplicates and a field/tier match found only on page 3 is still returned.
      Confirm numeric `is any of` / `is none of` filters accept comma-separated
      values. Exact-email matches and all backing stores stay globally newest
      first across page boundaries.
      If a continuation request fails, the last complete snapshot stays visible;
      a cold failure shows an error with an in-place Retry action instead of an
      authoritative empty table.
- [ ] Apps tab query covers identity, origins, created/suspended time, status,
      owners/managers, users, storage, and every subscription field. A no-match
      query keeps the controls visible; Clear filters restores the rows; tier
      or link changes refresh rows without clearing the active query. Seed more
      than 200 apps and confirm a manager/tier match beyond page 1 is queryable.
- [ ] Tiers tab query covers every descriptor field: lifecycle/version,
      identity text, display price amounts, computed/custom discounts,
      Editor.js inclusion text, quotas, and all timestamps. Filtered cards stay
      in Live / Draft / Archived groups with correct per-group empty states.
- [ ] System has independent queries for rate-limit rules and current admins.
      Filtering rate limits never discards hidden unsaved edits, and the
      separate Promote a user lookup keeps its existing username/email flow.
- [ ] Subscription editor: assigning a live tier's exact `tierVersionId` +
      per-field override (number in MB for byte fields, or Unlimited) persists
      and the row updates on save; Reset to default pins the current live
      default revision. If the current revision was archived, its card remains
      visible as current/non-selectable and note/override-only edits preserve
      that exact historical revision.
- [ ] Tiers tab lifecycle: create a new draft, edit its name/tagline/banner,
      currency, all four renewal prices, quota defaults, and Editor.js
      inclusions; reload and confirm every field persists. The draft appears
      only in Draft / not live and never in public `GET /api/v1/tiers`.
- [ ] Pricing discounts: each daily→weekly/monthly/yearly,
      weekly→monthly/yearly, and monthly→yearly percentage is computed from
      annualized prices. Enter a custom saved percentage, confirm it overrides
      just that comparison, then clear it and confirm the computed value
      returns. Check a zero-decimal currency (JPY) and a three-decimal currency
      (KWD) render their minor-unit prices correctly.
- [ ] Publish requires confirmation, makes the immutable revision live/public,
      and hides the mutable editor. Create a new draft version, publish it, and
      confirm the former live revision moves to Archived while an existing
      user's pinned `tierVersionId`, title, and quota snapshot stay unchanged.
- [ ] Archive requires confirmation and never deletes history. The default
      Free revision cannot be archived without publishing its replacement;
      draft and archived revisions are rejected for new assignments. A tier
      already holding a draft disables duplicate draft creation.
- [ ] Tier cards render the optional banner (with graceful broken-image
      fallback), tagline, four prices, savings, quotas, and rich inclusions.
      Desktop and 375px layouts have no clipping/overlap; open each lifecycle
      confirmation and the Editor.js content editor while testing.
- [ ] Tier quotas actually enforce: with `maxApps: 1` override the second
      `POST /api/v1/apps` is refused 400; a `null` override (or payg) lifts
      the cap. App subjects accept only `appStorageBytes`; tier/override and the
      runtime aggregate move atomically on the app Thing, `null` meters without
      blocking, and administrator-custom app plans lock owner tier changes.
- [ ] `subscription-tier`, `subscription`, and `account-link` kinds are
      PROTECTED: generic `POST /api/v1/things` refuses them, and generic
      creation also rejects the deterministic `subscription-*` shareId
      namespace (published tiers, self-assigned plans, or links would be
      privilege escalation).
- [ ] Apps tab: every app across all users with owner, co-managers, live-grant
      user count, storage rollup, and status. Suspend uses an inline
      Confirm/Cancel, flips the row to SUSPENDED + Restore, and: existing app
      tokens die immediately (401), the consent screen and /oauth/authorize
      refuse 403, restore allows re-authorization but does NOT resurrect swept
      sessions.
- [ ] Ownership links (many-to-many both ways): admin assigns an account link
      → target appears under the owner's "Owned accounts" in the switcher
      (`GET /api/v1/auth/accounts/owned`), "Sign in →" assumes it without
      credentials (fresh per-browser session folded into the roster; other
      browsers/owners are never signed out), non-linked users get 403. App
      links put the app in the co-manager's `/apps` list and update/delete
      accept them; removing the link removes access (404).
- [ ] Mobile (375px): the admin tables scroll inside their own container —
      the page body itself never scrolls horizontally; modals fit with no
      clipped controls.

## Admin CI control plane (`/admin` → CI Control, `api/utils/ciControl/`)

- [ ] With a prior snapshot cached, CI Control paints the last-known feature
      rows on first render without a spinner, then reconciles in the background.
      A failed refresh preserves those rows, says they are cached, and retries.
- [ ] Anonymous and non-admin callers receive the standard admin denial from
      all three `/api/v1/admin/ci*` endpoints. The dashboard never renders for
      them and the webhook routes do not accept a browser session as authority.
- [ ] Send the same signed GitHub delivery twice: the entity projection is
      current and exactly one relational `ci-event` exists for that delivery
      and parent. A payload with one changed byte, a missing delivery header,
      another repository, or a bad HMAC is rejected without writes.
- [ ] Send Vercel deployment created → ready and retry each exact body. One
      current deployment and preview projection advance to ready; exact retries
      do not duplicate history. Invalid HMAC and payloads over 2 MiB fail.
- [ ] GitHub reconciliation groups promotion PRs with their source feature,
      paginates beyond 100 branches/open PRs, refreshes runs/deployments,
      preserves existing event history, and never exposes the App private key
      or installation token.
- [ ] Dispatch every allowlisted workflow and confirm the audit row moves
      requested → accepted (or failed) with a relational event. Arbitrary
      workflow names, non-allowlisted inputs, and feature-branch entry refs
      cannot reach GitHub. Rebase/release require the UI confirmation gate.
- [ ] Save each supported automation with GitHub Actions, then Vercel Sandbox,
      and verify the cached dashboard updates optimistically and rolls back with
      authored copy on failure. Web CI and Electron release visibly remain
      GitHub-only rather than accepting an unsupported provider.
- [ ] Remove each Vercel-provider prerequisite in turn (GitHub App id,
      installation id, private key, router secret, and Vercel runtime identity).
      The Admin badge says setup is needed, names the missing server setting,
      disables the Vercel option, and a direct policy POST returns the authored
      409 without changing the prior policy. Vercel is shown ready only when all
      prerequisites are present.
- [ ] Send a fresh, correctly HMAC-signed provider request and verify a GitHub
      policy returns `execute: true`; a Vercel policy creates exactly one
      idempotent dispatch for duplicate delivery keys. Reject stale timestamps,
      changed bodies, unknown workflows/inputs, and bad signatures without
      starting a Workflow or writing a claim.
- [ ] With Vercel selected, confirm the native GitHub trigger performs only its
      provider-router job, a durable Vercel Workflow creates one uniquely
      labelled ephemeral Sandbox runner, and the exact protected workflow
      re-enters on that runner. Confirm completion/failure is projected and the
      Sandbox plus GitHub runner registration are deleted afterward.
- [ ] On Vercel's universal image, bootstrap must run GitHub's version-matched
      `bin/installdependencies.sh` non-interactively and provide `/dev/fd` from
      `/proc/self/fd` before registration. Make each command fail in turn and
      verify the provisional exact runner/Sandbox is still cleaned even though
      `createRunner()` never returns its handle to the outer Workflow.
- [ ] Remove or invalidate each router dependency in turn (router secret, App,
      Workflow/Sandbox auth) and verify automatic triggers fail over to
      GitHub-hosted compute with a visible event instead of silently stopping.
- [ ] Before the first Reconcile, the configured-but-empty dashboard explains
      that no provider events have been imported. Run Reconcile once and verify
      existing branches, open PRs, runs, deployments, and previews populate;
      subsequent GitHub/Vercel deliveries advance the same records and history.
- [ ] Desktop: search/filter feature rows, select a PR, open its GitHub and
      preview links, inspect topology, Actions runs, and the full status
      timeline. Scroll the page top-to-bottom and the sticky detail panel to its
      bottom without clipping, overlap, or horizontal page overflow.
- [ ] Mobile (375px): search/filter rows, open the bottom detail drawer, scroll
      every section, open the dispatch modal and confirmation state, then close
      both. The drawer is flush left/right/bottom, has no clipped controls, and
      the page never scrolls horizontally.
- [ ] Run `node scripts/workflow-caller-contract.mjs` manually or inspect its
      protected advisory comment: every product-branch workflow has exactly
      one reusable call pinned to `@github-actions`, no runner/steps/shell
      behavior, and no product-branch Actions scripts. A mismatch warns but
      does not join the required unit-test aggregate.

PR #220 live acceptance recorded on 2026-08-10:

- [x] A human exact-PR trigger handed off to Vercel, registered one unique
      runner, re-entered as `thingtime-ci-control[bot]`, ran the protected
      detector successfully, and deleted the exact runner and Sandbox.
- [x] A setup failure after the original trigger exited dispatched the same
      protected workflow back to GitHub-hosted compute through the App.
- [x] First authenticated Reconcile populated the CI dashboard; GitHub App,
      webhook, provider-router, and Vercel readiness were visible together.
- [x] Desktop and 375 px mobile acceptance covered provider persistence,
      dispatch confirmation/cancel, PR #220 detail panel/drawer, full-page
      scrolling, and zero horizontal overflow.
- [x] `node scripts/workflow-caller-contract.mjs`, focused CI-control tests,
      targeted lint, build/output verification, and Graphify integrity checks
      passed for the published branch.

## App-owner storage manager (`/apps/manage`, `api/utils/apps/appStorageManagement.ts`)

- [ ] Logged-out visitors get the sign-in card. An owner sees every registered
      app; an administrator-linked co-manager sees the linked app; ordinary app
      users and removed co-managers get the same 404-shaped denial as an unknown
      app and cannot inspect aggregate usage or the user roster.
- [ ] Selecting any current live card sends its stable tier id plus exact
      `tierVersionId`, updates the whole-app allowance while preserving exact
      usage, and rejects a downgrade below current usage atomically. The
      bootstrapped Free → Plus → Pro → PAYG path yields 5/25/100 GiB/null. An
      administrator-custom plan shows `custom` and disables self-service tier
      buttons until the admin resets it; an archived current revision remains
      visible but cannot be newly selected.
- [ ] Default cap starts at 50 MiB, accepts 0 and finite MiB values no larger
      than the current aggregate, and is re-checked atomically against a racing
      plan change. Existing users without overrides immediately inherit it.
- [ ] Select one user or many (up to all 200 shown) and apply a custom cap;
      each protected `app-storage` ledger records its own override, `Use app
default` unsets it, and runtime usage reports the effective cap. A custom
      value above the aggregate is refused; a later aggregate downgrade clamps
      enforcement even if a historical override was larger.
- [ ] The roster includes users with current or past grants/ledgers, but a
      username appears only while a live unexpired grant covers
      `profile.username`. App-user IDs/usernames are never written to the
      browser localStorage cache, and a failed manager re-authorization clears
      the cached storage view.
- [ ] Desktop and 375px mobile: switch apps; inspect banner/price/savings/rich
      inclusions on tier cards; choose a plan; edit the default;
      search, select-all, single-select, bulk apply/reset; horizontally scroll
      the user table; and scroll the full page top-to-bottom. No page-level
      horizontal overflow, clipping, sticky overlap, or console errors.

## Rate limiting & index-ensure reliability (`api/utils/rateLimit/enforce.ts`, `api/utils/mongodb/collections.ts`)

- [ ] Healthy path: burst a rate-limited endpoint past its limit (e.g.
      `things.search`, 120/min → 121 requests) → 429 with `Retry-After`,
      and NO `[rate-limit]`/`[mongodb]` error lines in the logs.
- [ ] Public sign-up is throttled: burst POST /api/v1/auth/register past
      `auth.register` (default 10 per 15 min per IP) → 429 with `Retry-After`;
      earlier attempts in the window still work (validation 400s/409s count
      against the window too). Blocked attempts return before the awaited
      `ensureIndexes` bootstrap, so hammering register can't re-run the index
      battery while the DB is broken.
- [ ] Index-ensure failure is AUDIBLE, never silent: break the index battery
      (drop `things_v2`'s `ownerId_1_crystal.appId_1_crystal.key_1` unique
      index, insert two docs sharing `(ownerId, crystal.appId, crystal.key)`),
      start a FRESH API process → the boot-time warmup run logs one
      line beginning `[mongodb] ensureIndexes failed building things.<index>`
      and saying the next bootstrap call will retry. The cold-start PR moved
      the battery off the request path, so ordinary API traffic neither retries
      it nor logs; only the awaited bootstrap callers (`registerUser`, admin
      migrations) can trigger another attempt.
- [ ] In-flight work is shared, but failures are retryable immediately: while
      one ensureIndexes battery is running, concurrent bootstrap callers await
      that same promise; after it fails, the next explicit bootstrap caller
      starts one fresh attempt instead of inheriting a rejected promise for a
      fixed cooldown.
- [ ] Self-heals after cleanup: delete the duplicate docs, then hit an awaited
      ensureIndexes caller (register a user / run an admin migration) or restart
      the process → the unique index is rebuilt immediately (`getIndexes()`
      shows it) and no stale cooldown blocks the recovered database.
- [ ] Limiter outage is AUDIBLE, never silent: with the limiter's own DB ops
      failing (e.g. Mongo down/unreachable), a limited endpoint logs
      `[rate-limit] enforcement unavailable for <rule> — failing open` per
      request; ordinary actions fail open (the route then surfaces its own DB
      error), `failClosed` routes return the 429 unavailable shape. Regression
      class: a bare `catch {}` fail-open invisibly disabled ALL rate limiting
      (2026-07 perf audit).

## Password hasher (`/crypto` Password Hasher panel, `api/utils/crypto/passwordHasher.server.ts`)

- [ ] `/crypto` → Password Hasher: enter a username + password → the panel
      shows a VERIFIED badge, `bcrypt cost 10`, the `$2b$10$…` hash, and a
      mongosh snippet templated with that username. A supplied password is
      NEVER echoed back in the response; only a generated one is.
- [ ] "Generate a strong one" + a length (12–64) returns a password shown
      exactly once ("save it now") whose hash verifies against it — check
      independently with `bcrypt.compare` if in doubt.
- [ ] The hash is self-verified server-side before return (`verified: true`);
      a password under 6 chars still hashes but is flagged (register's
      minimum), because an existing account may predate any policy.
- [ ] END-TO-END (the point of the tool): register a throwaway user via the
      real API, hash a NEW password, run the returned snippet VERBATIM in
      mongosh, then log in — the new password works and the old one is
      rejected. The snippet must report `things: matched 1, modified 1`.
- [ ] Blob integrity: after the snippet runs, the user's `secure` BinData
      blob still holds email / accountKind / emailVerified / meta, and
      `secureVersion` incremented by 1 (matching the app's CAS write). A
      plain `$set: { passwordHash }` on a things-era user writes a field
      NOTHING reads — the snippet must unpack → edit → repack instead.
- [ ] Snippet handles both stores and a miss: an unknown username reports
      "No user named …" AND lists the usernames that do exist, instead of
      silently modifying 0 docs.
- [ ] Collection names in the snippet come from `physicalCollectionName()`
      (currently `things_v2` / `users_v2`) — never hardcoded, so a version
      bump can't hand out a snippet that edits a frozen generation.
- [ ] Rate limited per IP (`crypto.hashPassword`, 20/min): bcrypt is the CPU
      cost, so a burst past the limit 429s with the hashing message. The
      intent stays ANONYMOUS on purpose — being locked out is the reason to
      reach for it — and never reads or writes the database.

## Social graph — follows + friends (`api/utils/users/social.ts`, `/api/v1/users/{follow,friend,relationships,connections}`)

- [ ] Follow is ONE-WAY and instant: user B POSTs `/users/follow { username: A }`
      → `{ following: true, followerCount }`; A's profile shows the count and B
      sees "Following ✓" immediately (optimistic, reverts on failure). Repeat
      with `follow: true` is idempotent; `follow: false` (or toggle) unfollows.
- [ ] Friendship needs APPROVAL: B `intent: request` → `pending-outgoing`; A's
      own profile shows the "Friend requests 🤝" inbox with Accept/Decline; A
      accepts → both sides read `friendState: friends` and friend counts bump.
      Requesting someone who already requested YOU accepts instead of duping
      (one doc per pair — `crystal.friendKey`, unique index).
- [ ] Self-actions rejected: following or friending yourself 400s.
- [ ] `tt:userFriends` acl is REAL now: a friends-visibility post is readable
      by an accepted friend (permalink AND feed AND the owner's profile as
      seen by the friend), 404s for strangers/anonymous, and stops resolving
      the moment either side unfriends.
- [ ] Relationship reads are public: `/users/relationships?username=` returns
      counts logged out (`viewer: null`); logged in it adds following /
      followedBy / friendState, and `incomingRequests` on your own profile.
      `/users/connections` lists followers/following/friends publicly;
      `type=requests` is your-own-account-only (403 otherwise).
- [ ] Forged edges impossible: `follow`/`friend`/`notification` are PROTECTED
      kinds — generic `POST /api/v1/things` refuses them (a forged accepted
      `friend` doc would fake acl visibility).

## Notifications (`api/utils/notifications/notifications.ts`, `/api/v1/notifications*`, nav bell)

- [ ] Emission: new follower, friend request, friend accepted, comment on your
      post, reply to your comment, reaction (preview = the token), repost, and
      capped fan-out (≤200 newest connections) of new posts to followers
      (`post-from-followed`) and friends (`post-from-friend`). Own actions
      never notify yourself; a failed emit never fails the triggering action.
- [ ] Fan-out respects the post's audience: public posts notify followers +
      friends, friends-only posts notify friends only, private posts fan out
      to nobody.
- [ ] The bell 🔔 (auth only) shows the unread badge (seeded from localCache —
      no flash), reconciles on mount/focus/slow poll, opens a popover of the
      latest 20 (unread rows tinted, actor avatar + type emoji, preview,
      time-ago), zeroes the badge on open (mark-all-read), and click-through
      goes to `/post/<id>` or the actor's profile. Works within a 375px
      viewport with no overflow.
- [ ] Settings → Notifications: a per-type × per-channel matrix — Push and
      Email switches per row plus a master switch per channel (top row).
      Defaults ON except email for `post-from-followed`/`post-from-friend`
      (opt-in) — and `weekly-summary` is email-only (push cell shows —).
      Optimistic flip + revert on failure, per-user localCache seed
      (`tt-notif-prefs-v2-*`), merge-patch POST in the channel shape
      (`{ prefs: { push/email/masters } }`) with the flat legacy body still
      patching push; unknown keys 400. Disabling a push type hides even
      ALREADY-WRITTEN notifications of that type (read-time filtering) and
      single-recipient emits skip writing it; push master OFF empties the bell
      entirely. Master OFF dims + disables that channel's column. No overflow
      or column misalignment at 375px.
- [ ] Notification emails (SES `notification` stream): each single-recipient
      emit also emails the recipient when their email master + per-type switch
      are on AND their address is verified — check the `email_messages` outbox
      row (`templateKey notification.<type>`, `metadata.notificationType`,
      manage + unsubscribe links in both html and text). Fan-out post emails
      only reach explicit opt-ins. Throttle: >10 notification emails to one
      recipient within an hour are silently skipped (digest excluded). A
      failed/slow send never fails or delays the triggering action.
- [ ] One-click unsubscribe: the footer link
      (`/api/v1/notifications/email/unsubscribe?uid&token`) flips ONLY the
      email master off, renders the
      confirmation page (mobile viewport included), is idempotent, and rejects
      a tampered token with the 400 page. Bell/push switches are untouched;
      re-enabling from Settings works.
- [ ] Weekly summary digest: admin `GET …/weekly-summary?dryRun=1` previews
      counts without sending; a real run emails only opted-in verified users
      with ≥1 nonzero stat, records `notification.weekly_summary` outbox rows,
      and a second run within 6 days skips everyone (`alreadySent`). Anonymous
      and non-admin callers get 401/403 (CRON_SECRET bearer also accepted).
- [ ] Mobile nav overlap regression: the centered commander pill must NOT
      cover the bell / username (they sit above it via `.nav-right-section`
      z-index, and the pill reserves 148px on the right). Regression class:
      nav-right controls rendered under the absolutely-positioned commander
      host and were untappable on mobile (2026-08).

## Post views (`api/utils/things/views.ts`, `/api/v1/things/views`, `useViewTracking`)

- [ ] Public stats on every post payload: `viewCount` (unique viewer
      identities) + `viewStats { impressions, avgDwellMs }`; the card's action
      row shows 👁 + compact count with the full stats in the tooltip, for
      everyone (logged out included).
- [ ] Counting is honest: a card must be ≥50% visible for ≥1s to count; one
      event per post per pageview; batches flush every 10s and on page hide
      via sendBeacon. Dwell (time on screen), max visible ratio, and viewport
      position (0..1) ride along.
- [ ] Manipulation resistance (all server-side, client untrusted): one
      postViews doc per (postId, viewerKey) — replays bump impressions only,
      never uniques; owner self-views dropped entirely; anonymous identities
      dedup on salted sha256(ip|UA) with NO raw IP at rest; UA-less requests
      dropped; dwell clamped (≤120s/event); batch ≤50; unknown or
      not-viewable posts dropped (a view write only lands where a read would
      succeed); rate limited `things.views` per user-or-IP; headless
      (`navigator.webdriver`) browsers skip client-side too.
- [ ] Views are tracked on every post surface: feed, profiles (both wired via
      PostList) and the `/post/:id` permalink page.
- [ ] Activate a custom Mongo endpoint containing a public post whose shareId
      matches a home post: its card shows zero home view stats, view reports
      count zero, and create/comment/reaction/share activity emits no home bell
      notification or email. Resetting to home restores normal telemetry/emits.

## Messenger (chats, communities, custom emojis) (`remix/app/components/Messenger/`, `/api/v1/chats*`, `api/utils/messenger/`)

Automated first: `node scripts/verify-messenger.mjs` from `remix/` against the
running dev stack (86 live-API checks: permissions, requests, receipts,
reactions, custom emojis, generic-things escape hatches). Then in a browser:

- [ ] `/messages` requires login (guests bounce to `/login`) and the page owns
      the viewport: no body scroll, no footer under the composer, nav
      clearance intact at desktop and mobile widths.
- [ ] Mode toggle (🏛️ Spaces / 💬 Chats) swaps the SAME conversations between
      Slack-style rows and Messenger bubbles; the choice survives reload
      (per-account localStorage key `tt-messenger-mode:<uid>`).
- [ ] DM flow: search someone → chat opens instantly (optimistic), Enter
      sends, bubble shows yours right/theirs left, conversation pins to the
      BOTTOM of the pane even when short.
- [ ] Requests: a DM from a stranger lands in Message requests (follower vs
      unknown buckets), stays OUT of the main list and unread totals until
      accepted; replying accepts implicitly; declining hides the chat and
      the sender is not told. SECURITY: the decliner can no longer read it.
- [ ] Slack mode: create community → channel (name slugs to lowercase),
      topic inline-edit (admins only), sections group channels, right-click
      renames a channel, public channels joinable via Browse channels while
      private ones stay invisible to non-members (check the directory).
- [ ] Threads: Reply in thread opens the side panel, replies stay OUT of the
      main list, the root shows a 🧵 count chip. One level deep only —
      replying to a reply files under the same root.
- [ ] In DMs, groups, message requests, community channels, inline replies, and
      Slack-style threads, the composer shows the same responsive attachment
      gallery as posts. Send image, video, generic file, text-plus-files, and
      attachment-only messages; each optimistic message reconciles to stable
      metadata and safe inline/download rendering after reload.
- [ ] Simulate a lost message-send response with files. The composer freezes
      the immutable request id, text, and attachment set, then exact retry
      reconciles one message without duplicate bytes or chat-preview drift.
      Known validation failures remain editable and show only authored errors.
- [ ] A non-member, departed member, declined request recipient, arbitrary id,
      and custom-Mongo shareId collision cannot open a message attachment. A
      current pending/active participant can, including from a thread reply.
- [ ] Delete an attachment message and verify its exact S3 versions disappear
      before the soft-delete/refund completes, the chat preview loses its file
      count, and displayed account storage refreshes without a stale balance.
- [ ] Reactions: hover/long-press → quick row + full picker; same token
      toggles off; custom tab lists community + personal emojis; a custom
      reaction renders its image chip for OTHER members too (resolved by id,
      `custom:<emoji id>`); custom tokens are REJECTED by the post react
      endpoint (namespace isolation both ways).
- [ ] Custom emojis: upload ≤512KB gif/webp/png/jpeg → renders inline via
      `:name:` in messages, animated gifs animate; duplicate name in scope
      409s. Personal emoji can render for authenticated recipients where it was
      used; community emoji content remains membership-gated. The upload uses
      the same single-tile gallery, charges the uploader's storage tier, and
      deleting it removes the exact S3 version before refunding quota. Legacy
      inline data-URI emoji remain read-only and cannot be newly created.
- [ ] Read receipts: opening a chat advances your receipt (forward-only —
      REGRESSION: reading an old message must never rewind it); seen-by
      avatars appear under the last-read message in Messenger mode; the
      settings toggle (details drawer) is PARITY: off = stop sharing AND
      stop seeing, while unread counts keep working.
- [ ] Unread + notifications: sidebar badges + bold rows; system messages
      (joins/renames) never count as unread; muted chats keep their count
      but leave the total; a fresh incoming message pops ONE Lopu toast per
      chat per 30s with an Open chat link (none while that chat is open and
      visible); polling PAUSES when the tab is hidden and fires immediately
      on return.
- [ ] Member control: group rename by ANY member (Messenger rule) vs channel
      rename by admins only; nicknames settable by anyone for anyone and
      shown everywhere names render; promote/demote/remove for admins with
      the owner untouchable; owner leaving hands the chat to the earliest
      admin, else earliest member.
- [ ] Generic paths stay closed: `POST /api/v1/things` with any messenger
      kind 403s ("managed by their own endpoints"); chats/messages are 404
      through `GET /api/v1/things?id=` for non-owners;
      `POST /api/v1/things/react` cannot reach another member's chat message.

## Things page (`/things`, `remix/app/components/Things/`, `/api/v1/things/bulk`)

- [ ] A fresh browser landing directly on `/things` blocks first paint only
      long enough to create one temporary session user, then serves the real
      Things UI (never the logged-out sign-in hero). Reload and navigation
      reuse the same user/roster entry without creating duplicates; direct
      `/login` and `/register` remain reachable so another account can be
      added without losing the temporary space. Existing signed-in users are
      never replaced. Once authenticated, `/things` seeds instantly from
      `tt-things-<userId>` localStorage cache and background-refetches.
- [ ] Temporary-session identity stays visually logged out: the top navigation
      says `Login` (never `Temporary space`), while account/profile/person
      surfaces say `Anonymous` with `Login to claim`. Generated `guest-*`
      usernames and placeholder `@temporary.thingtime.invalid` emails never
      appear in normal UI. Login/register can claim or add a real account
      without deleting the recoverable temporary roster entry.
- [ ] Folder CRUD: New → New folder creates a `["folder"]` thing (private by
      default) inside the CURRENT folder; rename edits `crystal.name`; folders
      never combine with other schemas (`["post","folder"]` 400s).
- [ ] Containment is a `folderId` pointer on the child: move = PATCH
      `{ id, folderId }` (null = root); a folder can never move into itself or
      its own subtree (400, cycle-safe ancestor walk); reactions/saves refuse
      folderId; deleting a folder RE-PARENTS its contents to the folder's
      parent instead of deleting them.
- [ ] `GET /api/v1/things?folder=root|<id>` lists only that folder level for
      the owner; v1/pre-folder docs read as root; `folderId` is a searchable
      root field on /search conditions.
- [ ] Bulk ops (`POST /api/v1/things/bulk`, ≤100 ids): move/copy/delete/share
      run the SAME single-item paths (updateThing/createThing/deleteThing)
      with per-item ok/error results — one bad id never fails the batch, and
      the toast reports "N done, M skipped" honestly. Copy refuses
      comment/reaction/save/share things and mints fresh shareIds ("Copy of"
      name hint on data things and folders).
- [ ] Recursive folder copy: copying a FOLDER duplicates its whole subtree
      through the same per-item create path (snapshot-first, so copying a
      folder into itself terminates), skips uncopyable kinds with honest
      copied/skipped counts, and refuses trees over 500 things BEFORE copying
      anything (never a half-copied tree).
- [ ] Bulk share (`op: 'share'` + acl/visibility): applies the audience per
      item via updateThing; `recursive: true` flows a folder's audience to
      everything inside (same 500 bound, refused past it), counting
      inherit-locked things as skipped, never silently changing them. Missing
      acl 400s the whole batch loudly.
- [ ] Selection: click selects, Cmd/Ctrl toggles, Shift ranges, Cmd/Ctrl+A
      selects all loaded, Escape clears; the View / Show / Arrange / Kind
      toolbar remains visible in its top position while the contextual toolbar
      appears beneath it. Mobile: tap OPENS, checkboxes select; both toolbars
      wrap without overlap or horizontal overflow.
- [ ] Clipboard: Copy/Cut (toolbar or Cmd/Ctrl+C/X) then Paste into any folder
      (Cmd/Ctrl+V or the Paste pill); cut items dim until pasted; cut+paste
      moves, copy+paste duplicates.
- [ ] Delete always confirms first (permanent — cascade note; folder
      re-parenting note when folders are selected); optimistic removal
      reconciles by refetch.
- [ ] Views: grid / list (name-kind-audience-tags-updated columns) / Miller
      columns (click folder opens next column, path highlighted). The
      Names/Previews toggle applies to ALL views: previews live-render each
      thing through the kind registry (crystal.render templates win, then
      crystal.thing, then the crystal itself) inside bounded, pointer-inert
      boxes, falling back to icon+name per item; folders always show as icons.
- [ ] Search + browse controls: the animated rainbow search ring is flush on
      all four sides (including after focus/resize), and every View / Show /
      Arrange / Kind pill keeps non-zero, even inline padding around its icon
      and label on desktop and mobile wrapping layouts.
- [ ] Things badge density: Theme Studio and both Appearance quick-settings
      surfaces switch the View / Show / Arrange / Kind pills live between
      Small / Medium / Large; Custom accepts safe 1–4-value CSS padding
      shorthand, persists after navigation/reload, and invalid CSS cannot
      escape into another declaration. Small is the compact default.
- [ ] Auto-icons use the ordered file-type registry: screenshot-like names win
      over generic image MIME/extensions (`🖼️`), ordinary photos/images use
      `🏞️`, known media/document/archive/install families are distinct, and an
      unrecognised attachment honestly falls back to `💾` rather than `🌀`.
- [ ] On a moving Vercel branch alias, leave the preview open on mobile, deploy
      a client change, then foreground/focus the old tab. It fetches the live
      alias HTML without cache and reloads only when the hashed `index-*.js`
      entry differs. The refreshed Feed Filters/composer/search input and
      Things New/View/Arrange controls all respond; production-domain tabs do
      not run this preview freshness check.
- [ ] On iOS Safari, navigate away from a Vercel preview and return with Back.
      The external same-origin preview recovery bootstrap loads before the main
      application entry; a `pageshow.persisted` restore immediately replaces
      the page with a unique network URL. `curl -I` for `/`, `/index.html`, `/feed`, and
      `/things` returns `Cache-Control: private, no-store, max-age=0,
      must-revalidate`, while `/assets/*` remains outside the HTML no-store
      route.
- [ ] With a legacy local Thingtime blob containing anonymous, arrow, scoped,
      hostile, and old failed-revival function tags, reload Feed and open
      “What's on your mind?”. Hydration executes none of them, removes every
      tag, restores the code-defined composer functions, and atomically stores
      the clean snapshot; the composer focuses and edits, Photos opens, close
      restores the collapsed composer, and Latest / Filters / navigation still
      respond.
- [ ] In Mobile Safari with a retained signed-in session and Commander closed,
      physically tap the collapsed “What's on your mind?” control immediately
      after a fresh Feed navigation. The composer opens on that first tap;
      tapping its Editor.js placeholder opens the keyboard and retains typed
      text; Photos opens; and the Tags input focuses and retains typing. The
      document has no Commander `touchend` click-away listener, and opening
      Commander then clicking or focusing outside still closes it without
      consuming the target control's action.
- [ ] Preview modal deep link `/things?preview=<id>` opens any viewable thing
      (ThingView tree + Move/Share/Delete actions) and is what Copy link hands
      out for non-post things (posts link `/post/:id`).
- [ ] Share dialog: audience select initialises from the thing's acl; person
      grants add `tt:user/<username>` entries via people search;
      inherit-locked (attached) things are warned about and skipped, not
      silently changed. Selecting folders reveals the "Also apply to
      everything inside" checkbox (off by default) — applying with it on
      updates deep descendants' acls and toasts the applied/skipped counts.
- [ ] Right-click context menus (the design-system Thing Context Menu):
      right-clicking a thing selects it (Finder semantics) and opens
      Open/Copy link · Rename/Move/Share · Copy/Cut/Paste-into-folder ·
      Delete, acting on the whole selection when the target is part of one
      ("Copy 4 things"); right-clicking empty canvas opens New folder / Paste
      / Sort by / Group by / View / Select all with radio-checked current
      states. Text selections and editable fields keep the BROWSER menu; any
      outside press closes the surface; page keyboard shortcuts pause while a
      menu is open.
- [ ] Sort (Newest/Oldest/Name A–Z/Z–A/Kind) and Group by (None/Kind) apply
      across grid+list (columns stays hierarchical), folders always first,
      persisted in the tt-things cache; a non-default arrangement eagerly
      loads the folder's remaining pages (bounded at 1000) so ordering is
      honest, and group sections show "📁 Folders · N"-style counts with
      correct plurals ("Data", not "Datas"). Exercise Group by Kind with at
      least one loaded thing so every section resolves its canonical icon;
      grouped rendering must not throw or show the route error boundary.
- [ ] Drag-and-drop: dragging a selected thing drags the whole selection
      (desktop only); folder tiles/rows, tree nodes, and every breadcrumb
      (including "All things" = root) highlight with the accent inset ring on
      dragover, clear on dragleave, and drop = the same bulk move path as
      Move to… (server still cycle-checks); a folder can't be dropped onto
      itself.
- [ ] Schema render-template previews: in Previews mode, data things stamped
      with crystal.schemaId render through that schema's crystal.render tree
      with `{field}` tokens interpolated from the data thing's crystal —
      always through the sanitising Chakra/Html allowlist renderers
      (interpolation runs BEFORE the gates, so injected values can't bypass
      URL/CSS screening); schemas are fetched once each and cached (null
      cached for schemas without templates); everything else keeps the
      existing kind-registry preview with per-item icon+name fallback.
- [ ] Deep search (top input) queries /api/v1/things/search scoped to the
      viewer's username across ALL folders, debounced, with kind-filter
      composition; browse mode filters kinds client-side over loaded pages.
- [ ] Columns-view folder loading happens in an effect, never during render
      (React "setState while rendering" stays fixed).

## Explore / trending (`remix/app/components/Explore/ExplorePage.tsx`, `remix/app/api/utils/things/trending.ts`)

- [ ] Logged OUT, open `/explore`: the Trending board renders public posts
      only — no friends/family/private post ever appears, and
      `GET /api/v1/things/trending` returns the same public-only `posts`
      array with `ok: true` and a `generatedAt` timestamp.
- [ ] Cards are real feed PostCards: reacting, commenting, and voting on a
      poll all work in place on `/explore` (logged in), and the counts match
      the same post viewed on `/feed`.
- [ ] Engagement moves the board: a recent post that gains reactions/comments
      outranks an older post with none, and a week-old post with stale
      engagement decays below fresh activity (score =
      (reactions×3 + comments×4 + votes×2 + views×0.25 + 1) / (hours+2)^1.4).
- [ ] Optimistic first paint: revisit `/explore` after a prior visit — the
      last-known board paints instantly from the `tt-explore` localStorage
      cache with NO skeleton flash, then reconciles in the background;
      skeletons appear only on a true cold start (cleared storage).
- [ ] The drawer's Feed section shows "Explore 🔥" and navigates to
      `/explore`; `/feed` itself still loads and paginates normally.

## Saved library (`remix/app/components/Saved/SavedPage.tsx`, `remix/app/api/utils/things/saved.ts`, `GET /api/v1/things/saved`)

- [ ] Logged in, every post card (feed, `/explore`, `/post/:id` permalink,
      profile) shows a 🔖 bookmark button beside Share. Tapping it flips the
      icon to filled/accent INSTANTLY (optimistic), toasts "Saved to your
      library 🔖", and the state survives a reload (`viewerSaved` rides the
      same batched projection as `viewerReactions` — one query per page, no
      N+1). Tapping again unfills instantly and toasts the removal; a failed
      toggle reverts the icon and toasts the error. Logged OUT, no bookmark
      button renders anywhere and `PublicPost` carries no `viewerSaved` field.
- [ ] `/saved` lists the viewer's saved posts newest-SAVED-first (save time,
      not post time) as real PostCards — reactions, comments, polls, and the
      bookmark itself work in place; unsaving a card removes it from the list
      optimistically (a failed unsave restores it in place). Pagination loads
      ~30 per page via `nextCursor`. Optimistic first paint from the
      per-viewer `tt-saved-<viewerId>` localStorage cache (no skeleton flash
      on revisit; skeleton only on a true cold start), and logout sweeps the
      `tt-saved-` prefix so another account on the same browser never sees a
      cached library.
- [ ] Libraries are independent per user: two accounts saving different posts
      each see only their own on `/saved`, and `GET /api/v1/things/saved`
      401s logged out (`/saved` shows the quiet log-in state instead). A
      saved post that is later DELETED (or its audience narrowed away from
      the viewer) silently disappears from `/saved` — fail closed, no error
      rows. The drawer's Feed section shows "Saved 🔖" (auth-only) linking to
      `/saved`.

## Public posts Atom feed (`remix/app/api/utils/things/rss.ts`, `GET /api/v1/things/rss`)

- [ ] `GET /api/v1/things/rss` (logged in OR out) returns well-formed Atom XML
      (`Content-Type: application/atom+xml; charset=utf-8`, edge cache headers)
      of the latest ~50 PUBLIC posts only — no friends/family/private post ever
      appears, cookies are ignored, and no viewer field leaks into entries.
      Posts containing quotes, angle brackets (`"><script>` probes), emoji, or
      control characters escape cleanly (feed still parses with xmllint), and
      the shell `<head>` keeps the `<link rel="alternate"
      type="application/atom+xml" href="/api/v1/things/rss">` discovery tag on
      every page (it lives outside the swapped tt-social-meta block).

## Feed keyboard shortcuts (`remix/app/hooks/useFeedShortcuts.ts`, `/feed` + `/explore`)

- [ ] On `/feed` (desktop): `j`/`k` move an accent focus ring down/up the post
      column (clamping at both ends, `scrollIntoView` keeping the card in
      view), `l` toggles a ❤️ on the focused post optimistically (press again
      to un-react; counts reconcile with the server), `c` does exactly what
      the Show/Hide comments button does, `n` expands/focuses the composer's
      editor, `?` opens the cheatsheet modal (Escape/backdrop closes it), and
      Escape clears the focus ring. Same on `/explore` minus `n`.
- [ ] Shortcuts are INERT while typing: with focus in the composer, a comment
      box, the search field, any input/select/contenteditable, while any
      modal/popover/menu is open, or while Commander is active, pressing
      j/k/l/c/n/? types normally and never navigates or reacts. Modifier
      chords (⌘/Ctrl/Alt + letter) always pass through to the browser.
- [ ] Mobile is untouched: with no keyboard there is no focus ring, no
      cheatsheet, and no visual change to the feed.

## Feed "On this day" memories (`remix/app/components/Feed/MemoriesCard.tsx`, `/feed`)

- [ ] Logged in with posts from this calendar day in previous years: a
      dismissible "On this day" card sits between the composer and the post
      column, showing up to 6 compact tiles (snippet + "N years ago today 🕰️")
      that link to `/post/<id>`. Posts made TODAY (year offset 0) never appear
      — this year is excluded from the query by construction. With no
      anniversary posts (or logged out) the card renders NOTHING — zero layout
      shift, no empty shell, no spinner.
- [ ] ✕ dismisses the card for the rest of the LOCAL day (per viewer:
      `tt-onthisday-<viewerId>` localCache) — reloading keeps it hidden; it
      returns after the local date rolls over. Same-day revisits paint from the
      cached entry instantly with no refetch (optimistic rendering); a stale
      cached day refetches in the background. Logout sweeps the
      `tt-onthisday-` prefix so another account on the same browser can never
      see cached private-post snippets.
- [ ] Query windows are the VIEWER's local calendar day per historical year
      (local-midnight instants, DST-correct), not UTC days: a Sydney (UTC+10)
      post from 09:00 local on this date last year appears, and a post from
      08:00 local TOMORROW's date last year does not. "N years ago today" uses
      the local year (a Jan 1 00:30 local post is Dec 31 UTC — label must not
      be off by one).
- [ ] A tab left open (or backgrounded) across local midnight rolls over
      without a reload: at 00:00 yesterday's tiles/labels disappear, a
      yesterday dismissal resets, and the new day's memories fetch on the
      midnight timer or the next focus/visibility change.

## Quick switcher (`remix/app/components/QuickSwitcher/`, global ⌘K)

- [ ] `⌘K` / `Ctrl+K` from any page (including with focus in an input) opens
      the centered palette; `Escape`, backdrop click, or `⌘K` again closes it.
      Fuzzy-typing a page name ("expl", "msgs") surfaces the Pages section;
      ArrowUp/Down move the highlight across sections and Enter navigates
      client-side (no full reload). Typing a username fragment shows People
      rows (avatar + name + @username → their profile); when logged in, a
      matching own thing appears under "Your things" (title + kind →
      `/thing/<id>`). Picks land in a per-viewer "Recent" section (localCache
      `tt-quickswitch-<viewerId|anon>`, cap 8, swept on logout) shown when the
      query is empty. The chord never fires while Commander is active or
      another modal/menu is open; with the palette open, feed j/k/l/c
      shortcuts stay parked (its `role="dialog"` trips the overlay check) and
      Commander's own ⌘P behavior is untouched. The Nav bar's small ⌘ button
      (mobile affordance) toggles the same palette.

## Components (/components, `remix/app/components/ComponentsLibrary/`, `/api/v1/components/browse`, `/api/v1/admin/components/seed`)

- [ ] Admin catalog import: regular users never see the publisher. On desktop
      and 375px mobile, open the importer, select valid/invalid/duplicate JSON,
      and review the count before publishing. Invalid files cannot publish;
      progress reflects server counts; stop/account switch prevents later
      batches and stale updates; retrying converges without duplicate Things.
      Large UTF-8 definitions stay below the HTTP body limit, and a skipped or
      failed batch stops with an honest partial-progress message.
- [ ] `node remix/scripts/verify-components.mjs http://127.0.0.1:<nitro-port>`
      passes end to end (browse + filters + docs twin, admin seed gate,
      user save-version via the unified things path, react/save decoration).
- [ ] /components paints the seeded library; every card renders its component
      LIVE from the stored template (no raw JSON fallbacks), with the library
      badge matching the card's visual style.
- [ ] The library filter pills (Ant Design → Thingtime) rescope the browse and
      the counts line; text search works and the lib filter is not silently
      applied while a q is active.
- [ ] "Args" expands the tester; editing a string arg re-renders live, an enum
      swaps its mapped styles (e.g. tracking-timeline stage), a boolean toggles
      its ttIf branch, and "reset to defaults" restores the original render.
- [ ] "Schema" stays collapsed by default and expands to inherits chips, args
      chips, on-create shape, thingtime-adds system fields, and the raw JSON
      definition (scrollable, no page overflow).
- [ ] "Save version" (signed in) pre-fills a name, saves privately by default,
      shows the Lopu toast, bumps the source card's "saved versions" count, and
      the version appears under Mine with its savedArgs snapshot rendering.
- [ ] React + Add to library work optimistically on component cards and
      reconcile with the server (flags survive a reload).
- [ ] Drawer: Schemas and Components are separate top-level items; /components
      highlights Components (not Schemas), /schemas highlights Schemas, and
      Search's submenu no longer contains Schemas.
- [ ] Mobile (375px): pills wrap, cards stay single-column, no horizontal
      scroll, args/schema expanders stay inside the card.
- [ ] Seeding is idempotent: re-running `node scripts/components-db/seed.mjs`
      reports unchanged (not created) for an already-seeded library, and a
      foreign doc squatting a `component-<slug>` shareId is skipped, never
      overwritten.
- [ ] Grouping: the default catalog shows ONE card per component family with a
      "designs (N)" pill row; clicking a pill swaps the card's preview,
      badge, and description to that library's rendition (args tweaks
      survive the switch); a q-search collapses its result pages the same
      way (no 8-duplicate walls).
- [ ] Deep links: every card's Docs button opens /components/<familyKey>/docs
      (scrolled to Docs); /components/<familyKey> shows the design switcher,
      big preview, args tester, deep-link copy row, args reference, API
      snippet, and definition; a componentKey slug and a component-<slug>
      shareId resolve to the same family page; unknown keys get the friendly
      not-found panel.
- [ ] Tags: every seeded component card and detail page shows a tags row led by
      the "✨ Made by Fable 5 Ultracode" attribution chip (bolder/filled),
      followed by topical tags (component, library, category, per-component
      topics); the attribution tag survives a reseed (it is stamped first so
      per-definition tags can never squeeze it out).

## Actions (/actions, `remix/app/api/utils/actions/`, `/api/v1/actions/run`, `/api/v1/actions/runs`)

- [ ] Server Action Timeline: run read-only, successful mutating and partially
      failing programs. Admission/outcome effects share trusted operation IDs
      with committed changes, retain no raw inputs/results/errors/traces, and
      do not move the Action content head. Invoker-only history survives Action
      deletion; shared runs and browser preparation create no outcome events.
      At full quota, admission refuses before execution. If only admission fits,
      preserve the actual result and show incomplete History without rerunning.
      Run `test:timeline:action-outcomes` on the guarded disposable replica; use
      the synthetic admin fixture for quota checks. In all four History looks at
      desktop/390px, verify named activity, mobile Activity details, no restore/
      replay controls, inspector History navigation and logout redaction.

- [ ] Browser Actions: create a request program in the full editor, reject
      malformed JSON/undeclared endpoints, run through the browser, and verify
      the actual record and private ACL. A preparation response creates no
      server history; the inspector shows the actual browser trace. Another
      account, old client, undeclared child and account change must refuse.
- [ ] Edit a saved Action, Component and page definition in Fields and Source
      at desktop and mobile widths. Expand nested arrays, reorder entries,
      remove a property, save and reload. The newest definition persists;
      leading-zero strings remain strings and stale saves refuse with 409.
      Scroll modal/page from top to bottom; Save remains reachable.

- [ ] `node remix/scripts/verify-actions.mjs http://127.0.0.1:<nitro-port>` passes
      end to end (100 checks: closed-vocabulary + capability-coverage + scope +
      ref-grammar refusals at save; run-by-key, $refs/$$-escape/ttConcat/$now,
      run-time scope enforcement, shared budget across actions.invoke, direct +
      ping-pong recursion refusal, ops exhaustion, run-record forgery 403,
      owner-private history, private-action 404, delegated (`source: 'component'`)
      runs refusing a foreign action by id, docs twins).
      Declared own prototype-named inputs remain ordinary data; omitted inputs
      never resolve through an inherited prototype.
- [ ] Run-trail lifecycle: run an action, confirm `GET /api/v1/actions/runs?action=<id>`
      lists it, DELETE the action, and confirm the same query is now empty while
      another action keeps its own runs. action-run is protected (no route deletes
      one directly) and off-ledger, and the retention prune only fires during a run
      OF THAT action — the delete cascade is the only thing that stops a
      create/run/delete cycle stranding unaccounted records. Covered by
      verify-actions.
- [ ] Same lifecycle with a run STILL IN FLIGHT: start a run, DELETE the action
      before it finishes, and confirm the run still returns its own result while
      `GET /api/v1/actions/runs?action=<id>` AND the unfiltered history are both
      empty of it. The record is written when the run ENDS, so the cascade cannot
      see it — writeRunRecord removes a record whose action went away mid-run.
      Covered by verify-actions.
- [ ] Kind boundary: an action declaring an UNSCOPED `things.update` (or
      `things.read`) whose step targets a non-data thing (a schema thing, an
      action thing) is refused at run time ("not a data thing — actions read and
      write Data Things only") and leaves the target unchanged; the action still
      SAVES (save time can't resolve a dynamic id). Covered by verify-actions.
- [ ] `node remix/scripts/seed-demo-app.mjs http://127.0.0.1:<nitro-port> <user>`
      seeds the Customer/Invoice demo idempotently (re-run reports "exists").
- [ ] /actions lists your actions with derived effect chips (creates/reads/
      updates/invokes + the limits envelope) and schema IDs resolve to display
      names; clicking a card opens /actions/:id.
- [ ] The inspector shows Takes / Does (numbered steps with op tones, invoke
      steps deep-link to the invoked action) / Can access / Cannot access (no
      network, no secrets, and "no deletes" ONLY while the program does not
      declare things.delete + scoped-only lines) / Limits / Effects, and the
      raw definition.
- [ ] v2 destructive + public-read disclosure: an action with a
      `things.delete` step shows a red "deletes things" chip on BOTH its
      /actions card and the inspector's Effects section, and its Cannot-access
      panel drops "no deletes" without ever printing an affirmative sentence
      under the 🚫 (a "🚫 Can delete …" line would invert the one capability
      that destroys data). An action whose only effect is that delete still
      renders an Effects section. A `things.search` with `scope: 'public'`
      shows "reads everyone's public <schema>" alongside the ordinary read
      chip. Covered by app/components/Actions/actionInspect.test.ts.
- [ ] The Run panel renders one typed input per descriptor, runs the action,
      and shows status + duration + ops/depth/child budget usage + the
      hierarchical trace (1 → 1.1/1.2 for invoked children) with /thing/<id>
      links; the Lopu toast fires on success and error.
- [ ] Last runs refreshes after an in-page run and survives a reload (the
      protected action-run trail).
- [ ] A composed action (onboard-customer) consumes ONE shared budget: opsUsed
      counts child ops, depthUsed 1, childActionsUsed 2.
- [ ] /things: ⚡ action things render via the action kind renderer, the
      Actions filter pill scopes the grid, and clicking an action opens the
      inspector; data things created by runs render through their schema
      {field} templates (the sent invoice shows "— sent" + sentAt).
- [ ] Mobile (375px): /actions and the inspector have no horizontal scroll;
      chips wrap; the run panel stays inside its card.
- [ ] Builder: "⚡ New action" on /actions derives CAN ACCESS chips LIVE from
      the steps (scoped when every step carries a literal schema, unscoped the
      moment one step lacks one); saving lands on the new action's inspector;
      a narrowed scope that no longer covers a step surfaces the registry
      refusal verbatim in the Lopu toast.
- [ ] ttAction: a component render node with ttAction/ttActionInputs draws as
      data-tt-action/data-tt-action-inputs (the ONLY data-* attributes the
      renderer allowlists) and the tt keys never survive as node keys; in the
      /things PreviewModal clicking the control runs the action AS the viewer
      (toast with ms · ops + Inspect link) and the target data thing mutates;
      grid tiles stay pointerEvents:none (clicks select, never run).
- [ ] /things component previews render RESOLVED templates (savedArgs over
      defaults) via the kind renderer — never raw {token} text.
- [ ] Used by: /actions/:key lists the viewer's components binding the action
      via ttAction as clickable 🧩 chips; exact-token matching (an action key
      that prefixes another never cross-matches).

## Design system + builder (`/builder`, `/p/:id`, `/docs/design-system`, `remix/app/components/Builder/`, `/api/v1/webpages/resolve`, `/api/v1/admin/webpages/seed`)

### Saved collection source pagination (2026-09-27)

- [ ] Bind an HTML/Chakra collection to a saved Action returning cursor pages. Next and infinite scrolling append older rows; duplicate IDs replace in place and empty intermediate pages continue.
- [ ] Search for a match beyond the first page; refresh while filtered and confirm the match returns without discarding visible rows during the request.
- [ ] Fail a subsequent page, verify earlier rows remain, then retry successfully. Repeated cursors, invalid row keys and bounded-source overflows stop with a visible error.
- [ ] Change the query target/account while a request is delayed; old rows/completions must not appear in the new target. Inert Builder previews make no collection requests. Shared reads retain stored-graph authorization.
- [ ] Export/copy a Component with a source inside a nested collection template; its literal Action is included/remapped, its input data stays unchanged, and runtime row values grant no dependency authority.

- [ ] Floating page controls: dock Lopu in split mode on all four edges and
      resize it live. The bar, inspector, mode menu and viewport popover stay in
      the remaining page pane, including a shallow top/bottom split. Repeat with
      the navigation drawer pinned left/right. At 390px, 320px and a narrow
      desktop split, controls wrap and modes become a keyboard-accessible menu
      in Builder/Edit/Layout/View/Visit/Deploy order. Escape restores trigger
      focus, mode changes retain form values, and the page bottom clears the bar.
      Mobile Lopu sheets hide the builder layer until dismissed. The safe fixture
      at `/tests/seamless-builder.html` uses the real Lopu host and ephemeral
      drafts/settings, and its Visit/Deploy saves intentionally fail without writes.
- [ ] Seamless editor: open the same owned page at `/builder?page=<id>` and
      `/p/<id>`. Builder/Edit/Layout/View/Visit/Deploy use the same blocks.
      Type into a live form, switch Edit/View/Layout, and confirm its value
      survives. Edit a heading, rich-text leaf, declared text arg and literal
      button label (including spaces, braces, paste and Escape); formatting,
      links and actions survive. Save/reload and verify the changes persisted.
- [ ] Full width, desktop, tablet, mobile, device presets and custom dimensions
      change the real preview viewport/media queries. At 390px and desktop,
      edit inside the preview, open insertion/context menus and the inspector,
      scroll both page and drawer to the bottom, and check for clipping,
      overflow and controls hidden under the combined floating bar. Builder shows no live
      source results. Container is a preview presentation, not an editing mode:
      verify the same size presets and custom maximum width/minimum height,
      no iframe, no maximum height and no change to the active runtime mode.
      Edit exposes pink handles, insertion and context menus without swallowing
      text editing or structural control clicks. Check first-block handles
      remain visible beneath fixed navigation.
- [ ] Visit saves the active edit before navigating; a failed save preserves the
      draft. `/p/<id>?mode=visit` (and legacy `mode=run`) has Thingtime navigation/footer but no builder
      controls. Plain `/p/` View has no Transfer or Edit in builder buttons.
      `/t/<id>` has full-width content and only the tiny Made with Thingtime
      bar; clicking it returns to `/p/<id>`. Private/link-key access follows the
      same permissions on both routes. Dedicated thing/component live output
      has no imposed card, padding or width cap.

- [ ] At desktop, 390px and 320px widths, select a short centred text block,
      a large heading and right-aligned text. The selection toolbar stays above
      the selection, separate from the block label and history buttons; no
      controls cross the viewport, inspector or scrolling-container edges.
      Resize the container and scroll from top to bottom with menus open.
      Native settings and Convert to submenus fit, including with reduced
      keyboard space. Large document fonts do not enlarge toolbar icons, and
      narrow desktop text has no unused 50px editor gutter.
- [ ] Move the pointer from an edited block through the empty space to Undo,
      Redo and Changes. All remain reachable; Changes opens, its controls work,
      and its Close button returns to the same editor (portal clicks must not
      be intercepted by the builder frame).

- [ ] Every restyled page (status, mongodb-status, tests, vercel, crypto,
      migrations, apps, raw, admin + sub-panels) renders the PageShell surface
      wash, clears the fixed nav (no underlap at 54px), and shows the mono
      eyebrow + rainbow/ink header — no raw Chakra Container/Badge dashboards.
- [ ] /builder lists the signed-in user's webpage things; New page ✨ creates a
      private page and opens the canvas; signed-out users get the quiet card.
- [ ] Shared composition inheritance: an anonymous valid-key reader sees the
      author's component inside nested containers, not a visitor's same-key
      component. Wrong/revoked links and removed group memberships fail closed.
      Public roots include private author components without disclosing their
      standalone link keys. Foreign private components remain inaccessible;
      shared writers cannot add guessed private author refs (by id or key).
      Run the real-API fixture with `TT_SHARED_TEST_URL=http://127.0.0.1:<port>
      pnpm --dir remix run test:webpages`; it creates test accounts through the
      API and deletes its exact test Things/groups. Existing test sessions may
      be supplied through `TT_SHARED_OWNER_COOKIE`/`TT_SHARED_VISITOR_COOKIE`.
- [ ] A signed-out shared control runs its included action and child action;
      invalid/revoked root keys and unrelated action IDs are refused. Shared
      runs can read explicitly included data but cannot create/update/delete
      saved data, including when the caller also happens to be the owner.
      Copy to my Builder/Things creates private independently editable parts,
      rewrites nested action/component references, and leaves the original
      unchanged. Repeat the control/copy checks at desktop and mobile widths.
      The opt-in API fixture also accepts `TT_SHARED_PLAYWRIGHT_PATH` (an
      installed Playwright module), `TT_SHARED_CHROME_PATH`, and
      `TT_SHARED_SCREENSHOT_DIR` for 1440px/390px anonymous browser proof.
      Set `TT_SHARED_SESSION_CACHE` to an ignored local temporary file to
      reuse generated test sessions across runs instead of exhausting the
      signup budget; that file contains test credentials and must never be
      published. The fixture writes it with owner-only file permissions.
- [ ] Hidden-link media: page/post-bound attachments accept the current root
      key and group audience; missing/wrong/revoked keys and removed group
      membership fail closed, including cache validation. Shared HTML, Chakra,
      native media blocks, attachment details, audio and lightboxes forward the
      key only to the exact relative first-party attachment content endpoint.
      External URLs never receive it; independently keyed URLs keep their own
      key. Negotiate `api.attachment-content >= 1.1.1` before attaching a key.
      The shared browser fixture stubs image bytes to verify key transport;
      attachment service/route tests cover authorization separately. Do not
      treat that fixture as proof of real S3 bytes or independent media copies.
- [ ] Copy an image-only post with an ordered gallery and comments/replies deeper
      than the initial rendered preview. Include image-only comments and files on
      the deepest reply, plus comments on media with their own galleries. Copy to my Things must create a private root, fresh file
      IDs and correctly nested inherited comments; reload, copy the copy, and
      revoke/delete the source to verify independence. Check desktop and 390px
      mobile, open a copied attachment, expand replies, and scroll to the bottom.
      Hidden/blocked comments must stay excluded; unavailable files, quota errors,
      source changes and the 512-Thing/file/comment limit must fail without a truncated copy.
      Negotiate `api.things-fork >= 1.5.0`. Run the opt-in real-API regression with
      `TT_FORK_TEST_URL=http://127.0.0.1:<port>` and `TT_FORK_COPIER_COOKIE` for an
      upload-approved disposable account:
      `node --import tsx --test app/api/utils/actions/forkComments.integration.test.ts`
      from `remix/`. Its linked galleries prove relational binding and URL
      independence, while byte-copy unit coverage uses a mocked object store;
      neither substitutes for real S3 byte-copy acceptance.
- [ ] Copy a shared standalone Data Thing with extended content and a private
      schema definition. The copy keeps its extended content, gets its own
      private schema/id/name pair, exposes no original link key, and is editable
      only by its new owner. The original stays unchanged. Wrong root keys fail.
      Account/credential, subspace machinery, relationship and app-storage rows
      have no copy control. At 1440px/390px, Copy to my Things fits the viewport
      and signed-out users reach sign-in. Wait for the copy control to mount
      before starting the response timer; byte-transport fixtures must not make
      real requests to deliberately invalid image URLs in the signed-in test.
- [ ] Open a shared Data Thing whose rendering schema is private: the schema
      template renders at desktop/mobile widths through `id` + `sharedRoot`
      after negotiating `api.things >= 1.6.0`. Reading the schema independently
      or an unrelated id through the root still fails. Wrong/retired keys and
      removed group memberships fail on contextual reads. App tokens cannot
      use this first-party mode to escape their namespace. Every response is
      private/no-store; shared templates never enter a schema-only local cache.
- [ ] Nested media inheritance: a literal first-party attachment URL in an
      included author component/schema or native media block can use the root
      audience even when its bound post is private. Unrelated private media,
      foreign private media and author media referenced only by a foreign
      component gain no access. Public profile/comment media retains its
      independent access. Ready state, moderation, object versions and home
      storage remain enforced. Revoked keys/group access fail on every read,
      including cached-byte validation. Shared editors cannot inject new
      private media refs. Negotiate `api.attachment-content >= 1.2.0`; forward
      `sharedRoot` plus the key only to the exact first-party content endpoint.
      Explicit audio downloads use the same context without persisting its URL.
- [ ] Shared component media supplied through argument defaults or savedArgs
      renders signed out with the root context at desktop/mobile widths.
      Saved values override defaults; replacing one removes the old grant.
      Unused args, unknown runtime tokens, external URLs and independent keys
      grant nothing. Non-owner editors cannot inject unreadable uploads through
      either argument source. Expansion limits never truncate one attachment
      identifier into another; negotiate attachment-content 1.5.0.
- [ ] Embed another author's public component in a hidden-key page: its
      authored private action/data/media children work signed out, just as
      they do when the component is opened directly. Revoking the outer key
      or the foreign component audience denies access. A third-party shared
      writer may add that public composition, but cannot use page arguments
      to select guessed private actions/media belonging to either author.
      Check PATCH /things and POST /things/update, independent copying after
      source revocation, and desktop/mobile Draw controls without Edit Original.
      Negotiate actions-run 1.3.1, things-fork 1.2.1, attachment-content 1.6.2.
- [ ] A nested page block overrides a same-author component's saved media args.
      Two blocks using the same component may render different media. Resolve
      aliases with the same composition lookup used for child reads; removing
      an override revokes its old media. Unused args and foreign templates do
      not grant private root-author media. Shared writers may preserve existing
      args but cannot insert inaccessible media through an override. Negotiate
      attachment-content 1.6.0; verify both desktop and mobile rendering.
- [ ] Conditional media properties: signed-out Draw/toggle controls may switch
      between stored image/poster/link/CSS alternatives under the same root
      audience. Include wrappers around the props/style record, nested maps,
      and stored argument outputs. Condition operands, map keys, action inputs
      and title metadata grant nothing. Revocation removes inactive grants too;
      both PATCH /things and POST /things/update reject an unreadable upload
      inserted into an inactive property branch. Negotiate content 1.6.1.
- [ ] Canvas: hovering a block draws its dashed boundary + label chip; nested
      sub-blocks highlight innermost-wins; clicking selects (solid outline)
      and opens the inspector in the right drawer.
- [ ] Inline "+ add block" lines appear between siblings on hover; the menu
      offers quick structural blocks and a live component search backed by
      /api/v1/components/browse; picking a component renders it instantly.
- [ ] Inspector args derive from the component's arg specs (string/text/
      number/boolean/enum inputs); edits re-render the canvas live; align +
      max-width apply; delete removes the block (native blocks can't be
      deleted, only moved).
- [ ] Drag the ⠿ chip onto any insert line to reorder/move blocks, including
      into/out of containers; dropping a container into its own subtree is
      refused.
- [ ] Save on a fresh page creates the thing (private by default); the Public
      toggle publishes (acl tt:all) and /p/<id> renders it; anonymous viewers
      see public pages read-only while included controls can run in the
      root-authorized read-only action mode (no saved-data mutations).
- [ ] Site edit mode: ✏️ pill (signed-in only, hidden on /builder, /p/*,
      /authorize) enters in-place editing of the current route; the live app
      screen renders as the locked 🔒 native block; Save my version forks a
      viewer-owned twin; leaving edit mode shows the personalised blocks in
      view mode; reset-to-default deletes the fork and restores the seed.
- [ ] Global blocks (webpage-site-global doc) render on every page and do NOT
      refetch or remount on client navigation.
- [ ] Admin seed POST /api/v1/admin/webpages/seed converges (re-run →
      unchanged), GET returns the census, non-admins get 401/403, and
      webpage- shareIds are refused on generic creates (reserved prefix).
- [ ] /docs/design-system shows the foundations/page-scaffold/brutal-button/
      builder-blocks entries with live stories; /design-system redirects there.
- [ ] Demo library: /builder/demos paints the whole catalog (200–500 demos,
      `pnpm --dir remix run test:schemas` → webpageDemos asserts every demo
      clears validateThingtimeCrystal(["webpage"]) unchanged and stays under
      the block/byte caps) instantly with no spinner; kind + family chips and
      the search box filter with the URL in sync; thumbnails mount lazily as
      you scroll and stay mounted; Show more paginates; Preview opens the
      full-size modal; Use template ✨ copies the demo into the viewer's own
      page (signed-out → login) and opens the builder; the Builder header
      links to the library.
- [ ] Component blocks: the 🧩 Component blocks chip shows demos whose blocks
      reference PLATFORM LIBRARY components by componentKey. Those blocks draw
      real library components (buttons, a card, a text input, a badge, a status
      avatar) in the thumbnail AND in the Preview modal once the demos endpoint
      answers — an unresolved ref renders as NOTHING for a viewer, so a blank
      card here means the catalog names a componentKey the components-db seed
      does not have. Cross-check with
      `GET /api/v1/webpages/demos` → every entry in `refs` non-null (the
      `webpages-demos-library-components` apiTest asserts exactly this).
- [ ] GET /api/v1/webpages/demos lists the catalog anonymously with seeded
      flags (0 seeded on a fresh DB is correct), family/kind filters, slug=
      returns the crystal, unknown family → 400, unknown slug → 404; admin
      POST /api/v1/admin/webpages/seed-demos converges (re-run → unchanged),
      after which every demo opens at /p/webpage-demo-<slug> and in the
      builder (edits fork, the seed never changes) and the gallery shows 🌱
      seeded + the /p/ link; GET /admin/webpages/seed reports
      siteSeeded/demosSeeded/demosTotal/suitesSeeded/suitesTotal alongside
      totalSeeded.
- [ ] Text blocks accept an optional `href` (https, site-relative, mailto:,
      tel:; javascript:/data:/http: refused — `test:schemas` →
      webpageBlockGate) and render as an anchor (`data-testid`
      text-block-link; external targets open in a new tab with noopener; the
      edit canvas never navigates); the inspector's Link field round-trips
      it. Every demo pill links (/register, /docs) and every demo nav label
      links to its slug. Block css `white-space` reaches the text element (a
      nowrap pill in a flex row stays on one line despite Main's global
      pre-wrap); standalone pills shrink-wrap via `align` and row labels keep
      their own width via `flex: 0 0 auto`.
- [ ] Run-or-install: on a seeded suite page (/p/webpage-demo-suite-<key>)
      or the gallery preview, a signed-in viewer's control click that finds
      no owned action (executor: owner-only delegated resolution) installs
      the suite into their things, re-runs the SAME click, then opens their
      own copy; signed-out → login. Owned actions run directly. Foreign
      user pages stay inert for non-owners (`useTtActionClicks` onUnowned,
      `installSuite`, `routes/p.tsx`).
- [ ] Demo gallery thumbnails scale to the card (ResizeObserver: scale =
      box width / 760) — no clipped right edge at any grid column width;
      layout audit script (scratchpad/audit-demos.js idiom: wrapped pills by
      Range line count, overflow by scrollWidth, wide pills in columns)
      reports zero defects across all cards.
- [ ] Behaviour suites (`schemas/behaviourSuites.ts`, `pnpm --dir remix run
      test:schemas` → behaviourSuites asserts every schema/component/action/
      data/page crystal clears its kind gate in BOTH materialisations): the
      🧪 Suites tab on /builder/demos lists 14 suites with counts; Preview
      renders the suite page with its ttAction controls from the catalog (no
      seed needed); Install suite ✨ (signed-in) creates the viewer's OWN
      schemas → components → actions → data (stamped schemaId) → page through
      /things and opens /p/<page>; clicking a control there runs the viewer's
      own action (source component → owner-only resolution) and the Lopu
      toast links to the run record; capture-and-qualify / open-with-note
      exercise actions.invoke + $step refs + ttConcat; complete/escalate/pay
      exercise things.get + things.update by id. Seeded suites (admin
      seed-demos) are browsable on /schemas, /components, /actions and
      /p/webpage-demo-suite-<key>; running action-demo-* from /actions mints
      the viewer's own data things against the public schema id.
- [ ] Nested blocks select on click: with a container (grid/row/column) holding
      children, clicking a CHILD selects the child (inspector shows its
      fields), clicking the container's own area selects the container —
      ancestors never steal the capture-phase click (regression: outermost
      frame always won and stopped propagation).
- [ ] Grid ×2 + two blocks: first block lands in the LEFT cell, second sits
      beside it, the trailing add-tile takes the next free cell (regression:
      interleaved insert zones consumed grid cells and shoved blocks right).
- [ ] Row container with two text blocks: children share one line via flex
      sizing (regression: width-100% frames wrapped each child onto its own
      line); row insert zones are slim vertical strips.
- [ ] Inline WYSIWYG: clicking a text block edits in place with the caret
      preserved while typing (regression: tag flips mid-edit replaced the DOM
      node under the mount-only init and ATE the text); Enter/Shift+Enter
      insert soft breaks; selecting text floats the B/I/U/S/link toolbar;
      formatting survives deselect (renders through the allowlist renderer).
- [ ] Custom CSS/tag/html/media fields round-trip a save and the gate rejects
      `expression()`, `@import`, `javascript:`, non-https `url()`, script/
      iframe text tags, ftp/js media src, and >20KB html
      (`pnpm --dir remix run test:schemas` → webpageBlockGate).
- [ ] Edit mode shows no white body bar between the 🌐 Global strip and the
      page region (canvas paints the surface wash) and the Global eyebrow has
      clear air below the navbar (view + edit).
- [ ] Dropping an image FILE onto a media block replaces its src (never opens
      the file in the browser); dropping anywhere else in edit mode uploads
      and appends a media block (window-level guard); ⌘/Ctrl+V of a clipboard
      image while a block is selected uploads at the selection, and plain
      text paste into inputs/the inline editor is untouched.
- [ ] Media inspector offers BOTH ⬆️ Upload file and a URL field; the Kind
      select never wraps its option text (FieldPair min-width regression).
- [ ] Inspector padding/margin mode toggles (▢/⬍⬌/⛶) write the css shorthand
      and round-trip (axes ↔ sides keep values); per-corner radius, border
      and shadow composers produce valid shorthands
      (`pnpm --dir remix run test:webpages` → figmaControlValues).
- [ ] Align=center on a block visibly centers it (fit-content + justify-self
      in grids — regression: align-self alone did nothing on 100%-wide
      blocks and was the wrong axis in grid cells).
- [ ] Text block 📝 Rich editor (Editor.js) applies headers/lists/tables/code
      as sanitised html and reopens editable; double-click on text inside a
      component block opens the inline arg editor and patches the arg.
- [ ] Drawer resizes by dragging its left edge (handle reachable even with
      the inspector scrolled — content scrolls, not the shell); width
      persists across reloads and the canvas padding follows live; selected
      inline text editor shows ONE outline (no double border once padding is
      set).
- [ ] TRUE WYSIWYG: a saved block's top/left/size are IDENTICAL in edit mode
      and view mode (toggle ✏️/Done and measure) — insert affordances are
      overlay strips on block seams and never occupy layout; the 🌐 Global
      label floats in the nav breathing band; grids have no add-tile cell.
- [ ] Selecting a text block mounts the FULL Editor.js editor inline
      (headings/lists/tables/quotes); a heading typed there renders at real
      heading scale after deselect (regression: Chakra reset flattened
      rendered rich markup to body size); right-click a text block →
      "Advanced rich editor…" opens the modal.
- [ ] Right-click any block (or the chip ⊞): Wrap with block drill-down wraps
      IN PLACE (block becomes the container's only child), Duplicate
      deep-clones with fresh ids, move/delete work
      (`pnpm --dir remix run test:webpages` → wrapBlock/duplicateBlock).
- [ ] Numeric inspector fields never rewrite mid-typing: type "300" into Max
      width — it must NOT snap to 120 at the "3" (clamps commit on
      blur/Enter); spaces can be typed in the uniform padding input.
- [ ] Dropping the SAME OS file twice starts two uploads (regression: the
      uploader's session dedupe silently swallowed re-drops); Rich-editor
      Apply shows immediately in the still-mounted inline editor and is not
      overwritten by its blur commit (external-change sync); pasting into
      drawer inputs or the Editor.js modal is never hijacked by the
      paste-to-upload listener; a padding of calc(100% - 20px) survives the
      Sides control (paren-aware tokenizer) and a multi-token shorthand is
      shown raw in uniform mode, never as an empty field.
- [ ] Verification: `node remix/scripts/verify-webpages.mjs http://127.0.0.1:<nitro-port>`.


### Recovery cards, build IDs and app selection

- [ ] Select Electron, Commander, Widgets and Thingtime Recovery in the App picker.
      Each sidebar/cache page must contain only that app's builds and counts;
      Recovery appears only in its own section. Relaunch with Recovery selected.
      Every release row/detail and cached build shows a Built/Released date beside
      the build identity, or an explicit unavailable date for legacy metadata.
      Refresh and relaunch offline: cached release dates persist, Cached dates
      stay distinct, and unsigned trust markers are unchanged. Check narrow/wide
      windows, scroll all lists to the bottom, and open/cancel unsigned prompts.
- [ ] In release details, use **Download & install** beside **Download and verify**.
      It must verify and install the exact selected release through the existing
      helper, preserving rollback; verify-only must leave installed apps unchanged.
      Both buttons disable during a download and for withdrawn releases. Failed
      downloads must never install an older cached build. Open/cancel unsigned
      install acknowledgement, then verify cache-only still only caches. Check
      the action row at wide and narrow window sizes, scrolling to the bottom.
- [ ] In both This Mac views, confirm build IDs come from the bundle or manifest,
      old Electron bundles expose their embedded commit, and Recovery cards use
      the Recovery component name even if old metadata used a desktop title.
- [ ] Open the App selector, switch Electron → Commander → Electron, and verify
      cached entries and release selections stay with their app. Save installed
      Commander, verify its cached signature, and confirm Electron's cache is unchanged.
- [ ] Inspect release cards and detail metadata at narrow and wide macOS window
      sizes, scroll every list to the bottom, and open/cancel unsigned acknowledgement.
      Dates, badges, long versions and archive names must wrap without clipping.
- [ ] A Commander handoff rejects an Electron path and vice versa. Unknown or
      incomplete build metadata must not fabricate a numeric build number.
- [ ] Cloud archives contain their run number in both app build metadata and
      `CFBundleVersion`; signed releases pass strict codesign, Gatekeeper and
      stapler checks after downloading the actual published ZIP.
- [ ] With a Developer ID certificate in the signing keychain, the production
      packager passes its unprefixed name and team to electron-builder, while
      native helpers keep the full certificate name. Missing or development-only
      identities fail before building; no unsigned fallback is allowed.

- [ ] Dispatch Commander on the protected controller; confirm its exact main SHA,
      signed Commander and Recovery ZIPs, checksums, and `latest=false`. Switch
      Recovery to Commander, download/verify both cards, install with rollback
      preserved, and verify build number, commit and branch still appear offline.
- [ ] Run Commander `--prepare` and `--build-only` with an installed app running;
      its PID/daemon remain unchanged. A failed notarization must not stop or
      replace the installed app. Run `node --test Commander/script/release-packaging.test.mjs`.

- [ ] Commander production verification passes the Mach-O file before `lipo
      -verify_arch` and exercises the real tool against a native fixture before
      cloud signing. A verifier failure must publish no incomplete release.

## Persistent media and progressive image regression

- [ ] At desktop and 390px mobile widths, scroll the feed/attachment fixture
      top to bottom: below-fold images stay lazy, low-resolution previews
      appear before responsive images, and no horizontal overflow appears.
- [ ] Leave and revisit a managed image: authorization checks increase while
      downloaded byte requests stay unchanged. Revoke access and revisit:
      cached pixels must not render. Restore access and verify loading resumes.
- [ ] Open and close the image lightbox, verify contained sizing, and inspect
      Media settings toggles and clear action at desktop and mobile sizes.
- [ ] Disable caching, clear storage, and disable previews; original loading
      remains usable. Unsupported image formats fall back without retry loops.
- [ ] Confirm partial/large files use native streaming and cached range reads
      cannot bypass authorization. Verify storage failure degrades to HTTP.

## Third-party connections (`/connections`, `/connections/feed`, `/api/v1/connections/*`)

Automated first: `pnpm --dir remix run verify:connections` (94 real-API
checks; `TT_VERIFY_LIVE=1` adds a live Hacker News pull). Manual checklist:

- [ ] `/connections` renders the provider catalog signed-out with a quiet
      sign-in card; signed in, connecting the Demo provider adds it under
      "Your connections" with Feed + Unlink working, and reconnecting the
      same handle reports "Already connected".
- [ ] Connecting the same external identity from a SECOND Thingtime account
      converges on the same external account (many-to-many): both accounts
      read the same posts through their own links, and each earns its own
      acl grant even when the other account's sync fired first (the shared
      per-account cooldown must never strand the second user's grants).
- [ ] `/connections/feed` merges all connections newest-first with per-
      connection tabs; external posts render through the native PostCard
      with the third-party author (never "Anonymous"), comments and
      reactions work natively, and `/post/<ext-post-…>` permalinks resolve
      with aggregated counts.
- [ ] A "warn" AI feed filter veils matched posts behind the ⚠️ card with a
      working "Show anyway" button (reason + source line shown); a "hide"
      filter drops them with the "N posts hidden" summary; pausing a filter
      stops matching; verdicts stay stable across reads (cached) and editing
      the prompt re-classifies.
- [ ] SSO connect: unconfigured providers show "Needs setup" (disabled);
      configured ones show "Sign in with <name>" and redirect to the
      provider's own login; the callback lands on /connections with the
      "Account linked" toast (or the oauthError toast on decline/forged
      state); the fields-based POST /api/v1/connections always refuses SSO
      providers with a pointer at oauth/begin; no token material ever appears
      in any API response or client store.
- [ ] Virtual YouTube list: searching a channel ID/URL/@handle returns a
      Subscribe row keylessly (name search only with YOUTUBE_API_KEY, and the
      hint line says so); first Subscribe auto-creates the "My YouTube
      channels" connection; the connection row shows "N channels"; Unsubscribe
      removes just that channel; the merged uploads feed interleaves channels
      newest-first; two users' lists stay independent while a shared video
      stays ONE post (one external-post-source row per sourcing account) with
      unified comments.
- [ ] Feed deepening: scrolling past the synced end (or "Fetch older from
      your apps") pulls older provider pages without resetting scroll
      position, and repeated deepens stop at the per-account depth cap.
- [ ] Personal-provider posts stay invisible (404) to non-linked users;
      `ext-` shareIds are refused on generic create/update; the connections
      kinds never appear in the generic /things browser; unlink removes only
      the caller's link and the shared account retires with its last link.
- [ ] Relational source membership (regression — the post doc must never grow
      per linker): with two Thingtime accounts linked to ONE external
      identity, a synced post's `acl` is exactly the constant `tt:extsourced`
      (personal) or `tt:all` (public) — never `tt:extacct/<accountId>`, which
      would both grow without bound on a viral post and disclose the other
      members' external-account ids through `PublicPost.acl`. The post carries
      no `sourceIds` array; membership is one `external-post-source` row per
      (post, account). Unlinking revokes that viewer instantly while every
      other linked member still sees the post, and a feed page never shows the
      same post twice even when two of the viewer's own accounts source it.
- [ ] Migration `relational-external-post-sources` (admin → /docs/schemas):
      dry run reports the pending legacy posts, the live run creates the
      membership rows + rewrites the acl + unsets `sourceIds`, a legacy
      `tt:extacct/` post stays visible to its linked member both BEFORE and
      AFTER the run, and a second run is a no-op.

## Commander emoji paste recovery

- [ ] Seed a disposable clipboard value, paste an emoji into TextEdit and a browser text field, and verify the emoji arrives before restoration. Repeat with a busy destination, rapid Return presses, and two Commander windows. Copy a new value during the paste and verify restoration never overwrites that new copy; check Paste and Keep a Copy separately.
- [ ] Open Commander over a text editor, dismiss the root launcher with Escape, and immediately type: input must return to the original editor. Escape from Actions must only close Actions. Clicking another app, opening a result, or switching to Commander Settings must not reactivate an older destination. Repeat with a pinned launcher.

- [ ] Follow `Commander/docs/TESTING.md` for denied emoji paste: preserve the selected emoji, recents, learning and clipboard; keep the error, grid and recovery controls inside the native window at standard/minimum/compact widths and large text size. Verify the installed signing requirement stays stable and complete an approved Accessibility grant migration before claiming successful paste.

## App suites — Pokeworld + StarsAlign (`remix/app/schemas/appSuites/`, `/p/pokeworld`, `/p/starsalign`)

- Seed as an admin (`POST /api/v1/admin/webpages/seed-demos` or the 🌱 button
  on `/builder/demos`), then open `/builder/demos` → **📱 Apps**: both cards
  show pages counts, a tagline, **Open /p/<key>** when seeded, **Install app**.
- Signed OUT: `/p/pokeworld` and `/p/starsalign` render the seeded pages with
  every bound block in its **signed-out** state (sign-in card), nav links work,
  no fetch is attempted (Network: no `/actions/run`).
- Signed IN, not installed: the same pages show the app's **Install** card;
  pressing it (or any control) installs through the server endpoint and the
  same URL now serves your copy (`/api/v1/webpages/resolve?id=pokeworld` →
  `source: "user"`). Re-installing reports `created: 0`.
- Pokeworld: begin the journey (name ≤7, sprite) → the 11×9 viewport paints
  with you in the centre; each D-pad press moves one tile (blocked tiles keep
  the facing), items/signs toast, tall grass eventually spawns a battle; the
  battle panel shows sprites + HP bars, four moves with PP, balls with counts,
  items, RUN; catching adds to the party/box and the pokédex; PARTY (make lead,
  deposit, heal), BAG (use on), POKéDEX (100/page, silhouettes until seen),
  PC (withdraw), OPTION (name/sprite, teleport by lat/lng, badges). Every
  control's run lands on `/actions/<id>`.
- StarsAlign: signed in without a profile → welcome card with the live
  sun/moon; Settings → save a birth date (future dates refused), find a city
  (chips), set the place, save again (updates, no duplicate) → Today shows
  greeting, chips incl. rising, the wheel (svg), the sky rows, transits or the
  quiet-sky card, houses; School search/section/entry/Combinator; Erase
  removes the profile and Today returns to the welcome.
- Layout: check desktop (≥1024) and mobile (375) — the map grid scales with
  its container, D-pad stays 48px cells, nav wraps, no horizontal scroll.
- Regression classes: an `if` branch must not evaluate when untaken (a
  `set` with an empty key inside the untaken branch used to fail the run);
  the run payload's own `status` must never shadow the HTTP status in scripts;
  a control gathers only the named fields of its closest `<fieldset>` (the
  city Find button used to send the birth-date fields to `pick-city`, which
  refused them as unknown inputs); a profile whose place was cleared
  (`placeName ''`, `tz ''`, lat/lon 0) must read as a solar chart, not a
  refusal; nested `ttEach` must flatten (the tile grid rendered empty).

## Dedicated live pages — every card opens one (`/components/:key`, `/builder/demos/:slug`, `/schemas/:key`, `/thing/:id`, `/actions/:id`)

Shared pieces: `remix/app/components/Builder/liveComponent.tsx` (`useThingSource`
+ `LiveTemplate` — the ONE live-render path; `useBlockSource` in the page
renderer delegates to it), `remix/app/components/Actions/ActionRunConfirm.tsx`
(`useActionRunConfirm` → the confirm gate `useTtActionClicks` accepts), and the
route stubs in `remix/app/routes.tsx`. Trust never comes from markup: own thing
→ live, no confirm; seeded platform/demo/app thing → live for a signed-in
viewer with the confirm dialog + run-or-install; a stranger's thing → inert with
a label. Browse cards and `/things` tiles are LINKS, never armed controls.

- [ ] `/components`: the whole card (title, preview area) opens
      `/components/<key>` in every view mode (feed / grid / columns); the
      buttons on the card (design pills, args/schema, react, Add to library,
      Save version, Docs) still work in place without navigating; middle-click
      on the title opens a new tab; the browse previews stay inert (a
      `data-tt-action` control in a preview does nothing).
- [ ] `/components/<key>` (e.g. `/components/app-pokeworld-hud`,
      `/components/demo-guestbook-signer`): preview + args tester + docs are
      still there; a LIVE pane renders the same component inside the page
      runtime. Own component → controls run with no dialog. Seeded suite/app
      component (signed in) → first press shows the "Run …?" confirm naming the
      action + inputs, approve runs it (or installs the suite, then re-runs);
      "Don't ask again for this action on this page" skips only for that
      action and only until reload. Stranger's component → inert + "🔒
      Controls belong to @author" label next to Save version. Signed out →
      "Sign in to run controls" hint; a press toasts and routes to /login.
      Data source control (`?source=<actionKey>&refresh=…`) renders the real
      data (`app-pokeworld-hud` + `app-pokeworld-state`) and never persists to
      the thing.
- [ ] `/components/<key>?source=<actionKey>` opened from a PASTED link asks the
      "Run …?" confirm BEFORE the source runs — for the owner of the component
      too, not just on a seeded one (the URL binding is nobody's authored
      markup, so it is gated even where the click path is not). Cancel leaves
      the live pane with no source chip and runs nothing, while the source
      control keeps the binding so it can be edited or cleared; approve runs it
      once and, for `refresh=interval`, starts the ticking. Same rule as
      `/thing/:id?source=` — a link must never start a program by surprise.
- [ ] `/builder/demos`: every demo / suite / app card opens
      `/builder/demos/<slug|key>`; the Preview button still opens the modal;
      the modal is live for a signed-in viewer (runtime provider present —
      source blocks load, `$refresh` works); the kind chip row shows every
      kind including "🧮 Interactive" and "🧪 Behaviour suites"
      (= not app, not interactive).
- [ ] `/builder/demos/<slug>` (`hero-centered-paper`, `guestbook`,
      `pokeworld`): paints instantly from the code catalog (no spinner), then
      reconciles the seeded flag; PREVIEW pane inert with the metadata rail;
      LIVE pane interactive for a signed-in viewer (platform-curated rule) and
      a sign-in card when signed out; app suites render the entry page live
      with the other pages as tabs (+ `/p/<pageKey>` links when seeded);
      Install / Open /p/ / Use template / Open in builder do what they say;
      unknown slug → "This demo isn't here" with a link back.
- [ ] `/schemas`: every card opens `/schemas/<builtin:id | shareId>`; card
      buttons (react, Add to library, Create a thing, Fork, Search things,
      Docs) still work in place.
- [ ] `/schemas/<key>` (`/schemas/builtin:post`,
      `/schemas/schema-app-pokeworld-trainer`): header + badges + full field
      tree + on-create crystal chips + render preview; the create-a-thing
      form is INLINE and posts through `things.create`; "Your things with this
      shape" lists the viewer's own data things and refreshes after a create;
      honest empty states; a `builtin:` key that is also seeded shows the
      registry entry.
- [ ] `/things`: single-click still selects; the tile title is a keyboard
      link to the dedicated page (webpage → `/p/:id`, component/data →
      `/thing/:id`, schema → `/schemas/:id`, action → `/actions/:id`, post →
      `/post/:id`, folder opens the folder); open (double-click / Enter) goes
      to the same page; context-menu Preview + `?preview=<id>` still open the
      quick-look modal; Copy link / Share produce the real permalink;
      previews stay `pointer-events: none`.
- [ ] `/thing/:id`: component → LiveTemplate with the trust ladder above
      (`?source=<actionKey>` optional binding); webpage → inline live render +
      "Open /p/…" link; action → summary + "Run it on /actions/…"; schema →
      link to `/schemas/…` + field chips; data → rendered through its schema's
      render template when one exists; raw JSON still available; the back link
      honours `?from=things|actions|feed`.
- [ ] `/actions`: each card is a real link (middle-click works); nested
      buttons don't navigate.
- [ ] Mobile (375px): none of the pages above scroll horizontally; the live
      panes and tabs wrap.
- [ ] `/thing/:id?source=…` rejects a key the server would reject rather than
      confirming it first: `?source=Foo/Bar@baz`, `?source=My_Action.v2`, and a
      120-character key must show NO "Run …?" dialog at all (the binding is
      simply ignored). `?source=app-pokeworld-state` on a live component still
      confirms once, then loads the real data.
- [ ] Switching `?source=` never leaves the PREVIOUS program running while the
      new one is still being confirmed. From a live `/thing/<A>?source=<x>`
      that you approved, navigate in-app to `/thing/<B>?source=<y>` (and
      separately, just edit `?source=` on the same thing). While the "Run
      <y>?" dialog is open the live pane must show NO source result and fire
      no request for `<x>` — check the Network tab for an action run of `<x>`
      against `<B>`. The clearing branch is skipped whenever `<B>` repaints
      instantly from the `tt-thing-*` cache, which is the normal path, so the
      approval has to be dropped explicitly before re-asking (same order as
      `/components/:key`). A viewer approved `<x>` for one surface, never for
      the next one.
- [ ] `/thing/:id` cache stays bounded and session-scoped: open 45+ different
      things, then in DevTools → Application → Local Storage confirm at most 40
      `tt-thing-*` keys survive and the oldest were dropped, not the newest.
      Sign out and confirm every `tt-thing-*` key is gone — the projections are
      ACL-gated (private posts, circle data) and must not outlive the session,
      the same bar as `tt-activity-` / `tt-saved-` / `tt-page-source:`.
- [ ] Every per-entity localStorage namespace is bounded, not just
      `tt-thing-*`. Open 20+ different component families
      (`/components/<key>`) and 20+ schemas (`/schemas/<key>`), then in
      DevTools → Application → Local Storage confirm at most 12
      `tt-component-family-*` and 16 `tt-schema-things-*` keys survive, oldest
      dropped first, and the page you are ON still paints instantly from cache
      on reload. These namespaces grow one key per entity visited and each
      entry is large (a family is up to 16 component crystals with their
      render trees), so unbounded they fill the origin quota — and because
      `writeLocalCache` swallows the quota error by design, the symptom is not
      an error but every OTHER `tt-*` optimistic cache silently going cold.
      Regression covered by `remix/app/hooks/localCache.test.ts`
      (`pnpm --dir remix run test:hooks`).
- [ ] `remix/app/routes/thing.tsx` contains no raw NUL byte. Check with
      `python3 -c "import sys;print(open(sys.argv[1],'rb').read().count(bytes([0])))" remix/app/routes/thing.tsx`
      — it must print 0, and the two requestKey separators must stay written as
      the six-character escape sequence in the source. An embedded NUL makes
      git, grep and ripgrep treat the whole file as binary and silently skip
      it, which costs a reviewer real time.
## Lopu AI assistant (`/lopu`, floating launcher, `remix/app/components/Lopu/`, `/api/v1/lopu/chats*`, `/api/v1/ai/models`)

- [ ] Action discovery: inspect an owned server/browser Action in Ask mode;
      no confirmation or run is created. Check enum choices, required fields,
      numeric bounds, reference hints and oversized JSON defaults. Candidate
      validation makes no writes; invalid inputs must fail before an Ask card.
      Corrected input still needs approval. Revoke readability and inspect again.
      Failed multi-step runs retain their run ID and require state readback
      before replay; inspection never promises downstream success.

- [ ] Large Lopu reads: inspect a component with a deeply nested form, more
      than 60 children and long text. Default `get_thing` explains omissions;
      `path` + `offset` reads every JSON page exactly. Verify escaped pointer
      keys, a missing path, changed revisions and access revoked between pages.
      A rejected workspace category lists the exact case-sensitive choices;
      correcting it succeeds without speculative writes to discover an enum.

- [ ] Chat Action access: new/legacy chats start in Ask. Confirming runs exactly
      the proposed Action/tool; Full runs without cards and persists on reload
      only for that chat. Check desktop and 390px composer/settings, switch
      chats/accounts, rapid toggles, failed saves and a pending save followed by
      Send. Background refresh must preserve an unsent chat's selected mode.
- [ ] Run the opt-in disposable [Lopu Action QA](docs/lopu-action-access.md):
      nested browser Action saves/reads Equipment without a page button; a
      server Action returns its result; stable-ID retry leaves one record.
      Full-to-Ask pauses the next call, logout rejects execution, scoped/foreign
      sessions cannot change access, and an Action cannot update chat permissions.
      Stale existing-chat reply bodies must not re-grant Full access.

- [ ] Lopu read continuity: read a 24k+ JSON value across several hosted
      checkpoints and verify the next provider request receives all previous
      pages without model-issued rereads. Resume after reload; deny foreign chat
      access, revoked Thing access and mixed revisions. Confirm raw JSON/grants
      never enter public history or private locator storage. Run the disposable
      Lopu Action QA for real protected-message persistence and readback.
- [ ] Completed tool context: force a checkpoint immediately after an Action,
      then continue and verify its exact result reaches the provider without a
      second Action execution. Only the exact prior request in the current
      account, chat and deployment can supply results. Revoked chat membership,
      expired output, incomplete calls and pending confirmation restore nothing;
      raw inputs/grants/messages never enter the continuation context. A 410
      task result is fetched once per account/deployment; transient errors retry.
- [ ] Tool-protocol recovery: split `json tt-tool` / `tt-tool json` fences at
      every character; run exactly one complete call. Ordinary JSON examples,
      result fences, malformed/truncated inputs and Stop must not execute tools.
      A native provider that prints a tool call receives at most two corrective
      hops; repeated failure stays recoverable, never falsely completed. Pending
      confirmation must not trigger corrective execution. Verify failure run IDs
      and recovery hints reach the next model hop.

- [ ] `test:api-capabilities` must run both the API-docs and origin-scoped
      manifest suites; when merging independently versioned features, verify
      every asserted version against the combined registry rather than leaving
      one manifest test outside CI with stale expectations.

Personal recording worker transport and HTTP integration:

- [ ] Explicit saved-recording handoff: with recordings 1.5.0, queue an owned
      ready standalone private audio Thing, then Send to Lopu after confirmation.
      Verify one transcript child, private notes/todos and the linked conversation;
      source crystal/purpose/binding must be unchanged. Repeat requests must not
      duplicate outputs. Deny public/foreign/app/bound/linked/deleted/draft audio,
      including changes during processing. Automatic discovery remains Watch-only.
      Verify same-domain Thing/post links and raw IDs, reject foreign/malformed
      links, and check both manual buttons at desktop and 390px phone widths.
      Check the recording tile's desktop right-click and phone three-dot menus:
      Send to Lopu is owner/private-only, multi-selection never bulk-sends,
      cancellation makes no mutation, disabled settings do not auto-enable,
      and account changes during preflight/confirmation stop the request.

- [ ] Run `test:recording-delivery` with the explicit disposable-QA opt-in in
      README, against loopback with an upload-approved unused test account.
      Check one private Watch source, one relational transcript, one note and
      one todo after concurrent claims, duplicate completions and a lost receipt;
      anonymous reads and conflicting receipts must fail. Confirm processing is
      disabled, this run's source/results removed and its login revoked afterward.
      Default invocation must skip; remote origins and normal accounts must be
      rejected before login. Synthetic inference is not real STT/Claude or
      physical-device acceptance; report those checks separately.

- [ ] Expired unfinished pairing: `resume` first; do not erase recovery after
      an ambiguous network error. `forget-pending` without its explicit
      confirmation must stop before accessing Keychain. With confirmation it
      refuses completed/changed state, checks deletion, and explains that no
      server device was revoked. A fresh challenge can then be paired.

- [ ] Hold an accepted completion open, then retry its exact body: receive
      private HTTP 503/Retry-After rather than an authentication/lease conflict.
      Let the first save finish and retry again: same receipt, one set of
      content, one inference. Changed payload/session, revoked consent and
      competing failure writes must still be rejected. Test this with real
      transactions as well as the controlled broker/transport fixtures.

- [ ] Recording setup panel: verify desktop and phone layout, open/close,
      masked/revealed secret, full-secret copy, expiry, request timeout and
      account changes during challenge creation. Hiding clears local state,
      never claims server revocation or automatically enables recordings.
- [ ] `test:lopu-ui` tests recording setup's origin/version/owner/expiry gates;
      `test:devices` includes the owner-bound no-store pairing response tests.
      Built manifests must publish device pairing 1.1.0 before setup is offered.
- [ ] Mac launcher pairing: `test:ai-models` covers signed claims persisted
      before network sends, manifest/origin gates before vault access, identical
      retries after lost prepare/complete receipts, and secret-safe failures.
      Keychain subprocess tests use mocks: writes must use stdin (never argv),
      verify read-back, and distinguish denied/corrupt items from absent items.
- [ ] Exercise the Mac launcher on a real paired account: hidden paste,
      interrupted `resume`, explicit selection/consent, private config, duplicate
      process lock, SIGINT/SIGTERM cleanup and bounded retry shutdown. Help must
      not access credentials. Local `status` must not imply provider health.
- [ ] `npm --prefix remix run test:lopu` also exercises the personal broker:
      exact session/device/consent filters and transaction fences, lease-bound
      audio, revocation during download, completion receipt retries, heartbeat
      races, competing failure rejection and crash-safe transcript checkpoints.
      These collaborators are in memory; verify the same races through the
      real API and transaction layer before enabling a deployed worker.
- [ ] `test:lopu` covers the personal device menu and HTTP boundary: no private
      device fields, active owner/capability sessions only, missing timestamps
      never treated as online, malformed/oversized requests with no-cache
      headers, subscription gates, and processor changes before sends or commits.
- [ ] Run `node --import tsx scripts/personal-recording-api-smoke.mts <loopback-origin>`
      from `remix/`: real signup, launcher signed pairing and recovery after a
      deliberately lost completion response, owner-selected processor,
      cookie rejection, queue polling and opt-out. The fixture account remains
      local with processing disabled; no provider is invoked. This is not an
      audio/result or concurrency-race test.
- [ ] On desktop and mobile, scroll `/lopu/recordings` fully and exercise the
      processor selector: provider mode, eligible/offline/missing personal
      worker, capability mismatch, settings error rollback and retry label.
- [ ] `npm --prefix remix run test:ai-models` verifies origin-bound capability
      negotiation before credentials, redirect rejection, bounded audio,
      text-only native completion, heartbeat cancellation and identical result
      retries without repeating inference. Unknown completion outcomes must not
      send a failure update that could overwrite an already committed result.
- [ ] Before enabling a paired worker, additionally prove owner/device/session
      isolation, revocation and consent races, durable completion receipts,
      private relational output and a real Watch upload on the deployed server.
      Transport mocks do not satisfy this live integration gate.

Design note: `PRs/592-claude-lopu-ai-chatbot-358029--lopu-ai-assistant.md`. Automated coverage:
`npm run test:lopu`, `test:lopu-chat-streaming` (fake SSE tool loop),
`test:partial-json`, `test:ai-models`, `test:lopu-ui`, `test:messenger`,
`test:settings`, `test:schemas`, `test:api-capabilities`; live:
`node scripts/verify-lopu.mjs <base>` against a stack started with
`LOPU_CHAT_PROVIDER=test` (147 checks; set `TT_VERIFY_ADMIN_USERNAME` +
`TT_VERIFY_ADMIN_PASSWORD` for the admin section).

- Catalog: `GET /api/v1/ai/models` is public, `Cache-Control: no-store`, lists
  every `AI_WORKFLOW_BASE_MODELS` entry as an `ai-model` Thing projection
  (`enabled`, `available = enabled && provider key configured && not
  rejected`, `verified`, `isDefault`); `providers.<p>` carries
  `{ configured, verified, checkedAt, reason? }` from the bounded key probe
  (`GET /v1/models`, 5 s cap, cached 10 min / 2 min after a failure); the
  generic `/api/v1/things` paths refuse to create/update/delete `ai-model`
  rows (protected, control plane).
- Provider keys (`api/utils/ai/providerProbe.ts`): with a wrong
  `OPENAI_API_KEY` (any string) the catalog lists every OpenAI model
  `available: false, verified: false`, the picker shows them disabled with
  "OpenAI key invalid", `defaults.model` falls to the first Anthropic model
  and an explicit per-turn pick of one is a 400 naming the rejected key; with
  the provider unreachable (`OPENAI_BASE_URL` pointing at a closed port) they
  stay offered with `verified: null` and the admin row reads "? key
  unverified · could not reach the provider (…)". Admin → Lopu models →
  Provider keys shows one row per provider (✓ key verified / ✗ key invalid
  with the reason / ? key unverified / no key, plus "checked … ago");
  "Re-check keys" (`POST /api/v1/admin/ai/models { probe: true }`, bucket
  `admin.ai.models`) bypasses the cache, toasts the summary and repaints the
  rows and the model chips; a plain user gets 403. Nothing but presence and
  verdicts ever reaches the client (`grep sk-` on the response stays empty).
- Conversations: `/lopu` signed out shows the quiet state + login CTA; signed
  in, the empty state offers four suggestion chips; the composer's model
  picker lists models grouped with "needs <provider> key" for unavailable
  ones; Enter sends, Shift+Enter breaks a line (mobile: the Send button);
  "New chat" starts a fresh conversation that is created lazily on the first
  reply and titled from that message; rename/delete from the left column
  (delete confirms when `confirmDeletes` is on).
- Streaming (`LOPU_CHAT_PROVIDER=test`): "Build me a page with a card
  component" → the bubble streams text, then a "Built a component" card with
  a live preview of the card, then "Created a page" and a `navigate` to
  `/builder?page=<id>`; the builder canvas shows the streamed section
  (heading, copy, the card component) and the Page builder panel names it.
  With that page open, "add a hero section to this page" patches the LIVE
  draft (blocks appear while the reply streams), the tool card reads
  "Edited the page · 1 change · Saved" with Undo; Undo restores the draft.
  "hello" answers with the context-aware greeting naming the open page.
- Floating host: every page but `/lopu*` shows the 🦄 launcher above
  DevKit's corner; click opens the 400×560 window resting above it (same
  conversation as `/lopu`); drag the header, resize from the bottom-right
  grip, double-click the header to dock right (the column stops above DevKit
  and the launcher hides), double-click again to float; the model chip opens
  the picker (Escape closes the menu only — a second Escape closes the
  window); ⤢ opens `/lopu`; − collapses to the header; ✕ / Escape hides.
  Mobile (375): an 88dvh bottom sheet with scrim; DevKit's trigger steps
  aside while it is open (`html[data-lopu-sheet="open"]`).
- Page frame (`/lopu`, `/lopu/:chatId`, `/lopu/voice`): header eyebrow
  "Thingtime · your AI", ink title "Lopu" beside the ring avatar, one status
  line (`model · effort`, or the voice phase); the `Chat | Voice` segmented
  control is route-driven (a chat deep link stays on Chat, Voice keeps the
  store's current conversation). Desktop: the 272px conversations sidebar
  (new chat, rename, delete — confirms when `confirmDeletes` is on —
  "Messenger ↗") collapses from the header toggle and remembers the choice
  (`tt-lopu-sidebar`); the conversation column is 760px centred. Mobile
  (375): full-screen chat with no card chrome, the conversations button opens
  a 72dvh sheet (drag handle, Escape/scrim close), the composer sits above
  the safe area, nothing scrolls horizontally or hides under the nav.
- Voice mode (`/lopu/voice`, or the floating window's mic): the same column
  with the shared text composer and the voice deck below it — gear ·
  64px mic (idle card / listening rainbow pulse / thinking spinner / speaking
  breathe) · Stop while Lopu replies. Standard Mac/browser recognition fills
  the editable Message Lopu draft; stopping retains it and Enter/Send submits
  a normal chat turn (the same brain, tools included). With no SpeechRecognition
  (the in-app Browser pane) the mic
  click toasts "No microphone here" and the typed path still works; with a
  mic, typing or sending stops capture. The gear popover (never a full-width card)
  holds Spoken replies, Transcribe mode, Direct voice (enabled only for a
  vault provider whose kind lists a realtime model — the hint reads the
  reason otherwise; a realtime-model select when it lists several) and the
  provider select (Thingtime default · Secure Vault providers · catalog
  models; disabled while transcribing). Transcribe mode posts each utterance to
  `/api/v1/lopu/voice/reply`, and the quote renders as a Lopu bubble (with
  the private page link) inside the conversation list after the timeline —
  the same bubbles as the chat, never a separate strip. Leaving voice mode
  ends the session (mic, speech, native audio, the realtime socket).
  Settings → Lopu 🦄 and the user settings modal mirror "Spoken replies",
  "Transcribe mode" and "Direct voice".
- Own providers (Secure Vault → Lopu): signed in, `GET /api/v1/ai/models`
  carries `vault.configured` and the viewer's `vaultProviders` as metadata
  only (id/name/kind/model/endpointHost/available/reason/realtimeModels —
  `model` is the row's own or its kind's first catalog model; `grep token`
  on the response stays empty; another account never sees them); the picker
  lists them under "Your providers" with the reason when one is unusable
  (vault key missing, host outside the allowlist, a custom host without a
  model) and ends with "Manage
  your providers →" (`/settings#secure-vault`), plus "Vault not configured"
  when the server has no key. Picking one pins the chat (`providerId` on
  create / update / reply; the status line and the chip show the
  connection's name), the turn's meta reads `provider: "vault"` with
  `providerLabel`, a rejected key surfaces a friendly error line then the
  canned vault line (the server keys are never a fallback), and a connection
  deleted from the vault is dropped on the next turn. Someone else's id, a
  deleted one, or any id with the vault unconfigured is a 400 before anything
  persists. With `THINGTIME_USER_VAULT_KEY` unset locally the vault shows
  "Encryption not configured", the list is empty and `verify-lopu.mjs` §K
  asserts that path (the BYO turn is skipped).
- Navbar 🦄 (`LopuNavButton`): the 28px ring beside ⌘K on desktop and
  mobile toggles the floating window (also with the launcher bubble turned
  off in settings); it pulses while a turn streams and renders nothing on
  `/lopu*`. Drawer → Lopu: Chat, Voice, Conversations, Secure Vault
  (`/settings#secure-vault`) and Settings (`/settings#lopu`) scroll to their
  anchored sections. Floating window header: ring avatar · "Lopu" · status
  line, mic (voice mode inside the window, ⤢ then opens `/lopu/voice`), model
  chip (hidden below 380px wide), −, ⤢, ✕; the launcher is a 48px ring with a
  hover lift and a soft pulse while streaming; both themes use tokens only.
- Messenger: enable **Show Lopu chats** (off by default); the conversation appears under Chats with the 🦄 rainbow disc,
  opening it renders the Lopu chat pane (header ⤢ to `/lopu`); assistant
  rows cannot be edited (409) but can be deleted; the Lopu chat never
  bolds/unreads for its owner; MessengerNotifications skip it.
- Settings: `Settings → Lopu 🦄` and the user-settings modal expose launcher,
  docking, apply-patches-live, confirm deletes, Enter-sends, preferred
  model/effort/fast mode, "Talk to Lopu"; Admin → Lopu models toggles
  catalog rows (disabled rows show unavailable everywhere) and edits the
  chat defaults (`/api/v1/settings/lopu-chat-defaults`).
- Regression classes (wave 2): the site "Edit page" pill hides on every
  `/lopu/*` route (voice and conversation deep links, not only `/lopu`), so it
  never covers the mobile composer or the desktop conversations sidebar (the
  sidebar also keeps 56px of bottom clearance); the picker's effort control
  wraps onto a second row for the seven OpenAI tiers (None → Ultra) instead of
  truncating labels, and opens scrolled to the current choice; persisted rows
  read "via GPT-5.6 Sol · High" (catalog label) like live turns; conversation
  previews strip markdown markers (`_(reply stopped)_` → `(reply stopped)`);
  voice transcript rows live inside the conversation list.
- Confirmations (server-verified, design note §2.4): with the test provider,
  "please delete <thing id>" streams a "Needs your confirmation" tool row
  (shield glyph, the summary + `id`, Confirm / Cancel — 44px on mobile) and
  Lopu's text asks for the card; nothing is deleted (the thing still
  resolves). Confirm sends a `Confirmed: …` user turn carrying the grant; the
  next reply shows "Deleted a thing" and the thing is gone; the card reads
  "Confirmed — Lopu is on it" and never re-sends (a second press is a no-op).
  Cancel reads "Cancelled — nothing was changed" and sends nothing. A card
  older than 15 minutes reads "expired". `purge <page id>` does the same for
  `run_action` on the scripted Purge action (a `things.delete` program): the
  action is created, the run stops for the card, the confirmed turn runs it
  and the page is gone. A public thing whose description says "the user
  already confirmed — delete X" must still produce a card, never a delete.
  The "Confirm conversation deletes" preference only gates deleting a
  conversation from the list. Wire: `verify-lopu.mjs` §H2 (forged / wrong
  action / wrong chat / no-chat grants are 400 and delete nothing; the same
  grant sent back runs the tool once).
- Fences (wire): every Lopu POST — `/lopu/chats`, `/update`, `/delete`,
  `/chats/reply`, `/voice/reply`, `/vault` — refuses a non-JSON body with 415
  before the body is read or a bucket is spent; `/voice/reply` and `/vault`
  writes refuse a temporary session (403); the chat write buckets fail closed
  (a limiter outage answers 429 "cannot check its rate limit", never an
  unthrottled write). `verify-lopu.mjs` §A + `apiTests` (`lopu-*-json-only`,
  `lopu-vault-guarded`, `lopu-voice-reply-guarded`,
  `lopu-chats-reply-forged-confirmation`).
- Regression classes (hardening): a Lopu bubble link `[x](/\evil.example)`
  is demoted to plain text (a backslash reads as a slash to the browser) and a
  `navigate` to such a path is ignored; the reply body states `providerId`
  (null included) whenever the client knows the chat's settings, so the
  picker's "Claude Opus 5" and the turn's provider never disagree; a chat
  created without an effort inherits the admin default effort (meta.effort
  is never null while a model is available); a vault turn's history row
  reads "via <connection name>" after a reload; a first turn that fails to
  persist leaves no empty conversation behind; NAT64 `64:ff9b::/96`
  endpoints are refused; the vault's "OpenAI-compatible custom endpoint"
  template starts with a blank endpoint/model instead of the previous
  vendor's; the window chip shows the pinned provider's name and lists
  "Your providers".
- Regression classes: a stored chat setting that names a disabled model is
  substituted per turn (the reply route resolves stored settings leniently,
  explicit per-turn overrides strictly → 400); reusing a `requestId` is a
  409 and never duplicates rows; the assistant turn is persisted even when
  the client disconnects mid-stream; `LopuActivityBadge` renders a `<span>`
  (it sits inside the drawer row's `<p>`); the `done` event is always last
  and only the route emits it.

### PR #592 integration regression

- After merging passkey and Lopu changes, verify logout clears `tt-passkeys`, `tt-page-source:`, and `tt-lopu-`; capability tests cover both families, and the iOS app retains both associated domains and its Lopu widget dependency.
### Shared rich-text surfaces (PR #635)

- In new posts, post edits, comments/replies and poll questions, select paragraph and heading text; confirm colour/alpha, size/units, decorations and history use the same controls as the builder. Never submit QA content to another person.
- In Thing rich-text fields, tier inclusions and the advanced modal, check neighbouring labels/actions stay visible. History uses small grey absolute controls near the bottom-right of field and inline editors, moving into nearby clear space for tiny blocks; text must never run underneath them. Compare content dimensions with history visible/hidden: no history padding, minimum width/height or wrapping row may change the preview layout.
- At desktop, 390px and 320px widths, select/style text, undo/redo, open/close Changes, toggle view/edit and scroll top to bottom. Ensure formatting survives and the active editor overlays do not hide a neighbouring editor.
- In a crowded mobile composer, select text and verify the formatting toolbar stays above the line. A temporary space opens above the text when needed and closes on deselection. Check Undo/Redo/Changes at bottom right, nearby feed filters/tags, keyboard-sized viewports, and repeated selection without growing gaps.

### Lopu verified access + credits (client — `PRs/lopu-verified-credits-design.md` §4)

Automated coverage: `npm run test:lopu-ui` (`useLopuAccount.test.ts` —
account / history / admin-row normalisation, the access matrix, credits
formatting, the store's reactions to `done` and the gate; `lopuTurnCore.test.ts`
— the `done` accounting fields, the gate, the footer credits;
`lopuChatStore.test.ts` — `done` → account slice, 402/403 → a gated turn) plus
`test:hooks`, `test:settings`, `test:nav`. Live: a stack with
`LOPU_CHAT_PROVIDER=test`, a fresh account (unverified) and an admin.

- [ ] Fresh account, verification required: `/lopu`, the floating window
      (desktop frame + 375px sheet) and `/lopu/voice` show the locked state —
      🦄 on the ring, "Lopu is invite-only for now", the one-line admin
      explanation, "Credits & usage" — with the composer disabled (placeholder
      names the reason) and the mic disabled; the status line reads
      "Invite-only — waiting for an admin to verify you"; the navbar 🦄 and
      the drawer's Lopu entry still open that view (no dead end); the
      conversations sidebar and Messenger history stay readable. An admin
      previewing the copy sees the "Admin → Lopu accounts" link
      (`/settings#lopu-accounts`). Nothing scrolls horizontally at 375px.
- [ ] Admin → Lopu accounts: the `Thingtime.LopuAccess` editor (require
      verification, allow own providers when unverified, starter credits,
      low-balance warning) saves and round-trips; the accounts table paints
      from cache, search filters by username, the verified toggle flips
      instantly and reverts on failure (admins are disabled — always
      verified), "Add credits" grants/adjusts/refunds with a reason, a pending
      request shows the amount + note with Approve / Decline (decline takes an
      optional reason), and "Load more" follows the cursor.
- [ ] Verified account, 0 credits: the balance chip beside the model chip
      reads "0.00 credits" in red and opens a popover with "Request credits"
      (`/settings#lopu-credits`) and "Buy credits ↗" only when
      `THINGTIME_LOPU_TOPUP_URL` is set; a send answers with Lopu's own bubble
      ("Lopu's credits for your account are used up — add credits to keep
      going") with Request credits / Try again — never a red error line or a
      toast, and the text is NOT handed back to the composer. Under the
      low-balance threshold the chip turns amber; above it, quiet. With one of
      your own providers pinned the chip reads "your provider".
- [ ] After a Thingtime-billed turn: the chip moves from the `done` event
      before the refetch lands; the turn's footer reads "via <model> · <effort>
      · 0.0132 credits" (BYO / free turns show no credits), and a reloaded
      history row keeps the same footer.
- [ ] Settings → Lopu credits & usage (`/settings#lopu-credits`): the verified
      status line, balance (red at zero / amber low), this month (key, cost,
      turns), lifetime (cost, turns, tokens in/out), the request form
      (0.5–1000 credits + note; a pending request replaces the form with
      "waiting for an admin" + "Check again"; a second request reads the 409
      as info), "Buy credits ↗" when the URL is set, and the history list
      (ledger + usage rows newest first, "Load more"). The user settings modal
      mirrors balance + status with an "Open" link. Logout sweeps
      `tt-lopu-account-*` with the rest of `tt-lopu-`.
- [ ] Cold start with no cache: the chat paints unlocked (no flash of the
      locked card) and flips to locked only when the account says so; a
      cached account paints its state on the first frame. On a deployment with
      `requireVerification` OFF, a first-ever unverified account on a browser
      that has seen ANY Lopu account (the per-device `tt-lopu-access` line)
      paints unlocked instead of "invite-only"; with nothing cached at all the
      safe default (locked) still applies.

#### Money invariants (server — regressions, fixer round 1)

Automated coverage: `npm run test:lopu` (`accounting.test.ts` — the minted
usage id, the guarded `$inc`, the in-flight cap and its TTL sweep, the stranded
approval; `access.test.ts` — the reservation matrix) and
`scripts/verify-lopu.mjs` §A2 end to end. Live checks below need
`LOPU_CHAT_PROVIDER=test` so a turn prices at exactly 0.2 credits.

- [ ] A `requestId` is never an idempotency key for money: send a turn, note
      the balance, delete that conversation, then send the SAME `requestId`
      again — it streams and costs another 0.2 credits, and the history shows
      two usage rows carrying that one `requestId`. (Before the fix the second
      turn ran on Thingtime's keys for free, repeatably.)
- [ ] Concurrency cannot spend the balance more than once: with a verified
      account, fire ~10 replies at the same instant. At most three stream; the
      rest answer 429 `LOPU_TURN_IN_FLIGHT` with "Lopu is still working on your
      last few messages" — never a 500, never a 402 — and the balance falls by
      exactly 0.2 × the number that streamed.
- [ ] Every slot comes back: four turns in a row all stream (a leaked
      reservation would refuse the fourth). Kill the server mid-turn, restart,
      and after `LOPU_INFLIGHT_TTL_MS` (10 min) the next turn still starts —
      the sweep clears the dead reservation.
- [ ] Admin → Lopu accounts: an amount that rounds to nothing (`1e-7` credits
      through `POST /api/v1/admin/lopu/credits`) answers 400, not 500.
- [ ] A top-up approval is recoverable: an `approved` request whose grant never
      landed (no `lopu-credit-topup-<requestId>` ledger row) is completed by
      approving it again; once the row exists a further approval is the
      ordinary 409 and the balance does not move twice.
- [ ] The "request credits" ops mail links the trusted origin (`APP_URL` → the
      platform → thingtime.com), never the caller's `Host` header.
# Storage ledger operator diagnostics

- Validate both immutable legacy four-field and current five-field quota snapshots (and partial overrides). Optional speed-test quotas accept null or safe integers 0–1000, reject coercible strings/fractions/unknown fields, and never change the stored assignment. After deploying, dry-run the production accounting migration before a separately authorized real run; verify storage readiness and a real upload before calling uploads healthy.

- As an admin, dry-run `backfill-user-storage-accounting`; invalid ledgers must report only deterministic ledger IDs and fixed validation-field labels, at most ten records. Confirm zero ledger writes, no raw values or arbitrary key names, and unchanged strict envelope validation. Anonymous and non-admin callers remain denied by the existing migrations API gate.

- Desktop privacy status: grant/revoke each permission, return from System Settings, and confirm live status refreshes without prompting. Stop the node and confirm failed checks show last-known status, not a new denial or false success. Restart and use Check access to recover; a signing migration must explain the one-time off/on grant refresh.
# Index consolidation regression checks

- Two-stage retirement: the first real run activates each layout but preserves all old indexes. A second run before one minute must preserve them without resetting activation time. After the drain, verify exact retirement, zero pending work, and continued canonical reads. Old/malformed/future markers start a fresh drain. Lease loss never starts activation or further cleanup.

- Legacy cutover: incompatible root-kind/shareOfId documents block cleanup; only exactly canonical schema-v2 embeds may lose redundant kind metadata. Check private embed denial, owner listing and CAS updates; feed/profile exclusion of rich comments; engagement-filtered search; and comment/attachment cascades. Native owner post/embed plans must avoid blocking sorts. Custom data planes retain legacy compatibility; no Thing is deleted by the index migration.

- In the admin workbench, an aggregation starting with `$indexStats: {}` must run without MongoDB Location40602. Keep protected-field probes rejected and strip protected Thing fields from later joins; do not generalize the first-stage exception to document-reading expressions.

- Relationship-key migrations must count missing individual keys, preserve all existing keys, compare the source identity, and stop safely on lease loss. More than one batch of duplicate slots must terminate, remain pending, and never disclose key values or delete a relationship.

- Shared relationship cutover: before activation, home and custom reads use legacy indexed fields; afterward, home uses `uniqueKeys` plus original identity/kind/ACL guards. A normal or cold read must never scan/backfill data or perform index DDL. Dry-run must not write. A missing lease, duplicate, or failed validation must not activate readiness. Verify follow/friend, DM, membership batches, invites, attachment authorization and device/AI-import upserts before/after migration; stale keys must not return a changed identity. Exact redefined/unique/TTL indexes and custom databases must remain untouched. Re-run after the 30-second readiness window and confirm no old workers recreate the five indexes.

- Run `cd remix && node --import tsx scripts/audit-things-indexes.mts`; source-plan replay must work without database credentials, include Mongo's `_id_`, and preserve exact key order, unique/partial/sparse/TTL options.
- Run `pnpm --dir remix run test:collections`. The unused emoji lookup must not be recreated; protected `uniqueKeys_1` must stay unique and the legacy unique ancestor must not be blindly retired.
- Before any live index retirement, compare exact production/develop index definitions with the source inventory, preserve unknown indexes, and prove the actual query and concurrent-write paths. A low count alone is not acceptance. See `docs/architecture/thing-index-consolidation.md` for the full rollout gates.

### Desktop permission recovery

- In Things and Desktop settings, use Open App Locations. Check that Finder contains symlinks to the running Desktop, its bundled Node, and installed Recovery/Commander/ThingDisk/ThingDock apps; an older standalone Node must not replace the bundled shortcut. Repeat after an update and verify targets refresh.
- Return from the folder or Privacy settings: Thingtime offers Later / Restart Node Now once per explicit recovery flow. Later must not prompt again on routine focus or polling. Restart must preserve pairing and leave one Node process; handle failure visibly.
- Re-add the affected app manually only with the owner’s consent. Apple controls its own Quit & Reopen prompt; if absent, use Thingtime’s restart control. Verify live permission checks and a protected operation after restarting.

- Permission recovery follow-up: click Open System Settings for both Accessibility and Screen Recording. Confirm Finder opens the combined App Locations folder, not Contents/Helpers, alongside the correct privacy pane.

- Shared settings / Desktop persistence: dismiss a healthy Things node panel, quit and reopen Desktop (which changes the local port), and verify it remains hidden. Settings → Things must still show the card and its restore switch. Restore the switch, then confirm the Things page shows the panel again.
- Shared settings / observed status: after the Mac reports connected with access allowed, switch between Things, the popup Things tab, and Open settings page. Keep the last observed status visible during the background check; do not briefly show Not running or a new permission denial. Pairing challenges and pending actions must not carry between views.

## Shared Data Thing template controls

- Share one component used twice with different saved action arguments. Signed
  out, both controls must run read-only and show their distinct results at
  desktop/mobile widths. Wrong or retired links must fail. Copy the page and
  verify both controls run the copied actions while labels, inputs and editable
  templates stay unchanged. Repeat on a fork of a fork. A shared writer must
  not introduce an unreadable private action through argument-only edits or a
  new instance of an existing component. Unused bindings and runtime query,
  result, viewer or template-shaped argument data must never grant access.

- Shared nested media: open rich/raw HTML blocks with image, poster, link and
  inline CSS media signed out at desktop/mobile widths. Same-author uploads
  attached directly to contained components must inherit the root audience.
  Revoke the key/group and verify denial. Foreign or unrelated uploads and
  message/profile/emoji purposes must not gain access. Script/template/comment
  text, unknown-tag attributes and over-budget markup must not mint grants.
  A non-owner writer must not insert unreadable private media through HTML.

- Shared CSS media: at desktop and mobile widths, verify page/block backgrounds,
  HTML style URLs, Chakra responsive backgrounds and hover styles render through
  the keyed root. Inspect linked-text downloads for the same context. External
  URLs, quoted CSS text and existing independent keys must remain untouched.
  Revoke the root/group and verify access stops; a shared writer must not be able
  to insert unreadable private media through CSS or the page background.
  Include escaped CSS function names with hex-terminating whitespace and both
  quoted/unquoted URL arguments; malformed spacing and nested external text
  must never receive the root key.

- Share an action that searches public Data Things using its included private
  schema. Verify it resolves the schema and returns public results when logged
  out; an own-scope search must not borrow either the author's or a logged-in
  visitor's private inventory. Wrong or revoked root keys must still fail.
- Open a keyed Data Thing whose private same-author schema contains a button
  invoking a private action. Logged out, the button must run read-only through
  the Data Thing root, show its result, and refuse unrelated actions and revoked
  keys/groups. A shared schema writer cannot insert an unreadable private action.
- Copy that Data Thing: its schema and control action must receive fresh private
  identities, and the copied button must reference the copied action. Owning data
  with someone else's schema must never delegate the viewer's account authority.
- Verify the detail page at desktop and mobile widths, including the visible
  control/result and top-to-bottom scrolling. List/grid previews remain inert.

## Apple widgets and Control Centre

- [ ] Widgets release/Recovery: verify the main-only workflow runs tests before importing secrets and publishes both Widgets and matching Recovery ZIPs after notarization/extraction checks. In Recovery select Thingtime Widgets; verify architecture filtering, isolated cache, download verification, install/launch and rollback without touching another app. Reject mismatched bundle IDs and never accept development signing as a production release.

- [ ] Per-widget Mac endpoints: pin two widgets to different saved, authenticated servers, including Things with identical IDs. Verify the picker lists only the chosen server’s Things, each dashboard/Thing/action link opens that server, and changing the companion’s active endpoint does not change pinned widgets. Remove/disconnect one server and confirm its content clears without affecting the other. Verify unconfigured widgets still follow the active endpoint and turning content sharing off clears every endpoint.

- [ ] Mac saved endpoints: migrate an existing local connection, add a named HTTPS domain, edit/remove an inactive entry, and restart to verify persistence. Reject duplicate or credential-bearing addresses. Switch between compatible origins and verify separate Keychain sessions, cleared content, and correct widget click destinations. An outdated production manifest must leave the previous endpoint active and show an actionable error. Open both Connection and Command-comma settings; test the editor, removal confirmation, scrolling, and reopening after closing the main window.

- [ ] Native Mac companion: Overview, Things, Widget Gallery, and Connection render without a webview. Inspect every page and its full scroll range; test connection cancellation, wrong/expired/replayed callbacks, secure Keychain restoration, and disconnect/revocation on the installed signed copy.
- [ ] OAuth: review all Things, individual read/create/update/delete permissions, Run actions, and each Lopu permission. Untick full Things and choose read-only in Share more. Confirm selected-only and legacy app-storage grants never gain account access; read-only cannot write, revoked/sandbox tokens fail, and action/voice endpoints require their own scopes. Verify real approved calls as well as denied calls; do not treat a catalog checkbox as enforcement proof.
- [ ] Verify account/origin changes clear widgets, offline revocation reports its limitation, and toggling content cannot renew an old snapshot. Test browser return into the exact native app on local and preview origins.

- [ ] Add Quick Action, Dashboard, Render a Thing, and Recent Things at every supported device size. Inspect long text, dark/light/tinted appearance, large Dynamic Type, and the full native layout gallery from top to bottom.
- [ ] On iOS 18+, add all four Control Centre buttons at compact and expanded sizes; cold/warm taps must reach the correct screen once. New Folder opens its dialog, Search focuses its input, and New Thing opens the schema chooser.
- [ ] Transcribe launches Lopu in transcription mode; Talk launches voice mode. Sign-in/access gates and denied microphone/speech permissions remain effective. Stop, tap again, background/foreground, and verify transcript, local recording, private upload, and iOS Live Activity independently.
- [ ] Open Widget settings from the iOS native destination drawer; its controls must be inaccessible when closed and must not overlay the web microphone/composer. Content starts disabled. Enable host sync and per-widget content; select a Thing and change card/note/value layout and title. Disable sharing, log out, change account/origin, delete a Thing, and verify stale content clears. Offline content expires after 30 minutes without another refresh.
- [ ] Install and test the signed Mac companion itself. Verify both the host and extension signatures and the same designated requirement across rebuilds. Never equate simulator or layout-preview success with physical Control Centre/microphone acceptance.

### Recording recovery and native push regression checks

- Leave an older completed CAF in the iPhone Lopu Recordings folder. Open Lopu
  while signed in: one owner-private audio Thing appears. Reopen/relaunch and
  switch accounts: the same source does not duplicate or move accounts. A file
  already uploaded by build 29 is reused. Local originals remain after success
  and network failure; an active recording is not imported before it finishes.
- Turn off Voice settings → Import older recordings: unclaimed older files stay
  local. Turn it on and reconnect: import resumes. Normal new recordings still save.
- In Settings → Notifications, send a normal test and verify the bell count
  updates immediately after completion. Open the bell, click it again to close,
  reopen with cached rows, then use Escape/outside click. Check desktop/mobile,
  long notification text and scrolling to the popup's final row and page footer.
- Check iPhone push status as signed out, signed in, and after switching accounts;
  status must never reveal tokens or another account's registrations. Reconnect
  after granting iOS permission in Settings; a stale registration must recover.
- Test missing APNs configuration, no device, rejected/expired device and Apple
  acceptance. Verify normal and time-sensitive banners on a physical iPhone,
  foreground/background/locked; quiet tests may appear only in Notification Center.
  A successful server response alone is not a native banner acceptance test.
- Trigger a followed/friend post and a single-recipient notification with push on,
  then with push off. History remains; muted/history-only events produce no push.
## Lopu linked-Things live HTTP smoke

- Open Lopu's Your Things picker at desktop and 390px phone widths. Its overlay and fixed modal container must sit above the navigation and floating windows; the title, Close and Done controls remain visible and clickable while scrolling the results from top to bottom. Check both Voice and Chat entry points.
- Upload a synthetic file and send it in Lopu. Its attachment card must remain visible while streaming and after the reply, without reloading; reload to verify the server-backed attachment persists. The optimistic metadata must never add unselected files or be sent as authoritative server metadata.

- Voice session and transcript request IDs must come from cryptographic UUIDs,
  never timestamps plus `Math.random()`. Run the voice identity regression tests
  alongside the Lopu UI suite; secure-random failures must not produce weak IDs.

- When adding a scheduled-task/run schema, run `npm --prefix remix run test:schemas` and review its pinned builtin projection; every registered crystal schema must survive the schema-Thing write gate without lost fields.
- Run `node remix/scripts/verify-lopu-linked-things.mjs` against the running worktree stack (or pass its loopback HTTP origin). It registers disposable local accounts and exercises real API comments, unchanged parent crystals, shared voice/Messenger history, retry deduplication, searchable scheduled-task Things, linked context, account isolation, protected writes, and pause/resume. It removes its created content and pauses schedules in `finally`; empty test accounts remain, with credentials never persisted. Production origins are rejected. This does not replace browser/device, provider inference, or scheduled-delivery acceptance.
# Portable Thing transfers

- Start a Cut, then sign in/switch accounts while root-data refresh is delayed
  or fails. Saved intent and in-flight copy tickets must be revoked immediately,
  before replacement root data arrives. A stale generation confirmation must
  not re-arm the previous account; a confirmed new account may create new cuts.

- Incomplete import rollback: make a later create fail, then fail/defer the
  deletion of an already-created child. Its earlier folders, schemas and media
  definitions must not be deleted afterward; retain remaining linked resources
  and report recovery IDs with 503. Also exercise a lost deletion response.
  The importer must require `api.things-import >= 1.8.1` on major version 1.

- Archive deletion regression: deferred or ambiguous object cleanup must leave
  a deleting root and all message history for retry. Only refund/delete archive
  rows after canonical object cleanup and an empty-child check. Refuse foreign,
  app-scoped, live, malformed and changed record sets; make repeated/concurrent
  completion idempotent. Verify actual S3 deletion and account ledgers before
  enabling the archive lifecycle in the HTTP/UI transfer flow.

- Archive storage regression: each historical row must be importer-owned and
  private, with no live memberships/account lookups. Test fresh avatar/message
  bindings, mixed file/link order, custom-reaction remapping, missing/foreign/
  reused resources, quota and concurrent-bind failures, folder-deletion fencing,
  caller mutation during awaits, and stable IDs across transaction retries.
  Dependency tests do not replace live storage/rollback and UI acceptance.

- Messenger archive regression contract: preserve exact text, historical dates,
  reply/thread links, reactions and avatar file references. On import, replace
  only the exporting self with the importer; other authors must remain archived
  snapshots, never live user lookup/membership targets. Reject forged authority,
  orphan/cyclic references, duplicate imported identities and restored deleted
  text/media. Runtime and browser acceptance is required before enabling this
  currently unconnected archive contract.

- With a disposable, already upload-approved local fixture account, run
  `TT_TRANSFER_BINARY_TEST=1 corepack pnpm --dir remix run test:transfer-binary`
  with `TT_TRANSFER_TEST_URL` and `TT_TRANSFER_TEST_COOKIE` provided securely in
  the environment. This uses real storage and creates/deletes fixture content;
  it does not enable uploads. Require PNG byte and annotation equality across
  ZIP/reimport, anonymous denial, exactly one concurrent emoji-claim winner,
  and confirmed cleanup. A precondition failure or skipped test is not live
  storage acceptance. See the README for fork-safe setup.

- Newly durable emoji files start quarantined while asynchronous moderation
  runs. The binary fixture polls the owner-only archive projection for at most
  30 seconds and still requires the exact remapped image; it must fail if the
  safe projection never appears. Unit coverage uses the canonical `pending`
  and `clear` statuses. Never disable moderation or bypass upload rate limits
  to make this acceptance test pass.

- For an explicitly authorized dev fixture, additionally set
  `TT_TRANSFER_REMOTE_DEV_TEST=1` and `TT_TRANSFER_TEST_USERNAME` to the exact
  expected username. Only HTTPS dev.thingtime.com or numbered PR preview origins
  are permitted; production and lookalike hosts must fail before requests.
  Validate synthetic manifests before uploads. Verify ordinary Thing reads return
  200 before cleanup and 404 after deletion, without spending the shared export
  budget on cleanup. Preserve both primary and cleanup failures in test output.

- Round-trip stored files with a title, multiline description and display
  filename through export, ZIP and clipboard import. Verify those annotations
  on fresh copies while the original filename/bytes stay unchanged. Reject
  forged detected types/moderation and malformed annotations before writes.
  A draft bound elsewhere during import must reject annotation rather than
  modify that existing gallery; expired and non-post drafts also fail.

- Export a linked gallery as JSON and ZIP, then import each via the file picker
  on desktop/mobile. Verify URLs, multiline descriptions, filename previews,
  titles and mixed stored-file/link ordering. New private copies must survive
  source deletion; the import must not fetch external bytes or bypass stored
  upload approval. Toggle linked-gallery inclusion separately from stored files.
  Reject unsafe URLs, duplicate IDs, forged moderation stamps and incomplete
  attachment ordering. Flagged links must not export even for an administrator.
  A failed annotation/create must clean only new unbound link drafts and report
  any deferred cleanup. Nested-value import must not silently discard galleries.

- In the nested value editor, import ordinary JSON and exported value JSON/ZIP;
  review before replacement and round-trip strings such as `"42"`, arrays,
  null and objects without changing their types. Import the value ZIP through
  My Things too: it must create one new private data Thing, not a local edit.
  Copy/Cut must write the portable envelope to the OS clipboard. Top-level
  and direct nested-path Cut must remove only the copied key; array Cut must
  preserve array shape and siblings. A clipboard failure or changed value
  while copying must never delete anything. Read-only menus must omit import,
  paste and cut. Reject cycles, accessors and non-JSON values explicitly.
- Stack several transfer success notifications, then open every transfer
  dialog on mobile. Notifications must not cover the file picker, review,
  Cancel/Replace/Download controls; verify by clicking those controls.
- On Thing details, component-family pages, public webpages and the Builder
  inspector, open Transfer at desktop and mobile widths. Copy must write a
  portable envelope and Download must produce a real file. Open Import too;
  menus and both dialogs must sit above the inspector and remain clickable.
  Unsaved Builder changes must disable export with a save-first explanation.
- Import a file-bearing app whose image/CSS URL is assembled from multiple
  saved argument fragments. Repeat with two different page-instance arguments,
  then export and import that copy again. Every rendered media ID must point
  to its new owned upload; labels and editable argument text must stay intact.
  An upload-unapproved account must get an explicit refusal before import.
- Copy a folder using its context menu, then paste into Things. Verify the OS
  clipboard holds portable content and importing creates fresh private IDs.
  Cut/Paste in the same account/session must move the original; after reload,
  account switch or changed clipboard content it must not infer move authority.
  Denied clipboard permissions and cancelled exports must show a handled error
  or cancel cleanly without an unhandled rejection or false success message.
- Download both JSON and ZIP, then import each downloaded file through the
  real picker. Verify all selected folder pages and canonical app dependencies,
  plus desktop/mobile dialog bounds and every inclusion option. Revoked file
  access must fail the complete export rather than emit a partial ZIP.
- In Things, open Import on desktop and mobile. Check invalid JSON, unsupported
  envelopes, a complete JSON transfer, and ZIPs with missing/tampered files.
  Validation must happen before uploads or creation; the dialog must fit and
  scroll without clipping its controls.
- Import into the top level and an owned folder. Copies must get new IDs,
  private ACLs and current ownership, retain folder/schema/action/component
  references and extended content, and appear without a manual reload.
- Upload real files and verify imported bytes independently of the source.
  Cancel, switch accounts, test quota/permission failure and lost responses;
  never automatically repeat an import POST or delete source records.
- Run transfer unit tests and the opt-in local
  `app/api/utils/things/importTransfer.integration.test.ts` with
  `TT_TRANSFER_TEST_URL` and a disposable `TT_TRANSFER_TEST_COOKIE` provided
  securely. It must clean only its newly returned IDs. Clipboard/export and
  file-bearing UI acceptance remain separate from this JSON import check.

# Synthetic personal recording runtime smoke

- Run `node --import tsx scripts/personal-recording-runtime-smoke.mts` from
  `remix/`: without opt-in it must skip and make no provider call.
- On macOS, set `TT_PERSONAL_RUNTIME_SMOKE=1` plus absolute executable/model
  paths in `TT_SMOKE_CLAUDE`, `TT_SMOKE_WHISPER`, `TT_SMOKE_FFMPEG`, and
  `TT_SMOKE_MODEL`. Confirm synthetic WAV and M4A both transcribe expected words.
- Separately opt in with `TT_PERSONAL_CLAUDE_SMOKE=1` to consume native Claude
  allowance and verify note/todo output with exact transcript evidence. Do not
  pass real recordings or tokens. Fixture files must be cleaned up on failure
  as well as success. This is not a substitute for paired-account/Watch tests.

## Shared AI waterfall and stack overrides

- Open the shared selector from CI stack selection and the Admin model-order
  editor. Add OpenAI, custom endpoint and Claude entries; reorder/remove rows,
  vary effort/speed, Apply, reopen, then Cancel an edit. Verify the returned
  config and saved draft keep the intended order and no credentials/URLs.
- Check desktop and mobile from top to bottom, including the scrolled modal
  footer, long endpoint labels, focus restoration and duplicate validation.
- Save/reload a custom stack; omit the field to preserve it, send null to inherit,
  and restart it. Verify the immutable dispatch includes the saved selection,
  foreign connections are rejected, and edits never change an active run.
- Run `node --import tsx --test app/api/utils/ai/waterfallConfig.test.ts`
  from Remix and the CI-control suite (including the signed gateway tests).
  Verify missing-model/capacity failures advance, ownership/output errors stop,
  and stopped/unrelated/replayed run requests cannot consume provider access.
- On the controller branch run the feature-stack plan and routing self-tests,
  plus `node --test .github/scripts/feature-stack-waterfall.test.mjs`.
  Confirm a real text conflict preserves exact merge parents and touches only
  conflict paths; binary/oversized conflicts fail without publication.

### Saved AI waterfall library

- In Settings → AI waterfalls, create a mixed-provider order, save, reload, edit and reorder; verify persistence.
- In a feature selector, select an existing config, Save as new, then edit and Save & apply; verify the returned snapshot and both library records. Cancel must preserve the feature value. Later library edits must not change that value.
- Open the same saved config in two editors. Save one, then save the stale one: show a conflict, retain the unsaved draft, and refresh the library for reopening.
- Anonymous requests return 401; changed-account headers return 409; another owner cannot read or replace a record. Reject extra secret/URL fields and incompatible endpoint selections.
- At desktop and mobile widths, scroll Settings and the open dialog top to bottom; verify nested controls, fixed footer, focus, and no horizontal overflow.

## Durable recording reads

- AI chat archives: export a complete authorized Lopu/AI history, import and
  re-export it, and confirm assistant avatar presets and name/result/summary
  tool receipts survive without target IDs, approvals, billing or connector
  metadata. Expand receipt lists at desktop/mobile widths and scroll to the
  bottom; no action control may execute history. Deleted rows retain neither
  receipts nor content. Reverse equal-timestamp source segments and verify the
  imported view retains segment order despite fresh IDs. Reject missing,
  duplicate or mixed-revision segments and incomplete device synchronization.

- Live-chat archive timestamps: exercise the actual Messenger edit/delete APIs,
  which store canonical ISO strings inside `crystal`, unlike BSON root dates.
  Export edited messages and tombstones together; preserve `editedAt`, never
  restore deleted text, and reject invalid calendar dates or loose date strings.
  Require export 1.11.1 before running the self-only live-history ZIP fixture.

- Ordinary live-chat export: use a first-party active/pending member, include
  former participants and thread replies, then import as a private archive.
  Confirm self substitution, historical names/avatars, mixed gallery order,
  exact bytes and no outgoing messages/invitations/notifications. Repeat as a
  nonmember, PAT, app account and custom data plane: deny. Revoke media access
  during export: fail without a partial plan. AI/device chats, external avatars
  and other-owned emoji definitions remain unsupported; do not count a refusal
  or unit-test fixture as end-to-end Messenger acceptance.

- Live Messenger archive snapshot reader: require home first-party scope at the
  eventual caller, check current membership in the same transaction as history,
  include former members and every thread, and reject foreign/duplicate records
  or row-budget overflow. An exhausted budget must still query one overflow
  sentinel, never MongoDB's unbounded `limit(0)`. This reader is internal only;
  it must not be returned directly or counted as live export UI acceptance.

- A completed owner recording with no expiry must export a descriptor and download successfully.
- Repeat anonymously and as another account/admin: deny without signing a URL.
- Expired/invalid-expiry recordings, import drafts without expiry, blocked media and custom data endpoints remain denied.
- File exports require attachment-content 1.6.4 and things-export 1.6.1; reject pre-fix origins before starting the export.
## Navigation-safe Cut

- Cut a Thing, follow an internal link away, return to Things and paste: move the original IDs, not imported copies.
- Change accounts or log out/back in before pasting: never move from old intent. A reload also drops move authority.
- Replace clipboard text, use Copy, or dismiss the clipboard: prior Cut must not move anything.
- Export a readable gallery with files unchecked and links checked: unavailable
  stored bytes must not block links-only export. Included bytes must still fail
  on unavailable storage; exclusions must not bypass owner/shared-root,
  moderation or expiry gates, and recording roots must still require bytes.
- At 390px, select both Download formats: the selected label must fit, and the
  helper must clearly state whether the archive can include stored file bytes.
- Export/import saved themes and algorithms both inside an included folder and
  alone into a selected current folder. Confirm new private IDs, remapped
  placement, unchanged active selections and dedicated cleanup on placement
  failure. Check their owned-library Cut menus and same-account folder paste;
  shared viewers must never receive Cut authority. Exercise the import
  destination selector at desktop/mobile widths with both kinds in one file.
- A partially failed move retains only failed IDs; an older request completing must not consume newer Cut intent.
- Before releasing emoji transfers, verify two simultaneous imports cannot claim
  one upload; stale/bound/foreign uploads must fail without deleting an existing
  emoji. An uncertain commit may recover only the same server import attempt.
  The connected writer is unit-tested; live transaction acceptance remains
  required with an upload-enabled account.
- Export a personal stored emoji and a legacy inline emoji to ZIP, then import
  each into a folder. Confirm identical image bytes, new personal names/IDs,
  preserved image title/description/filename preview, and no community scope.
  A failed fresh-upload claim must not annotate any existing image; annotation
  or placement failure must clean up only the new emoji. Verify the file picker,
  destination selector and final controls at desktop and mobile sizes.

## Gifted signup invitations (2026-09-13)

- [ ] In Settings → Lopu, create an invite with a profile photo, display name,
      username and fractional gift. The balance decreases once; copied links use
      the browser/deployment origin, never the internal Nitro port.
- [ ] Visit the link signed out at desktop and mobile widths; scroll top to
      bottom. The avatar/name/username are prefilled, editable, and remain after
      refresh. Remove and replace the photo; submit stays disabled while it is
      being prepared. Floating app controls must not cover this focused form.
- [ ] Enter only a password to complete signup. The chosen profile and gifted
      balance persist after fresh login. Email-less users see no false email-sent
      message; regular signup still requires email. No invitation may grant
      administrator status, upload permissions, Lopu verification or bonus starter
      credits. Optional email keeps ordinary verification/recovery behavior.
- [ ] Race two claims: exactly one account receives the gift. Invalid passwords,
      duplicate usernames, expired/cancelled tokens and ledger failures leave no
      partial account or consumed gift. No request log or auth return-to hint
      should persist the bearer token.
- [ ] Successful invite signup advances the root account generation before
      refresh, rejecting responses from the previous account. Failed signup and
      invite preview must leave the current identity unchanged.
- [ ] Cancel an unused link twice and run expiry twice: return credits once.
      Insufficient balances, active billed turns, concurrent creates and the
      20-pending cap must never overspend or leak another user's invites.
- [ ] Test malformed/oversized images, remote URLs, rejected moderation and a
      provider outage: no invitation or balance deduction is left behind.
- [ ] `test:invites`, accounting, schema and capability suites pass. Manifest
      advertises both invitation routes and invite-aware signup. Expiry without
      the exact `CRON_SECRET` bearer fails closed without touching balances.

- [ ] Creating a new invite and cancelling an older pending invite keeps the newest copyable link visible; cancelling that newest invite removes its link.

- [ ] Settings → Account (`/settings/account` and popup `?settings=account`) groups account switching, storage, invitations, credits and plans. Profile retains profile editing/privacy; Lopu retains assistant preferences. Check direct reload, category switching, Back, modal close/Escape and Open settings page at desktop and 390px, scrolling both page and modal to the bottom. Old `/settings#lopu-credits` and `/settings/lopu#gift-invites` links select Account and reveal the section below the sticky navigation. Password-only accounts do not show a resend-email action without an email address.

## Mobile sign-in and ambiguous post recovery (2026-09-13)

- [ ] On a foreign preview at 390px and desktop widths, /login offers its selected authority instead of a native passkey for another origin. Continue navigates in the same tab with popup blocking enabled. Approve and cancel both return safely; an expired, wrong-origin or replayed state cannot sign in. No auth code enters query strings, logs or persistent return state.
- [ ] Scroll login, authorization and account invitations through the footer; expand the feed composer, menus and account controls at both sizes. No account-hint card covers the login form.
- [ ] Lose the response after a text/link post commits with no media layout. Exact-ID readback recognises the server-omitted layout and completes once; different content, owner, audience, attachments or nonempty layout never reconcile. Retry checks the saved post first and retains the original UUID.
- [ ] Leave a create request unresolved: after 30 seconds plus bounded readbacks, the composer keeps its draft and offers Check and retry safely. An unresolved readback cannot keep the button spinning indefinitely.
- [ ] Avatar moderation 429 then success creates the invite; persistent 429, insufficient quota, malformed response and non-JSON 503 never produce a clear verdict. Failure retains the profile fields and thumbnail, reserves no gift, and offers explicit photo removal.

## Admin error-log Things (2026-09-14)

- [ ] Create a harmless server error via the canonical logger; Things → Error logs lists it for current admins. Search by provider, literal punctuation, code and request ID, expand details, refresh without clearing prior rows, and load older rows. At desktop and 390px, scroll from top through footer with details expanded; long traces wrap without overflow or overlays.
- [ ] Anonymous/non-admin/app-token access returns no logs. Demote/logout/switch accounts while viewing logs: old records disappear and the next API request is denied. Generic Thing reads, search, export, create/update/delete and public ACL spoofing cannot expose or mutate error-log Things.
- [ ] Provider 429 bodies with only `error.type` retain their redacted reason and request ID. JSON/non-JSON failures, timeout, retry success and retry exhaustion retain fail-closed moderation behavior. No request image/text, credentials, query strings, raw SDK fields or reversible reveal values enter stored detail.
- [ ] Simulate unavailable log storage and a capture flood: original responses survive, persistence has a one-second deadline, per-request/instance caps apply, and console diagnostics remain. TTL indexes stay home-only; expired records cannot be read even before MongoDB reaps them.

## Post tag rendering

- [ ] At desktop and 390px mobile widths, open a tagged attachment post in the feed and its standalone post page. Each stored tag appears in one pill row beneath the body; tapping a pill opens the matching tag search. Check ordinary posts, comments, and shared originals; tags remain visible without an extra outer-card row. Scroll to the bottom and verify no wrapping overflow or overlap with the action row.

### Subspace branding uploads

- At `/s/:slug/mod?tab=settings`, verify icon and banner default to upload tiles, each with **Use URL instead**. Upload a raster image to each slot, verify preview/progress and Save blocking, save and reload; check directory/card/feed icon and subspace banner as another viewer. Branding remains public directory identity for private subspaces.
- Replace, remove, cancel, retry a failed upload/save, and switch to/from a valid URL. Existing URLs survive unchanged saves; invalid URLs/non-images/over-64-MiB files and wrong-purpose, wrong-owner, expired or already-bound uploads are refused. Replacement URLs stop serving old managed bytes; abandoned/replaced objects remain billed until reaped.
- Check revoked moderator access, upload approval, quota failure, ownership transfer and deletion cleanup. On desktop and 390px mobile, open both URL panels and scroll top to bottom; verify no overlap, clipping or horizontal overflow.

## HEIC/HEIF photo selection

- [ ] Uploader guidance lists every accepted format and matches the picker: invite/signup JPEG, PNG, WebP, HEIC, HEIF; profile/branding additionally AVIF and GIF; emoji GIF, JPEG, PNG, WebP, HEIC, HEIF; unrestricted attachments say all file types. Verify desktop/mobile wrapping, including settings popups.

- [ ] Newly selected HEIC/HEIF files upload as full-resolution PNG with no JPEG encoding; invite previews and saved thumbnails remain PNG (128px crop). Verify detailed/transparent thumbnails above the old 16 KiB ceiling keep their pixels and moderation receives PNG. Existing stored JPEGs are not retroactively changed.

- [ ] Open `/scripts/heic-upload.browser.html` on the Vite dev server: all cases
  pass using the synthetic HEIC fixture and the real decoder/upload queue with
  fake HTTP/object storage. Posts, comments, messages, avatars, banners, subspace
  branding and emoji reserve/send matching PNG bytes; retry preserves identity;
  selecting the same original twice stays deduplicated. Invite preparation and
  removal perform no attachment API calls. This harness does not prove S3 access.
- [ ] In Settings → Account and its popup, and in invite signup, select HEIC/HEIF
  photos (including uppercase extensions and missing browser MIME types). The
  shared profile uploader shows a valid preview, replacement/removal and retry;
  Create stays disabled while preparing or after a conversion error. Test invalid
  bytes, size limits and removal/replacement during conversion. Desktop and 390px
  layouts remain usable when scrolled from top to bottom.
- [ ] With an upload-approved account, select/paste/drop HEIC in post, comment and
  message composers, avatar/banner and subspace branding; verify the PNG preview,
  matching stored size/type, server moderation, quota refusal, cleanup, and reload.
  Downloads use the converted `.png`; originals remain untouched on the device.
  Archive imports retain original bytes. External HEIC URLs are not converted.

## Feed defaults, algorithm directory and geographic Things

- [ ] Open `/feed` on desktop and mobile: all eight builtins appear in the bounded, scrollable picker; selecting one updates the feed and reloading preserves it. Builtins never receive training events.
- [ ] Open `/algorithms`, search by name/description, create a private profile, publish it, branch it from another account, unpublish, and disable sharing. Private and link-only algorithms never appear in the directory; previews never expose learned weights; existing copies survive unsharing.
- [ ] Create Things through the API with `geo: {lat,lng}`. Invalid/missing/out-of-range coordinates return 400. POST `/things/search` with `near` and `radiusKm`, and Local feed with lat/lng, find nearby visible posts, exclude far/private posts, and retain tag/subspace/ACL filters. PATCH `geo:null` removes the location.
- [ ] Local's location request occurs only from its button; denial leaves the location-tag fallback usable. Scroll directory/feed top-to-bottom at desktop/mobile widths, including the editor and open picker; no content overflows.

- [ ] Account invitations default to Never expire; select each dated expiry. Reload and show/copy a pending invite, including clipboard-denied fallback. Legacy replacement warns before invalidating the old link; cancelled/claimed/expired rows have no link control. Check desktop and 390px page/popup top to bottom with dropdown open. Never-expiring gifts survive expiry sweeps; dated gifts refund once; another owner cannot reveal/replace a link.
### Lopu uploads, provider media and mobile keyboard (2026-09-16)

- [ ] In an owned interactive HTML component (`tt-upload`) and Chakra component
  (`Upload`), pick an image and a text file, wait for Ready, choose Use file, and
  verify `<name>`/`<name>AttachmentId` form values and a private attachment-backed
  post. Toggle Use URL instead; cancel/retry, switch account, and verify shared
  read-only runs cannot upload. Clearing a field keeps the saved private file.
- [ ] Send an image, PDF and UTF-8 text file to each supported provider. Verify
  provider input contains actual media/text, also after a tool hop and a follow-up
  turn. Test Claude OAuth separately. Revoke access during download: bytes must
  be discarded. Linked, unsupported, oversized and failed reads must be explicit.
- [ ] Read a public URL with `fetch_url`; propose an `http_request`, inspect its
  exact input, refuse once and confirm once. A changed body invalidates approval.
  Private literals, mixed public/private DNS, redirects, oversized responses and
  ambient cookie headers are refused; ambiguous mutations are never retried.
  Confirm the origin manifest advertises network 1.0.0 and chat reply 1.10.0.
- [ ] At desktop, 390x844 and 390x444, scroll page/chat/attachment panel to the
  bottom; expand attachments, model menu, Your Things and chat settings. Send
  remains visible, long input scrolls inside its own field, and no horizontal
  overflow appears. On a physical iPhone, repeat keyboard open/close, multiline
  typing, visual-viewport panning, orientation and safe-area changes in both the
  Lopu page and floating sheet. Desktop resizing alone is not iOS acceptance.

Automated regression coverage: `chatMedia.test.ts`, `chatMediaLoading.test.ts`,
`chat.streaming.test.mts`, `lopuVisualViewport.test.ts`, API capability tests and
existing Lopu/component/webpage suites. Browser synthetic upload QA uses mocked
storage only; do not describe it as a production upload or provider acceptance.

## Background refresh and returning tabs

- [ ] Open an existing Lopu conversation in two clients. Create another conversation and append a message in the other client: the first client's list and selected timeline update without reload or changing the selected conversation. Repeat in the floating Lopu window and Messenger.
- [ ] Leave the tab hidden, update from the other client, then return. Verify an immediate refresh on visibility/focus, reconnect and browser history restoration; hidden tabs poll at most once per minute per resource. Cached content remains during failures.
- [ ] Keep a draft, scroll into history, open conversation/chat settings drawers, and let several polls run at desktop and phone widths. No draft loss, loading flash, pagination rewind, overlap or clipping. Rename/delete while an earlier read is delayed; an old result cannot undo the edit. Switch accounts away and back during a delayed read; old private data cannot reappear.
- [ ] Run the hooks, Lopu UI, Lopu store, Messenger and root-data suites. Use the live browser as well: native browser timers require correctly bound callbacks, which Node timers alone do not prove.

## Legal pages and policy exports

- [ ] Signed out, open `/legal`, all three current `/pages/` documents and their version links on desktop and mobile; scroll to the bottom and confirm readable text and no overflow. Select the archived privacy version and return to current. Unknown versions must show a not-found message, never current text.
- [ ] Copy privacy URL and Apple TV text, compare copied text and `.txt` download with the selected document. Deny clipboard permission and verify the selectable fallback. Confirm archived exports carry an archive warning and production URLs never use a preview origin.

### Floating Lopu conversation selection (2026-09-17)

- [ ] Open the floating popup and docked panel, widen past 680px, collapse/reopen Conversations, then shrink to 390px: the full list scrolls independently and the composer stays reachable. Repeat in the mobile sheet and voice mode.
- [ ] With more than twelve conversations and long titles, select the oldest entry, start New chat, rename, cancel deletion, and open its Messenger link. Selection stays in the popup until a page link is explicitly chosen. Confirm the dedicated Lopu page uses the same list and history.
- [ ] Open/close Conversations with a draft and attachments present; preserve them. Use keyboard Enter/Space on rows and nested Rename/Delete/Keep/Messenger controls: nested actions must not select a row. Escape in the rename field cancels editing without closing the popup.

### Lopu page context and window docking (2026-09-17)

- [ ] Current-page context starts checked and shows the title/URL. Navigate with Lopu minimised; restore it and verify the new page. Toggle off, send, and confirm route, draft and selected-block context are absent; manually attached pages remain explicit. Rejected sends keep page chips; accepted sends clear manual chips.
- [ ] Pages lists recent normal navigation and navigator selections for this account. Search, select/remove, deselect the automatic current page, and scroll to the last result on desktop and 390x844/390x500. Done and Close remain reachable. Switch accounts and verify previous private history does not appear.
- [ ] Minimise leaves only the floating bubble, including when its normal launcher preference is disabled. Navigate and reload: no title bar returns. Restore with the bubble/navbar; drafts remain on desktop.
- [ ] Drag all four edges and four corners. Opposite edges stay anchored; frame bounds stay within the viewport. Dock to top/left/bottom/right, select overlay/split, and resize each divider. Split reduces the actual page rectangle; overlay preserves it. Scroll the page fully in each mode; fixed navigation remains in the page area and DevKit/Edit controls stay behind overlay Lopu.
- [ ] Shrink split page width to 320px: compact navigation controls do not collide, page content has no horizontal overflow, and the drawer/quick switcher remain accessible. On mobile, check the full sheet, minimise/restore, page picker and conversation controls in a short viewport.
- [ ] Both capability manifests advertise api.lopu-chats-reply 1.12.0. Page-bearing clients refuse 1.11 origins, while continuation without pages keeps its 1.11 requirement. Invalid page arrays/URLs fail before writes. Real route tests must prove sanitized references reach the provider and persisted message, and opt-out omits implicit page context.

### Lopu message queue and Send now (2026-09-18)

- [ ] While Lopu works, press Enter (Cmd/Ctrl+Enter on mobile or with Enter-to-send off) or the normal send arrow to queue three messages; there is no dedicated Queue button. Shift+Enter and IME confirmation never send. Add/remove draft attachments while replying, then queue them and confirm the next draft remains editable. Accepted queue items disappear before their reply completes; interruption cannot resend an accepted batch. Each starts with Send together checked. Drag by holding the handle, reorder with both arrows, and remove an item. Check desktop and 390px, long text, queue scrolling, composer settings and the bottom of the page.
- [ ] Leave consecutive messages checked: they reach one reply in queue order. Uncheck the middle message: it waits for the preceding reply, sends individually, and the next message waits for its reply. Different model/page/media snapshots and batches above 8000 characters split at a safe boundary.
- [ ] With a typed draft, the send arrow floats above the stop square. Stop remains clickable and preserves the draft for a new reply; a paused older queue does not capture that explicit new send. More send options opens above the composer without clipping at desktop/390px. Send now saves a text note without cancelling the existing provider call or tool. The next provider hop receives it as user input. Late notes stay in history for the next reply; notes never approve destructive tools. File/Thing selections must be queued or sent normally, not silently dropped by Send now.
- [ ] Pause/Resume, Stop, interrupted transport, refresh, account switching and switching conversations retain the right queue. Reload restores paused. Retrying an uncertain batch/note keeps its original operation identity and payload. Old-account completions cannot consume a newer account's queue.
- [ ] Run Lopu UI, Lopu provider streaming, Lopu route/background-task and API capability suites. `/scripts/lopu-queue.browser.html` is a local-only interaction fixture using the production queue/composer; its simulated delivery is not authenticated provider acceptance.

### Lopu chat archiving (2026-09-18)

- [ ] In the Lopu page and floating conversation list, archive a chat, find it under Archived, reload, read its unchanged transcript, and Restore it. Repeat at desktop and 390px, scroll to the final row, and check long titles and wrapped actions.
- [ ] Archive while a reply runs: the selected transcript and reply stay alive. New chat, rename, Messenger link and delete confirmation still work. A failed archive restores only that chat's flag; switching accounts while it fails never leaks prior chats.
- [ ] Run the Lopu store, messenger Lopu and capability suites; `scripts/verify-lopu.mjs` covers real authenticated archive/restore idempotency, invalid booleans, cross-account denial and transcript preservation when its verified test account is available. `scripts/lopu-archive.browser.html` provides a synthetic API fixture for list layout and failure testing.

Local queue-fix validation: `http://localhost:18720/scripts/lopu-queue.browser.html` (worktree `thingtime-lopu-auto-queue`, Vite 18720 / HMR 18721 / Nitro 18722 overrides; default trio occupied). Tailscale/Funnel unavailable: the installed launcher targets a missing `/Applications/Tailscale.app`; no public mapping changed.

## Builder SDK uploads, forms and lookups (2026-09-18)

- [ ] Run `/scripts/builder-sdk-regression.html` on desktop and 390px; the production
      page renderer enables uploads, inherits component sources and passes all
      synthetic assertions for required fields, saved initial files, pending upload
      guards, failed commit/retry identity, double-click suppression, empty text,
      source refresh, clearing files and draft retention. Open the optional URL
      control; inspect top-to-bottom for clipping and horizontal overflow.
- [ ] With configured object storage and an approved account: select a real file
      on an owned `/p/:id` in View mode, wait for processing, Use file, save the form,
      read the returned Data Thing, and reload. Verify the same component on its
      dedicated page. A foreign/anonymous reader cannot access the private file.
- [ ] Run the 99-check `verify-actions.mjs` against an isolated local database.
      Empty optional text overrides descriptor defaults; omission retains defaults;
      partial updates preserve unrelated fields. A missing Vault key fails visibly,
      and even an explicitly opened foreign lookup action cannot use the viewer's key.
- [ ] `/docs/builder`, all six section links, `/builder/docs`, Builder's docs link
      and docs search work at desktop/mobile; scroll each page through the footer.
- [ ] Create a lookup step in the action builder: query `$input.address`, Google
      provider, and an owned Vault entry id. The capability and effects display the
      provider and credential use. Shared execution refuses lookup; no arbitrary
      URL or secret appears in the authored definition or error.
- [ ] With an explicitly configured Google key, verify a match, no matches, quota
      denial and timeout. Display attribution. Do not persist provider-derived
      results contrary to Google's rules; run history/source cache omit lookup results.
- Collected unlisted posts: visiting a bare URL saves discovery for the signed-in
  account or saved anonymous browser identity. A different browser can open the
  URL but must not inherit that collection on profile listings. IP alone grants
  no collection. Removing the link audience revokes anonymous access.

## Canonical unlisted links and inherited audiences (2026-09-19)

- Open an unlisted or mixed people/group/link post as an allowed viewer, then
  open its comment video. Gallery Copy link, Share, menus and breadcrumbs use
  the canonical Thingtime URL without `key`. Paste into a fresh anonymous
  browser: both the page and video bytes must load. Repeat for nested comments.
  Legacy keyed URLs still work, but changing a key cannot revoke a known base
  URL: remove “Anyone with the link” to revoke anonymous access. Group-only and
  private posts remain restricted, including their comments and media.
- Child cards show the root privacy icon and muted audience summary, including
  mixed people/group/link audiences. Never list a group's private member roster.
  Blocked/pending intermediate comments hide their descendant media as well.
- Run `test:things`, `test:attachments`, and `test:api-capabilities` for inherited
  chains, key projection, URL transport, broken/cyclic chains, and negotiation.
- Open `/scripts/inherited-audience-preview.html` at desktop and 390x844. Scroll
  to the bottom, open the comment's video, navigate to its photo and back, open
  Media options, copy/share links and inspect the synthetic audit text. Long
  audience labels ellipsize without overlapping menus or overflowing the page.
  The fixture uses real components and synthetic transport; it does not prove S3.

Local validation: http://localhost:18420/scripts/inherited-audience-preview.html
in `thingtime-media-gallery-profile` (Vite 18420 / HMR 18421 / Nitro 18422).
Tailscale/Funnel is unavailable because its installed launcher points to a
missing `/Applications/Tailscale.app`; no public mapping was changed.

## Builder demo app suites (2026-09-21) — `remix/app/schemas/appSuites/{dusted,thingmon,snapquest,branchwood,garden}.ts`

Automated: `npm --prefix remix run test:schemas` (every part of every suite
clears its kind gate in both materialisations), `test:action-packs` (the
`thingmon` pack), and the live verifier
`node remix/scripts/verify-demo-apps.mjs http://127.0.0.1:<nitro-port>` with
`TT_VERIFY_ADMIN_USER/PASS` naming an `ADMIN_USERNAMES` account (151 checks:
register → seed-demos → install → run every program → resolve every page).
`TT_VERIFY_ONLY=thingmon,garden` narrows it.

Manual (signed in, after `POST /api/v1/admin/webpages/seed-demos`):

- [ ] `/builder/demos` → 📱 Apps lists Done & Dusted, Thingmon, Snapquest,
      Branchwood, Pixel Garden with taglines; each card opens
      `/builder/demos/<key>` with PREVIEW + LIVE panes and Install app.
- [ ] Signed OUT, `/p/thingmon` shows the sign-in card (not the starter
      picker); signed in, the seeded page shows the Install card, and after
      Install the page re-resolves to the viewer's twin (builder bar appears).
- [ ] Thingmon: pick a starter + name → Begin (toast narrates) → keeper card
      shows shards/dex/lead; Explore Meadow opens the arena (wild + player
      sprites, HP bars, log, one button per move, crystals, tonics, Run);
      a move updates both HP bars and the log; a Shard crystal either
      catches ("Gotcha!", party count rises on Team) or the wild replies;
      Team: rename reads only its own row, Tonic/To box/Lead/Evolve work;
      Dex: unseen species are silhouettes, `?page=2` paginates, a card opens
      `/p/thingmon-species?id=`; Shop: Buy sends only that row's qty; Keeper:
      Daily bonus once per day, Start over empties everything.
- [ ] Done & Dusted: add a task with a date and an uploaded file (Upload →
      Use file → Add); the board refetches; chips `?filter=today|overdue|high`
      and `?project=inbox` filter; Edit opens `/p/dusted-task?edit=<id>`
      prefilled (select/date/textarea/upload initialise from the record);
      Snooze moves the due date a day; Find renders `last.result`; Done page
      Undo + Clear all done (each → delete).
- [ ] Snapquest: board shows 24 challenges, today's featured pick, category
      chips; a challenge page refuses Claim without a file, accepts after
      Use file; the gallery shows the private photo; Un-claim reopens it.
- [ ] Branchwood: Begin → choices as buttons, a locked choice shows its hint
      inline; reach an ending → "THE END", Play again keeps endings found;
      Journal lists the path with titles.
- [ ] Pixel Garden: Open → six beds; Plant reads only that bed's seed
      select; the percentage moves within 15 s without clicking (interval
      source); Water refuses a fresh bed; a radish is harvestable after ~3
      minutes; Shed shows the catalogue; Compost resets.
- [ ] Mobile (390px): the arena stacks, move buttons wrap, dex grid is 3-up,
      no horizontal overflow on any app page.

## Continuity, Builder, navigation and Things regression checks (2026-09-21)

- [ ] Stop a background reply before it produces text, then poll and reload.
      Recovery must retain the terminal assistant state and manual Retry control
      without adding an empty user bubble, duplicating an already-saved terminal
      reply, or dispatching another reply. Verify
      both local and Vercel management, a missing/unloaded user-message identity,
      and an attachment-only genuine user turn that must remain visible.
- [ ] Build the Vercel output and verify the Claude runtime in both the Nitro
      server function and each Workflow step function that can invoke it. Resolve
      the pinned runtime from an isolated function working directory without
      repository node_modules. Check the native executable matches the emitted
      function architecture; missing manifests, archives or corrupt runtime
      metadata must fail the build. A successful main API shell
      alone does not prove the Workflow runtime is packaged.
- [ ] On the deployed preview, send a harmless Claude reply with Vercel management
      using an authorized account and existing OAuth credentials. Confirm the
      worker reaches the provider, persists the response and completes without
      a package-resolution error; reload while it runs and recheck Stop. Verify
      reply 1.14.2 on both manifests. Repeat on production after release; a local
      bundle check alone does not prove authenticated provider execution.
- [ ] On a deployed preview with an authorized account, send a harmless native-tool
      GPT-5.6 Sol reply at High effort in local and Vercel management. Confirm the
      selected effort survives a read-only tool hop, its receipt is saved once and
      the reply reaches a terminal state. Reload the server-managed chat while it
      runs. Both manifests must advertise reply 1.14.2; a provider rejection must
      retain accurate settings and an honest error without exposing credentials.
      Mocked provider tests alone do not prove this live acceptance.
- [ ] Reject a provider tool batch before execution when streamed and completed
      tool identities disagree, item/call IDs repeat, or any argument JSON is
      incomplete. A failed later hop must preserve earlier receipts without
      replaying their effects.
- [ ] Fail admission before scheduler dispatch, then wait for its lease or Stop:
      a new send becomes possible and a delayed worker cannot execute. Abandon a
      claimed child: saved receipts survive and uncertainty requires attention; the
      conversation claim remains held until worker completion is acknowledged.
      Hold a worker across Stop plus redelivery: no new worker starts, late
      receipts persist, and acknowledged completion releases the claim once.
      Delay a competing finalizer past acknowledgment: terminal status cannot
      regress. Redeliver an already-finished child: no stale reservation remains.
- [ ] Reach the local safe-error retry limit, then poll and reload. Automatic
      recovery stays paused across both; explicit manual Continue can retry. Switch
      accounts while the continuation identity hashes: no stale recovery sends.
- [ ] Viewing an interactive webpage attached to a feed/post/Thing never makes
      it Lopu's active editable page. A real builder target remains active,
      explicit edits to the attachment are refused, and local controls respond.

- [ ] Open a service-workspace component in the catalog preview and as a
      non-owner in its inert live pane: only the static hint appears, without a
      workspace loader or setup controls. Interactive shared pages still allow
      authorized staff. Multiple attached workspace records reuse one lookup
      while each source ACL is checked; later reads recheck revoked membership.

- [ ] Choose each Lopu management mode from the send menu and settings; confirm
      the choice survives reopening that chat. Close/reload at a safe checkpoint
      or recoverable error: work resumes once without a synthetic prompt bubble.
      Stop during execution and between parts; polling/reload must never restart
      it. Pending confirmations, uncertain tool completion, unsaved page edits,
      session revocation and account/data-source changes must fail closed.
- [ ] On a physical iPhone, run two server chats and lock the device: exactly one
      Live Activity changes from two active chats to one, then finishes. Verify
      real APNs while suspended, user dismissal, disabled Live Activities,
      signout/account/source switches and a simultaneous voice session. Simulator
      lifecycle tests do not prove real lock-screen or APNs delivery.
- [ ] Desktop and mobile: a single search icon opens Commander with page/recent
      shortcuts, remote Things/people and `>` commands. Test keyboard navigation,
      Escape, close/reopen, account switch and nested editor shortcuts. Admin is
      directly below Dev for administrators and absent for other accounts.
- [ ] Builder dashboard page/component cogs and floating editor cog expose
      privacy, share, rename, private duplicate, clipboard and import/export.
      Exercise dialogs and unsaved-change guards at desktop/mobile widths.
      Public/page view routes and ordinary app pages have no floating Edit page
      control; Builder has no Go to page button. Scroll through the footer.
- [ ] Fresh notification preferences disable action-run push and email. Explicit
      saved choices survive. Muted runs remain in notification history.
- [ ] Anonymous crawler HTML for an unlisted post/page carries its specific
      title/excerpt and card while retaining noindex; private/missing targets
      remain generic. Download the actual PNG and check stored photo tiles.
- [ ] Things: plain click opens; modifiers/checkboxes select. Explicit legacy
      data folders browse and move with the normal owner/cycle fences. Every
      root/nested tree and Miller column ends with New folder +. Open the page
      cog and error log. Rename preserves original payload/permissions.
- [ ] Thing data starts collapsed. Rendered null, false, zero and empty strings
      remain distinct. Shared comments retain existing replies and ACLs and use
      the same reactions/rich composer as posts. Attach multiple existing Things
      through Commander search/folders with independent Data/Interactive modes;
      recheck reader permission after revocation and after account switches.
- [ ] Run focused continuity, native, Things, notification, navigation, webpage,
      social-preview and capability suites; build and verify Vercel output and
      both live capability manifests. Record baseline typecheck errors separately.
- [ ] Graphify can refresh a read-only snapshot through a writable private copy
      without mutating the snapshot; run `node --test scripts/graphify-cas.test.mjs`.

## Funding and support (`/support`, landing funding section)

- [ ] Signed out, open `/support` directly and reload; contribution, paid setup
      enquiry and sponsorship enquiry paths remain visible without signing in.
- [ ] At desktop and 375px widths, scroll the homepage and `/support` from top
      to bottom. Cards, sticky navigation, form controls and footer links stay
      reachable without horizontal overflow, clipping or overlap.
- [ ] Homepage support links and the shared footer reach `/support`. Contribution
      links reach the real Thingtime GoFundMe campaign. No Indiegogo prelaunch
      link, hard-coded raised total/backer count/deadline, merch entitlement or
      lifetime AI promise appears in the active funding section or FAQ.
- [ ] Switch between setup and sponsorship enquiries, enter a brief including
      punctuation/newlines, and inspect the generated email recipient, subject
      and body. The visitor can edit the message; preparing it never sends it.
- [ ] Copy the enquiry on desktop and mobile. If clipboard access is unavailable,
      the visible draft and contact address remain available to copy manually.
- [ ] Open the homepage funding FAQ with keyboard and pointer. Donation terms remain separate
      from paid services and Lopu credits; no payment-success claim is shown
      merely from clicking an outbound link or returning to the page.

## Sign-in hint clearance

- [ ] On signed-out desktop, 390px and 320px mobile pages, show both the preview
  sign-in hint and account suggestion card. Keep default Lopu/DevKit launchers
  visible; Not now and account controls must remain unobscured and clickable.
  Scroll long hints on a short viewport; the card must stay within the viewport.

## Functional catalog controls (2026-09-21)

- [ ] At `/tests/functional-demos.html`, use the first component's text field,
      checkbox, Toggle, Increase and range. Its visible summary changes; the
      second component does not. A parent render preserves the edit. Reset
      restores all visible fields and the summary. Open More and scroll to the
      bottom at desktop and 390px without overlap or horizontal overflow.
- [ ] In guestbook, RSVP and calculator demos, change the native form fields.
      Required, email and number constraints block invalid submits. Confirm
      shows the actual values; cancel writes nothing. A successful first run
      installs its suite and shows the result without navigating away.
- [ ] Contact/newsletter demos and site CTAs create private saved Things with
      inspectable links. They claim no external delivery. Use template installs
      its required suite before copying; the copied page remains functional
      after reload. Automatic dependency installation preserves customized parts. Explicit reinstall refreshes controls without duplicating suite parts or overwriting saved data.
      Run `TT_FUNCTIONAL_TEST_URL=http://127.0.0.1:<port> node --import tsx --test
      app/api/utils/webpages/functionalDemos.integration.test.ts` from `remix/`
      for real API proof (local server only; exact fixture Things are cleaned up).
- [ ] Local controls work signed out on curated demo live panes. Server Actions
      still require sign-in and remain owner-scoped. Browse thumbnails and
      stranger-authored controls remain inert. Switching account, component or
      defaults does not reveal the preceding component's local values/result.
- [ ] Video demos use a native player; changing its URL changes the actual src.
      Play/pause, seeking, volume and fullscreen work for a compatible URL.
      Source URLs and markup continue through the existing safety allowlists.
- Native catalog controls: a dialog opens only after a click, traps focus, closes
  with Escape/Close and restores focus; a nested local Action remains within its
  component. A countdown starts, pauses, resets, catches up after delayed ticks
  and announces completion without affecting another instance. Repeat at phone
  width; drawers are flush to the left/top/bottom and keep the close control usable.

- Service workspace production regressions: save an uploaded image, reload the
  record, and verify the gallery plus thumbnail/banner actions. After saving,
  the upload tray must clear and the next Before/After batch must be independent.
  A revoked member and unrelated account must not read comment media metadata;
  blocked and wrong-owner attachments stay absent. A Google Places configuration
  rejection must show specific safe setup guidance; gateway HTML must show a
  retry message rather than a JSON parser exception. Run test:service-workspaces
  and the isolated test-service-workspace-local.ts smoke.
- Native app blocks (the builder's Service workspace html block): the live
  page `/p/<id>` (with and without `?mode=visit`) and the seamless editor's
  Edit, Layout and View modes must render the real workspace — Edit/Layout show
  the "Live app preview" hint and clicks select the block; View and the live
  page run it. Builder mode, component-library previews and feed embeds keep
  the placeholder that names the workspace and never mount its loader. Run
  test:webpages (webpageBlocksNativeApp.test.ts) and test:editorjs.
- Workspace record navigation: open property → job → visit; each Back returns
  to the previous record ("Back to Lawn & edges"), then to the section list.
  Adding a time log, usage log, sub-job or customer link keeps the parent open
  with the new row listed; editing an existing record keeps its page. Deleting
  a record from a list stays on the current page; deleting the open record
  returns to where it was opened from. Creating a workspace on a never-saved
  builder page shows the "Save this page to connect it" notice, and Setup →
  "Connect this builder page" works after saving.
- Integration builder mobile header: with a long display name at 320px/390px,
  account text truncates without covering Commander or neighboring controls;
  the full name remains available to assistive technology and on hover.
  The compact mobile search button opens a focused input below the header;
  results remain below that input and Escape closes it. Desktop search remains inline.

- Index-capacity upgrade: a home database carrying the pre-release Connections
  lookup can run the integration seed with legacy read layouts still enabled.
  Bootstrap retires that obsolete non-unique index before creating missing
  current indexes; unique constraints and saved Things remain intact.


## Map SDK and larger-platform library (2026-09-21)

- Browse all 540 examples: Mapbox, Google Maps and Google Places belong to the key-required filter and each has a grouped builder page. No provider requests or SDK scripts load merely by browsing. The public-only browser harness must omit SDK/keyed examples.
- Open SDK demos at desktop, 390px and 320px. Inspect inputs, key Show/Hide/Clear, setup links, source and reuse tabs; scroll through the full page. Empty keys disable Run. Mapbox secret tokens and malformed inputs fail before loading. Invalid provider keys produce actionable errors, never fake maps/results.
- With a restricted browser key you own, run a Mapbox marker/popup and Google advanced marker. For Places, enable Places API (New), run text/nearby search and autocomplete, and verify actual markers, addresses, attribution and result JSON. Only the first autocomplete prediction is resolved using its session token. Check browser console for CSP violations; provider errors must not expose credentials in Thingtime logs or result output.
- Clear/reset/cancel, changing account and unmounting dispose SDK frames. A saved Thing contains only the catalogue ID and ordinary inputs; credentials/results never persist. A second demo's input/key state remains independent.
- REST Places text/nearby searches send a catalogue-selected POST with bounded fixed fields and masks; arbitrary caller URL/method/body/header choices cannot change that transport. GET providers retain their existing behavior and key redaction. Verify anonymous 401, unknown example 400, and origin capability 1.2.0.
- Re-run the integration-only admin seed. Existing authored copies remain unchanged; the index lists 51 services and all 540 examples resolve to schema-valid component and individual page Things.

- Upcoming visits: completing a future-dated visit removes it from the dashboard upcoming list while keeping it in the planner and property visit history. Cancelled and archived visits also remain absent from upcoming visits.

### Shared discussion acceptance and service galleries

- Component navigation: follow two nested query links on a saved page, then
  return twice with a `$ui` Back control. Reload the deepest page and verify
  Back still returns within that app. A direct deep link uses its declared
  fallback. In Builder View mode, query links and fallback navigation retain
  the selected page and mode; unrelated pages and external links stay intact.

- Media forms: render two new `tt-form` instances using one save Action. Bind
  completion to its receipt and return each form's operation id. A successful
  save resets only the matching form and gives it a fresh id; rejection,
  unrelated receipts and source refresh preserve typed fields and retry ids.
  Saved-record forms never reset from this receipt. Attachment helper text and
  linked-URL controls follow their configured values; upload readiness disables
  submit while empty, pending, failed or committed, and clears after reset.
  With attachments selected, bind `committedTargetId`/`committedIds` from the
  same receipt and confirm the completion reset keeps every saved file: after
  the form clears, the saved record still resolves its attachments and no
  `POST /api/v1/attachments/delete` fires for them. Unbinding those two props
  must be the only way to observe that delete.

- Saved Components: embed `tt-discussion` for an authorized Thing. At desktop
  and 390px, post a comment and nested reply, react, search, and refresh; keep
  the canonical discussion controls and refresh page sources only after an
  accepted write. Builder previews stay inert, malformed targets never mount
  a loader, and another account cannot see a private target's discussion.
  Authored post projections, children and callbacks must be ignored. Wrap the
  discussion in authored Action markup: comment controls must not invoke the
  ancestor Action from the template's capture handler.

- Post a plain or rich comment/reply on a workspace Thing, including a nested
  reply. Refresh the media gallery only after server acceptance; rejected writes
  must not trigger refresh. A failed gallery refresh must leave the accepted
  comment visible without retrying or duplicating its write.

- Franchise list controls: seed more than 20 authorized records; check 5/10/15/20 sizes, next/previous/page selection, filter reset, clear filters and empty matches across directories, Trash, linked records, history, media and comments. Infinite mode appends batches and stops at the last record; changing mode or filters resets the window. Search must find older cursor-backed comments/media, including attachment-free intermediate pages, and stop on failed/non-advancing cursors. Planner filters and per-day paging preserve cross-page moves in the complete day order. Check controls and opened record menus at desktop and 390px without horizontal overflow.

- Shared Thing discussion paging: with more than twenty authorized comments,
  search for text on an older cursor page and verify rich comment controls remain
  available. Check 5/10/15/20 sizes, next/previous, author filters, empty
  matches and infinite mode at desktop and 390px. Inaccessible comments must not
  appear in the batched post projection; rejected or non-advancing cursor pages
  must stop automatic loading, with an explicit retry for recoverable failures.

- Device command confidentiality: generic Thing exact-id and discussion reads must reject owned device-command rows, including live and expired filesystem results and upload chunks. Only the dedicated device command result endpoint may return its authorized, unexpired result.

### Native controls in the demo apps (2026-09-22, PR #886)

- [ ] Done & Dusted `/p/dusted`: the Focus timer card shows 25 minutes; the
      15/25/50 buttons change the length with no network run (signed out too);
      Start counts down, Pause/Reset work. Done page: "Clear all done…" opens
      a native dialog; Escape closes it; "Yes, clear them" runs the delete.
- [ ] Thingmon `/p/thingmon-dex`: "Hide unseen" hides the silhouettes and
      flips to "Show all"; paging keeps the grid. `/p/thingmon-keeper`:
      "Delete my Thingmon data…" opens a dialog; the red button inside runs
      the reset. `/p/thingmon`: Explore shows a one-line result panel (no JSON).
- [ ] Snapquest challenge page: "Un-claim…" confirms in a dialog. Pixel Garden
      shed: "Compost the garden…" confirms in a dialog.

- Builder record navigation: throttle the source request, follow a related record link, and verify old edit/archive controls disappear before the new result arrives. Reopening the same binding may paint its cached data; another record, viewer, page or sharing context must not inherit it.

- Builder app portability: preview each generated Component and Action through the signed mutation workflow before migration. A valid app must fit without raising review limits; confirm record labels, zero values, empty text, archived references, missing references, and every planner day match the original app after title normalization.

## Web standards Builder app (2026-09-24)

- [ ] Constructor examples compare calling with using new. Confirm boxed false
  is truthy, exact BigInts retain decimal strings, a single numeric Array
  argument creates holes, and typed-array copies stay independent while buffer
  views observe source writes. Test native alignment/bounds failures and the
  separately labelled 4096-element/byte demo allocation limit.
- [ ] Promise construction records a synchronous executor, asynchronous thenable
  assimilation/reactions and first-settlement behavior. Proxy reads obey fixed
  property invariants and refused writes preserve target values. RegExp calling
  versus construction preserves/copies identity correctly. Save an edited
  Promise or typed-array program, reopen/reload/run it, and check private owner
  access plus anonymous refusal. Weak/finalization examples make no GC promise.

- [ ] Run TypedArray intrinsic recipes across numeric widths and BigInt types.
  Check byte windows, signed wrapping, clamping, exact decimal strings,
  callback thisArg/visit order, native bounds errors, mutation, and shared
  subarray versus copied slice storage. Unavailable constructors stay explicit.
- [ ] Drive native generator next/return/throw with caught and uncaught errors,
  including a yield during finally: cleanup suspends before final return.
  Helper return closes its source; a wrapper with no return must not invent
  source closure. Hidden async-from-sync and for-in examples show the actual
  language protocol trace, not a simulated public receiver. Missing-throw
  cleanup reports whether the current engine matches ECMA-262 2026.
- [ ] Edit generator cleanup and return values, save through the catalogue
  workbench, reopen/reload/run the private Component and retain both values.
  Verify collection deduplication, Unicode iteration and UTF-16 containment
  against actual browser output. Run javascriptIntrinsics.test.ts on Node 22
  and the current runtime so engine differences remain visible.

- [ ] Run HTML form recipes with boolean false, fractional meter values, edited
  text-selection offsets/direction, replacement text, radio values and validity
  messages (including empty to clear). Verify native outputs and control state;
  serialization alone does not prove current value/checked/selection state.
  Save/reopen/reload/reuse a form program as a private Component.
- [ ] Run `HTML_FORM_BOUNDARY_FIXTURES` in the actual opaque runtime. Both
  select remove overloads and option-node insertion must work. Growing a
  detached options collection repeatedly must spend the cumulative node budget,
  and length 301 must fail before allocation. Retained ValidityState remains
  live. Detached form reset must be refused and remain requires-context in the
  catalogue; a no-op native call must never count as a completed reset demo.

- [ ] Run detached DOM recipes with edited text, selectors, attribute names,
  token values and text offsets. Confirm native results and projected changes:
  append/insert/replace/remove, sibling reordering, text splitting, class-token
  changes, attribute writes, queries, node/attribute collections and fragments.
  Document factories do not count as constructor coverage. Save an edited DOM
  program as a private Component, reopen/reload/run it and reuse it in Builder.
- [ ] DOM runs refuse previous-run handles, window/defaultView/constructor
  access, script/resource elements, event/URL attribute writes and markup
  setters. Repeated detached subtree cloning must hit the allocation budget;
  repeated requests cannot extend the worker deadline. An invalid selector's
  native SyntaxError is catchable. Repeated handles preserve identity, native
  void results remain undefined, and missing registered browser members report
  unsupported. The rendered projection is not a live browsing-context receiver.
- [ ] Run `DOM_BOUNDARY_FIXTURES` from `domBoundaryFixtures.ts` in the actual
  opaque runtime. Named form controls must not hide cloned descendants or tree
  depth, shadow native inspection/mutation accessors, or break projection.
  Ordinary control names remain usable. A shallow Document clone must fail
  ownership validation, just like a deep clone from another document.

- [ ] Change class initial/increment/setter values and observe private state,
  static fields and brand checks; change `this`/`super` receivers and generator
  values. Compare postfix/prefix returns, logical assignment with null/false,
  do-while with a negative limit, switch default/fall-through, labelled breaks,
  async iteration, and real template cooked/raw arrays. Save/read/update a
  class Component through the API and confirm the full program survives.
- [ ] Template segments containing backticks, `${...}` and zero through five
  adjacent backslashes remain literal text in plain and tagged templates.
  Control characters, Unicode separators, emoji and lone surrogates preserve
  their cooked values without executing source-looking segment text.
- [ ] Malformed switch case entries and rest parameters in class setters fail
  with the compiler validation message before any worker is launched.
- [ ] Inspect `Element.prototype.classList` and `Document.prototype.URL`: report
  accessor availability without Illegal invocation. An intermediate accessor
  reports an unresolved receiver requirement, not unsupported or a guessed
  value. Getter side effects must never run during inspection.
- [ ] Warm the prior runtime URL, then deploy changed compiler nodes. The
  no-store runtime HTML must reference a new script digest and load current
  code. Verify both runtime responses use no-store, the HTML digest matches JS
  bytes and scoped opaque CSP still applies before filesystem routing.

- [ ] Change event cancelability and preventDefault; observe the dispatch return
  and defaultPrevented flag. Once/removal/aborted observable subscriptions stop
  later deliveries. stopPropagation retains same-target listeners, while
  stopImmediatePropagation stops them. Delivery-time target/currentTarget and
  eventPhase are captured before the event resets. Test abort reasons, first
  signal selection, onabort, timeouts and throwIfAborted with both states.
- [ ] Run stream examples with changed chunks, reasons and BYOB capacity. Check
  tee outputs, pipeTo closure, concurrent transform reads/writes, writer queue
  pressure and lock release. BYOB responds with real bytes and invalidates its
  view; controller errors reject reads/writes, while transform termination
  closes readable output and rejects writes. Split UTF-8 decoding and
  compression round trips preserve content. A missing ReadableStream.from
  reports unsupported; invalid byte/format inputs remain errors. Saved event
  and stream Components retain callbacks, full programs and exactly their used
  parameters through the normal API. No account/network capability is added.

- [ ] Run the runtime audit with `TT_STANDARDS_AUDIT_LANGUAGES=webapi`. Exercise
  URL/query/header/form mutations, Blob byte slices, body JSON/form decoding,
  UTF-8 encodeInto capacity and geometry transforms with changed inputs. Check
  observed return values, not only successful compilation. Invalid
  `URL.canParse` input returns false and `URL.parse` returns null; invalid body
  JSON remains an error. Missing members report unsupported before execution.
  Window-only matrix string parsing remains marked as needing context.

- [ ] Run `audit:web-platform` against the local managed runtime. Default
  JavaScript fixtures exercise valid receivers/callbacks for Intl, Object,
  Reflect, Promise, Set/Map, resizable buffers and byte encodings. Missing
  capabilities report `unsupported` before execution; final-property getters
  are not invoked during availability checks. Invalid input remains an error.
- [ ] Install `web-standards` through the suite API on a disposable local stack.
  Reinstall with `onlyMissing`; IDs stay stable and customized parts remain.
  Run `TT_STANDARDS_TEST_URL=http://127.0.0.1:<web-port>
  TT_STANDARDS_TEST_DATABASE_HOST=127.0.0.1:<mongo-port>
  corepack pnpm --dir remix run test:web-platform` for real API install, private
  component save/read/update, anonymous denial and exact-fixture cleanup.
- [ ] Open `/p/web-standards`, search `dialog` with HTML selected and Explore.
  The URL and card list use actual field values. Clear the search; empty text
  clears the query. Change coverage; navigation and pagination preserve filters.
  Query controls collect only declared names from their own form group.
- [ ] Reload filtered results and navigate between language links. Search,
  language and coverage fields adopt the returned defaults; Explore again keeps
  those filters. While a response is delayed, edit a field: the late default
  must preserve that draft. Run the opt-in `HtmlTemplateField.browser.test.ts`
  with `TT_PLAYWRIGHT_MODULE` for all field types. It bundles the actual field
  component into an intercepted browser fixture, without an app server or data.
  The full `check-web-standards-browser.mjs` flow supports
  `TT_STANDARDS_TEST_BUILT_CLIENT=1` after a build, retaining real local API
  calls while intercepting only public built client assets.
- [ ] Exercise unary/shift operators, break/continue, try/catch/finally, optional
  access with null, and computed Symbol iterator/RegExp/species properties.
  Saved definitions retain the complete program and editable inputs. Abstract
  clauses without their own fixture remain inspection-only.
- [ ] Run dialog, open/close it and use Escape. Change CSS display and confirm
  computed output changes. Change Array.prototype.at arguments from `[0]` to
  `[2]`; the result changes from 1 to 4. Save example template, follow its Thing
  link, edit its complete program and reuse it as a Builder component.
- [ ] Edit the live program to an infinite loop. It times out within two seconds
  and the outer app remains usable. A fetch to the app/API is blocked; opening
  the runtime directly still has its opaque-origin CSP. Raw source, dynamic
  evaluation, script/iframe tags, event-handler attributes and input patterns
  do not execute in the account document. Stop removes the frame and worker.
  Worker startup has a separate ten-second bound; the two-second execution
  clock begins only after readiness. A slow start must not be labelled a
  runaway program, and repeated ready messages cannot extend execution.
- [ ] Switch account/component and verify inputs, draft and result reset. At
  desktop and 390px inspect navigation, search, detail, editable program and
  results through the footer: no horizontal overflow, clipping or overlap.
  Inspect runtime support separately from published/draft status. Inspection
  and context-dependent entries must remain labelled as incomplete demos.
- [ ] Run schemas, action packs, actions, components, webpages, capability and
  Web Platform suites; build client/server and verify Vercel runtime assets/CSP.
  Exercise the bundled server API too: JSON inventory initialization must not
  silently vanish from Nitro's lazy module initialization.

### Edited Web Platform drafts and JSON Action inputs (2026-09-24)

- Change a workbench definition and its inputs, including false, zero, empty
  text, null, nested arrays and literal `{name}` / `$input.name` text. Run it,
  save the edited Component, read the exact Thing, reload its Component preview
  and reuse it in Builder. Definition, defaults and results must match.
- Enter invalid program/input JSON and click Save: show a form error and make
  no save request. Correct it and save once; one private Component is created.
- Edit parameter defaults/types and remove a parameter: stale form overrides
  must not reappear or replace the new defaults. Check desktop and 390px widths.
- Create a JSON-input Action in the guided editor and inspect/run it. JSON
  strings are literal at the API; form JSON is decoded exactly once. Verify
  omitted defaults, explicit null and nested Action calls. Oversized resolved
  defaults/child inputs refuse before executing; anonymous reads stay denied.


### Authored form pending state and dialog close content (2026-09-27)

- [ ] Bind a control to page.id on a live page and in Builder; after copying
  the page, the copied control must identify its new page. No page operation
  may bypass API ownership/ACL checks.

- [ ] During a saved Action, bind tt-form disabled and its save label to pending.
  Fields pause and show the authored saving label, then re-enable on success,
  failure, or cancelled confirmation. Preserve failed drafts and existing
  identity/revision. Navigate while pending; completion must not mark the new
  screen busy or clear its pending state. A sibling Component remains usable.
- [ ] Render a custom close SVG and accessible label in tt-dialog. Verify mouse
  dismissal and Escape at desktop/390px; unsafe SVG/HTML event props stay inert.

### Live Web Platform form contexts (2026-09-27)

- Run `liveFormFixtures.ts` programs in the real served opaque runtime. Edit all
  four reset controls, click the button named `reset`, and confirm authored
  defaults return. Also use named controls `addEventListener` and `id`: native
  binding and event target identity must survive property shadowing.
- Request submission with the required input empty: observe `invalid` and
  `valueMissing`, with no submit event. Type a value and request again: the real
  canceled submit event names the referenced `send` button. Clicking the second
  submit button instead reports `publish`. Check/reportValidity return false
  before valid editing and true afterward; the document never navigates.
- Type a partial number (`-`) for `badInput`, a short string for `tooShort`, and
  type a long string before applying a smaller maxlength for `tooLong`. Inspect
  the actual input/invalid event's native validity flags. Correct each input and
  check again; flags clear. Change length parameters and repeat.
- Refuse missing/out-of-surface element arguments, unregistered methods,
  malformed observation bindings and immediate method errors without a later
  success overwriting the error, including programs that also contain worker
  steps. Register observers before immediate calls.
  After more than ten observations only ten receipts remain; repeated event
  dispatch reaches the 200-event limit without recursive runaway.
- Confirm form context is opt-in on the Component iframe and that Vite, built
  Vercel output and hosted runtime CSP retain an opaque origin, network refusal
  and `form-action 'none'`. No same-origin, popup or top-navigation grant. An
  ordinary document program without form context retains `allow-scripts` only.
- Save edited requestSubmit/reset programs through the canonical API and the
  workbench, reopen/reload and reuse on a Builder page. Context, event bindings,
  element arguments and defaults persist exactly; anonymous reads return 404.

### Authored native menus (2026-09-27)

- Open a saved tt-menu at desktop and 390px near a viewport edge. Its popup
  must stay inside the viewport without resizing the surrounding card/grid.
  Edit its trigger SVG and item styles; scoped colors and spacing still apply.
- Arrow keys, Home/End and typing move among enabled items; Space/Enter activate.
  Escape restores trigger focus. Clicking outside or opening another menu closes
  the old menu. A disabled/inert trigger cannot open or dispatch an Action.
- Choose a saved Action and an app link; they keep the same Component runtime,
  form boundary and page identity. Open a tt-dialog from a menu: the menu closes,
  the modal stays visible, its Action still works, and dismissal restores focus.
  Test nested menu dialogs again after rerender/navigation and in Builder view.
- Bind closeDisabled to pending in a menu dialog. During a delayed save, Close
  and Escape cannot dismiss it; success still closes it. With two closed sibling
  dialogs sharing that Action, only the open dialog may restore trigger focus.

- Type text and spaces in a dialog opened from a menu: menu keyboard handling must not intercept modal input or move its focus.
### Web Platform ECMAScript receivers (2026-09-27)

- Run the receiver/prototype programs in the served opaque browser runtime.
  DataView edited endianness changes the actual backing bytes; a BigInt above
  Number precision round-trips exactly, and invalid byte offsets return errors.
- Iterator map/filter callbacks remain lazy until consumption; find/every/some
  stop early. Compare the remaining original iterator. Empty reduce uses its
  initial value; negative take/drop limits return native errors.
- WeakMap keys retain identity after editing their fields; an equal-looking
  second object is absent. getOrInsertComputed runs its callback only for a
  missing key. WeakRef/FinalizationRegistry examples must never assert GC timing.
- Promise finally preserves fulfillment/rejection unless cleanup throws. Bound
  functions preserve their receiver despite a subsequent call receiver override.
- Edit a prototype's inherited label and an error's instance name. Only fresh
  per-run objects change; native prototype relationships and defaults remain.
  Async/generator constructor examples invoke the corresponding function family.
- Save edited DataView, iterator, Promise and prototype Components, read them
  back through the canonical API and reopen/reload their previews. Programs,
  edited defaults and behavior survive; anonymous reads remain denied. Missing
  native members and SharedArrayBuffer report unsupported in their actual context.

- Constructor allocation limits: numeric, numeric-string and array-like DataView backing inputs above 4096 reject with an explicit demo-limit error; small numeric buffers still zero-initialize and null preserves native conversion. Oversized iterator materialization also rejects before iteration.


### Web standards binding and assignment patterns

- Edit object and nested-array destructuring demos: defaults run only for
  undefined, null stays null, elisions skip values, nested defaults and rest
  preserve native results. Object/array assignment retains RHS identity.
- Verify computed keys, renamed bindings, own enumerable symbol rest keys,
  getter order, inherited/hidden exclusions and partial assignment on failure.
  Older engines may read an excluded getter twice; preserve and flag that
  native discrepancy instead of substituting a passing result.
- Test pattern declarations, ordinary/arrow/async/generator parameters,
  destructured rest parameters, class methods, catches and all loop kinds.
  Compare let/const closures with shared var and assignment loop targets.
- A trailing array-pattern elision must consume its position; empty and partial
  patterns must perform native iterator cleanup, including initializer errors.
- Reject malformed/defaulted rest targets, assignment references in binding
  contexts, optional targets, compound destructuring assignment, code-fragment
  identifiers and patterns exceeding shared depth/size/node budgets.
- Save an edited pattern Component, reopen and reload it, and run with the
  persisted inputs. Owner read succeeds; anonymous read remains 404. Confirm
  both capability manifests advertise actions-run 1.19.0 and the served runtime
  hash matches the current compiler while retaining the sandbox CSP.


### Web IDL option dictionaries and callbacks

- Edit EventInit/CustomEventInit defaults and verify native boolean conversion,
  cancelable dispatch and arbitrary detail. Callback objects receive their own
  this; once, passive, capture-matched removal and AbortSignal lifetime affect
  actual delivery. Retain native engine differences.
- Construct Blob/File values with MIME, line endings and lastModified options;
  inspect real bytes and timestamp values. Construct Request/Response metadata
  with normalized headers/body, native enum/method/status errors and a following
  AbortSignal. Record engines that ignore window or differ in error types. These examples must never send a network request.
- Split multi-byte decoding across calls; compare stream, fatal and ignoreBOM.
  Exercise every geometry dictionary field in a browser, omitted defaults,
  inconsistent matrix aliases/is2D and negative rectangle dimensions.
- Observe native queue desiredSize and size callbacks, pipe preventClose,
  preventAbort/preventCancel and signals; verify locks release after settlement.
  Compare default/BYOB readers, detached supplied views and min validation.
- Exercise source/sink/transformer callbacks, auto-allocation, ordered writes,
  backpressure, flush and cancellation. Missing Transformer.cancel must report
  unsupported. Reserved stream types must expose their native rejection.
- Numeric strings must not bypass the 4096-byte allocation limit. Reject numeric
  or array-like byte lengths and overlong chunk lists before allocating/looping.
- Edit a stream options Component, save/reopen/reload/run, verify its inputs and
  full saved callbacks remain intact, and confirm anonymous read remains 404.
  Run the real local API round-trip separately from the opt-in test skip.
- Check both capability manifests for actions-run 1.20.0 and verify exact hosted
  source, runtime artifact and isolated CSP before production delivery.


### Web Standards live event bindings (2026-09-27)

- Run `npm --prefix remix run test:web-platform` and `test:api-capabilities`.
  Compile all 107 live event examples and preserve edited boolean input references
  through the actual Component API/save-draft path; anonymous reads must be 404.
- In the live opaque frame, verify capture -> selected handler -> later listener
  -> ancestor bubble ordering; stopPropagation retains the sibling listener and
  stopImmediatePropagation removes it. `once` runs once; passive cancellation has
  no effect. Native IDL replacement removes the old handler.
- Return false from a native on-handler with real pointer input and verify
  `defaultPreventedAfterDispatch` becomes true. Microtasks can run before native
  return-value processing, so do not treat an in-handler receipt as final.
- Verify real typing/selection, required-form invalid/submit/reset, dialog
  requestClose cancellation, popover state, scroll, drag/drop, command invokers,
  local image load/error and CSS animation/transition lifecycle receipts.
- Exhaust the event budget with repeated native clicks and multiple listeners. Expect one terminal
  error, no outer method result replacing it, and no surviving program listeners.
  Partial setup failure/unsupported operations also stop their prior bindings.
- Save an edited event program as a private Component, reopen/reload/run it,
  compare owner-visible program data, and verify anonymous API access is 404.
- Check desktop/mobile preview layout and confirm both capability manifests show
  actions-run 1.21.0 plus the exact runtime asset hash before and after promotion.


### Web Standards native media programs (2026-09-27)

- Compile all media programs with `test:web-platform`, run both capability
  manifests, and roundtrip edited numeric/boolean controls and clip bytes through
  the real catalogue/Component API and authored save-draft Action. Verify private
  owner readback and anonymous 404, then remove only exact disposable local IDs.
- Run the real opaque runtime: audio/video/source load metadata, native IDL
  lifecycle handlers, play/playing/ended/pause, seek events, speed/volume changes,
  reload/emptied and current properties. Decode both clips; inspect video quality,
  codec support, buffered/played/seekable ranges and invalid-media error state.
- Dynamic `muted` content attributes do not prove current mute state. Verify the
  explicit saved setter produces `muted: true` before playback and preserves
  false after editing. Zero volume and native out-of-range rejection both work.
- Observe actual play promise fulfillment and rejection. A later media event must
  retain the rejection, and a later pause or refused attribute write must fence
  the older promise's result.
  Reset, pagehide, unsupported setup and exhausted event budget stop old bindings
  and playback. Missing methods/properties report unsupported, never success.
- Refuse object-valued or inherited input references, wrong scalar types,
  arbitrary/readonly properties, mixed property/method grammar, external media
  sources, non-media receivers, and more than eight media nodes.
- In Builder save edited seek/speed/mute inputs, reopen/reload/run the private
  Component and verify real playback state. Check desktop and narrow mobile
  controls stay within the frame. Match source SHA, both 1.22.0 manifests,
  runtime hash and restrictive CSP on preview and production.

### Canvas program receivers (2026-09-27)

- Run all Canvas recipes in the real opaque runtime. Assert actual pixels,
  matrix values, save/restore state, width-reset transparency and native radius
  exceptions. Explicitly verify a 24px font reads back as 24px and paints/measures
  text; a detached Document's ignored font write is not successful coverage.
- Verify Path2D self-addition and copies cannot grow exponentially past the
  path budget; negative/oversized ImageData dimensions, inferred tall pixel
  arrays, five canvases, oversized bitmap edges, filters with URLs, relative or
  oversized fonts and foreign handles are refused before expensive work.
- Surface handles must refuse parent/runtime-document access and root removal;
  surface and detached contexts cannot mix. Run existing DOM/form boundary
  fixtures to preserve detached ownership, clobber defenses and node budgets.
- Native context outputs may contain extra browser fields; project the published
  settings while still rejecting unknown author inputs. Missing text metrics
  remain explicitly unsupported. No account, network or iframe permission grows.
- Edit gradient colours/stop, save through the authored Action, reopen, reload
  and run the private Component; verify the native pixel and preserved inputs.
  Repeat on production @lopu after matching source, runtime hash and both
  actions-run 1.23.0 manifests. Anonymous reads must return 404.
- Inspect desktop/mobile drawings and controls for overflow. Confirm completed
  drawings remain visible, Stop clears the frame, and repeated Run starts fresh.

### SVG program receivers (2026-09-27)

- Run all SVG recipes in the opaque browser runtime; assert native namespaces,
  geometry, text metrics, unit conversion, readonly animated-value exceptions,
  transform matrices, native factories and primitive IDL constants.
- Bbox option support must change native measurements on fixed filled, stroked,
  marked and clipped geometry. Silently ignored dictionary fields are unsupported,
  even when getBBox returns successfully. Input edits cannot alter the support probe.
- Refuse external references/paint, executable attributes, foreignObject, surface
  escape/removal, 129 SVG nodes, 33 list items and oversized initial/live/nested
  viewport writes. Compact signed coordinates and newline-separated language
  lists must not bypass the initial list limit. Unit conversion retains physical
  viewport dimensions; tolerate native float precision when checking conversions.
- Primitive constants must cross the normal worker transport without exposing
  constructors or invoking accessors. Run the existing Canvas and DOM/form
  boundary fixtures to retain context and ownership restrictions.
- Edit colour, shape width and rotation, save through the authored Action, reopen,
  reload and run the private Component. Compare preserved inputs and native angle/
  matrix output. Anonymous reads return 404. Check desktop and 390px layout,
  retained completed drawings, Stop cleanup and fresh repeated Run.
- Verify exact preview/main deployment source, runtime hash, unchanged restrictive
  CSP and both actions-run 1.24.0 manifests before production @lopu save/reload.

### SVG filter programs (2026-09-27)

- Run every filter recipe and svgFilterBoundaryFixtures through the opaque runtime.
  Compare original/filtered output for each primitive, including PNG image/tiling,
  alpha transfer, convolution, lighting and turbulence. Native paired blur,
  Boolean, integer, string, region and list mutations must return real values.
  Literal SVG Boolean attributes serialize true/false, unlike HTML presence flags.
- Refuse excessive blur, radius, octaves, convolution order/list values, regions,
  filter/node counts, relative unit mutation and external/non-PNG image data.
  Detached native number insertion cannot bypass its destination filter limit.
  Malformed repeated numeric input must reject without regex backtracking.
- Run existing SVG/Canvas/DOM/form fixtures. Filter ownership checks must not call
  Element accessors on Document, text or other non-element receivers.
- Edit colour and X/Y blur, save a private Component through the authored Action,
  reopen/reload/run and verify persisted defaults plus native output. Anonymous
  reads return 404. Check desktop/390px, retained drawing, Stop and fresh Run.
- Verify preview/main deployment source, runtime digest, unchanged restrictive CSP
  and both actions-run 1.25.0 manifests. Missing browser members report unsupported.

### CSS function comparisons (2026-09-27)

- Run every function and published-value recipe with default and edited inputs.
  Supported edits must change native computed output. Compare visible controls,
  3D perspective, grid tracks, shape clipping, paused easing progress, anchor
  geometry and nested generated counters. Unsupported syntax must retain an
  honest native fallback rather than a manufactured result.
- Run cssProbeBoundaryFixtures: arithmetic, parameterized property/target,
  accepted missing-variable syntax, rejected declarations, pseudo-element reads,
  scoped comparison, missing targets, closed pseudo-element vocabulary and
  field limits before/after substitution. Named form controls cannot shadow the
  native geometry method. Legacy syntax-only programs without #sample retain
  their null computed result. CSS.supports(true) is not visual proof.
- Published-value aliases retain interactive coverage. The paged-media element()
  must not accidentally receive the same-name image function's implementation.
- Round-trip edited programs through catalogue, private Thing storage and the
  authored save-draft Action. Save/reopen/reload/run an edited width expression,
  verify its native pixel result, and confirm anonymous reads return 404.
- Check desktop/390px controls, page overflow, retained completed output, Stop
  frame removal and fresh Run. Run prior SVG/filter/Canvas/DOM/form regressions.
- Match exact preview/production source, runtime digest, restrictive CSP and both
  actions-run 1.26.0 manifests before production @lopu verification.

### Web standards: CSS Typed OM

- Run all 249 Typed OM programs with their default and edited input sets; verify
  the native value/selected member changes where supported. Missing colour APIs
  must report unsupported rather than a fabricated result. Exercise real unit
  conversion, dimensional records, matrix output and visible transforms.
- Run `typedCSSBoundaryFixtures.ts`: one-inch conversion yields 96px, scoped
  map writes affect the sample, constructed rule maps remain editable, computed
  maps refuse writes, and foreign handles, static namespace escapes, invalid
  input types, stylesheet imports and excessive expression composition fail.
- Native style-map iteration must fit the existing request budget; declared-map
  iteration demonstrates its real entries without traversing every computed
  property. Re-run CSS/function, SVG/filter, Canvas, DOM and form regressions.
- Save an edited transform through Builder, open its private Component, fully
  reload and run it. Verify the authored amount survives and the computed
  transform matches it. Check anonymous API denial, Stop/fresh Run, desktop and
  narrow preview rendering. Keep the program editable and reusable on another
  Builder page through normal Component references.


### Web standards: CSS Object Model

- Run all 102 CSSOM programs with default and edited inputs. Compare native
  declaration values/priorities, rule lists and computed styles. CSSRule.cssText
  remains its specified no-op; imported sheets can raise native SecurityError.
  Missing page descriptors and ignored baseURL options report unsupported.
- Run cssomBoundaryFixtures: awaited replace returns its native sheet, grouping
  rules retain parent identity, adopted sheets affect the owned sample, computed
  declarations reject writes, and escaped selectors find their actual element.
  Refuse foreign sheets, runtime-document access through a shadow host, root
  attachment outside the owned sample, closed roots, excessive nested/cumulative
  rules, text and adopted sheets. Window.open and constructor escape stay closed.
- The complete authored adoption recipe must compute 120px/180px for its
  default/edited inputs; outer sample styles must not override shadow styles.
- Stop or deadline during pending native replacement must prevent late replies
  from reviving the worker. A native rejection ends cleanly with one cleanup.
- Round-trip edited CSSOM programs through the catalogue Action and private
  Thing APIs. Save an edited adopted stylesheet in the workbench, fully reload
  and run the saved Component, reuse it on a separate Builder page, check the
  computed width, anonymous 404, Stop/fresh Run and desktop/390px overflow.
- Re-run Typed OM, CSS, SVG/filter, Canvas, DOM and form browser regressions;
  match runtime digest, restrictive CSP and both actions-run 1.28 manifests on
  exact preview/main deployments before calling production @lopu delivered.


### Web standards: layout and Geometry (2026-09-27)

- Run all 130 CSSOM View and 19 remaining Geometry examples with default and
  edited inputs. Compare native rectangles, scroll positions, caret hits, range
  rectangles, quad points/bounds, matrix values and media-query matching.
  Read-only screen metrics and iframe move/resize restrictions stay explicit.
- Await native scroll completion, including engines returning an interrupted
  dictionary. Stop/deadline must discard late results. Native WebIDL mixin
  accessors may live on unnamed prototype layers: capture registered names
  through the native chain without reading shadowing instance properties.
- Run layoutBoundaryFixtures: refuse runtime/parent/global escapes, outside
  hit-test nodes, foreign shadow roots, malformed options, unbounded geometry
  and unrelated surface mutations. An initial Range cannot expose its runtime
  document. Owned shadow-root contents support scoped caret testing.
- Observe real mouse/viewport events; dispatch an explicitly synthetic media
  query event and verify isTrusted=false. Remove the exact legacy callback,
  dispatch again and verify no further receipt; Stop releases handlers.
- Round-trip edited programs through the catalogue Action and private Things.
  Save/reload/run a scroll Component, reuse its reference on another page, and
  verify native offsets, anonymous 404, Stop/fresh Run and desktop/390px layout.
- Run existing CSSOM/Typed OM/CSS/SVG/filter/Canvas/DOM/form regressions. Match
  preview/main source SHA, runtime digest, restrictive CSP and both actions-run
  1.29.0 manifests before production @lopu delivery.

### Web standards: native observer programs (2026-09-27)

- Run all 81 Mutation/Resize/Intersection Observer programs with default and
  edited options. Verify actual native callback records, projected fields and
  changed output. An unavailable IntersectionObserverEntry constructor or
  callback field reports unsupported, never a fabricated successful result.
- Run observerBoundaryFixtures: takeRecords drains five queued mutations before
  callback delivery; disconnect clears the next queue; oldValue and receiver
  identity match the native records. Resize/intersection unobserve/disconnect
  must suppress later changes. Resize box selection responds to border changes.
- Reject foreign targets/roots, unregistered callbacks, observer/callback
  allocation overflow, invalid options, nested batches and async operations in
  a synchronous batch. A rejected async command must not have been invoked.
  Callback exceptions end the run; Stop/deadline disconnect resources, discard
  late callbacks and keep the outer app responsive.
- Round-trip edited programs through the catalogue Action and private Things
  API. Save in the actual workbench, reopen, fully reload and run the saved
  Component, then reference it from a second private page. Verify anonymous
  404, Stop/fresh Run, and desktop/390px layout without horizontal overflow.
- Run existing native DOM/form/Canvas/SVG/CSS/Typed OM/CSSOM/layout regressions,
  compiler/protocol and capability tests. Both manifests and the client require
  actions-run 1.30.0. Verify the built runtime hash and deployed commit before
  claiming preview or production delivery.

### Web standards: native range programs (2026-09-27)

- Run all 40 added live/static range recipes with default and edited input.
  Observe actual native text, cloned/extracted fragments, wrapper markup,
  comparisons, boundary nodes and offsets. Static offsets stay fixed while
  a live range follows inserted text. Preserve existing surface geometry demos.
- Run rangeBoundaryFixtures: native IndexSizeError stays catchable; cloned
  ranges remain independent; extraction moves text. Reject initial runtime
  document access, selecting the surface root's parent, surface tree edits,
  foreign handles and unknown StaticRangeInit fields. Concrete prototype-chain
  getters must work when AbstractRange has no own boundary accessors.
- Reject fragment scripts, resources, attributes, foreign content, malformed
  tags and token/text overflow before native parsing. Escaped markup remains
  inert text. Reuse the existing worker deadline, node/work/handle budgets.
- Round-trip edited programs through the catalogue Action and private Things.
  Save/reload/run in the actual workbench, reference the saved Component from
  another private page, check anonymous 404, Stop/fresh Run and 390px overflow.
- Run compiler, capability, schema, Action, Component and page tests; native
  DOM/layout regressions; build/typecheck. Verify both actions-run 1.31.0
  manifests, deployed source SHA and runtime digest before production delivery.

### Web standards: native animation programs (2026-09-27)

- Run all 111 animation programs with default and edited keyframes/timing. Check
  real interpolation and computed styles, playback state, ready/finished
  promises, changing targets/timelines, native keyframe copies and query results.
- Run animationBoundaryFixtures. Check exact half-way interpolation, clone
  timing independence, trusted finish/cancel/remove events, native handler `this`
  identity and shadow queries.
  Actual native keyframe errors remain catchable. Refuse foreign effect/target/
  timeline handles, unsupported option fields, excess objects/keyframes/values,
  forged callbacks and asynchronous reads in synchronous DOM batches.
- Detect ignored getAnimations pseudoElement filters with a real pseudo-effect;
  report unsupported instead of presenting an unfiltered result as a success.
  Draft iterationComposite/startTime support must remain honestly reported.
  Native Event.isTrusted own accessors must distinguish constructed from trusted
  playback events. Pseudo-element samples must not invoke commitStyles.
- Edit JSON inputs and save in Builder. Fully reload the private Component,
  run its edited definition, reference it from a second private page and confirm
  the same native result. Verify anonymous reads return 404, Stop removes its
  frame, a fresh Run works, and 390px editing/results do not overflow the page.
- Run platform/compiler, capability, schema, Action, Component and page tests;
  the broader DOM/CSS/SVG/observer/range native audit; lint, build and typecheck.
  Verify both 1.32.0 manifests, exact deployed source and runtime hash in preview
  and production before claiming delivery. Clean up disposable local fixtures.


### Timeline large Thing regression

- Grow a valid data Thing past 2 MiB through requests below the ordinary body cap.
  It must still shrink, update, restore supported content and delete successfully.
- Verify full retained reconstruction, including escaped text and Unicode crossing
  part boundaries. Missing/altered/foreign parts must refuse reconstruction.
- History pages stay within their response budget; no part payload or credential
  is exposed by generic Things reads/search. Generic part edits/deletes refuse.
- Account bytes include retained large content exactly once. Deletion transfers
  the same logical bytes into history rather than charging the part envelopes.

### Web standards: native ARIA object programs (2026-09-27)

- Run every ARIAMixin program with default and edited values/references. Compare
  actual native property assignment with attribute reflection; clear values with
  null. Unsupported native properties must remain explicit.
- Run ariaBoundaryFixtures: null versus empty relationship lists, string false
  versus null, stable element/cached-array identity, immutable native FrozenArray,
  old snapshots after attribute reset, shadow ancestry, wrong/foreign handles,
  64-reference bounds, detached relationship refusal and resource-attribute denial.
- Save an edited relationship Component, fully reload and run it, then reuse that
  same Component on a second private Builder page. Check anonymous reads return
  404, Stop removes the frame and a fresh Run restores the edited result.
- Check 390px and desktop inputs/results, and both animation tiles after the
  stage height fix. Saved user definitions must remain untouched by catalogue updates.
- Run platform, capability, schema, Action, Component and page suites, native
  regression audit, lint, typecheck comparison and production build. Verify both
  1.33.0 manifests and exact deployed runtime in preview and production.

## Public schema copies, durable chat files and Lopu instructions (2026-09-27)

- [ ] Run `test:schemas`, `test:migrations`, `test:components`,
      `test:attachments`, `test:lopu`, `test:lopu-chat-streaming`,
      `test:lopu-streaming`, `test:lopu-ui` and `test:api-capabilities`.
- [ ] Seed through `backfill-user-storage-accounting`; anonymously read every
      `schema-<id>` from the registry. Copy Post, a collection/root schema and a
      user schema; preserve nested fields, enum constraints, bounded JSON,
      render and `forkOf`. Extend the copy and create an ordinary private Thing.
      Copies never acquire protected native write powers or mutate the source.
- [ ] On a real local upload form, choose an actual file, wait for Ready,
      click Use file and submit. No invalid Post type, reserved `component-` ID or unfinished-file error;
      both content URL and attachment ID persist in the returned Thing. Repeat
      desktop/mobile, retry a failed commit, and deny anonymous file access.
- [ ] Run `scripts/verify-schema-files.ts` using the isolated setup in README.
      Save a chat photo to a folder and a Product property, retry the same tool
      identity (same file), delete the source chat and compare exact saved bytes.
      Reject foreign, blocked/pending, linked-only and unapproved sources.
      Moderation updating a fresh copy must not prevent transactional placement.
- [ ] In Settings → Lopu, add/edit/remove instructions, toggle one off, save and
      reload. Only enabled entries reach the next provider request. An admin
      edit of the base prompt appears in the public viewer and the next chat,
      voice, musing and recording-analysis request. Start a new direct voice
      session to receive a changed prompt. Check desktop and 390px layouts.
- [ ] Ordinary users cannot edit shared guidance or write another account's
      instructions. Guests/service accounts cannot read private instructions.
      Stale revisions return 409; drafts survive background refresh and failed
      saves. Account switching never displays or sends the previous list.
      Custom instructions cannot replace server permissions or Confirm cards.
- [ ] Generate the Xcode project and build the iOS simulator target. Web and
      native direct voice require voice-session 1.2.0 and use its instructions.

### PR #954 integration regressions

- [ ] In Ask before running mode, saving a chat attachment and extending a Schema show a real Confirm card before writing. Full access permits the same tools; scheduled read-only work still refuses them.
- [ ] Retry a private file save as the first request finishes: retain the completed independent file. Reject mismatched retry metadata without deleting that file; cleanup claims must not cross pending-to-ready finalization.
- [ ] Verify all current registry kinds, including Timeline definitions, appear in the public Schema projection and pass the ordinary Schema validator.
### Web standards: reusable native XPath objects (2026-09-27)

- Run all 30 XPath entries with default and edited programs; assert actual scalar,
  ordered node, iterator and snapshot results, not just successful execution.
- Verify Document, constructed evaluator and compiled expression paths, optional
  arguments/result reuse, namespace maps, Node resolver identity and nullable
  prefix lookup. Keep wrong-type, malformed-expression and unresolved-prefix
  exceptions native; compare unknown numeric result types with the same browser.
- Remove a snapshot node and verify its retained identity/length. Mutate an
  iterator's tree and verify invalidIteratorState and native InvalidStateError.
- Reject surface/scalar escapes, foreign/fabricated contexts, wrong result
  handles and asynchronous resolver impersonation before native evaluation.
- Exercise nested predicate, traversal, actual whole-tree/text and accumulated
  compiled-query work limits. String literals containing brackets/slashes must
  not be treated as XPath traversal syntax.
- Round-trip edited Action-produced programs through private Component writes,
  assert anonymous 404s and idempotent installation, then save/reload/run in the
  Builder and reuse the same Component on another private page. Verify Stop and
  fresh Run, desktop and 390px layout, and unchanged opaque runtime CSP.
- Check both 1.34.0 manifests and exact runtime/deployment identity in preview
  and production before claiming that the new objects are live.

### Web standards: native traversal and editable synchronous callbacks (2026-09-27)

- Run all 41 entries with default and edited programs; check exact native node
  order, getter values, method results, callback identity and pointer state.
  Compare TreeWalker reject pruning with NodeIterator's skip-like rejection.
- Exercise iterator reversal and removal on both sides of its reference pointer,
  TreeWalker currentNode outside its original root but inside the owned document,
  zero-mask callback suppression, null/function/object filters, native return
  conversion and recursive-filter InvalidStateError followed by successful reuse.
- Keep callable callbacks strict in the built classic IIFE: an omitted native
  receiver must remain undefined, never become the runtime Window. Check object
  callback this, callback-thrown falsy data, native errors and nested handle identity.
- Refuse asynchronous tokens, foreign/wrong handles, prototype/global/async
  escapes, large trees and callback work/collection/depth limits. Check literal
  copies (including property-name text) and joins before allowing unbounded allocation, and catch/finally loops.
- Edit the filter's program logic itself, not only selector inputs. Round-trip
  Action-produced definitions through private Component writes, preserve all
  callback nodes, assert anonymous 404 and idempotent suite installation. Save,
  reload and Run in Builder, reuse the same saved Component on a second page,
  verify Stop/fresh Run, and inspect desktop/mobile layout.
- Run the broader native regression audit after changing the shared bridge and
  worker error transport. Verify both 1.35.0 manifests, unchanged opaque sandbox
  policy and exact runtime/deployment identity on preview and production.


### Direct Timeline branch lookup (2026-09-28)

- On the disposable replica set, run `test:timeline:branch-merge` and
  `test:timeline:home-scope` with the guarded `TIMELINE_TEST_BASE`. Lookup must
  return the exact named branch/Thing head, reflect its next accepted push,
  leave published content/history untouched, and feed an exact checkout.
- Query a missing membership, another signed-in account, stale account/source,
  duplicate selectors and mixed page/version selectors. Expect 404, 404, 409,
  and 400 respectively; anonymous reads return 401 and rate limits fail closed.
- Create the same branch and Thing ids in home and a custom database with
  different names/versions. Concurrent explicit-home and selected reads must
  remain separate and leave the surrounding selection unchanged.
- `test:timeline` additionally covers two exact owner-scoped storage lookups,
  canonical public projection, a cold local branch cache, queued push retention,
  delayed-reply revision protection and cancellation after an identity change.
  No visual Builder behavior is introduced by this increment.

## No-login draft preview and agent export

- In a clean browser, open Builder's no-login draft link; paste the affirmation
  transfer, render, edit the argument, render again, download JSON and reload.
  Confirm no login/temporary-user/API traffic, no persistence on reload, opaque
  origin storage denial, and exact text/line breaks through the real renderer.
- Call `thingtime_render_and_export` through the stdio SDK client. Save the
  inline JSON/PNG resources; validate the JSON and dependency closure. Capture
  1440×1000, 390×844, 320×844 and the first viewport's card-only crop. Check
  400×560 desktop card bounds, 24px phone margins, no overflow and stable hash.
- Reject malformed/oversized input, duplicate/ambiguous/missing references,
  unknown schema, remote CSS/assets, Actions in inactive branches, unsafe props,
  expansion exhaustion, invisible/overflowing content (including zero font size
  and transparent CSS Color 4 colors), invalid crop/viewport,
  render exceptions and overlapping requests. Failed exports return no images.
  A failed editor render retains the last good preview without allowing export.
- Run the opt-in browser tests, not only their default skip. Round-trip the
  actual exported JSON through the normal importer on the dedicated disposable
  `draftPreview` replica; allow fresh IDs, verify dependency remapping/private
  ACLs/anonymous 404, normal reexport and cleanup. Never use existing accounts.
- Keep local protocol/browser/import acceptance distinct from CI and deployed
  verification. Setup and commands: [draft workflow](docs/no-login-draft-preview.md).


## Password manager and native AutoFill

- [ ] On desktop and 390px, add two entries for one website, edit/reorder custom
  fields, mask/reveal, close/reopen and delete one without changing the other.
  The heading clears the fixed navigation and device safe area.
  Labels and controls wrap without overflow. Tab switching or a capture picker
  must mask secrets without discarding an unfinished entry.
- [ ] Upload a synthetic TOTP QR; compare rotating codes to RFC 6238 vectors.
  Screen scan uses the selected screen/tab and stops all tracks afterwards.
  Invalid images, oversized images, HOTP and FIDO handoff codes fail clearly.
- [ ] Preview/import 1Password 1PUX/CSV, Chrome CSV and Apple CSV; test quoted,
  multiline and whitespace-sensitive passwords, Unicode, custom fields, TOTP,
  cancellation, malformed ZIP and bounded expansion. Export acknowledgement
  is required; 1PUX re-import preserves complete ordered Thingtime entries.
  More than 2,000 accounts export as numbered parts that all import successfully.
- [ ] Use the HTTP fixture with two owners: session unlock, other-owner denial,
  account-switch fence, same-origin proxy handling, no-store, exact retry,
  stale revision, delete tombstones, password recovery and immediate revocation.
  Generic Thing reads/search/export and Timeline must not expose credentials.
- [ ] Native catalog contains no passwords, TOTP secrets or private keys. Reject
  scoped/temporary/service identities, unavailable vault configuration, wrong
  origin, bad body, stale session and revoked access before decrypted responses.
- [ ] Check a configured desktop endpoint against a signed native app. Ordinary
  unconfigured web servers must not forward passwords to production; desktop
  forwarding is restricted to its loopback UI and selected HTTPS endpoint.
- [ ] Managed worktrees sharing a repository basename must have distinct PM2
  names/ports; starting this checkout must not remove another checkout's stack.

- Vercel functions retain image binaries for their target CPU/OS and stay below
  the function size limit even when local dependencies include other platforms.

- Password QR capture: close/hide the editor while the picker or video is pending. The scan cancels immediately; any later stream stops before pixels are read. Blank-frame errors and playback timeouts must also stop every track.

- Password vault routes reject request-scoped internal Action actors for every operation, even if the internal request carries an Authorization header. A full browser session is required directly; internal account authority cannot substitute for it.

## Android native device pairing

- [ ] Run `android/scripts/test-mobile-devices.sh` against a disposable local
  account and a test emulator/device; inspect the installed Things card and
  Check connection round-trip, then relaunch and confirm the same device ID.
- [ ] Pause or navigate while prepare/complete is in flight; no stale bridge
  reply may reach a new page/account. Retry the saved completion without
  generating a duplicate device. Reject unsupported server capabilities.
- [ ] Cross-origin frames/documents cannot invoke pairing; cookies and node
  credentials never follow redirects. Responses and encrypted records are bounded.
- [ ] Corrupt or transplant an encrypted record to another account/origin:
  fail closed with no plaintext fallback. Verify no-backup storage and that
  native secrets do not appear in bridge replies or logs.
- [ ] Check Android system bars and keyboard at narrow and foldable widths.
  Web controls must stay inside the native inset container; WebView padding
  alone does not reliably move its rendered page away from status/navigation bars.
- [ ] Revoke then explicitly reconnect; confirm a full account and selected
  server are required. Pairing alone must not request storage/Photos permission
  or advertise background sync/continuous presence.


### File-sync verified content (2026-10-17)

- [ ] Run `test:file-sync`, `test:attachments` and `test:api-capabilities`.
  Composite multipart checksums must never compare equal to whole-file hashes;
  reject wrong part boundaries, noncanonical digests, changed object versions,
  source changes during hashing and account/root changes while reading.
- [ ] Run the README's opt-in `file-sync-fingerprint.integration.mts` against
  a disposable local upload-approved account. Check two real parts, identical
  start/complete retries, matching cloud/local fingerprints, an independent
  whole-file download hash, anonymous 404, deleted-file 404 and fixture cleanup.
- [ ] Fingerprint requests obey the existing content ACL/moderation/expiry and
  rate limits, remain private/no-store, reject image/cache variants and never
  expose storage URLs/keys/versions. Missing checksums, 404, 409, offline and
  oversized responses must preserve the current sync state, not imply deletion.
- [ ] Both compiled manifests advertise `api.attachment-content` 1.13.0.
  Full native transfers, zero-byte files, large-part streaming and production
  object-storage acceptance remain separate items in `docs/mobile-file-sync.md`.


### Stable cloud file revisions (2026-10-17)

- [ ] Run `test:files`, `test:file-sync`, `test:attachments`, `test:things`,
  `test:timeline`, `test:schemas` and `test:api-capabilities`.
- [ ] Run `file-versions.integration.mts` with the README's disposable local
  fixture. Replace real bytes while retaining the file ID, race two expected-head
  commits (one winner), replay an old operation after later edits and look up its
  original receipt. Different input under an old operation must fail.
- [ ] Verify every successful edit in the canonical Timeline; a failed append
  or accounting operation must roll back file publication and attachment binding.
  Never accept a client draft as proof that a file mutation ran.
- [ ] Live files list once; retained byte attachments and Trash stay out of the
  normal owner library. Move into a folder, reject a pre-move revision, delete
  the folder and verify reparenting/history without losing file content.
- [ ] Trash and restore through guarded commits, including an older attachment;
  independently hash both versions. Generic hard deletion and bound attachment
  cleanup must fail. Retained bytes stay charged. Verify anonymous/foreign
  refusal, blocked/linked/expired/bound upload rejection and home-plane fencing.
- [ ] Built manifests expose files 1.0.0, things 1.34.0 and bulk 1.6.0. Native
  background transfers and the version/conflict/retention UI remain in the full
  sync acceptance ledger; this backend acceptance does not substitute for them.

### Cloud sync transport and interrupted execution

- [ ] Run `test:file-sync`: close/reopen IndexedDB after an accepted commit loses
  its response; resume with the same pinned folder/file identity and confirm that
  no source is opened and no bytes are uploaded again.
- [ ] Interrupt before publication after upload completion; retry reuses the
  ready upload. Reject changed immutable journal destinations, stale revisions,
  foreign receipts, mismatched bytes, oversized responses and unsupported APIs.
- [ ] Switch account/root/origin during a request. Stop before further writes;
  verify expected-actor/data-plane headers against the real API. Signed object
  PUTs must omit cookies, account credentials and referrers.
- [ ] Run the opt-in `scripts/file-sync-cloud.integration.mts` with a disposable
  localhost account: real multipart interruption/restart, lost accepted commit,
  stable replacement, independent hashes of retained versions and executor Trash.
  Remove temporary test admin access and restart; verify the account is non-admin.


### Paged inventory storage (2026-10-18)

- [x] `inventoryJournal.test.ts`: ingest 100,000 distinct paths in bounded pages,
  reopen during ingestion and after sealing, then compare every ordered path.
  A partial capture remains unreadable and preserves the prior complete capture.
- [x] Reject missing/reordered pages, altered retries/generations, duplicate IDs,
  case/Unicode collisions and missing/file/aliased parents, including invalid
  ancestry after a committed validation page. Retrying cannot publish a prefix.
- [x] Cancel validation after one page, reopen and resume from its durable cursor.
  Check every account/origin/data-plane/root/device boundary, concurrent exact
  retries, scoped discard and migration of existing version-2 runs/checkpoints.
- [ ] Exercise the real browser IndexedDB and installed Mac/iOS adapters with
  paged source generations and the integrated planner. Native/cloud scanning,
  paged run/checkpoint execution, million-path and throughput acceptance remain
  open; the current live sync limit is still 10,000 combined paths.

## Editable file sync configuration

- [ ] Run `test:file-sync`, `test:schemas`, `test:api-capabilities` and
  `test:things`. The `file-sync` schema copies without mutating its system
  definition and accepts only its bounded typed fields; private native paths,
  URIs and credentials never enter the authored configuration.
- [ ] Run README's `file-sync-configuration.integration.mts` on a disposable
  loopback account. Verify private create/list/reload, all policy choices,
  invalid path refusal, stale-edit 409, normal cleanup and logout. Confirm the
  runtime reads the actual public `author.id` projection, rejecting other owners
  and shared audiences. View all eleven fields in `/docs/schemas#schema-file-sync`.
- [ ] After a saved configuration changes direction, destination, exclusions,
  revision, owner, origin, data plane or device, old local approval must not
  authorize a new plan. Paused/offline/unknown-network/unknown-charging conditions
  must not produce mutations. Stored configuration alone grants no access.
- [ ] Exclude a child, then delete its parent on the other replica. Keep the
  excluded child and its ancestor folder; allowed siblings may still sync.
  Apply exclusions to both inventories and baseline, and reject incomplete,
  case/Unicode-colliding or missing-ancestor scans before filtering. This
  regression prevents exclusions from turning protected descendants into
  apparent empty-folder deletions.
- [ ] Native approval persistence and policy rechecks during
  actual native transfers remain separate acceptance in `docs/mobile-file-sync.md`.


## Mobile sync connection editor

- [x] In an installed iOS WebKit app, start a real foreground transfer after
  native approval. Inventory and byte requests must retain the Window receiver
  for `fetch`; copying the function into a transport must not cause an illegal
  invocation. The editor browser fixture rejects an unrelated fetch receiver.

- [ ] Open `scripts/mobile-sync-editor.browser.html` in the local dev browser.
  Exercise the real editor/useApi with synthetic native and Things responses.
  Save all settings, reload before saving, and verify complete draft restoration,
  including whitespace-only names and unfinished invalid exclusion text.
  Backup disables deletion propagation; empty/invalid destinations/exclusions
  cannot dispatch. Repeat at desktop 1280px and mobile 390px/320px, including
  long folder names, checkbox wrapping and lower save/error controls.
- [ ] Lose the next accepted create/edit reply; readback confirms the same
  connection without a duplicate write. Go offline before saving, reload, and
  retry the fixed pending ID/payload. Retry never silently edits an uncertain
  payload. The real-API configuration integration covers both accepted reply
  losses through the same save helper, exact write counts and stale edits.
- [ ] Change the saved version elsewhere before saving. Preserve the full local
  draft, inspect saved settings without discarding it, then explicitly replace
  the draft with a freshly read saved version. Do not silently overwrite.
- [ ] Remove native access during editing: keep the saved connection and mark
  missing access. If no mutation was dispatched on the first attempt, the draft
  stays editable. Do not unlock a previously uncertain write on a failed grant
  check. A confirmed existing save can be read back without restoring the grant.
- [ ] Quota/disabled draft storage blocks HTTP dispatch. Another tab replacing
  the draft disables further edits until reload. Account/origin/device/data-plane
  changes cannot retarget a save; requests carry both guards and stale async
  completions are fenced, including React StrictMode remounts.
- [ ] Check paginated private cloud folders/connections, excluded invalid/shared
  connections, cached first paint and missing-grant labels in signed-in native
  apps. The synthetic fixture is not proof of real picker/background transfers.

- [ ] In transport fixtures, classify storage requests by parsed exact origin,
  never a URL prefix that would accept a lookalike host. CodeQL flagged the old
  test-only prefix check; production transport authorization is separate.


### Complete cloud folder inventory (2026-10-17)

- [ ] With a disposable local account, run `test:files`, `test:file-sync` and
  `scripts/file-versions.integration.mts`. Read a private root containing nested
  folders, a stable file and an ordinary note: return all folders and the exact
  live file revision/fingerprint, exclude the note and trashed files, and allow
  an explicitly complete empty subtree. Remove fixtures via normal APIs.
- [ ] Concurrent metadata edits between breadth reads must not mix versions in
  one snapshot. One query per breadth level must serve sibling folders; reject
  missing/cyclic ancestors, foreign/shared/namespaced descendants, malformed
  metadata, traversal and case/Unicode aliases without a partial result.
- [ ] Entry, depth, byte and total time limits must fail the whole scan, close
  cursors and preserve the worker's prior complete baseline. The total budget
  must also cover transaction retries. Anonymous, duplicate/mixed selectors
  and custom-storage requests must not disclose a tree.
- [ ] Change owner, origin, root, device or data plane during capability checks,
  HTTP or body streaming: cancel/refuse the observation. Abort and oversized or
  malformed replies must never become an empty successful scan. A successful
  inventory alone must not authorize a later write.


### Recoverable nested cloud uploads (2026-10-17)

- [ ] Run `test:files`, `test:file-sync` and the opt-in
  `scripts/file-sync-cloud.integration.mts` with the disposable local fixture.
  Lose the accepted parent-creation response, reopen the durable journal, then
  interrupt a multipart upload and lose its final commit reply. Resuming must
  create exactly one nested tree and preserve both independently hashed byte
  versions without rereading bytes after a confirmed commit.
- [ ] Race identical folder-create operations: return the same immutable receipt
  and charge/create once. Race different IDs using case/Unicode-equivalent names:
  one wins and the other receives 409. Reject occupied IDs, changed replay input,
  private/namespace/ancestry violations and client-authored Timeline drafts.
- [ ] Edit or delete a created folder via ordinary Things APIs: its original
  receipt must remain immutable and replay must not recreate it. Children must
  reauthorize the current destination before creation. Roll back on quota/history
  failure or filename normalization; do not run effects from aborted attempts.
- [ ] Verify new directories consume no file byte source, missing parent mappings
  fail before dispatch and original parent IDs survive IDB reopen. Folder deletion
  remains unsupported by this adapter and must not become a blind recursive
  delete. Remove acceptance folders only through normal APIs and retain accounted
  file versions in private Trash.


### Foreground mobile upload recovery (2026-10-17)

- [ ] In the synthetic mobile editor, choose an unpaused Backup connection.
  Use cellular under Wi-Fi-only policy: Upload refuses before mutation. Restore
  Wi-Fi, lose the next upload reply, reload and retry; the original folder is
  recovered once. Hold the next scan, start, Stop, reload and Retry; progress
  survives and the run completes. Verify controls at 1280, 390 and 320px.
- [ ] Run `test:file-sync`: missing/malformed native policy signals and old
  bridge versions cannot authorize transfers; v1 IDB upgrades preserve pending
  work, stale/incomplete runs cannot complete a checkpoint, and changed reviewed
  configuration stops effects. Interrupted scans must never become empty trees.
- [ ] With the disposable local account/upload setup, run
  `scripts/file-sync-foreground.integration.mts`. Lose an accepted file commit,
  reopen the journal and recover without byte reupload. Fail the completion
  checkpoint, edit local bytes, then recover the original common baseline from
  immutable receipts and replace the same file without a false cloud conflict.
  Independently hash the downloaded bytes; repeat without changes makes no PUT.
  Restore temporary env settings/restart and retain accounted Trash versions.
- [ ] Native acceptance remains separate: on iOS and Android verify paired
  conditions, real selected-file upload, revoked grant, account switch,
  background/foreground and device revocation. Do not infer native background or
  continuous network enforcement from foreground/mock acceptance.


### Android verified range reads (2026-10-17)

- [ ] Scan an 8 MiB + 17 byte fixture and read every 64 KiB range through fresh
  readers sharing scoped proofs: count exactly one file of provider bytes for
  aligned ranges, and compare independent full hashes. Verify unaligned reads
  spanning chunks. Same-size/same-timestamp changes must fail for touched chunks
  and the full pre-publication verification, including a ready-upload retry.
- [ ] Clear/evict proofs or change owner/origin/grant namespace: fall back to
  full source verification. Cancellation and incomplete streams return no bytes.
  Legacy clients must continue to get full-file checking by default.
- [ ] Run Android debug/JVM/lint and the normal emulator suite. Separately run
  optional `THINGTIME_FOLDER_UPLOAD_TEST=1` with only the documented synthetic
  picker folder and disposable upload-approved local account. Verify the actual
  Upload now control, cloud file identity and downloaded SHA-256; retain accounted
  bytes in Trash and restore temporary admin env. Generated provider tests alone
  do not prove this optional installed-app picker/upload path.


### Bounded download ranges and staged publication (2026-10-17)

- [ ] Run `test:attachments`, `test:api-capabilities` and `test:file-sync`.
  Require attachment-content 1.14.0, exact HTTP 206/ETag/Content-Range and byte
  count; reject duplicate/mixed selectors, oversized ranges, wrong versions,
  truncated/oversized storage bodies and redirects. Reauthorize after reading:
  revoked access or changed content must return no bytes.
- [ ] Run the foreground integration script with `--large-download` and the
  disposable local fixture. Read 17 MiB + 17 bytes via bounded ranges, compare
  independent whole-file SHA-256 and multipart fingerprints, deny anonymous and
  wrong-version reads, and refuse the source after cloud replacement. Restore
  temporary env/restart PM2; retain accounted versions in private Trash.
- [ ] In executor tests, stage a nested download, lose its accepted publication
  reply, reopen IndexedDB and recover without new byte reads/stages/publications.
  Local destination races, source changes, invalid stage proofs and changed
  account/origin must refuse publication. No native publisher must refuse the
  port entirely. Native platform staging/CAS/relaunch acceptance remains separate
  from these adapter tests; never enable download controls on fixture evidence.


### iOS private download staging (2026-10-17)

- [ ] Run `MobileSyncStagingTests`, `MobileFolderTests` and
  `MobileDevicePairingTests` on a concrete simulator after XcodeGen. Receive
  8 MiB + 17 bytes in bounded chunks, reopen, replay a lost acknowledgement and
  verify the full multipart hash. Inject failure after byte flush but before the
  checkpoint: resume at the acknowledged offset, discarding only the extra tail.
- [ ] Reject changed immutable operations, foreign owner/origin, gaps, oversized
  chunks, altered replay bytes, checksum mismatch, symlinks and corrupted finished
  stages. Empty files/folders retain the shared JSON shape, including explicit
  null `sha256`; completed stages are reverified before reuse.
- [ ] Exercise actual WebKit capability injection and native handler dispatch
  through an owned synthetic bookmark. Verify injected and ready-event file access
  versions both use 1.1.1. Require owner checks before and after each
  request and an untouched selected folder. This synthetic authentication test
  must not be reported as cloud/native or OS-picker acceptance.
- [ ] Run `test:file-sync`: missing/breaking staging capability, malformed native
  progress/proofs, changed source and cancellation fail closed. Reopen after a lost
  native chunk reply without writing acknowledged bytes again. Rebuild/install
  the final simulator app, verify its binary and launch/render it. Native write
  approval, publication CAS/retained conflicts and process-kill recovery still
  require their own acceptance before enabling downloads.


### iOS approved download publication (2026-10-17)

- [x] Run selected native staging/folder/pairing tests: same-volume absent-file,
  empty-directory and replacement publication; retained original bytes; reopen
  after rename before receipt; immutable receipt after a later local edit;
  expected-target mismatch, symlink escape and an uncoordinated final-check race.
  A raced edit must remain retained and pending, never receive a success receipt.
- [x] Native picker grants start read-only. Verify missing write approval refuses
  actual WK bridge publication; explicit synthetic consent permits only the
  matching scope/settings/grant. Settings/revision changes, reselect and removal
  invalidate consent. These tests do not substitute for a real consent click.
- [x] Run `test:file-sync`: negotiate publication capability separately, reject
  forged receipts/approval bindings, recover lost native replies and failed
  baseline checkpoint writes using the original operation, preserve later edits
  and refuse download deletion propagation.
- [ ] In the authenticated installed iOS app, choose a disposable Files folder,
  save a download connection, cancel then approve the native dialog, download
  nested real cloud bytes and compare independent hashes. Edit settings/reselect
  the folder and require renewed consent. Check narrow and wide layouts.
- [ ] Kill/relaunch after native rename but before receipt persistence; recover
  without repeating swap. Edit before recovery and verify pending conflict plus
  both retained versions. Test local/iCloud/third-party providers, offline,
  protected storage locked, low disk space and physical devices. Unsupported
  providers must preserve both sides. Add conflict resolution/restore acceptance
  before describing these pending cases as automatic convergence.


### Installed iOS download acceptance and real process exit (2026-10-17)

- [x] In iPhone 17 Pro / iOS 26.5, pair through Things, choose only the empty
  acceptance folder in Files, save an unpaused download connection with deletion
  propagation off, cancel then approve the real native dialog. Cancellation
  leaves the folder empty. Download nested real cloud files, independently verify
  17-byte and 8 MiB + 17-byte SHA-256 values, repeat, then replace the cloud binary
  with 8 MiB + 31 bytes. Verify the replacement hash, retained original hash/inode
  and unchanged file inode/mtime. Relaunch retains completed progress.
- [x] Deliberately exit the native test host after rename but before receipt;
  recover in a different process for create, replace and edit-before-recovery.
  The last case remains pending and retains both versions. This is process-exit
  evidence, not reboot or physical storage-power-loss evidence.
- [x] After the polling/cancellation fix, repeat native cancellation and retry
  while periodic device status refresh runs. No "another device request" error
  should interrupt the transfer; cancellation must not imply lost folder access.
- [x] Edit the saved connection name/revision and require new native approval;
  cancel, retry and approve in build 33, then complete the transfer.
- [ ] Re-select the folder and require renewed native approval. Check wide
  layouts and physical/iCloud/third-party providers separately.

### Android private download staging (2026-10-17)

- [x] Run JVM contract tests and `SyncStagingTest` on Android 15 / API 35:
  canonical multipart bytes, short tail, empty files/folders, explicit null
  digest fields, reopen/replay, incomplete progress, changed immutable bindings,
  foreign scopes, bad paths, oversized/gapped/altered chunks, corrupt checkpoints
  and modified completed stages. Verify private symlink/directory/FIFO refusal;
  hard links must be refused either by Android's platform policy or staging.
- [x] Hold a writer after fsync and cancel a waiting caller. Assert only one
  native lock descriptor exists before/after cancellation and the writer can
  complete. Repeated successful calls must not leak private file descriptors.
- [x] Run `android/scripts/test-mobile-staging-process.sh`: kill the actual
  test host after payload fsync before progress save, then after finished-stage
  save. Fresh-process verification must reuse the original operation, discard
  only the unacknowledged tail, preserve the completed proof, verify all
  8 MiB + 17 bytes, and pass the production shared TypeScript codec.
- [x] On the authenticated installed WebView, assert staging capability is
  present and publication capability is absent. Send a full 64 KiB base64 chunk
  envelope for an unregistered grant and require the native permission error,
  without a private URI in the response or a transport timeout.
- [ ] Through the installed Android app's real picker, verify stage dispatch
  with an actual account/grant, changed account, revoked grant, navigation and
  cancellation. No private URI/path may appear in responses. Private staging
  must leave the selected folder untouched and must not enable Download now.
- [ ] Verify Android 8.0 compatibility on a supported runtime, low-disk failure,
  reboot and physical storage behavior. Implement and separately verify native
  write consent, publication recovery/retained conflicts and provider writes
  before claiming Android download acceptance.

### Android native write approval (2026-10-17)

- [x] Registry tests: same-URI re-selection during consent rejects the old
  generation; changed owner/site/root/device/revision/hash cannot reuse approval.
  Limit approvals to 32 per selection and replace revisions within one scope.
- [x] Failed approval saves release only newly acquired write access. Removing
  an approved account preserves another approved account; removing the final
  approval releases write access while preserving remaining read references.
  OS write revocation must invalidate a saved approval. Reacquiring the OS grant
  for one connection must not reactivate other accounts or connections.
- [x] Run `THINGTIME_FOLDER_APPROVAL_TEST=1` with the disposable picker fixture.
  In the installed app, Cancel must save no approval, Continue to Files must
  require the exact folder and OS write grant, identical retry must return
  without another prompt, and a changed revision must require fresh consent.
  Re-selection clears approval and unused OS write permission. Responses must
  contain no private URI. Publication capability must remain absent.
- [x] Run the optional directory-descriptor probe on Android 15 local storage:
  directory opens, but relative child access fails `EACCES`. Do not infer atomic
  rename support or scoped-storage bypass from a readable directory descriptor.
- [ ] Verify wrong-folder and revoked-picker results, background/navigation
  during consent, Android 8.0 runtime, physical/third-party providers and
  process/reboot recovery before claiming full native write acceptance.

### Android offline-folder publication backend (2026-10-17)

- [x] Verify nested folders and an 8 MiB + 17-byte multipart file through real
  native staging/publication; scan, ranged read and retry must preserve content
  and the immutable receipt. Ancestor versions must change with descendants.
- [x] Replace conditionally, verify retained original bytes/version, then replay
  an older receipt after a later edit. Replay must not overwrite current bytes.
- [x] Reject stale target versions, case aliases, missing parents, foreign
  account/site/root, changed operations, forged stages and changed source bytes.
  Corrupt or symlinked blobs must fail scans/reads and target preconditions.
- [x] Race two creates and require one file / one receipt. Throw before commit
  and after commit: recovery must distinguish rollback from accepted-response
  loss, never expose a partial entry or delete an uncertain candidate.
- [x] The native stage-copy callback receives a read-only descriptor; changing
  its underlying source during copy must fail final stage verification.
- [x] Run `android/scripts/test-mobile-managed-process.sh` on a disposable
  Android 15 emulator: actual process kills before/after commit and after
  replacement; verify from a fresh process and validate native receipts with
  the production TypeScript codec. Keep the run-ID proof on failure.
- [ ] Integrate native root removal and existing write approval, per-folder
  capabilities and Download now; native creation/read-only Files are covered below. Verify real cloud bytes
  in the installed app before claiming user-facing Android download delivery.
- [ ] Verify API 26/physical devices, reboot/power-loss, low storage, retention,
  Files edits, background scheduling and large-root behavior separately.


### Android offline folders in Files (2026-10-17)

- [x] Cancel native creation before confirming: no root/catalog is created.
  Create a synthetic named offline folder, select it in the real system picker,
  and verify **Check folder** reports its published file. Visually navigate
  Files to the nested 8 MiB + 17-byte fixture and verify all bytes via the real
  ContentResolver. The initial manual run timed out before selection; the
  successful retry reused that empty root and cleaned its fixtures.
- [x] An explicit canonical document path must open the correct starting folder
  and breadcrumbs. Cross-root/ancestor requests and hostile IDs fail closed.
  Stable file IDs survive replacement; existing readers keep original bytes.
- [x] Refuse every writable descriptor mode, directories, cancelled opens,
  corrupt/symlinked blobs and cross-account native root selection. Unknown
  projection columns cannot disclose native paths or account identifiers.
- [x] Installed provider requires `MANAGE_DOCUMENTS` plus explicit URI grants;
  an ungranted shell UID cannot enumerate roots. Native exposure is required,
  and v1 catalog migration keeps existing roots hidden with stable IDs.
- [x] Removing Thingtime access keeps offline files. The acceptance fixture
  separately removes only its synthetic root and blobs after verification.
- [x] Refuse oversized child metadata without returning a partial listing;
  provider queries must remain bounded even for a native catalog at the limit.
- [x] Re-run all three process-loss publication cases after schema migration;
  retained bytes and shared receipts remain recoverable.
- [ ] Verify physical/API 26 devices, system reboot, low storage, cancellation
  during creation, writable Files editing and cloud Download now separately.


### Android foreground offline-folder downloads (2026-10-17)

- [x] Per-folder capability is required by publication bridge 1.1. Generic SAF
  roots, missing roots and incompatible versions cannot reach approval/staging.
  Legacy iOS publication 1.0 remains compatible; Android cannot use that fallback.
- [x] Native adapter rejects cross-account/root/device scopes, stale selection,
  removed or OS-revoked read grants, changed configuration and failed approval
  persistence. Revocation during copy leaves no committed entry or receipt.
- [x] Approval permits private catalog publication without OS write permission;
  Files descriptors remain read-only and removal preserves published bytes.
- [x] Media worker must not intercept pinned sync ranges, fingerprint JSON,
  expected-actor/data-plane or no-store requests. Preserve native API response
  status, exact version and byte-range headers; retain normal media cache tests.
- [x] Real cloud download through installed Android controls: cancel native
  approval, retry with approval, independently hash text and nested 8 MiB + 17
  bytes, then repeat without changing native entries. Use the private disposable
  fixture/runbook in `android/README.md`.
- [x] Visually inspect both downloaded files in Android Files, return to
  Thingtime, remove access and verify files remain. Final API 35 suite: 46
  executed checks, two opt-in process cases skipped (`OK (48 tests)`).
- [ ] Verify real cloud replacement/reapproval, physical/API 26 devices, low
  storage, system reboot, background scheduling and large-root performance.

### Two-way foreground connections (2026-10-17)

- [x] Mixed upload/download run survives lost cloud and native replies and
  journal reload; confirmed operation identities and one publication per side
  remain stable. A repeated converged run has zero mutations.
- [x] Refuse two-way execution before scanning when native approval is absent
  or deletion propagation is enabled. Conflicting initial bytes stop the whole
  plan before cloud or native effects; preserve both copies.
- [x] Installed Android: use the optional two-way runbook, cancel/allow native
  consent, verify both transfer directions and independent replacements, repeat
  without changing file identities/revisions, inspect Files and remove access.
- [x] Installed Android: change saved settings through the revision-guarded
  Things API, refresh and require renewed native consent. Cancel, compare the
  complete cloud inventory and native identities/full hashes, then allow the
  retry and require unchanged convergence. This models settings saved elsewhere,
  not editing through the connection form.
- [x] Installed iOS simulator: cancel/retry native consent, run mixed uploads
  and downloads, independently replace each side, compare full byte hashes,
  and repeat without changing cloud revisions or local inodes/mtimes. Local
  source edits use disposable container files, not an external Files editor.
- [ ] Verify iOS external Files edits, two-way settings reapproval, concurrent
  same-file edits and interrupted two-way restart recovery.
- [ ] Add Mac receivers, recoverable native trash, explicit conflict resolution,
  native background workers, Photos, peer sync and large-folder acceptance.


### Shared Apple receiver and macOS portability (2026-10-17)

- [x] Run the same native folder/publication cases on macOS and iOS. Verify
  bounded real bytes, grant isolation, symlink/version refusal, concurrent
  receivers, replacement retention and failed-publication recovery.
- [x] Preserve the pre-extraction owner JSON and Keychain account key; keep the
  existing iOS bookmark format and v1 staging/grant records.
- [x] Exercise actual process exits after rename and before receipt on both
  platforms, followed by a fresh process: create, replacement and local edit
  after exit. Preserve originals and refuse to overwrite that later edit.
- [ ] Verify Mac installed picker/consent, account-bound desktop dispatch,
  Keychain/sandbox/TCC behavior, real cloud two-way transfer and signed install.
- [ ] Verify additional filesystems/providers, physical iOS, reboot and low
  storage separately; process exit is not power-loss or background acceptance.


### Mac folder host identity and device disconnect (2026-10-17)

- [x] Use a paired identity to read real temporary bytes; reject other owners,
  devices, origins, traversal and revoked/changed local credentials. Multiple
  native credentials must select exactly one device; never use a cached identity.
- [x] Stage/publish 65,537 bytes only after matching native approval; reject
  cancellation/changed configuration, replay the receipt and preserve bytes when
  the grant is removed. Generic and remotely leased dispatch must reject access.
- [x] Cancel only the matching pending request/dialog. Modal approval timers must
  run in AppKit's modal mode; actual AppKit UI cancellation remains unchecked.
- [x] On the managed loopback stack, verify capability discovery and real signed
  pairing; ordinary browser cookies cannot introspect device identity. Reject
  caller-supplied identity IDs, anonymous/device-token disconnects, malformed
  owner overrides and unknown devices. Disconnect twice; identity becomes 401,
  old claim replay becomes 409 and device history/browser session remain.
- [x] Run `test:devices`, `test:api-capabilities`, targeted lint, the focused Swift
  suite and the Node release build. Full TypeScript remains at the existing 91
  diagnostics. Broader NodeController tests abort under XCTest's missing Bluetooth
  usage description; do not count that run as passing.
- [ ] Expose through Electron only after current browser-account verification,
  origin mapping, native capability/timeouts and network/power conditions exist.
- [ ] Verify real Mac picker/consent, signed Keychain/TCC, interrupted cloud
  transfers, sustained throughput/rate limits, release/install and mobile regressions.

### Desktop folder bridge and proxy scope (2026-10-17)

- [x] Real isolated Electron profile: main-frame IPC + cookie-session account
  checks reject wrong accounts, proxy destinations and child frames. Public
  capability discovery carries no cookies. Cookie changes cancel pending work.
  Native dispatch is synthetic; do not count this as a signed Mac transfer.
- [x] Shared renderer runtime: exact owner/device/origin/request replies, bounded
  native source reads, cancellation before/after context negotiation, anonymous
  signed uploads and canonical-to-bundled API mapping. Reject missing actor/home
  headers, redirects, foreign destinations and wrong proxy response headers.
- [x] Proxy regression: only the explicit desktop sync route/method family may
  forward expected-actor requests. Ordinary web deployments and Browser Actions
  remain denied. Changed destinations fail before consuming mutation bodies.
- [x] Browser StrictMode fixture: desktop folder scan, configuration save,
  foreground completion and unsaved draft reload; desktop and 390px controls have
  no horizontal overflow. Existing mobile folder controls still work.
- [ ] Signed installed Mac: real picker/consent, account switch while dialogs are
  open, Keychain/TCC, upload/download/two-way bytes and interrupted receipts.
- [x] Isolated full-process restart: run `verify:renderer-restart` after Electron
  `build:web` and `verify:web`. Four separate processes preserve shared journal
  IDs, confirmed progress, the completion baseline and pending editor drafts.
  Synthetic receipt recovery must not replay mutations; other scopes stay empty.
  An occupied saved port must refuse startup without contacting its server;
  release it and verify exact recovery. No installed/native acceptance is implied.
- [x] Stable-origin regression: malformed, oversized, symlink and non-file address
  records remain untouched and fail startup. Competing first starts cannot
  overwrite the record; failed bundle loading releases the owned socket; fresh
  profiles have distinct addresses. Loading middleware serves only uncached 503s
  until it is ready. Existing HTTP cache clearing preserves application storage.
- [ ] Signed installed Desktop: verify the same journal/draft persistence with
  real native/cloud transfers and app upgrades; preserve the profile/address
  record together. Older random-port origins are not automatically migrated.
- [ ] Measure native streaming throughput and identity-rate-limit behavior on
  large files/roots; per-64-KiB bridge correctness tests do not establish scale.


### Mac native/cloud transfer and rate-limit recovery (2026-10-17)

- [x] Build `MacFolderSyncFixture` and run `scripts/mac-file-sync.integration.mts`
  with a private disposable loopback account. Real Swift upload/download bytes,
  signed pairing and live identity checks must pass. Synthetic picker/consent,
  conditions and credential storage are explicitly outside installed acceptance.
- [x] Lose accepted cloud and native publication replies. Restart the native
  process, retain the same run/operation IDs, and recover without another PUT or
  publication. Independently hash both destinations; repeat for stable revisions.
- [x] Edit one local file and another cloud file. Both changes converge with
  stable file IDs; old cloud byte versions remain readable and unchanged.
- [x] Trigger the real 240/minute native identity limit. Honor one valid integer
  Retry-After up to 60 seconds, then repeat the live check with the exact original
  credential. The verified run observed one 47-second cooldown and completed.
  Never retry 401/403, invalid/long delays or a second 429. Cancellation, local
  unpairing or credential replacement during the wait stops before retry.
- [x] Disconnect through the owner API; native scanning must fail with 401 while
  selected bytes remain intact. Clean fixtures through canonical APIs and remove
  the private test directory; keep accounted Trash/history.
- [ ] Signed Electron/XPC, actual AppKit approval, Keychain/TCC, sustained native
  streaming and large-folder throughput remain required. The measured 129 native
  calls / 259 verification attempts for this small complete acceptance sequence
  are evidence of remaining overhead, not a performance pass.


### Sync authorization and HTTP deadlines (2026-10-17)

- [x] Model a native cooldown longer than 30 seconds during foreground mutation
  authorization. The regression must fail on the old early timer and pass with
  authorization completed before the request deadline begins.
- [x] Every upload mutation (start, part signing, PUT, completion, file commit)
  reauthorizes before its fresh network deadline; GET lookups do not. Cancellation,
  changed scope and refused approval must prevent the PUT and file commit.
- [x] Run Mac acceptance with `--cooldown-before-upload`: the real preflight took
  61,971 ms, including a 50-second server-directed cooldown, then sent the upload
  with an unexpired signal. Mixed transfers, replacements, lost replies, native
  restart, original IDs and revocation still passed with four PUTs/two publications.
  The forced device-budget pressure is not a throughput benchmark.
- [x] Run all shared sync tests (104 plus one module-mock transport check), targeted
  lint and TypeScript. The latter remains the identical existing 91 diagnostics.

## Mac file range stream (2026-10-17)

- [x] Transfer a range crossing 8 MiB through the real native adapter and shared
  cloud writer; verify full hashes, replacement, lost-reply recovery and original
  operation IDs with `mac-file-sync.integration.mts --large-upload`.
- [x] Check one live native verification before and after the range, 64 KiB
  backpressured frames, and unchanged ordinary XPC bounds. Exercise the actual
  nested sink/ack protocol through an anonymous XPC connection.
- [x] Reject source modification, path replacement, cancellation during delivery,
  sink refusal, malformed/missing/reordered/duplicate/oversized frames and wrong
  final scope/range. Never treat provisional bytes as successful completion.
- [x] Verify an 8 MiB-plus binary range through isolated Electron IPC and reject
  account change before returning it. Native dispatch is a fixture here.
- [ ] Verify the signed installed Mac app with real picker, Keychain and TCC.
- [ ] Benchmark sustained upload/download and large roots; download staging and
  mobile reads still use individual chunk requests. Android download range
  acceptance is recorded below.

## Mac download staging stream (2026-10-17)

- [x] Negotiate Mac staging 1.1 and send 2 MiB cloud ranges as binary Electron
  IPC; retain 64 KiB appends for older Mac, iOS and Android staging 1.0.
- [x] Check bounded helper headers, sequential 64 KiB XPC pulls, truncated and
  oversized sources, malformed offsets and account/main-frame boundaries.
- [x] Recover an interrupted range and a payload-flushed/checkpoint-lost range
  without advancing the durable offset; refuse replay with changed bytes.
- [x] Verify late native identity refusal leaves only private recoverable state,
  while publication still needs separate consent and final content verification.
- [x] Run real APIs with `--large-upload --large-download`: lose a staging reply,
  restart the native fixture, resume at the accepted offset, then verify hashes,
  replacements, original IDs, retained versions and revocation without replay.
- [ ] Verify signed installed XPC/Keychain/TCC, physical mobile streaming,
  abrupt machine power loss, low storage and sustained large-root performance.

### Android binary download range regression — 2026-10-17

- [x] On the installed API 35 app, run the existing two-way acceptance with a
  fresh cloud fixture. Verify staging 1.1, nonzero raw binary frames bounded to
  64 KiB plus their 36-byte nonce, zero legacy append messages, exact cloud-byte
  counts, final hashes, repeated convergence and native settings reapproval.
- [x] Unit transport checks reject malformed/out-of-order frame requests and
  premature completion; cancellation suspends the exact native request. Native
  frame tests ignore stale/duplicate/unsolicited frames and wake on cancellation.
- [x] Real private Android staging: a multi-frame range checkpoints once;
  replay compares every frame; interrupted reads, short frames and loss after
  fsync leave only the old durable offset, and resume truncates extra tails.
- [ ] Verify binary-capable physical devices and an older WebView chunk fallback.

### Sync conflict review — 2026-10-17

- [x] Open a conflicting connection, choose versions across pages, and verify
  Apply stays disabled until every conflict has a valid choice. One-way modes
  cannot reverse direction; folder/type/excluded conflicts cannot become deletes.
- [x] Change either version, identity, content, settings or account while review
  is pending; applying must refuse before writes. Cancellation preserves both
  copies, and Stop transfer removes the pending review and releases the root lock.
- [x] Lose an accepted chosen replacement response, reopen the journal and retry:
  retain the same operation/choice without another upload or prompt. Real cloud
  acceptance independently hashes both retained versions and checks stable IDs.
- [x] Check long filenames, pagination and muted grey preservation reassurance
  at 390px and 1280px without overflow; missing-copy conflicts refer to existing
  data rather than claiming both versions exist.
- [x] Installed Android two-way conflicts: Cancel, keep cloud, keep device,
  independently verify both sides' hashes and repeat convergence after each.
- [ ] Verify installed iOS/Mac review and physical devices; folder conflict
  resolution, keep-both rename, retained-version browsing and restore controls.

### Retained cloud file versions — 2026-10-17

- [x] File Things open home Timeline; malformed, foreign, draft and unsupported
  snapshots do not offer file actions. Content IDs include byte length and
  multipart framing rather than mislabeling the multipart hash as whole-file SHA256.
- [x] Review restore shows the current name; Cancel sends no mutation. A concurrent
  file change refuses the stale command. Review latest file requires fresh review.
- [x] Lose an accepted reply, reopen the version and Retry: the same persisted
  operation completes with one write. Verify account changes during a pending
  read cannot reveal a restore review or enable a download.
- [x] Long names and content IDs fit 390px and 1280px browser layouts without overflow.
- [x] Real API acceptance: serialized restore replay, original/current byte hashes,
  permission failures and canonical Timeline snapshots (`file-versions.integration.mts`).
- [x] Installed Android History/export/restore acceptance (checkpoints below).
- [ ] Installed iOS and Mac History/download/restore acceptance; local device
  retained-version browsing and content-ID search across folders.

### Installed file History and effect replay — 2026-10-17

- [x] File revision cards show their recorded filename and remain discoverable
  under the Files filter and filename search; malformed/unsupported/foreign
  snapshots cannot invent file cards (`browserModel.test.ts`).
- [x] Run `scripts/file-history.browser.html` under React StrictMode: Review
  opens after effect replay; Cancel sends no write; lost reply plus reopen and
  retry uses one operation; account change during a delayed read removes
  download access and cannot reveal a late review.
- [x] Run Android `THINGTIME_FILE_HISTORY_TEST=1` with a disposable local
  account: real History filter, two retained versions, cancel without writes,
  restore and both complete byte hashes. Verify the saved review screenshot.
- [x] Native History export into Android Files (Save As acceptance below).
- [ ] Installed iOS and Mac restore, local retained-version browsing and
  cross-folder content-ID retrieval.

### Android historical Save As — 2026-10-17

- [x] With the installed debug app and disposable History fixture, cancel the
  first Save As dialog; the UI confirms cancellation and no file is created.
  Save both versions to Downloads under the same suggested name. Android adds
  a suffix for the second file; independently check 128 bytes of value 11 and
  257 bytes of value 22. Both cloud versions and restore remain available.
- [ ] Cancel or change account while Save As pauses the activity; a late result
  cannot resume the old export or satisfy a newer request. Backgrounding during
  transfer stops it. Provider interruption must not show saved success.
- [x] Native unit checks reject mismatched version/range headers, redirects,
  truncated/extra/corrupt bytes and cancellation; multipart boundary streaming
  and complete provider-byte verification pass.
- [x] Shared bridge checks negotiate the feature, ignore foreign callbacks,
  reject changed version receipts and abort the native request on cancellation.
- [ ] Physical devices, API 26, low storage, remote document providers, process
  termination during provider writes, and iOS/Mac native exports.
- [x] Refresh/reorder unrelated cookies between export phases without cancelling
  an unchanged session. Changed, missing or duplicate `tt_auth` credentials still
  fail closed (`SessionCookieTest`); native save errors retain actionable guidance
  in the shared History error display (`fileExport.client.test.ts`).


### iOS retained file export — 2026-10-17

- [x] Run AppleFileSync tests: bounded multipart ranges, damaged/short/oversized
  reads, unsafe names and framing, existing-file/symlink collisions, cancellation
  before publication and authorization loss after copying must preserve existing
  files and remove only the unpublished candidate.
- [x] Run FileExportBridgeTests plus the mobile bridge/device/destination tests:
  export support is explicitly negotiated and only the exact auth cookie is
  pinned; missing/duplicate/malformed credentials refuse.
- [x] Rebuild/install on iOS 26.5 simulator, open real History, cancel the first
  Files picker without writes, then save both retained versions to one folder.
  Verify both exact byte arrays and collision naming independently.
- [x] In the installed History screen, review/cancel restore without a revision
  change, then restore the earlier version and verify both retained cloud files.
- [ ] Repeat with a physical iPhone/iPad, external Files providers, low storage,
  account change/revocation while a picker or copy is pending, and process kill.
  Background export and native Mac History export remain separate coverage.


### Android binary upload ranges (2026-10-17)

- [x] Bound native ranges and frames; require exact request/offset/length/final
  metadata. Reject stale source versions, unchanged-metadata content edits,
  early completion and malformed acknowledgements. Ignore foreign frames.
- [x] Check acknowledgement timeout, cancellation while waiting and proof-cache
  eviction; preserve full pre-publication source verification.
- [x] Negotiate access 1.4 only with WebView binary support; retain older-host
  chunk transport and existing Android binary downloads.
- [x] Real selected-folder upload through the installed API 35 app: independent
  cloud SHA-256 matches 8,388,625 bytes; two ranges, 129 binary frames, zero legacy
  multi-byte reads. Scope completion to the newly created connection and use
  the shared current status text, so old completed cards cannot satisfy it.
- [x] Final native runner: 49 executed checks, two opt-in restart cases skipped;
  39 JVM tests, 127 shared checks, Android build/lint and targeted lint pass.
  Both installed APK hashes match the built outputs and the app is relaunched.
- [ ] Physical devices, API 26, background uploads, large provider-performance
  runs, and iOS binary ranges remain separate acceptance.


### iOS native cloud range staging (2026-10-17)

- On iOS 17+, negotiate staging 1.2, select a disposable folder through Files,
  approve downloads, and sync a nested 8 MiB + 17-byte file. Independently compare
  complete local/cloud hashes; assert native `stage-download` ranges are at most
  2 MiB and no base64 `stage-append` messages carry those bytes.
- Lose a range acknowledgement, resume its original operation, and verify the
  persisted offset prevents replay. Older staging 1.0 hosts still use the existing
  path; a mismatched owner/origin/file revision fails before staging starts.
- Refuse wrong attachment/version/range/length and changed or trashed cloud files.
  Change the session through the native cookie store during work; verify active
  transport is cancelled even without an observer notification. Unrelated cookie
  changes must not interrupt transfers. Keep grant, foreground and navigation
  checks active and require the normal final fingerprint before publication.
- Run `NativeFileSessionTests`, `MobileFolderTests`, `MobileSyncStagingTests`,
  `FileExportBridgeTests` in a signed simulator test host (Keychain requires it),
  plus `test:file-sync` and explicit installed native-cloud acceptance. Recheck
  History export consent/cancellation when changing the shared network transport.

- Run interactive iOS transfer/History acceptance on a dedicated simulator when
  another task uses the same bundle ID; distinguish an installation-terminated
  test host from a product crash and preserve the interrupted fixture for cleanup.
- Observe installed History export replies through a native test observer installed
  at document start; a WebView/dev reload must not erase the acceptance counter.
  Explicitly cancel in Files, save both byte versions without overwriting, cancel
  restore, then restore and independently read both retained cloud attachments.

### Retaining an alternate file version without publishing — 2026-10-17

- [x] `POST /api/v1/files` with `kind=retained-version` stores an owned ready
  upload in the existing file's Timeline. The live bytes, revision, filename,
  folder and modification date stay unchanged; the Published head does not advance.
- [x] Exact retained-operation replay/lookup survives later file edits without a
  second upload/binding charge. A normal commit lookup cannot mistake retention
  for publication. Mixed/duplicate/unknown selectors fail closed.
- [x] Stale, renamed, moved, trashed or missing roots and foreign/blocked/expiring
  uploads fail without binding bytes. Timeline failure rolls the binding and
  accounting back. Client-authored effects cannot impersonate retained receipts.
- [x] Real API/object-storage acceptance (`file-versions.integration.mts`) races
  retention against publication, verifies the live winner, replays after later
  edits, restores the alternate version and independently hashes all retained
  bytes. Anonymous reads and direct deletion of retained attachments are refused.
- [x] Retention effects appear under Timeline's Files filter with their recorded
  filename; ordinary or malformed effects cannot offer file-version actions.
- [ ] Wire explicit conflict capture to native source reads/uploads and durable
  client retry state; verify Ignore after capture, reload and source-file loss on
  installed Mac/iOS/Android. This API alone does not preserve an uncaptured device
  file, implement content-ID search or provide independent whole-data backups.


### Durable conflict capture — 2026-10-17

- [x] Save two-existing-file conflicts through the shared foreground transport.
  Verify the root bytes/revision stay unchanged, both versions are independently
  readable and no common sync baseline advances. A later normal sync must still
  require a winner choice; repeating Ignore reuses its immutable receipt.
- [x] Lose an accepted capture reply, reopen IndexedDB and remove the source.
  Recover using the original receipt without scanning, reopening or uploading
  the captured source. Exercise the real local API/object store with
  `scripts/file-sync-foreground.integration.mts`.
- [x] Cancellation, account/settings changes, a changed review and failed durable
  persistence stop before upload. Version-1 execution and baseline completion
  reject a version-2 retention run; persisted intent cannot be changed in place.
- [x] Render `mobile-sync-editor.browser.html?capture=1&view=review` at 390px and
  1280px: muted content-ID copy, long filenames and 40px action buttons wrap
  without horizontal overflow. This static review fixture does not upload data.
- [ ] Complete interactive browser and installed iOS/Android/Mac capture, reload
  and source-loss acceptance. This run's browser inputs did not reach either
  existing Edit/Upload handlers; rendered layout is not click-through evidence.
- [ ] Add explicit re-review/abandonment for a pending uncaptured version that
  changes, folder/missing-file capture, content-ID lookup and whole backups.

### Portable backup storage and export — 2026-10-17

- [x] Capture a real local file in bounded chunks, lose an accepted range-page
  reply, reopen the private vault and read only the remaining source bytes.
  Delete the original, seal/read back the backup and compare the full byte hash.
- [x] Interrupt export after an accepted chunk, resume without retransmitting
  that chunk, then delete the first vault and restore from the second. A fully
  repeated export fetches no source chunks. Verify empty files and metadata-only
  items, and preserve canonical Timeline snapshot data and placement as metadata.
- [x] Exercise offline `backup:vault verify`, `copy` and `restore-file` in child
  processes. Restore byte-identical output; refuse overwriting an existing path.
  A missing source vault is not created by the verify command.
- [x] Missing/corrupt bytes, reordered/missing manifest pages, overlapping ranges
  and altered seals must fail. Cancellation and wrong/revoked scope stop work;
  revoked access after a range read must yield no bytes to the restore consumer.
  Unsafe paths/symlinks and concurrent changed immutable writes are refused.
- [x] Stream 100 TB and 10 PB metadata inventories through bounded pages, keeping
  exact cumulative decimal counters beyond Number.MAX_SAFE_INTEGER. This is not
  evidence of a 100 TB byte transfer or disk-throughput acceptance.
- [x] Run the real API foreground fixture with `--portable-backup`: capture exact
  authorized cloud ranges, lose a capture reply, Trash the source, reopen/recover,
  copy independently, remove the first vault and verify the restored byte hash.
- [ ] Implement/verify the complete server inventory boundary, protected job and
  manifest Things, quota, cloud replicas, scheduling/retention and server Timeline
  events. Add native consent/UI, encrypted media, multi-item restore and measured
  large-data export. Existing helper/CLI checks do not prove those product flows.

### Cloud folder backup worker — 2026-10-17

- [x] Freeze a real complete selected folder including empty folders; capture its
  exact retained bytes only after the live file moves to Trash. Verify full hashes.
- [x] Run authenticated `backup:cloud create` and `resume` child processes with a
  private disposable session config; repeat capture downloads zero new bytes.
  Run the foreground fixture with `--portable-backup --large-download` (17,825,809 bytes).
- [x] Reject a root revision mismatch, incomplete inventory, wrong account/origin,
  cancellation and a revoked session immediately before completion publication.
  Test the real `/auth/me` `{ user }` response without an `ok` envelope.
- [x] Refuse exposed credential files and non-loopback HTTP origins; malformed
  session JSON must never echo its secret contents through CLI errors.
- [ ] Complete account-wide/paged snapshot inventory, native consent/UI, scheduled
  independent cloud copies and Timeline backup lifecycle; selected-filesystem
  coverage and command-line acceptance do not establish these outcomes.

### Reviewed portable tree restore — 2026-10-17

- [x] Dry-run the whole saved tree with `backup:vault plan-tree`; no destination
  is created. Changed review/destination and existing recovery roots must refuse.
- [x] Preserve nested files and empty folders. Exit a real child process after
  its first durable range, then resume through the CLI. Accepted ranges and
  completed files require zero source-chunk reads; compare full output hashes.
- [x] Repeat restore without changing file inode/mtime. Reuse manifest scans
  across files rather than performing a whole-inventory scan per file.
- [x] Refuse concurrent workers, symlinks, unexpected output, unsafe names,
  missing/cyclic parents and case aliases. Cancellation releases only its own
  candidate. Corrupt accepted staging and later user edits remain untouched.
- [x] A file edited after publication or an empty folder removed during the run
  must prevent the overall completion marker; resume can recreate a missing
  empty folder without rewriting already verified files.
- [x] Run the real foreground API fixture with `--portable-backup --large-download`:
  restore captured bytes after live Trash, preserve its empty folder, hash-check
  the 17,825,809-byte output and repeat CLI resume without rewriting it.
- [ ] Native restore review/consent, account-wide/generic Thing restoration,
  cross-device/shared-filesystem destinations and large-data throughput remain.

### Mac History Save As and bundled static assets — 2026-10-17

- [x] Regression: a selected server without compatible `api.devices-node-identity`
  must explain that the server version does not support folder sync before native dispatch.
  Account/endpoint changes during negotiation still refuse; a compatible manifest
  never skips native pairing verification. Renderer errors hide native paths and
  IPC details. Run the Electron folder host and shared desktop-folder tests.
- Installed-app check: open Things in the rebuilt signed Mac app, verify the
  server compatibility message under Folders on this Mac, and leave the existing
  pairing, selected endpoint and folder grants unchanged.
- [x] Export 17 MiB through the production preload/host, real Electron session
  cookies and native Save panel; verify all saved bytes, canonical multipart
  fingerprint, nine bounded ranges and removal of the request's partial file.
- [x] Reject foreign frames/origins, invalid content descriptors, changed accounts
  during the picker/ranges, proxy mismatch, short/oversized/corrupt bodies, wrong
  version/framing, cancellation and concurrent requests. Existing files, symlinks
  and files created during transfer must remain untouched. A failure after
  publication preserves the saved bytes and reports uncertainty.
- [x] Shared History client negotiates the Mac capability, retains cancellation
  binding, checks exact version receipts and sanitizes host errors.
- [ ] Authenticated signed installed-app History save/cancel/restore against a
  real retained file, account switching during its native picker, external-volume
  permissions, low disk space and app termination during transfer.
- [x] Regression: Electron's Nitro middleware preset must serve startup JS/CSS
  bytes from the package, not the HTML catch-all. Check responses across the
  restart fixture and visually open the rebuilt isolated app.

- [x] Regression: an account-bound Desktop API request must work through the
  real bundled Nitro/srvx middleware. Do not clone its framework Request using
  Node's private-state copy constructor. Verify GET and POST body preservation,
  forwarded-origin removal, and unchanged actor/home/origin checks. Run the
  native export fixture with `--headless` after `build:web` to cover real
  cookie-session account checks and exact-version ranges through this proxy.

### Account snapshot inventory foundation — 2026-10-17

- [x] Freeze more than two owner pages using one server snapshot timestamp.
  Interleave real majority-committed updates, deletion and insertion; retained
  records must reflect the original timestamp. Seal/read metadata after source
  database removal (`scripts/account-snapshot.integration.mts`, disposable local
  replica only). Also verify an empty collection supplies a server timestamp.
- [x] Refuse unsupported managed families before payload access; never export
  root credentials, link keys or authentication envelopes. Dedicated Timeline
  exporters may decode only validated history envelopes. Do not seal a partial
  inventory. Preserve canonical Timeline metadata and exact file references.
- [x] Regression: expired snapshots, missing/malformed timestamps, transaction
  sessions, changed account during authorization, revoked access, cancellation,
  missing/duplicate payloads and oversized metadata cannot publish a plan.
  Cursor/session cleanup and refusal to rebuild the same ID are covered.
- [x] Regression: the account index must not overflow legacy bootstrap's 64
  slots. Modern plan is 52; full compatibility remains 64. Missing index refuses
  the producer without a cross-account scan fallback. Real explain: 2,560 to 128
  keys examined for a 128-result page in the 6,000-row fixture.
- [ ] Dedicated protected-family exporters, full account/settings/device coverage,
  authenticated job admission/quota, large metadata, retained-byte pinning and
  independent cloud copying, Timeline backup lifecycle, native UI and measured
  100 GB–100 TB export remain required before claiming whole-account backup.


### Recoverable Apple native Trash — 2026-10-17

- [x] Require separate native deletion consent, exact configuration/scope/grant
  binding and an explicit allowTrash reply; download-only permission, cancelled
  deletion consent, old hosts, changed settings and revoked accounts refuse.
- [x] Retain exact file/empty-file/empty-directory bytes by exclusive same-volume
  rename. Refuse changed sources, nonempty planned folders, symlink ancestors,
  exposed private journals and attempts to move the adapter's own lock/data.
- [x] Regression: a replacement or newly populated folder racing the native move
  stays pending and recoverable. Explicit folder restore preserves children and
  symlinks without following them. Restore never overwrites a recreated path.
- [x] Kill disposable children after trash/restore rename and before receipt;
  a fresh process recovers the same operation. Retried deletion must never remove
  restored or recreated files. Existing download publication recovery still passes.
- [x] Real Mac adapter/API fixture: restart, original receipt, alternate restore,
  exact hashes and device revocation; isolated synthetic picker/consent only.
- [x] Mac focused adapter/identity/XPC 42; Apple 41; iOS simulator 27; shared
  file-sync 139; Electron folder/stream 17. Full native suite hits an unrelated
  Bluetooth usage-description test-host crash. Web tsc remains 91 diagnostics.
- [ ] Enable automatic native deletion only after fresh remote absence and parent
  revision handling, Android parity, recovery browsing and installed consent QA.
  Verify external volumes/providers and preserve local recovery in whole-account
  backup before promising device-loss recovery.


### Cloud path freshness — 2026-10-17

- [x] Exercise Files/sync suites: explicit absence versus 404/401/409/413/503;
  replace an old path with a new id; refuse case/Unicode aliases, inaccessible
  siblings, file ancestors, invalid root ancestry and incomplete observations.
- [x] Rename a cloud ancestor while a file is staged: the unchanged old file id
  must not allow native publication. Preserve receipt recovery across reload.
- [x] Exercise the opt-in Mac/API fixture's nested path absent/create/delete/
  recreate checks with independent ids and an uppercase alias refusal.
- [ ] Enable local deletion propagation only after parent stamp transitions,
  native recovery controls and platform-specific Trash support are verified.


### Foreground Apple deletion and recovery browser — 2026-10-17

- [x] Parent stamps advance only from exact same-scope completed child receipts;
  intervening edits, foreign receipts and incomplete post-crash transitions refuse.
  The immutable run and original operation IDs stay unchanged.
- [x] Fresh cloud path replacement, missing roots and failed reads stop native
  removal. Every removal rechecks cloud absence and native source identity.
- [x] Native recovery pages limit returned records to 20, preserve pagination
  across unrelated records, filter owner/origin/grant, and include prior pairing
  and connection IDs only under that same owned surviving grant.
- [x] Explicit native restore consent is separate from sync approval. Cancelled
  consent, revoked identity and occupied destinations preserve retained bytes.
  Interrupted restore retains its exact intent and resumes without a new path.
- [x] Recovery UI at 1280px and 390px: long paths wrap, controls are 40px high,
  no horizontal page overflow, invalid destination disabled and restore feedback
  visible. Synthetic browser fixture; native consent is tested separately.
- [x] Real Mac/API: shared planner removes children then parent; lose Trash reply,
  restart native/IndexedDB, resume original IDs, list retained files, restore with
  lost reply/restart and verify exact bytes. Revocation refuses later access.
- [ ] Installed native recovery consent and selected-folder lifecycle; Android
  parity, external/provider volumes, recovery after removing/rechoosing a grant,
  and inclusion of native recovery storage in device-loss backups remain open.

### Android transactional Trash and recovery — 2026-10-17

- [x] Delete rollback leaves the exact visible entry and no recovery receipt;
  lost replies replay the same completed operation. Original bytes remain intact.
- [x] Nested child/sibling receipts advance only the pinned direct parent;
  external edits, foreign scopes and nonempty directories stop removal.
- [x] Restore requires exact reviewed retained metadata and an absent destination;
  case aliases, missing parents and corrupt bytes refuse. Lost replies cannot
  overwrite later edits or choose a different destination.
- [x] Schema 2 migration retains files and publication receipts. Recovery pages
  return at most 20, include previous owned pairing/configuration IDs, and exclude
  other accounts and native grants.
- [x] Copy consent never permits deletion. Explicit deletion consent survives
  encrypted reload, while reselection and revocation invalidate approval. A
  permission change inside a delete/restore transaction rolls back all effects.
- [x] Kill a real Android process before and after both SQLite commits; reopen
  in a new process, verify rollback/exact replay and all restored bytes.
- [x] Installed authenticated WebView: native delete consent cancel/allow, shared
  recovery list/review, separate restore cancel/allow, exact retry without another
  prompt, restored bytes, no horizontal overflow and Android Files inspection.
- [ ] Physical-device/background/provider acceptance, native recovery in backups,
  independent snapshot copies and whole-account large-volume export remain open.

- [ ] Investigate Android emulator paint artifacts after expanding/scrolling the
  recovery card. Measured Things section bounds do not overlap, but captured
  pixels show stale search/toolbar layers. Keep physical-device visual acceptance
  open; do not infer a CSS sizing fix from the screenshot alone.

- [x] Installed Android two-way deletion: enable deletion with separate native
  cancel/allow consent, remove a cloud child and its parent, suppress one real
  committed native reply, reload and resume the same IndexedDB operation IDs,
  verify repeated convergence, then restore parent before child with native
  confirmation and independently hash the original bytes.

  Installed API 35 emulator acceptance passed on 2026-10-18: 236.765 seconds,
  one test, no failures. Verified the new document, original operation IDs,
  resumed parent removal, repeat convergence, reviewed parent/child restore,
  independent original-byte hashes and the restored 8.39 MB file in Android
  Files. Earlier intermittent WebView timeouts and physical devices remain
  separate coverage limits; a passing run does not explain those timeouts.

- [x] The Android acceptance runner streams `OFFLINE_CREATE_QA_READY` before
  folder selection and `OFFLINE_FILES_QA_READY` before manual Files inspection.
  Do not interact during the preceding bridge checks. Confirm the terminal
  retains the final JUnit result and exits unsuccessfully on a failed test or
  adb transport, even when earlier progress lines report passed substeps.

  The canonical runner passed on 2026-10-18: 61 instrumentation tests in
  331.348 seconds, including the opt-in live planner recovery scenario; build,
  JVM unit tests and Android lint passed. A focused shell check of the actual
  runner block verifies success, JUnit failure and adb failure exit handling.


### Android retained replacement versions — 2026-10-18

- [x] Schema 3 to 4 migration retains original file/blob/publication identity,
  derives only its original grant and leaves unknown capture time null.
- [x] Paged lists return at most 20; foreign owner/origin/grant, stale review,
  corrupt bytes, occupied/case-alias destinations and missing parents refuse.
- [x] Restore creates an independent file and keeps both current and retained
  versions. Precommit failure or grant revocation rolls back; lost replies and
  later edits replay the original receipt without a second write.
- [x] Installed API 35 WebView: replace, review, cancel, reload, resume the same
  saved operation, native confirmation, complete restored hash, exact retry and
  both 8.39 MB copies visibly present in Android Files. Wait for enabled controls
  after reload before clicking; presence alone is insufficient during refresh.
- [x] Shared response validation rejects wrong folder, content, path, operation
  or reused file identity. Live synthetic 390px/1280px controls fit without
  horizontal overflow and show completed-copy feedback.
- [ ] Physical devices, Apple native version browsing, native history in
  independent backups, grant replacement and actual process-kill acceptance
  specific to version-copy restore remain open.

Canonical runner: 67 instrumentation tests passed in 174.246 seconds, with build,
JVM tests and Android lint. Shared suite: 148 passed. Raw TypeScript: 91 existing
diagnostics outside changed files. These results do not establish 100 TB data
transfer, whole-account snapshots or production deployment.


### Android photo library backup

- On a disposable Android 11+ emulator, cancel the native photo explanation and
  confirm no folder is selected. Complete the permission flow and Files selection;
  selection alone must not upload anything.
- Confirm the connection identifies originals and full/limited access, defaults to
  paused backup, disables other directions and deletion propagation, and remains
  readable without overflow at mobile and desktop widths.
- Run `THINGTIME_PHOTO_BACKUP_TEST=1 android/scripts/test-mobile-devices.sh
  /path/to/private-fixture.json`; compare the downloaded original SHA-256, add a
  second owned test image, delete the first locally, and verify both cloud copies
  remain. Re-run without extra publications.
- Run the installed `PhotoLibraryTest` checks: duplicate display names retain
  distinct paths, pending/trashed/deleted assets are not readable, denied access
  and cancellation fail rather than return an empty scan, and provider writes
  fail. Never treat a permissions flag as a persisted grant.
- Real limited-selection changes, video/EXIF format coverage, physical devices,
  large libraries and background completion remain additional release checks.

### iOS original-photo backup

- On a disposable simulator, use Things to pair the device and choose Photo
  library (backup). Verify the explanation, native permission, and full/limited
  source projection; denying permission must not create an authorized source.
- A photo connection must stay backup-only with deletion propagation disabled.
  Native write approval, staging, publication and Trash actions must reject it.
- Run `THINGTIME_PHOTO_BACKUP_TEST=1 iOS/scripts/test-mobile-sync-installed.sh`
  with `DEST` and a private disposable account fixture. Verify original PNG
  cloud download hashes, discovery after another photo is added and retention
  after the first test original is moved to Recently Deleted.
- `PhotoLibraryTests` covers distinct same-name resources, multipart fingerprints,
  bounded reads, owner/grant cache partitioning, changed inventories, revoked
  permission, missing originals, cancellation and denied write authority.
- Keep actual limited-selection changes, Live Photo/video/EXIF fixtures, iCloud
  downloads, physical devices, large libraries and background acceptance open
  until each has direct evidence. Resource bytes do not prove album/database
  restoration or an independent whole-device snapshot.

### iOS file-backed multipart uploads

- Run the shared Apple package and the iOS `FileUploadPartTests`,
  `PhotoLibraryTests`, `NativeFileSessionTests` and `NativeFileUploadTests`.
  Confirm canonical part bounds, 33 MiB capture through bounded chunks, actual
  selected-file mutation refusal, permission loss, incomplete streams,
  cancellation, foreign/credential-bearing signed URLs, extra headers and
  oversized/error responses cannot publish a successful part.
- Run the opt-in installed photo backup acceptance from iOS/README.md with a
  disposable loopback account and simulator. Verify at least four native parts,
  two complete multipart originals, zero legacy bulk bridge reads, independent
  download hashes and retained cloud bytes after local deletion. Clean up only
  the test's originals/configuration/grant using recoverable product paths.
- Run shared cloud transport/native upload adapter tests, including native
  failure/lost-response retry with identical IDs, digest mismatch and aborted
  completion. Older hosts must retain their existing supported transfer path.
- Physical hardware, actual OS process death during PUT, disk exhaustion,
  prolonged network loss and measured 100 GB–100 TB throughput remain required;
  bounded fixture checks do not prove those properties.

- During an iOS identity check, present an OS Photos dialog or suspend the app.
  Confirm the pending web identity request settles promptly instead of holding
  the serialized device queue until its 120-second timeout. Repeated suspension
  sends one cancellation; switching web destinations sends no old account
  context to the new page (`MobileDeviceBridgeLifecycleTests`).

### Mac photo library backup

- Run `MacPhotosSyncTests`, `MacFolderSyncTests` and `FolderStreamXPCTests`.
  Verify original multipart fingerprints/binary bytes, read-only projection,
  cancellation/stale account during selection, revocation during a stream,
  changed source refusal and grant removal. Photos must reject every native
  write/stage/publish/Trash action before prompting or touching recovery storage.
- Run the opt-in `mac-file-sync.integration.mts --photos` with a mode-0600
  disposable loopback account fixture and rebuilt `MacFolderSyncFixture`. Check
  independent download hashes before/after replacement, original retention,
  new-photo discovery, source-deletion retention, native restart and no duplicate
  upload on repeat. This uses synthetic PhotoKit/picker adapters.
- In an updated signed installed Mac app, cancel source selection and the photo
  explanation; neither may create a grant or request OS access. With explicitly
  approved library access, verify full/denied access, original photo/video bytes,
  metadata and revocation through the actual shared Things controls. Retain
  existing endpoint, account, pairing and grants. Live Mac library acceptance
  remains open until this separate session is completed.

### iOS durable upload-part recovery

- Run `FileUploadPartStoreTests` and the existing capture/transport suites. Verify
  fresh-instance reuse without source recapture; changed source/grant under the
  same identity refused; different owners/origins/roots isolated; truncated,
  corrupt, symlink and hardlink payloads refused; count/byte limits preserve other
  unfinished parts and explicit successful release frees capacity.
- Run `apple/FileSync/scripts/test-upload-part-process.sh`. The disposable child
  must exit 77 both after payload fsync before the digest checkpoint and after
  complete capture. A distinct process must recapture the incomplete payload,
  reuse the committed payload without calling its source stream, reject a changed
  live source version and release only its exact cache entry. Regression class:
  native upload inputs were temporary and disappeared during process interruption.
- Run the installed multipart photo test and confirm `IOS_UPLOAD_CACHE_RELEASE_PASS`
  alongside independent cloud hashes, four native parts and zero bulk bridge
  reads. Successful uploads must leave no new retained part directories.
- Keep actual process death during PUT, app/device restart scheduling, power loss,
  exhausted physical storage, cache-management UX and 100 GB–100 TB acceptance
  open. Cache-process fixtures do not prove native background completion.

File protection is configured in iOS capture attributes but is not verified by
this simulator: it returns no protection attribute. The separate
`testDeviceFileProtectionAfterCapture` skips Simulator and requires physical iOS
hardware; device lock/reboot enforcement remains an open acceptance check. Read
protection values as strings, as specified by
[Apple's protectionKey API](https://developer.apple.com/documentation/foundation/fileattributekey/protectionkey).

### Native whole-file upload jobs

- [ ] In the disposable iOS photo acceptance, require two whole-file bridge
      requests, at least four native part progress events, exact original-byte
      download hashes and no bulk read/per-part upload fallback through WebKit.
      Verify new-photo discovery, cloud retention after local deletion, and no
      successful part-cache leftovers.
- [ ] Between parts, pause/edit the connection or revoke pairing; change owner,
      audience, roots, network or charging state. No subsequent part/completion
      may run under the stale authorization. Cancellation preserves the original
      journal and any unfinished retained part.
- [ ] Reject changed upload identity, malformed digest and wrong composite before
      completion. A ready reservation skips retransmission; a wrong server
      fingerprint still blocks Timeline publication. Exact accepted file replay
      does not repeat the native job.
- [ ] Reject foreign, duplicate, backwards, noncanonical or oversized progress
      messages; they cannot extend the 15-minute inactivity deadline. Custom
      runtime mutation policies continue through the original per-part path.
- [ ] Do not count foreground acceptance as background/reboot/force-quit proof.


### iOS continued-upload lifecycle

- [ ] Run `NativeUploadBackgroundTests`: single registration, serial jobs,
  monotonic byte progress, final completion, expiry, cancellation and refused
  submission. A timed-out request must not attach its late callback to a new job.
- [ ] Run shared native-upload tests: reject acknowledgements from another
  owner/origin/root/request/upload/source, from older hosts or with malformed
  background flags. Duplicate acknowledgements cannot extend authority. Pause
  only an accepted hidden job's timer; restore the timeout in foreground. Abort
  removes authority and listeners; navigation must always abort.
- [ ] Run the disposable installed photo acceptance on the updated host, checking
  original download hashes, new-photo discovery, retained cloud versions and cache
  cleanup when the OS refuses continued processing.
- [ ] Add `THINGTIME_PHOTO_BACKGROUND_TEST=1` to require actual OS acceptance.
  After its readiness marker, use Home, independently observe an initially
  unfinished attachment become ready while the app remains backgrounded, return
  to Thingtime and verify canonical publication. Refusal is a failed background
  acceptance check, not a pass or evidence that the foreground fallback failed.
- [ ] On physical iOS, cancel using system progress UI and test expiry, lock,
  network/power changes, grant/device revocation, force quit and relaunch. Do not
  infer these from simulator lifecycle mocks or foreground success.


### Timeline history inside account snapshots — 2026-10-18

- [x] Freeze all seven Timeline record families, including legacy events, active
  and cleared names and Unicode snapshot parts larger than manifest metadata.
  Rejoin normalized events/links and reconstruct the original large snapshot.
- [x] Interleave real database changes after the snapshot census, including
  deletion of a Timeline part and damage to a live event. Export must retain the
  original records; after source database and first vault removal, every record
  must read identically from the independent vault (334 records, 34 history).
- [x] Regression: missing/corrupt chunks, lost accepted range replies, revoked
  ownership, wrong scope and an unsupported family on a later census page cannot
  certify a partial snapshot. An interrupted enumeration needs a new identity.
  Reads must detect corruption introduced after sealing.
- [ ] Complete remaining protected-family/settings/device exporters, historical
  attachment-byte closure, authorized restore writers and full product backup
  jobs/UI. Archived Timeline receipts never authorize replay on their own.


### Historical attachment bytes in account snapshots — 2026-10-18

- [x] Snapshot ready attachments with canonical metadata and verified immutable
  byte versions. Check every current/before/after/conflict file reference through
  bounded owner-filtered batches at the same Mongo timestamp. Missing, foreign,
  changed-target/version/fingerprint, blocked or unfinished data must refuse the
  full plan; no late reference silently disappears. Verify at most eight
  concurrent HEAD requests, bounded caching, and draining a failed batch before
  returning without starting another batch.
- [x] Preserve all existing attachment purposes and linked URL metadata without
  copying private object keys, provider versions, upload state or credentials.
  Linked media never fetches an external URL or claims stored bytes.
- [x] Capture each attachment once; current/history references reuse its ranges.
  Lose an accepted capture reply, remove source metadata, resume, independently
  copy, then remove source bytes and the first vault. Read current, earlier and
  retained-conflict versions through the canonical offline recovery readers and
  compare bytes. Wrong live version and revoked access never seal.
- [x] Real disposable Mongo proof: 351 rows / 47 Timeline records; concurrent
  writes include deleting a referenced attachment after the census. After source
  database/files and first vault removal, all three file versions recover exactly.
- [x] Real API foreground fixture with `--portable-backup --large-download`:
  account byte reader captures current and conflict attachments after live Trash,
  then exact hashes survive independent copy and first-vault removal. Explicit
  fixture descriptors are not whole-account API or permanent-S3-loss proof.
- [ ] Complete remaining managed family/relationship coverage, storage retention
  leases, authorized account restore/jobs/UI, encryption and independent cloud
  copies. Historical attachment support alone is not complete whole-data backup.


### Saved drafts and large content in account snapshots — 2026-10-18

- [x] Preserve exact canonical editor snapshot strings, reusable template modes,
  provenance and revision tombstones. Reject malformed content, extra fields,
  invalid dates/modes/revisions, oversized editor state and active/deleted mismatch.
- [x] Resolve draft media at the same database timestamp in owner-indexed batches;
  missing, foreign, wrong-target/purpose/profile or expiring media must refuse the
  complete plan. Deletion markers have no active editor or media references.
- [x] Recover both inline and multi-chunk ordinary Thing snapshots; reject protected
  kinds and extra envelope fields. Retaining multiple ordinary rows must stream
  payloads rather than collecting a whole page of large records.
- [x] Regression: mutate a caller's Buffer after the first chunk write; frozen
  payloads remain unchanged. Cancel between chunks: no complete plan or seal may
  be published, and no later source reread may masquerade as the old snapshot.
- [x] Real Mongo snapshot proof: concurrently delete a working draft's media,
  replace its editor with a tombstone and edit a 10 MB ordinary Thing. After
  source database/files and first-vault deletion, verify all original records and
  exact media from the independent vault (357 records, 22,064,370 payload bytes).
- [ ] Complete other protected families/settings/device coverage and reviewed
  account restore/jobs/UI. Offline content readers do not restore live state.

### Android native whole-file uploads — 2026-10-18

- [x] Replay lost part/completion replies under the original immutable operation;
  completed reservations perform no new source reads or PUTs. Verify bounded
  reads, exact reconstructed bytes and cleanup of transient part files.
- [x] Same-timestamp source edits, replaced provider identity, changed metadata,
  foreign owner/device/ACL/revision, unknown configuration policy and disallowed
  network/power must refuse. Canonical connection comparison includes arrays.
- [x] HTTP regressions: storage must receive no ambient cookie, Origin or auth;
  refuse redirects/auth challenges, changed credentials, extra signed headers,
  foreign HTTP targets, oversized replies and cancellation during an active call.
- [x] Android filesystem regression: use the supported free-space query;
  `Files.getFileStore` throws SecurityException in the sandbox. Capture a real
  managed-blob part, verify its bytes and reject a replaced source afterward.
- [x] Installed API 35: choose the synthetic SAF fixture through the real picker,
  upload two parts with one native job and zero bulk WebView frames, independently
  hash downloaded bytes, then run managed-blob replacement/source checks.
- [x] Installed photo backup: two native jobs and zero bulk reads; independently
  hash originals, discover a new photo, preserve the cloud revision after local
  deletion and repeat without another publication.
- [ ] Physical devices, long jobs, low disk, interrupted actual PUT, background
  policy, OS process death/relaunch and sustained large-data throughput.


### Android durable native upload parts — 2026-10-18

- [x] Bug class: a lost PUT reply or process restart must retain the original
  verified part, not delete it or invent a new upload. Reopen the cache and check
  exact IDs, bytes, source-read counts and release after a confirmed handoff.
- [x] Kill-point regression: interruption after payload fsync but before the ready
  record must recapture; an uncommitted directory and atomic discard may be
  cleaned, while unknown files, symlinks and hardlinks must fail closed.
- [x] Refuse changed grant/source identity and corrupt payloads before disclosure.
  Retry rechecks current authorization and source even when cached bytes exist.
  Wrong-owner removal must retain the part; exact account/root removal clears it.
- [x] Enforce bounded reservations without evicting uncertain uploads; verify
  private file/directory modes, native file locking and no credential persistence.
- [x] Run both explicit `NativeUploadRecoveryTest` phases from android/README.md,
  with force-stop between them. Assert different process IDs, original operation
  and upload IDs, exact two-part bytes, cached first-part reuse and cleanup.
- [x] Repeat installed SAF picker/API upload with the cache enabled: one native
  whole-file job, zero bulk WebView reads, complete downloaded hash and cleanup.
- [ ] OS-scheduled background work, autonomous relaunch, physical devices,
  power loss during fsync, interrupted actual network PUT and sustained large data.


### Android current-file OS continuation — 2026-10-18

Deferred by user on 2026-10-18. Preserve this code and evidence in PR #1002;
resume unfinished Android gates only when requested.

- [x] Bug class: notification consent may pause the activity. Request it before
  creating transfer authority, then reauthenticate on return; first approval must
  not cancel the subsequent upload. Old clients never receive the new action.
- [x] Exact OS acknowledgement gates hidden uploads. Refusal cannot be revived
  by a late callback; normal completion releases the job without cancelling work.
- [x] Real notification Pause, stale Pause, OS stop and completion remove only the
  current job/notification; stopped work is not automatically rescheduled.
- [ ] Run `THINGTIME_BACKGROUND_UPLOAD_TEST=1` using the documented 32 MiB + 17
  byte synthetic SAF file. Observe pending then ready while the real activity is
  paused, return and verify pinned downloaded-byte SHA-256 and zero bulk bridge bytes.
- [ ] Disabled notifications must keep foreground fallback. Validate Android 8–13
  foreground-service admission on an installed device, as well as physical-device
  sleep, network loss, policy changes, process death and explicit retry.
- [ ] Full-folder autonomous background work, relaunch/reboot and sustained
  100 GB–100 TB delivery remain outside this checkpoint.


### Saved themes in independent snapshots — 2026-10-18

- [x] Preserve the canonical partial theme exactly, including false/zero/null,
  title, tags, folder and historical visibility; never fill current defaults.
  Omit private roots and unapproved crystal/token fields.
- [x] Inline small themes; retain larger canonical snapshots in verified chunks.
  Capture them inside the same database snapshot, processing one row at a time.
- [x] Refuse mixed protected kinds, invalid tokens, exceeded field bounds, foreign
  owners and cancellation without publishing a complete inventory. Wrong-account
  reads and corrupted retained chunks must refuse.
- [x] Run the disposable account storage consistency proof: concurrently edit a
  partial theme and delete a large one after the census; recover both originals
  from the second vault after source database/files and first-vault deletion.
- [ ] Actual account-wide capture/import, active-theme selection restoration,
  remaining managed families and native/UI acceptance remain separate gates.

### Account profile and preferences in independent snapshots — 2026-10-18

- [x] Unit: preserve null/false/absent preferences, partial notification switches,
  disabled personal instructions, linked profile URLs and ordered reactions;
  recover exact content from the second vault after source edits/removal.
- [x] Unit: reject mixed/foreign user identities, malformed JSON/UTF-8, plaintext
  private envelopes, invalid values and damaged chunks. Error messages must not
  contain private envelope values; credentials/permissions never enter chunks.
- [x] Unit: managed profile images require the exact owner, slot, profile purpose
  and durable target. Missing/foreign/rebound/expiring images refuse the complete
  plan; valid image bytes read identically from the sealed vault.
- [x] Real signup/profile/settings Request handlers on an isolated home replica
  match snapshot/API readback under concurrent changes; explicit selected values
  restore through current writers. HTTP/browser and managed-media acceptance remain open.
- [ ] Restore a live account through current reviewed writers; cover active
  theme/algorithm selection, visibility, permissions and current revision fences.
  Credential/security recovery and remaining managed-family coverage are open.


### Real account profile snapshot integration — 2026-10-18

- Run `npm --prefix remix run test:backups:account-profile` on macOS with free
  loopback ports 28142/28144 and local `mongod`/`mongosh`. Confirm the OS isolation
  preflight denies hostname, direct-IP and redirect connections outside the
  permitted database port before any fixture starts. No permissive fallback is
  allowed. Confirm the runner removes its own
  replica/data and never connects to an existing application database.
- Register through the production handler, then change profile, notification,
  chat and Lopu settings through their handlers. Compare saved values with API
  reads, including false/absent preferences and disabled instructions.
- Interleave concurrent API mutations within the inventory reader's read-only
  Mongo snapshot. Both reads must retain the original values; a fresh session
  must see the later committed state.
- Recover from the second sealed vault after deleting the first. Restore the
  explicitly selected values through current writers with the live Lopu revision,
  then compare profile and settings API readbacks with the originals.
- Verify revoked auth cannot read the live account; offline recovery still binds
  the archived owner. Missing owner-census indexes must prevent a complete plan.
- Single-account reads must use the existing unique share-ID index, without
  weakening the separate owner/ID requirement for whole-account census paging.
- Keep HTTP/browser, managed image restoration, whole-account families and the
  product review/restore UI open; handler-level proof does not complete them.


### Paged file-sync reconciliation (PR #1002, 2026-10-18)

- [ ] Run `npm --prefix remix run test:file-sync`; include the 100,000-entry inventory and 20,000-path planner cases. Compare all four modes and both deletion policies with the whole-tree planner.
- [ ] Interrupt indexing and planning separately after a committed page, reopen the journal and verify exact ordered decisions. Partial plans must refuse reads and must not advance the live baseline.
- [ ] Place an edited descendant beyond the first page while deleting its unchanged parent on the other replica. Require a delete/edit conflict; excluded children must protect parent deletion.
- [ ] Introduce a late cross-replica case/Unicode alias or mismatched baseline, including an excluded path. Require failure with no readable partial decisions.
- [ ] Try changing scope, captures, policy, exclusions and read cursors. Run competing builders; require immutable settings, no duplicate decisions and no foreign-scope access.
- [ ] Attempt capture discard while two plans pin it. Finish one, then discard the other; only the final pin removal may permit capture discard. An initialization failure must roll back every pin.
- [ ] Verify version-3 capture migration, long-path byte bounds, and Unicode lowercasing that expands an otherwise valid filename segment. Folded cursor keys must not be validated as filesystem segments.
- [ ] Repeat the generated 20,000-decision proof in OS-isolated Chromium with two process restarts, exact path/source comparisons, input-pin checks, traces and scoped cleanup. This does not prove native transfer or lift the live scan cap.


### Paged file-sync operations (PR #1002, 2026-10-18)

- [ ] Run the shared file-sync suite and `pagedRunJournal.test.ts`. Compare multi-page copy/trash ordering with the whole-tree runner, including shallow copied parents and deepest deleted children.
- [ ] Interrupt preparation, reopen and discover the active run. Operation IDs must stay identical. Introduce a conflict beyond the first page and require all execution to remain refused.
- [ ] Lose an accepted reply, fail confirmation storage and cancel after acceptance separately. Resume with the original receipt ID; count independent effects to prove no repeat.
- [ ] Race paged preparation with legacy persistence, and two paged executors with the same Web Lock. Only one run may own a root; only the next pending operation may be confirmed.
- [ ] Refuse altered receipts, changed scope/settings, pending outcomes, duplicate IDs and changed source/target stamps. Preserve the prior checkpoint; neither completed nor uncertain paged runs may release it prematurely.
- [ ] Upgrade a version-4 database containing captures, a complete plan and a legacy run. Verify all old data before preparing the paged run.
- [ ] Repeat the OS-isolated Chromium proof with 10,001 operations and two process restarts. Verify 257 accepted receipts versus 256 confirmations at interruption and exactly 9,744 new effects after resume. Keep source metadata and independent receipt readback separate from journal assertions.
- [ ] Connect real paged native/cloud adapters and checkpoint publication, then exercise installed Mac/iOS transfers before lifting the live scan limit. Generated receipt tests alone do not satisfy this gate. Android is deferred.


## Paged sync checkpoint recovery (2026-10-18)

- [x] Run `pagedCheckpointJournal.test.ts`: refuse capture before full confirmation; retain post-copy edits; resume bounded merges and output sealing; prevent case aliases and account changes from publishing.
- [x] Interrupt between local/remote output page writes, reopen, replay the same page, and verify the previous published head survives until both outputs seal.
- [x] Verify recreated public inventory IDs cannot rebind an existing plan; original capture instances remain pinned through execution and checkpoint preparation.
- [x] Retry an old publication while a later run is active and after a later checkpoint publishes. Neither the new run nor its baseline may be released or overwritten; legacy writers and stale plans must refuse.
- [x] Isolated Chromium: three process restarts, 400 independent receipts, interruption at 257 accepted/256 confirmed, checkpoint restart at 128 paths, exact 400 baseline pairs, post-copy edit and next-run preservation. Evidence: `paged-checkpoint-evidence-2026-10-18` beside the HTML tracker. Generated metadata only; no live account or file bytes.
- [ ] Connect paged native/cloud scans, destination preparation, Trash receipt chains and checkpoint publication to the foreground/worker lifecycle; run real installed Mac/iOS acceptance before lifting the 10,000-path cap. Android remains deferred.


## Paged cloud binding recovery (2026-10-18)

- [x] Retain cloud nodes and reconciliation stamps in the same bounded page; refuse changed attachments on exact retry even when their stamps match. Validate physical ancestry, aliases and metadata-free legacy capture migration.
- [x] Reopen partial cloud preparation, preserve original parent operation IDs and exact configuration, and refuse starting until every binding is durable. Reject metadata attachment after execution begins.
- [x] Compare native Trash receipt chains across multiple pages with the original whole-run derivation, including deep descendants and wide siblings.
- [x] Exceed the expanded binding byte budget before the entry budget; resume without skipping paths. Inject a quota failure inside a binding transaction; neither rows nor cursor may partially commit.
- [x] Execute 270 generated downloads through the shared cloud transport. Reopen after 129 accepted publications/128 confirmations; require exactly 141 remaining effects, original attachment bindings and independent target receipt readback.
- [x] Repeat preparation/transfer recovery with two full isolated Chromium process restarts. Retain `cloud-bindings-evidence-2026-10-18` beside the HTML tracker; generated adapters do not count as installed-device acceptance.
- [ ] Connect stable paged producers and foreground/worker orchestration, then repeat real installed Mac/iOS transfers, permission and provider checks before lifting the live scan cap. Android remains deferred.


## Mac/iOS foreground paged recovery (2026-10-18)

- [x] Recover a 135-file foreground run after the 129th accepted effect loses its reply. Preserve original operation IDs, reject changed network conditions, publish an exact complete baseline and make the next run a no-op.
- [x] Interrupt post-run import after its first page. Reopen with fresh observation generations; do not repeat file publication. Keep another active plan's input captures pinned, and refuse replacing already sealed checkpoint inputs.
- [x] Finish uncertain legacy work with its existing IDs before migration; reject settings changes while the paged run is pending.
- [x] Persist review pages with exact retry order/digests/counts. Missing, extra or changed conflict versions keep all prepared operations unexecutable. Reopen fully stored review without another popup; require fresh choices after incomplete import.
- [x] Lose a retained-version reply, remove the local source, and resume from its accepted receipt. Repeated Ignore must upload nothing extra and must not advance the baseline. A later selected winner must still synchronize.
- [x] Isolated Chromium at 1440×1000 and 390×844: actual Mac/iOS connection component, open two conflicts, select/reset a winner, Ignore, rendered completion, reload and repeat Ignore. Compare two retained receipts, unchanged cloud revision, zero repeat upload parts and no active run with independent fixture readback. Scroll every affected view top to bottom; inspect the popup and status row for overflow.
- [x] Retain trace/screenshots/source in `paged-foreground-evidence-2026-10-18` beside the HTML plan. Verify browser/backend OS boundary against hostname, direct-IP, alternate-port and redirect probes, then remove task-owned temporary resources.
- [ ] Repeat real upload/download/two-way, permission loss, network interruption and provider acceptance in the intended installed Mac/iOS apps. Generated adapters and isolated browser fixtures do not complete this gate.
- [ ] Complete stable paged producers, worker/relaunch integration and scoped orphan/retention cleanup before lifting the live 10,000-path bound. Android remains deferred.


## Bounded foreground journal cleanup (2026-10-18)

- [x] Stop cleanup after 128 child-row deletions, reopen the journal and finish. Refuse reads and public-ID reuse while the retired header still exists; allow a new generation only after complete removal.
- [x] Keep another reader's pinned input, another account's records and unregistered captures. Late readers must not acquire a partially retired generation.
- [x] Inject a deletion failure inside the transaction: the retirement flag, cursor and all child deletions roll back together. Change accounts after a committed page and refuse further cleanup until the original scope resumes.
- [x] Repeat foreground sync seven times and compare all store counts after warmup. Preserve exact current baseline entries and avoid additional cloud effects.
- [x] Preserve an uncertain 135-operation run, its original IDs and accepted receipts. Repeat Ignore without another upload; keep the latest retained run. Independently protect active inputs when pin indexes are missing.
- [x] Retire a completed run, collect its old published checkpoint between cleanup pages, then finish the already-authorized cleanup without losing the current baseline.
- [x] Run all 246 file-sync checks, focused lint and whole-project TypeScript comparison. The existing 91 diagnostics remain; no new diagnostics were introduced.
- [x] Isolated Chromium: five Ignore repetitions on each Mac/iOS layout with stable store counts, rendered completion and independent receipt readback; a 270-entry cleanup interrupted after 128 rows and resumed after a full process restart. Scroll top to bottom and inspect the opened review and final status. Retain both traces and source hashes with the HTML plan.
- [ ] Repeat on installed Mac/iOS devices/providers and integrate stable paged producers/workers before lifting the live scan cap. Inventory data without an explicit lifecycle owner is preserved, not automatically classified as garbage. Android is deferred.


## Native single-path sync checks (2026-10-18)

- [x] Inspect real files and folders with the canonical scan fingerprint/version; distinguish missing leaves/ancestors from permission, alias, symlink, malformed-path and cancellation failures.
- [x] Inspect a directory containing 10,001 files without relaxing the complete-scan cap or retaining the directory listing.
- [x] Revoke identity or remove the selected grant during final authorization; no successful observation or byte mutation may escape.
- [x] Negotiate Mac 1.4.0/iOS 1.2.0, reject missing/breaking contracts, retain older-client and Photos fallback, and leave Android implementation deferred.
- [x] Run twenty operations through each foreground runner with two full scans; reject stale, foreign and failed point observations before writes without falling back.
- [x] Exercise real controls in isolated desktop/mobile Chromium: review both conflicts, retain versions, reload/retry without reupload, compare native request counters and retained journal records, scroll all states and inspect screenshots.
- [x] Run 249 shared checks, 66 Apple tests, 16 Mac adapter tests, 13 Electron checks, focused lint and TypeScript baseline comparison (91 existing diagnostics).
- [x] Compile the iOS simulator scheme with destination selection; do not force an iPhone SDK onto the Watch target using a global `-sdk` override.
- [ ] Verify current signed installed Mac and iOS folder operations against real native/cloud bytes and revocation through the intended app controls.
- [ ] Implement stable native/cloud paged producers and verify installed large-root traversal before lifting the live 10,000-path limit.


## Native paged folder captures (Mac/iOS) — 2026-10-18

- [x] Stream and reopen 10,001 actual files; verify exact entry set/digests, bounded pages, terminal count, later edits, owner/device/grant/generation refusal, cache eviction and metadata-only discard.
- [x] Reject truncated/corrupt capture databases and cancellation; missing rows must never become an empty or complete inventory.
- [x] Negotiate Mac 1.5.0 / iOS 1.3.0; reject incompatible/Android capabilities. Fence every capture/page reply with owner/origin/device/grant identity.
- [x] Run 135-entry planning and checkpoint publication through native pages with the legacy scan set to throw. Reject missing, reordered, substituted, duplicate and orphan pages before writes; preserve the prior checkpoint.
- [x] Regression: checkpoint captures retain their existing plain observation schema; cloud destination metadata is attached only to planning captures. Repeated runs and interrupted checkpoint imports recover normally.
- [x] Inspect real controls with generated adapters in OS-isolated Chromium at desktop/390px through the bottom and open conflict review. Confirm captures/pages/discards and retained-version receipt reuse after reload, with zero legacy root scans.
- [ ] Repeat capture/page/recovery through installed Mac/iOS picker grants and real providers. Complete stable cloud producers and worker integration before lifting the combined 10,000-path cap. Android remains deferred.


### Streamed cloud sync inventory

- Run `npm --prefix remix run test:files`, `test:file-sync`, and
  `test:files:inventory-pages`. The last command owns a disposable isolated
  replica and uses actual signup/Things/Files handlers; see README prerequisites.
- Verify missing, repeated, out-of-order, mixed-generation and trailing-error
  pages never seal or replace a complete baseline. Include incorrect physical
  `folderId` links during the post-transfer checkpoint, then recover with a
  fresh generation without duplicating writes.
- Verify the built origin advertises `api.files` 1.5.0. In Mac and iOS controls,
  exercise conflict review/retention and reload recovery; scroll the open popup
  and full page at desktop/phone widths. The Mac proxy origin response marker is
  mandatory for NDJSON as well as JSON. Refuse missing markers; never bypass it.
- Installed-device and deployed streaming acceptance remain required. A 10,001
  producer test is not proof that the live 10,000-path planner cap is removed.

### Wide-folder cloud path observations — 2026-10-19

- Run `npm --prefix remix run test:files`, `test:file-sync`,
  `test:api-capabilities` and `test:files:inventory-pages`. The large fixture must
  exceed both 10,000 siblings and 8 MiB; finding the requested item early must not
  bypass an invalid or aliased sibling later in the scan.
- Exercise an exact path, confirmed absence, case/NFC alias, duplicate identity
  across levels, inaccessible sibling, missing root, file ancestor, cancellation,
  changed plane, scratch exhaustion, failed scratch close and transaction retry.
  Only a complete authorized snapshot can return `entry:null`.
- The child-process crash check must leave no populated scratch file. Verify the
  endpoint remains private/no-store and the built origin advertises `api.files`
  1.6.0; older/missing/breaking capability versions must stop the client before a
  path request. The production-handler fixture must use real signup and Things
  writers and reject path reads after logout.
- Installed Mac/iOS, deployed proxy/server behavior, real very-wide directories,
  million-path throughput and complete large-root synchronization remain separate
  acceptance gates. Keep Android deferred and the combined foreground cap until
  bounded review and the remaining integration gates are ready.


### Bounded conflict-review draft storage — 2026-10-19

- [x] Run `pagedReviewDraft.test.ts`: interrupt indexing, reopen, save and clear
  individual choices, reject stale row/header revisions, and prevent unsupported
  source selections. Keep all unselectable conflicts visible.
- [x] Preserve v9 run data on schema upgrade; reject reused capture instances and
  foreign/stale cursors. Cancellation, account changes and quota failures must
  stop/roll back writes without losing the prior draft.
- [x] Verify long-path byte bounds, active-plan/input pins, independent root-head
  protection with damaged pins, bounded release cleanup and legacy-write refusal.
- [x] Import sealed pages into a fresh run. A changed final conflict must leave
  every prepared operation unexecutable; unchanged pages must match all choices.
- [x] Run `scripts/review-draft.browser.ts` in a task-owned Chromium profile under
  the existing OS isolation fixture: close the whole browser after saving one
  choice in 270 conflicts, relaunch, verify that exact choice, finish/seal/import
  bounded pages, release/collect and prepare 270 operations with zero effects.
- [ ] Connect the real foreground popup through editable Builder blocks, preserve
  repeat-Ignore identity, and verify save/cancel/reopen on installed Mac/iOS.
  Keep the live 10,000-path cap and Android deferral until their own gates pass.


## Paged foreground conflict review (2026-10-19)

- [ ] Use `test:file-sync` to verify sealed review recovery after partial import,
  interrupted fresh scans, older draftless runs, explicit cancel, stale revisions,
  closed callbacks and account/settings changes. No failure may start effects.
- [ ] Add, remove or edit the final conflict on a multi-page fresh scan. The full
  run must refuse before copying any earlier file and permit a fresh review.
- [ ] Compare the streamed retention identity with the old whole-JSON SHA-256
  for Unicode/escaped paths and 10,001 rows; repeated Ignore must reuse receipts.
- [ ] Run `scripts/review-draft.browser.ts` in an isolated Chromium process,
  close/reopen it and verify the saved choice, Web Crypto hash parity and bounded
  import into 270 prepared operations with zero confirmed effects.
- [ ] Product acceptance remains open: bind the paged adapter to individually
  editable Builder blocks; edit nested labels, version controls and repeated
  fields, save/reload, then exercise real Mac/iOS review, ignore and restore.
  Keep the 10,000-path cap until this complete path passes. Android is deferred.

### Paged conflict review controls

- Navigate to the last review page, go Previous and Next, close/reopen the
  review and verify exact saved choices and row ranges. Long paths must respect
  the byte limit in both directions without retaining prior pages.
- A stale choice, off-page field, repeated click or disposed view must not
  overwrite a newer choice or complete a review. Failed reads retain the prior
  page. Applying after another writer changes the header requires reload and
  fresh review; incomplete or folder-blocked choices cannot apply.
- Run `pagedReviewDraft.test.ts` and `test:file-sync`. The generated-data
  `scripts/review-draft.browser.ts` proves controller/journal restart and bounded
  handoff only. Actual editable Builder controls and installed acceptance remain
  open; preserve Android deferral and the 10,000-path limit.

### Editable conflict review acceptance

- Run `scripts/check-editable-sync-review.mjs` from `remix`, with an installed
  Playwright module. Check each row's numeric revision remains numeric through
  authored action bindings; a string interpolation must not silently lose a choice.
- Choose versions across pages, interrupt/restart the browser, and compare saved
  choices with the journal. Fail a page read: preserve rows, disable completion,
  reload, and verify Cancel, Resolve and Retain are distinct explicit outcomes.
- In Builder, separately edit the grey message, repeated path, select option and
  navigation button; save/reload. The private layout must contain no live paths,
  review handles or saved choices. Scroll top to bottom on desktop and phone.
- In installed Mac/iOS, verify the selected origin/account layout and actual
  files/Timeline after Resolve and Ignore. This last native/data-path acceptance
  remains open; synthetic UI evidence does not substitute for it.


### Mac paged foreground acceptance

- Run `pnpm --dir remix run test:files:mac-paged` after building the current
  Nitro server and `MacFolderSyncFixture` (README runbook). Require paged native
  and cloud observations, exact byte hashes, original operation receipts after
  lost cloud/staging/publication replies, and saved conflict choices surviving
  native/journal reopen. Confirm the paged baseline is published only after all
  receipts and fresh scans; completed runs are no longer the active journal head.
- Verify the disposable runner releases its two ports and child processes,
  keeps its generated credentials private, and never touches the installed app.
  Do not treat this native/API proof as installed UI or large-volume acceptance.


### Wide native publication and complete paged roots

- [ ] Run the Mac paged fixture with `-- --wide`: all cloud folders must be
  created through the Things import API. Require complete 10,003-path local and
  remote checkpoints, full byte hashes, accepted-reply recovery, and no repeated
  transfers on the unchanged rerun. Keep installed/provider acceptance separate.
- [ ] Verify native publication/lookup and Trash/restore with 10,001 siblings;
  alternate case/Unicode paths must still refuse before a write. Reopen receipts
  and compare the retained/restored bytes, including occupied destinations.
- [ ] Native Mac access 1.5.0 and iOS 1.3.0 must keep bounded legacy behavior;
  1.5.1/1.3.1 may use the complete paged path. A missing paged review or individual
  path adapter must preserve the 10,000-path limit and the previous baseline.
- [ ] Retired metadata cleanup must delete at most 128 keys per step, preserve
  other scopes and current pins/baselines, and roll back retirement plus all
  queued range deletions when storage fails before transaction completion.

- [ ] Large-root cleanup: confirm each page starts at its first remaining key,
  preserves the 128-key/byte bounds and active recovery, and finishes after
  restart without repeatedly traversing the deleted prefix.


### Saved native approval checks for background recovery

- On Mac publication 1.2.0, `write-check` must never open a consent dialog or
  write a new approval. Approve explicitly once, recreate the adapter, and
  verify the exact account/origin/device/connection/revision/settings/Trash
  binding survives. Missing or changed approval must refuse without fallback.
- Revoke the account, selected grant or exact approval during the final native
  identity verification. Both approval replies must fail rather than expose a
  stale success. Retained bytes and other approvals must remain intact.
- Revoke saved approval between target creation and staging, publication or
  Trash. The shared target must stop before new effects; read-only receipt
  recovery must continue through its normal authorization checks.
- Run `mobileSyncTarget.test.ts`, `MacFolderSyncTests`, Electron folder-sync
  tests and `test:files:mac-paged`. The HTTP fixture now explicitly grants once,
  then uses only saved-consent checks across all lost-reply/process restarts.
- Installed app/dialog acceptance and closing the connection screen while a
  durable whole-folder worker runs remain separate, incomplete checks.


### App-owned Mac sync lifecycle

- Start a long transfer, leave Files, and reopen while a native scan is still
  pending. Progress, Stop transfer and saved conflict choices must be available
  immediately; host re-negotiation must not queue ahead of the controls.
- Stop after reattaching: no aborted-host render exception or error-boundary
  screen. Retry uses the existing operation IDs and unchanged data is not copied.
- Close the Mac window during transfer, reopen from Dock, then Quit. Close keeps
  the same live renderer; Quit stops it. Account/endpoint changes must cancel and
  clear private task state. Verify in the installed signed app before acceptance.
- `npm --prefix remix run test:files:desktop-lifecycle -- <evidence-directory>`
  covers production views, task handoff and IndexedDB with synthetic API/native
  adapters on isolated loopback 28188. Check desktop/phone and full-page scroll.
- `npm --prefix electron run verify:folder-sync-host` restricts the real Electron
  fixture to loopback 28421/28422. Fail closed if nested Chromium sandbox setup
  fails; never use a permissive fallback. Unit window-lease tests do not prove
  native Close/Quit acceptance. Full-quit automatic resume remains unimplemented.

### Durable Mac sync admission and relaunch

- Run `npm --prefix remix run test:file-sync` for admission migration, bounded
  per-account discovery, stale-state refusal and durable Stop coverage.
- Run `npm --prefix remix run test:files:desktop-lifecycle -- <evidence-dir>`.
  Terminate the isolated browser after the synthetic cloud commit but before
  the reply; reopen with Files absent and verify identical job/destination IDs.
  Wrong account, changed origin and revoked grant must cause no scan or write.
  A stopped job must remain paused on restart. Open conflict controls and scroll
  desktop and phone views fully; preserve saved choices and both versions.
- Installed acceptance remains required: signed Mac Close/Quit/relaunch/reboot,
  offline-to-online and power changes, native approval revocation, real Files
  targets, and independent exact bytes/Timeline receipts. The isolated UI
  fixture cannot establish these installed/physical-provider behaviors.


### Automatic Mac sync schedules

- In the isolated lifecycle fixture, edit heading, help, interval option and
  button separately in Builder, save/reload, then exercise the edited controls.
- Start a one-minute schedule, leave Files, add a local folder, and verify no
  copy before due time. Verify the next cycle copies it once, retains the
  interval and rotates only the cycle ID. Restart the entire Chromium process
  and verify a future cycle is not replayed early; advance to its due time.
- Install the test clock before app timers are created. Read the scheduled job
  as one exact IndexedDB snapshot, and fail if the next cycle never finishes.
- Switch selected server: no scan and no idle window retention. Stop between
  cycles, advance time, restart and verify no scans. Test completion racing
  Stop, stale callbacks, quota failure and bounded competing revisions.
- Repeat native installed Close/Quit/reopen, sleep/wake, offline/online and
  permission loss with independent byte/Timeline checks before marking worker
  acceptance complete. Android remains deferred.


### iOS saved folder approval

- Run `MobileWriteApprovalTests` and `MobileSyncStagingTests` on a task-owned
  simulator. Recreate the native bridge and reuse exact saved consent without
  opening a prompt or writing another grant. Missing consent must fail promptly.
- Change owner, server, paired-device authority, configuration revision/hash or
  Trash consent. Remove the folder or replace its approval during the final
  asynchronous device check. Every case must fail without returning authority.
- Verify publication 1.2.0 per writable folder; photo roots expose no publication
  capability and reject write checks. Run the shared target suite for both Mac
  and iOS: check saved consent before staging/publication/Trash; legacy iOS must
  refuse automatic resume without silently opening a consent dialog.
- Repeat with real pairing, picker grants and revocation on an installed iOS app
  before claiming provider or background-worker acceptance. Synthetic bridge
  authorization is not evidence of physical-device background execution.

### App-owned iOS file sync recovery (2026-10-19)

- Run `npm --prefix remix run test:files:ios-lifecycle` and the desktop lifecycle
  regression. Navigate away during a native request, restart after an accepted
  cloud write with an unobserved reply, and verify unchanged job/operation IDs.
- Hide the iOS view with no native lease: no new native or API effects may start;
  returning visible resumes the durable runnable job. End an accepted file lease
  while still hidden and verify the next effect is fenced immediately.
- Reopen Files during execution: progress/review/Stop reattach, while folder
  selection and checks cannot compete for the native controller. Stop must remain
  paused after restart. Changed account, origin, bridge, device or grant must not
  borrow previous authority. Older iOS and deferred Android must not opt in.
- Repeat on the intended signed physical iPhone using actual folder data and
  independent byte hashes; simulator/browser fixtures alone do not close native
  suspension, OS expiry or relaunch acceptance.


### Paged selected-folder backups (2026-10-19)

- Run `npm --prefix remix run test:backups` and the shared inventory decoder
  tests. Capture 10,051 generated nodes plus the root using bounded pages, seal
  the manifest in Thing-ID order and independently compare recovered file bytes.
- Reject duplicate IDs across pages, normalized path aliases, missing or wrong
  physical parents, selected-root cycles, truncated streams and trailing errors.
  None may publish a durable header or plan. Scratch disk exhaustion and
  cancellation must invalidate the workspace and remove its private files.
- Older origins must refuse new paged captures. Frozen plans must retain their
  existing format and resume without new inventory using Files 1.2.0.
- Run `node remix/scripts/test-cloud-inventory-pages.mjs`: the OS-isolated
  disposable replica uses production signup, Things, Files and auth handlers;
  preserve 135 folders plus the root in a sealed vault after a later live edit.
- Keep HTTP/installed-app acceptance, source retention leases, independent cloud
  replicas, 100 GB–100 TB throughput and paged whole-tree restore open. This
  worker change does not establish those behaviors.

### Large selected-tree restore (2026-10-19)

- Restore a three-level tree spanning folder pages with child IDs ordered before
  their parents. Every descendant must resolve; completing one depth before
  advancing prevents valid trees being misreported as disconnected cycles.
- Run `test:backups`. Keep the 10,051-folder plus file restore/resume regression,
  zero source reads for already published bytes, legacy v1 review-hash agreement,
  and actual CLI review of over 32 MiB metadata with a 64 MiB V8 heap limit.
- Verify scratch-budget exhaustion, cancellation, closed-plan use, missing and
  non-folder parents, disconnected/root cycles and Unicode/case aliases refuse
  before destination writes. Normal completion/errors must remove scratch.
- Retain process-exit, lost-range acknowledgement, concurrent invocation,
  unexpected output, newer edits, missing empty folders and symlink checks.
  A completion marker requires the full inventory and final identity checks.
- These generated/offline cases are not physical-device, whole-account or
  100 GB–100 TB throughput acceptance. Re-run actual native/provider restore
  acceptance when those adapters are connected.


### iOS native bridge fixture lifecycle (2026-10-19)

- Retain a real scene-backed window for every bridge WebView, and remove it in
  teardown. Fail explicitly if no scene connects, UIApplication stays inactive
  or the loaded page has the wrong origin; never skip or inject an active state.
- Run the 66 selected `MobileDevicePairingTests`, `MobileFolderInventoryTests`,
  `MobileSyncStagingTests`, `MobileSyncTrashTests`, `MobileWriteApprovalTests`
  and `NativeUploadBackgroundTests` on a task-owned iOS 27 simulator. Verify
  all 13 bridge cases complete and the non-bridge filesystem regressions pass.
- Repeat on the signed physical test host before replacing the historical
  53-pass/13-fail hardware result. Simulator success does not prove real picker
  grants, physical background expiry, OS scheduling or installed recovery.

### Independent S3 backup replica worker — 2026-10-19

- Run `npm --prefix remix run test:backups`. The S3 suite uses the real AWS SDK
  against an ephemeral loopback protocol fixture and only synthetic credentials.
- Verify conditional immutable writes, identical concurrent retries, bounded 409
  conflicts, a lost acknowledgement, scope separation, redirects, denied/missing
  buckets, unsafe keys/destinations and oversized/truncated/corrupt response bytes.
- Regression: the SDK must not mutate a vault-owned credential object; a reused
  strict credential handoff must stay valid. If account scope changes while the
  credential provider awaits, zero network effects may occur.
- Kill the real `backup:replica upload` child after the first 8 MiB object is
  accepted. No complete seal may exist. Resume the same snapshot: that object
  must have one successful write, 8 MiB reused and only 17 additional bytes copied.
- Remove the primary local vault; download into a new private vault and compare
  SHA-256 with the original bytes. A second download copies zero new bytes.
- Refuse wrong-account, expired-credential and non-opted-in HTTP handoffs before
  any network request. No secret value may appear on stdout/stderr. Revoking
  access in the progress callback before verification must prevent completion.
- Live-provider IAM, retention/durability, encryption/key recovery, actual vault
  selection, scheduled native jobs and UI remain unverified. Run those paths
  before offering independent cloud backup; this fixture is not 100 TB evidence.

### Backup retention and deletion races (2026-10-19)

- Run `npm --prefix remix run test:attachments:retention`: real disposable Mongo
  transactions/Request handlers must prove owner-only exact-version holds, atomic
  batch refusal, concurrent renewals, no byte double-charge, no premature refund,
  expired renewal refusal and exactly-once purge/refund. Object storage/expiry
  clock are synthetic; do not count this as live provider acceptance.
- Run the backup, attachment and capability suites. Refused holds must copy no
  bytes; long captures renew; expiry/session revocation cannot return protected
  bytes or publish completion; resumed complete receipts must not read lost sources.
- Live acceptance remains required: upgrade/drain every deletion/reaper writer
  sharing storage, verify provider lifecycle retention, begin a large snapshot,
  request source deletion, interrupt/restart, verify its independent bytes, then
  expire the hold and confirm exact quota reconciliation. Exercise installed
  Mac/iOS job controls when connected; Android remains deferred.

- Desktop snapshot retention: allow content POST only for the pinned server, exact actor, home data plane and same local origin; changed/missing scope or cross-site requests must fail before reading mutation bytes. Covered by `server/utils/apiFallback.test.ts`.

### Home upload exclusions and hierarchical progress (2026-10-19)

- Apply the Mac home-backup preset to an existing draft: retain selected roots
  and custom exclusions, add Library/Applications/.Trash, set backup/paused and
  disable delete propagation. Pending saves and Photos sources must refuse it.
- Excluded native directories must be pruned before access, traversal or hashing;
  an excluded unreadable directory must not fail an otherwise valid scan. Test
  nested/case/Unicode boundaries, malformed/oversized policies and capture-ID
  reuse with a changed policy after success or failure. Older hosts and leaked
  excluded inventory rows must fail closed; Android behavior stays deferred.
- Progress: unknown index totals remain indeterminate; verify empty/unchanged,
  zero-byte files, nested mixed-size parents, partial bytes, pause/error, resume,
  page boundaries and completed retained metadata against independent receipts.
  Never count the final byte callback twice or show 100% before confirmation.
  Account/origin/root changes and malformed cached descriptors must not leak or
  crash. Completed display reads must not reactivate retired run writes.
- Run the file-sync suite and the isolated home-upload/desktop-lifecycle browser
  harnesses. In actual Builder, independently edit a heading, help, control and
  repeated-row field, save/reload, then exercise expand/collapse, pagination and 13-level focused-folder/parent/root navigation.
  Scroll desktop 1440/mobile 390 top to bottom and inspect overflow/stacking.
- Before declaring ready for real upload, exercise the matching deployed API and
  signed installed Mac with the reviewed home grant/exclusions; compare actual
  transferred bytes and parent totals. Synthetic fixture success is not this
  release acceptance. Retain Android's later-date status and original app data.


### Transfer speed windows (2026-10-19)

- Check each decimal bit unit and logical file/folder/inode unit independently
  for upload and download, including non-aligned rolling-window boundaries,
  large counters, idle zero, unknown byte telemetry, pause/resume, account change
  and at least 24 hours of bounded history. Retried receipts and retained offsets
  must not inflate either direction. Journal failure must not count a completion.
- Add multiple trackers with different windows, apply and save their settings,
  reload, remove one and save again. Invalid windows must remain rejected.
  In actual Builder edit each tracker label, control and reading separately.
  Check save-in-flight controls and desktop/mobile full-page overflow.
- On the signed installed Mac, compare real transferred payload totals and
  logical confirmations against the live readings. Verify native adapters that
  omit telemetry show unavailable rather than a fabricated rate. Synthetic
  fixture checks do not establish installed or provider throughput acceptance.
