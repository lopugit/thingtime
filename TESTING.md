# TESTING.md — per-area manual test checklists

Run the checklist for every area a PR touches, in a live browser against the
local dev stack (`npm run web-pms`, worktree stacks get their own port trio —
see `AI_ALL.md`). Each list is the distilled regression history of that area:
every line exists because it broke once. Add a line whenever a new bug class
is fixed, and cite the checklist you ran in the PR description.

## Passkeys + cross-deployment auto-login

- [ ] Settings → Security → "Add a passkey ✨": wrong password → error toast,
      no platform sheet; correct password → the browser/1Password/iCloud sheet
      opens and the saved passkey appears in the list with provider name,
      created date, and your nickname. Cancelling the sheet shows NO error
      toast (cancel is silent).
- [ ] `node scripts/verify-passkeys.mjs` (from `remix/`, dev stack up) passes
      44/44 — full software-authenticator ceremony: registration, duplicate
      409, challenge replay refusals, usernameless login, lastUsed + linked
      apps, revocation blocking login, revoke-before-delete, hint liveness.
- [ ] Login page: "Sign in with a passkey 🔑" completes a login (platform
      sheet → welcome toast → roster merged, other accounts untouched); the
      username field offers the browser's own passkey autofill popup
      (conditional UI) on browsers that support it.
- [ ] Revoked passkey: revoke (password-confirmed) → the passkey stops logging
      in IMMEDIATELY (401), stays listed with a Revoked badge, Delete appears
      only after revocation and asks for the password again.
- [ ] Passkey login bypasses email-OTP 2FA (a 2FA-enabled account logs
      straight in with a passkey — the passkey is the second factor).
- [ ] Auto-login popup: with a live session on another `*.thingtime.com`
      deployment, a signed-out visit shows the "Continue as… ✨" corner card;
      picking an account routes to `/login?u=<username>` with the username
      prefilled and password focused; "Not now" snoozes it for a day; it never
      renders on `/login`, `/register`, `/authorize`, `/reset-password`, or
      while signed in.
- [ ] Hint liveness: log out on the OTHER deployment → the suggestion
      disappears here on the next fetch (hints resolve live sessions, never a
      cached identity). `GET /api/v1/auth/account-hints` responses carry no
      email — only id/username/displayName/avatarUrl.

## Login with Thingtime anywhere (federated hints + SSO handoff + FedCM)

- [ ] Commander desktop OAuth: from the signed macOS Commander app, open
      Thingtime login and complete consent in the system browser. The callback
      must reach only Commander’s exact `127.0.0.1` loopback origin, exchange
      a one-time S256 PKCE code, and create the expected Keychain-backed
      account. Replaying the callback code, changing the callback URI, or
      changing the verifier must fail without creating another grant.

- [ ] `node scripts/verify-federated-login.mjs` passes (31 checks) against two
      stacks on DIFFERENT databases (recipe in the script header — stack B
      must be a production build; a second dev stack silently shares `.env`'s
      database). Proves: per-environment hint authority + federated resolve
      (CORS allow family / deny others, read-only), handoff aud binding,
      cross-environment fail-closed, single-use + replay-revokes-session, and
      the full FedCM accounts→assertion→session loop.
- [ ] On a `*.thingtime.com` page, DevTools → Network shows at most
      `MAX_FEDERATED_ORIGINS` (4) `/account-hints/resolve` fan-out fetches,
      only for origins the local endpoint reported `unresolved`, and the
      popup/login strip merges accounts without duplicate users.
- [ ] On a NON-thingtime origin (immutable `*.vercel.app` preview) while
      signed out: the corner card offers "Sign in with Thingtime 🌈" (never
      the hints list); the button opens the `/authorize?self=1` popup, the
      popup shows "Continue to <host>?" with the ACTIVE account, Continue
      signs the page in (welcome toast) and the popup closes; Cancel closes
      with nothing shared. In Chrome with FedCM available, the native
      "Continue as" sheet ALSO auto-appears on page load (no click; the
      browser's own dismissal cooldown governs re-prompts) and completes the
      same loop. Until the hub code is live on production thingtime.com, set
      `localStorage['tt-sso-hub'] = '"https://pr-<N>.previews.dev.thingtime.com"'`
      (JSON string, matching localCache format) on the foreign origin to
      point both flows at a preview hub sharing the deployment's database.
- [ ] The `/authorize?self=1` popup signed OUT shows the embedded login (with
      the cross-deployment hints strip) before the confirm card.
- [ ] Replaying a captured sso-session code fails AND kills the session it
      minted (theft response); a code redeemed on the wrong origin 403s; an
      expired (>2 min) code 401s.
- [ ] FedCM endpoints refuse non-browser fetches (no
      `Sec-Fetch-Dest: webidentity` → 400) and `/fedcm/accounts` 401s when
      signed out.

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
      `github-actions` and duplicate SHAs skip, a valid Nitro artifact is
      staged at root, and invalid source output preserves the prior artifact.
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

- [ ] Reload a post with a rich comment using Rows or Grid. Its chosen
      `mediaLayout` (including columns/pattern and non-default spans) survives
      the feed, profile, and `/post/:id` projections rather than silently
      falling back to masonry.
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
      returns the public key, ordered waterfall, and the base-model catalog
      with per-model `provider`, `efforts`, and `speeds`; `POST` returns 401.
      A signed-in non-admin `POST` returns 403, while an admin can save a
      valid reordered waterfall.
- [ ] Settings → Admin paints the last-known waterfall immediately, then
      reconciles in the background. Via the Add-fallback picker, add a Claude
      model with an explicit effort, an OpenAI model with effort + Fast, and
      at least five total entries (more than the historical 3-entry cap);
      drag a row by its dedicated handle, use the Up/Down controls, remove a
      non-default row, save, reload, and confirm the exact order persists.
      `default` stays present and cannot be removed. The effort select only
      offers that model's tiers and the speed select only appears for models
      with a fast lane; re-adding an already-listed combo is blocked.
- [ ] Exercise the editor at desktop and mobile widths from the top to the
      bottom of `/settings`: model names, provider/effort/speed subtitles,
      handles, the add-fallback picker row, and save/add/remove controls
      never clip, overlap, or create horizontal scrolling.
- [ ] Composed variant ids (`<model>[:<effort>][:fast]`) validate per model:
      efforts a model does not support, `fast` on a model without a fast
      lane, and duplicate segments are rejected on write; reads drop unknown
      entries without discarding the rest of the order and always keep
      `default` present.
- [ ] Resolver workflow config parsing in the `github-actions` control plane
      (PR #391) validates the widened-but-closed grammar: unique 1..256
      entries matching `^[a-z0-9][a-z0-9.:-]{0,63}$`, parsed into
      model/effort/fast segments. Claude Code runs `default` plus `claude-*`
      bases (rebuilt from the closed pattern, variants collapse to one CLI
      slot per base); OpenAI entries are skipped with a log line; the
      primary entry's effort becomes the session `--effort` (default max)
      and fast mode is logged as not applied headless. Malformed JSON,
      unknown/duplicate/empty segments, oversized arrays, or an unavailable
      endpoint fail closed to `--model default --effort max` with a warning;
      `default` is appended defensively and no stored value can inject
      another CLI flag. Control planes predating PR #391 fail closed to
      `[default]` for any non-legacy entry.
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
      Anthropic request uses the first Anthropic-capable Admin entry — model
      plus any explicit effort (`output_config.effort`) and fast mode.
      Reorder from Opus to Fable without restarting the app; the next musing
      must use Fable. An OpenAI entry ordered above the Claude entry must not
      change the Anthropic request.
- [ ] Put `default` first and request an Anthropic-backed Lopu musing. It must
      use the provider-valid `LOPU_CLAUDE_MODEL` fallback, never send the
      literal Claude Code `default` sentinel to Anthropic. With
      `LOPU_PROVIDER=openai` and an OpenAI entry configured, the OpenAI call
      must use that entry's model/`reasoning_effort`/priority tier; with no
      OpenAI entry above `default` it must retain `LOPU_OPENAI_MODEL`. If it
      falls through to Claude, that Claude call must still resolve the
      current Admin preference. A rejected effort/fast knob retries once bare
      on the same model before the provider is skipped.
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
- [ ] Seed a canonical attachment with every protected object-accounting root
      field, then dry-run and run `backfill-user-storage-accounting`. Both
      passes retain the complete attachment envelope while calculating exact
      bytes, converge to zero pending, and never misclassify the attachment as
      `InvalidAttachmentStorageEnvelopeError` because of a Mongo projection.
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
- [ ] Member batch durability fault injection: a membership `insertMany` with
      only duplicate-key write errors stays idempotent, while the same result
      plus a write-concern failure returns an error instead of reporting a
      successful chat creation or member add.
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
