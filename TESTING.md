# TESTING.md — per-area manual test checklists

- Thing detail back links accept only `things`, `actions`, or `feed` as `from`.
  Unknown values and prototype keys such as `toString` must display a working
  Back to feed link on desktop and mobile.

- Rich-text editors initialize when a browser omits `crypto.randomUUID`.
  Multiple mounted editors of the same saved block keep independent tune IDs;
  plain registry identifiers are never treated as credentials.

- At 390px and desktop widths, the Lopu message input stays inside its composer
  card after typing and resizing. Measure the textarea and card bounds, not
  just document width (a clipped ancestor can hide overflow). Open/close chat
  settings and inspect the bottom controls after scrolling.

- Combined Watch/Lopu/Builder release: build both embedded native targets;
  iOS-only ActivityKit source must not compile into watchOS. Nested Builder
  `ttArg` and `ttFormat` data must share the existing output-size budget and
  must not execute template-shaped action result data. Confirm logout clears
  Watch history, passkeys, Builder source/detail data and Lopu chat caches.

- Signed-out first paint: `/`, `/builder/demos`, and `/watch/pair` must render
  without a Watch approval banner exception. Account switching and temporary
  sessions never show another account's cached Watch requests; expired and
  dismissed requests stay hidden.

- Watch release integration: the Nitro health contract smoke accepts documented
  `degraded` / `migration-required` responses, but rejects contradictory readiness
  or unavailable storage. Separately require `ready` on the release deployment;
  passing the contract smoke alone is not proof that uploads are enabled.

Run the checklist for every area a PR touches, in a live browser against the
local dev stack (`npm run web-pms`, worktree stacks get their own port trio —
see `AI_ALL.md`). Each list is the distilled regression history of that area:
every line exists because it broke once. Add a line whenever a new bug class
is fixed, and cite the checklist you ran in the PR description.

## Native Commander network speed test

- [ ] Account allowances: Free 4/hour, Plus 20/hour, Pro/PAYG unlimited by
      default; admin overrides and historical tier snapshots remain effective.
      Back-to-back tests work within the budget. Changing IP or session never
      resets an account budget; different accounts do not share an IP quota.
- [ ] Invalid/revoked or wrong-origin account tokens fail without guest fallback.
      A selected locked account must prompt sign-in/unlock, not run anonymously.
- [ ] A quota-denied zero-sample retry preserves the previous speed readings.
      Switching accounts clears prior-account results and rejects stale replies.
- [ ] Settings → Account → Compare account features shows the live tier
      allowances at desktop/mobile widths. Admin tier and subscription editors
      expose speedTestsPerHour, with null for unlimited and 0 for disabled.

- [ ] Activity: run one 17.6 MiB each-way test against the deployed origin;
      confirm 5/5 download and upload samples, no 400/413, and no upload request
      exceeds 2 MiB. Wait through a latency refresh: both speed values remain.
- [ ] A streamed upload without Content-Length succeeds only for the exact
      allowlisted byte count; short, oversized, and false-length bodies fail.
- [ ] Interrupt a direction or hit its cooldown: completed measurements remain
      visible, partial results are labelled, and Retry-After is actionable.
      Opening a second Commander window must not duplicate an in-flight test.
- [ ] Both capability manifests advertise download 1.1.0 and upload 2.1.0; incompatible/missing
      capabilities are rejected before transferring the speed-test payloads.

## ChatGPT / Codex MCP connector

- [ ] `GET /.well-known/oauth-protected-resource`, `GET
    /.well-known/oauth-authorization-server`, and the Thingtime capability
      manifest return the deployed HTTPS origin and the MCP path exactly.
- [ ] From ChatGPT Developer mode, add the deployed MCP URL. The authorization
      page works at desktop and a 390px mobile viewport, requires `resource`,
      state, and S256 PKCE, and never reflects a personal access token in the
      redirect or an error page.
- [ ] The OAuth connection page starts with Thingtime SSO rather than a token
      form. After SSO, its background-generated default is non-expiring
      read/write-all Things access; Advanced settings can narrow scopes,
      regenerate the generated token (revoking its predecessor), and add a
      manually scoped additional account without exposing a credential to a
      chat, redirect, or error page.
- [ ] After selecting Connect Thingtime, the page visibly enters its
      completion state, reports an in-page error if preparation fails, and
      only then navigates to the exact registered OAuth callback.
- [ ] Connect two PAT-backed accounts at different explicitly allowed origins;
      list/select them in ChatGPT and verify reads use the selected account.
      An unallowlisted endpoint, non-PAT credential, read-less PAT, replayed
      authorization code, altered callback/resource, or altered verifier must
      fail closed.
- [ ] In an unauthenticated existing chat, `@Thingtime login` reaches the MCP
      tool (rather than failing as an HTTP transport error), returns its
      tool-level `mcp/www_authenticate` challenge, opens that chat host's OAuth
      browser, and returns only through its registered callback. Without
      starting a separate CLI listener or a new chat, add two named accounts on
      that page, then confirm `@Thingtime list accounts` exposes safe metadata
      for both. Bridge credentials have no default expiry but become unusable
      immediately after their account or connection is revoked.
- [ ] Confirm a read/search tool succeeds with `things.read`, while each write
      tool asks for ChatGPT confirmation and the target API rejects a PAT that
      lacks its exact Things scope. Disconnecting an account removes its bridge
      access; removing the last account revokes the ChatGPT bridge session.
- [ ] With a known Thing ID outside the first recent/list page,
      `get_thingtime_thing` calls the exact-ID API and returns that Thing or the
      stable `thing_not_found` error; it never falls back to list/search. With a
      known parent ID, `list_thingtime_comments` returns only directly attached
      comments and preserves `limit`/`cursor` pagination without fetching global
      comment rows.
- [ ] `tools/list` exposes all 32 tools with the Thingtime MCP App output
      template; prompts and static UI/contract resources work before OAuth,
      while account-scoped resources return the OAuth challenge. In the app,
      inspect Result, Diff, and Raw tabs at desktop and 390px mobile widths,
      select multiple rows, expand details, and verify Apply stays disabled
      until the explicit confirmation checkbox is checked.
- [ ] Preview a create/update/delete plan with least-privilege scopes. Change
      one target after preview and verify apply returns 409 without performing
      any operation; with fresh preconditions, verify serial apply, honest
      partial failure receipts, encrypted history, and undo-as-a-new-preview.
- [ ] Create a valid `Thingtime Capability` data Thing with `$input`
      placeholders, start it, and verify its exact signed preview must match the
      persisted workflow run. Reject missing inputs, duplicate targets, more
      than 25 operations, raw query/operator keys, URLs/routes, and code.

## Limitless MCP Lab (`/docs/mcp`)

- [ ] On a production-CSP preview, the embedded review app renders its Result,
      Diff, and Raw tabs instead of remaining on the empty placeholder; the
      route CSP permits only the review module's exact SHA-256 hash and keeps
      `unsafe-inline` / `unsafe-eval` absent.

- [ ] Open `/docs/mcp` at desktop and 390px mobile widths. Confirm the live
      contract badge resolves without replacing the optimistic release counts,
      all six stat cards fit without horizontal overflow, and the docs drawer
      opens, closes, and identifies **Limitless MCP Lab** as active.
- [ ] Select all five missions. Each selection must update the prompt, expected
      outcome, ordered tool pipeline, and embedded review cards without a page
      reload; **Copy** copies only the selected prompt.
- [ ] In the embedded shipped MCP App, inspect Result, Diff, and Raw; select a
      row, expand Full details, and scroll to the bottom. The read-only morning
      mission must not show an Apply control. Write-composing missions must keep
      Apply disabled until the confirmation checkbox is selected, then fail
      closed with the host-only message rather than mutating data.
- [ ] Load the page with MCP discovery unavailable. The release contract and
      workflow cards remain immediately usable, the page shows the quiet
      release-contract state, and no spinner, blank page, recursive request,
      iframe error, or console exception appears.

## Admin integration vault + policy proxy

- [ ] Sign in as an admin and open **/admin → External integrations**. Without
      `THINGTIME_ADMIN_VAULT_KEY`, the visible warning explains setup and
      **Save secret** is disabled; no browser request reveals a credential.
- [ ] With a disposable 32-byte base64url vault key, save a labelled Vercel
      token. Refresh and confirm its row shows only label/id/date—not masked or
      plaintext value. Deletion is blocked while an endpoint references it.
- [ ] Save a Vercel endpoint with read + **Create new items only**, then verify
      an existing environment key is blocked before POST and the redacted audit
      contains only operation, path, status, and outcome—never body, token, or
      secret value. Generic endpoints cannot claim create-only semantics.

## Lopu voice + personal Secure Vault

- [ ] Open `/lopu/voice` at desktop and 390px mobile widths; scroll the
      conversation from top to bottom, open and close the gear before and
      during a session, and confirm the header, the gear popover, messages
      and the voice deck never clip, overlap, or cause horizontal page
      scrolling.
- [ ] Add a disposable provider in **Settings → Secure Vault**, grouped under a
      test environment. Refresh and verify only metadata returns to the
      browser—never plaintext, masked text, IV, tag, or ciphertext. Updating
      without a new token retains the stored token; deleting removes it.
- [ ] Select that provider for the chat (the gear's provider select or the
      composer's picker). Confirm continuous listening pauses while the
      provider responds and while Lopu speaks, then resumes without hearing
      Lopu's own voice. Toggle **Spoken replies** before, during, and after
      the session and verify replies render, and speak only while it is on.
- [ ] Verify a provider connection's model is optional. The Secure Vault form
      offers the kind's catalog models (realtime voice models marked) plus a
      **Custom model id…** entry and shows the chosen model in the stored
      metadata line; a custom compatible host requires a model id. A
      connection saved without a model runs on its kind's first catalog model
      (`GET /api/v1/ai/models` → `vaultProviders[].model`), and a turn's meta
      names that model. Reasoning and speed are chosen per chat in the
      composer, never stored in Secure Vault.
- [ ] Exercise **Direct voice**. With no provider chosen, a catalog model, a
      provider whose kind has no realtime model (any non-xAI connection), or
      Transcribe mode on, the gear's switch is disabled and its hint reads the
      reason in one line; Settings → Lopu 🦄 mirrors the switch. With an xAI
      connection the switch enables, a realtime-model select appears
      (Grok Voice / Grok Voice Think Fast 2.0), and starting the mic mints a
      credential through `/voice/session` — the network log shows only the
      ephemeral token and `wss://api.x.ai/v1/realtime?model=…`, never the
      stored key — then streams PCM both ways; the provider's transcripts and
      reply text land in the conversation list, Spoken replies off suppresses
      playback, and Stop closes the socket. When the mint is refused (vault
      key missing, connection not yours) a Lopu toast says why and device
      transcription runs.
- [ ] Turn on **Transcribe mode**, speak several final utterances, and verify
      each creates a separately numbered, timestamped, owner-private Thing page
      and streams back into chat as a quote with a working page link. Provider
      selection and Direct voice stay disabled and no provider request occurs
      in this mode.
- [ ] Reject unauthenticated vault/voice/session requests, non-JSON bodies
      (415), guest sessions (403), oversized bodies, missing provider tokens,
      non-HTTPS or private/local endpoints, unallowlisted custom hosts,
      private DNS resolutions, redirects, oversized provider responses, and
      rate-limit-store failures. Error responses must not echo provider
      bodies or credentials; `/voice/session` refusals carry no `session`.
- [ ] Make the provider answer a **non-JSON rejection** — an HTML or empty-body
      429/502/504, the shape an edge/CDN returns before the API is reached —
      for both the voice turn and `/voice/session`. The Lopu toast must name
      the status ("rejected the request (429)"), never "unreadable response":
      the status is the only thing telling the user whether to wait, re-key,
      or pick another model. Covered by `npm run test:lopu`
      (`app/api/utils/lopu/voice.test.ts`).
- [ ] In the iOS app, grant microphone and speech access from the user action,
      start Lopu, lock the device, and verify recognition/replies continue and
      the Live Activity moves through listening, thinking/transcribing, and
      speaking. Confirm native reply requests carry only unexpired cookies
      matching the active Thingtime origin and API path. Stop the session and
      confirm the microphone, audio session, and Live Activity all end.
- [ ] In iOS direct voice (`inputMode: provider-audio`), deny Speech
      Recognition but allow Microphone; the session should still start,
      stream and play realtime audio under the background audio session,
      update the Live Activity while locked, post the provider's transcripts
      into the conversation, and close its WebSocket and player cleanly on
      Stop.

## Deployment peer explorer (`/peers`, `/api/v1/admin/peers`)

- [ ] As an administrator, open **Dev → Deployment peers**. Verify the first
      page retains current rows while Refresh runs, requests at most 25 rows,
      and **Load next bounded page** advances only one opaque cursor page (no
      all-peers request or automatic unbounded hydration).
- [ ] Exercise Grid, Cards, and List at desktop and 390px widths. Search
      origin, `active`/`expired`, a signing-key fragment, and each displayed
      timestamp via the property selector; every view shows the same filtered
      rows with no horizontal page overflow (the List table itself may scroll).
- [ ] As a non-admin or signed-out user, `/peers` shows only the quiet access
      gate and `GET /api/v1/admin/peers` returns 401/403 with private no-store
      headers. Confirm no browser response contains `syncCursor`, request
      signatures, a peer secret, or a private key.

## Admin integration vault + policy proxy

- [ ] Sign in as an admin and open **/admin → External integrations**. Without
      `THINGTIME_ADMIN_VAULT_KEY`, the visible warning explains setup and
      **Save secret** is disabled; no browser request reveals a credential.
- [ ] With a disposable 32-byte base64url vault key, save a labelled Vercel
      token. Refresh and confirm its row shows only label/id/date—not masked or
      plaintext value. Deletion is blocked while an endpoint references it.
- [ ] Save a Vercel endpoint with read + **Create new items only**, then verify
      an existing environment key is blocked before POST and the redacted audit
      contains only operation, path, status, and outcome—never body, token, or
      secret value. Generic endpoints cannot claim create-only semantics.

## Passkeys + cross-deployment auto-login

- [ ] TestFlight passkey updates preserve the embedded Watch companion, both production push entitlements, the configured preview origin and matching phone/Watch build numbers; the signed phone includes `webcredentials:thingtime.com` and Apple CDN association matches it. Verify saved-key sign-in on a real device.
- [ ] Slow login-options response + immediate passkey click or navigation: the old autofill request never opens a sheet or submits an assertion. Repeat with account-switcher login and the auto-login popup.
- [ ] With 1Password enabled, click passkey sign-in, then Cancel: the button becomes usable immediately even if the extension ignores AbortSignal. Retry once; navigate away and verify no stale sign-in completes. Check desktop and 390px mobile through the footer.
- [ ] Two login tabs can finish independently. Replaying a saved challenge cookie and zero-counter assertion fails. Wrong origin, missing UV and mismatched userHandle all fail.
- [ ] Switching accounts in Security immediately shows only that account’s cached passkeys; failed list fetches show a retry action, not a misleading empty list.
- [ ] Both capability manifests advertise passkey register/options and login/options at 1.1.0; the client rejects missing, older, wrong-origin or breaking contracts.
- [ ] iOS release: the signed app includes `webcredentials:thingtime.com`; the HTTPS AASA response includes its exact application identifier. Verify Face ID sign-in and registration on a physical device after installing the rebuilt signed app. A simulator build alone is not acceptance evidence.

- [ ] Passkey app-link dedupe rides root `uniqueKeys`, never a crystal-path
      unique index: `node scripts/verify-passkeys.mjs` covers it (two data
      things may share one `crystal.linkKey`; the real link still dedupes to
      one row and keeps counting). After deploying, re-run the
      `backfill-relationship-unique-keys` migration from /admin so legacy
      `passkey-app-link` rows get stamped — until then they dedupe through the
      crystal-path fallback in the upsert filter.
- [ ] `things_passkey_link_key_unique` is gone from the `things` collection
      after a boot (`db.things_v2.getIndexes()`). On a dev machine running
      several worktrees against ONE local mongod, a sibling checkout still on
      pre-fix code re-creates it at its next boot — drop it again and update
      that worktree; it is not a code regression.

- [ ] Settings → Security → "Add a passkey ✨": wrong password → error toast,
      no platform sheet; correct password → the browser/1Password/iCloud sheet
      opens and the saved passkey appears in the list with provider name,
      created date, and your nickname. Cancelling the sheet shows NO error
      toast (cancel is silent). Inspect both registration and login options and
      confirm `userVerification: "required"` matches the server verifier; a
      completed Face ID/Touch ID/1Password ceremony must not return a generic
      verification failure.
- [ ] `node scripts/verify-passkeys.mjs` (from `remix/`, dev stack up) passes
      every check — full software-authenticator ceremony: registration, duplicate
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
      renders on `/authorize`, `/reset-password`, or while signed in. On a
      foreign `*.vercel.app` login/register page, the recovery card is the
      intentional exception: it opens the matching first-party hub.
- [ ] Hint liveness: log out on the OTHER deployment → the suggestion
      disappears here on the next fetch (hints resolve live sessions, never a
      cached identity). `GET /api/v1/auth/account-hints` responses carry no
      email — only id/username/displayName/avatarUrl.
- [ ] Account-hint response privacy: both the same-origin endpoint and the
      credentialed federated resolver send `Cache-Control: private, no-store`;
      their `Vary` headers include `Cookie` (the resolver also includes
      `Origin`) and a 429 retains its `Retry-After` header.
- [ ] Cross-deployment account hint: the compact row names the deployment
      environment (for example `Dev preview · PR #68`, never `Production` for
      a preview); expand its chevron to reveal every environment badge, exact
      origin, and last-active time without selecting or signing in as the
      suggested account.
- [ ] Vercel-preview account recovery: on a `*.vercel.app` login page, the
      account card remains available and opens `https://dev.thingtime.com`
      (not production) for the same development environment. The preview
      itself cannot read the `.thingtime.com` cookie; the Dev Thingtime popup
      must present its first-party signed-in account choices instead.
- [ ] Data-authority identity: deploy a Preview whose branch name and
      `VERCEL_ENV` disagree with its configured `THINGTIME_DATA_ENV`. Root
      data and `/api/v1/capabilities` must expose the same safe
      `{ id, kind, federationId, authorityOrigin }` identity; sign-in routing
      must use that authority rather than infer an environment from Vercel
      metadata. No database host, database name, connection string, or secret
      may appear in either public response.

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

## Social meta / link unfurls (`remix/app/api/utils/meta/socialMeta.ts`)

Crawlers never run JS, so verify with plain `curl` against the Nitro port (the
Vite dev port serves the raw shell without injection; in production, Vercel
routes `/post/:id` and `/profile/:username` to the Nitro `__server` function —
`remix/scripts/patch-vercel-output.mjs`).

- [ ] `curl -s <nitro>/post/<public post id>` returns `og:type article`, an
      `og:title` carrying the author + truncated text (or the poll question),
      an `og:description` capped near 200 chars, an absolute `og:url` /
      `og:image`, and `twitter:card summary` (`summary_large_image` when the
      post has an image attachment or a legacy `images[0]` URL, which then
      becomes the `og:image`).
- [ ] Fail closed: `curl -s <nitro>/post/<private post id>` and
      `/post/<garbage id>` both return ONLY the generic site block —
      indistinguishable from each other, and no post text, author, or image
      may appear anywhere in the HTML. (Status stays 200 by design: h3 treats
      a 404 Response from this middleware as "unhandled" and would fall
      through to the raw source template — see `server/routes/[...].ts`.)
- [ ] `curl -s <nitro>/profile/<username>` returns `og:type profile`, the
      `displayName (@username)` title, the bio as description, and the avatar
      as `og:image` when set; an unknown username gets the generic block.
- [ ] User-authored text with `<`, `>`, `&`, quotes, and newlines arrives
      HTML-escaped and whitespace-collapsed inside `content="…"`.
- [ ] `curl -s -H 'x-forwarded-host: thingtime.com' -H 'x-forwarded-proto:
      https' <nitro>/post/<id>` derives `https://thingtime.com/...` absolute
      URLs (the request-origin pattern, not a hardcoded host).
- [ ] Every other page (`/`, `/feed`, deep unknown paths) carries the injected
      site-default block (site_name Thingtime, generic description, brand
      image, `twitter:card summary`) with absolute URLs, and responses from
      the shell handler carry the `X-TT-Shell: social-meta` header.
- [ ] After `npm run build`, `verify:vercel-output` passes: the permalink
      routes sit between the API routes and the SPA fallback and point at the
      Nitro server function.
- [ ] A normal browser load of `/post/<id>` and `/profile/<username>` still
      renders the SPA (the injected head block must not break the shell).

## Emailed-link origin trust (`remix/app/api/utils/auth/appOrigin.ts`)

Verification and password-reset links carry single-use auth tokens, so a
`Host`-derived origin is an account-takeover primitive: the victim gets a real
email whose link points at the attacker.

- [ ] `npm run test:auth-origin` passes (APP_URL precedence, spoofed/lookalike
      hosts, the multi-tenant `*.vercel.app` namespace, Vercel preview vs
      production env precedence, and the local-dev host allowlist).
- [ ] With `APP_URL` set, `curl -X POST .../api/v1/auth/password-reset -H 'Host:
      attacker.example'` (and the same via `X-Forwarded-Host`) emails a link on
      the `APP_URL` origin — never the supplied host.
- [ ] With `APP_URL` UNSET on a Vercel preview, the emailed link uses the
      deployment's own `VERCEL_BRANCH_URL`, and a spoofed `Host:
      attacker-xyz.vercel.app` does not change it. Our own preview namespace is
      NOT trusted from the Host header — anyone can deploy into `*.vercel.app`.
- [ ] With `APP_URL` unset and no Vercel env (plain local dev), links use the
      requested origin for `localhost`/`127.0.0.1`/`[::1]`/`*.thingtime.com`/
      `*.ts.net`, and any other Host yields `https://thingtime.com`.
- [ ] All four emailed-link routes stay on the helper: `register`,
      `resend-verification`, `password-reset`, `service-account`.

## Canonical AI instruction links (`AI_ALL.md`)

- [ ] Root `AGENTS.md` and `CLAUDE.md` are relative symlinks whose target is
      exactly `AI_ALL.md`.
- [ ] `cmp -s AI_ALL.md AGENTS.md` and `cmp -s AI_ALL.md CLAUDE.md` both pass,
      and root `CODEX.md` is absent.
- [ ] In a fresh Git checkout, `git ls-files -s AGENTS.md CLAUDE.md` reports
      mode `120000` for both links and both still resolve to `AI_ALL.md`.

## Repository-root Vercel builds

- [ ] Leave a custom-domain or Vercel preview tab open across an alias flip,
      then navigate to a route whose chunk was not loaded before the deploy.
      Chromium, Safari, and Firefox each perform exactly one hard reload and
      land on the requested route instead of the dynamic-import error surface.
      With the chunk request kept broken, the tab must not reload-loop; after
      ten healthy seconds, a later alias flip can claim one new recovery.
- [ ] Run `npm run test:vercel-root`: it proves root `vercel.json` owns the
      build, the nested config is absent, automatic Git deployments are limited
      to exact `main` and `develop`, `github-actions` and generic Preview
      duplicate SHAs skip, the `develop` Custom Environment still rebuilds an
      already-previewed SHA, a valid Nitro artifact is staged at root, and
      invalid source output preserves the prior artifact.
- [ ] Run `npm run build:vercel` from the repository root. Confirm both the
      existing Remix verifier and the root wrapper pass, then inspect
      `.vercel/output/static/index.html` and `.vercel/output/config.json` rather
      than an `outputDirectory` selected by the dashboard.
- [ ] Confirm the Vercel output verifier rejects any server chunk that leaves
      `unicode-emoji-json/data-by-emoji.json` as a runtime package lookup
      without tracing the JSON asset. In an isolated copy of the generated
      function (with no parent checkout `node_modules`), importing the search
      chunk must not throw `MODULE_NOT_FOUND`.
- [ ] In Vercel, clear the old `remix` Root Directory and all Build, Install,
      Output Directory, and Ignored Build Step overrides; select Other as the
      framework. Confirm a product-branch commit builds from root and serves
      `/`, one `/assets/...` file, and `/api/root-data` from the same deployment.
- [ ] Fetch `/.well-known/thingtime-capabilities.json` from the built Vercel
      output, its preview URL, and the production alias. It must reach Nitro and
      return JSON with the exact request origin; it must never fall through to
      `index.html` as `text/html`.
- [ ] Confirm a disposable feature-branch push creates no automatic Vercel
      deployment, while exact `main` and `develop` pushes still do. The product
      config must map minimatch `**` to `false` (including branch names with
      `/`) and explicitly map both retained branches
      to `true`; the thin control-plane config must set
      `git.deploymentEnabled` to `false` and retain `ignoreCommand` as a second
      fail-safe.

## Lopu CodeQL all-branch listener

- [ ] Open or update PRs targeting `main`, `develop`, `github-actions`, and an
      older feature branch without the current listener. Confirm normal
      `pull_request` runs own targets that carry the listener, while the
      default-branch `pull_request_target` run performs only the protected
      metadata handoff for missing listeners. Confirm no target-context job
      checks out PR code, no redundant analyzer cancels an in-flight scan, and
      both language contexts finish green for the latest immutable snapshot.

## Lopu wildcard `all`-branch maintenance

- [ ] Run `node remix/scripts/workflow-caller-contract.mjs` and confirm product
      branches contain no `.github/workflows/all-branch.yml` or rebase-specific
      listener. Push `develop` and `main`, exercise every PR lifecycle transition
      including draft and close, wait for the `53 * * * *` backstop, and invoke
      the `build-all` and `backfill-codeql` maintenance choices manually. Every
      path must appear under **Lopu PR manager**, call the corresponding
      protected implementation, and keep at most one model-backed Lopu job
      active without cancelling it.

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
- [ ] Run the protected controller self-test and inspect its prebuilt deploy
      arguments: `--prebuilt` and `--target=develop` are present, while
      `--skip-domain` is absent because Vercel accepts that option only for
      production-target deployments.
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
- [ ] Enable `CODEQL_CENTRAL_PR_ENABLED` and update a PR targeting an older
      feature or stack branch that does not contain the CodeQL listener. The
      `pull_request_target` run must perform metadata-only handoff with no
      checkout, CodeQL initialization, AI secret, or repository code execution;
      its separate `workflow_dispatch` run must revalidate the live head and
      upload both language categories against the exact merge ref. Repeat with
      a conflicting PR whose old merge ref still exists: its parent mismatch
      must be reported and the fallback must scan `refs/pull/<number>/head`.
- [ ] Update a PR whose target already carries the normal listener. Its
      `pull_request` run—not the target-context fallback—must remain the owner
      of both Analyze job contexts required by branch protection. Confirm the
      listener's `control-plane` call reaches the unprivileged analyzer without
      the former nested `actions: write` workflow-validation error, while the
      `pr-handoff` call is skipped.
- [ ] On the corresponding `pull_request_target` event, confirm only
      `pr-handoff` calls the protected metadata bridge and `control-plane` is
      skipped. The bridge may dispatch the exact unprivileged scan but must not
      check out repository code or receive an AI/provider credential.
- [ ] Re-dispatch the same unchanged PR head after both CodeQL categories are
      present: the protected scope job must report that analysis is complete and
      skip initialization. Dispatch an older expected SHA and confirm it no-ops
      rather than scanning or publishing against stale PR state.
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
- [ ] Open the deployed PR preview's footer and confirm it shows the exact PR
      branch plus the complete 40-character head SHA, with each linking to the
      matching GitHub tree/commit. Confirm `/api/root-data` reports the same
      values and neither label falls back to `git/unknown`.
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

## Apple Watch notifications

- [ ] Code input: four evenly spaced squares backed by one native input. Paste
      a complete PIN with Cmd/Ctrl+V into any square (including replacing a filled
      PIN), test autofill, select-all, arrow keys and backspace, and preserve
      leading zeroes. Pasting an older eight-character code expands all eight
      squares; no paste/autofill may get trapped in the first square. Check both
      desktop and 390px layouts, focus ring, keyboard submission and accessible label.
- [ ] With 1Password installed, focus the approval input and fill all digits.
      Its saved-password badge must not cover the last square. Native
      `one-time-code` autofill and Cmd/Ctrl+V must still fill the complete code.
- [ ] Start with **Paired iPhone** selected, open the signed-in companion, and
      verify another session of the same account/domain shows the exact prefilled
      Watch/device/PIN. No credential may be claimed before explicit approval.
      A different account must not list, look up, approve, or rebind the request.
- [ ] Repeat using **Username** (including `@username`, a typo and wrong domain)
      and **Enter code**. A `/pair/1234` link preserves all four digits, including
      leading zeroes, through login. Check the five-minute expiry, unique active
      PIN reservation, and five guesses/account limit with a visible retry error.
- [ ] Verify quick-approval cards at 390px and desktop widths through the full
      scroll range, dismiss with **Not now**, and approve another request. Account
      switching/sign-out must never flash the previous account's request.
- [ ] Open `/watch/pair` without query parameters on desktop and a 390px phone.
      Sign in, enter a fresh Watch code, review the matching device/account, and
      approve. Confirm the Watch claims the credential and downloads notifications;
      no hidden pairing ID or Watch web browser is required. Invalid, wrong-domain,
      expired and already-consumed codes must offer recovery without logging secrets.
- [ ] Leave code approval pending beyond 90 seconds (31 polls), approve, and
      confirm pairing still completes. Interrupt network access, retry approval,
      switch domains mid-request, and replace an expired code. Cancelled requests
      must not restore an old code/account or overwrite the new connection state.
- [ ] Select an origin without `api.watch-pairing` 1.2.0 and confirm the Watch
      shows an actionable domain/preview hint rather than a missing-endpoint error.
- [ ] Pair a fresh Watch directly against both `thingtime.com` and
      `dev.thingtime.com` once their manifests support the feature. Approve the four-digit code while
      signed in, confirm the Watch receives only its device credential, and
      verify notification refresh/read state works with the iPhone app closed.
      A second account must remain independently selectable after relaunch.
- [ ] On the smallest supported Watch, confirm the signed-in header shows the
      selected account's avatar, **@username**, domain, and live status. Scroll
      through the whole screen, tap the toolbar refresh and **Check & refresh**,
      and verify checking/success/error states plus Last check and Last live
      reply remain readable without clipping.
- [ ] Open Settings, switch between production and development accounts, add
      another account, and remove only the selected account. Confirm no account
      reuses another origin's credential, snapshots, upload outbox, or inbox.
- [ ] Under **Add private Thing**, confirm **Record** is the default first
      favourite and that Settings can enable/disable the available favourites
      while preserving their stable system order and the main Add action.
- [ ] Create a private audio or photo Thing directly from the Watch, interrupt
      the upload at each stage, and confirm retry uses the same request/Thing
      identity without duplicate Things. The created record remains owner-only
      and the Watch retains its local source until completion.
- [ ] In `/things`, open the paired Apple Watch device. Confirm last sync,
      status, battery/low-power health, last error, created-Thing count, and the
      owner-only recent Things created by that exact Watch update after refresh.
- [ ] On a signed-in paired Watch, confirm the connection section identifies
      the active account as **@username**, keeps the current connection state
      visible, and always shows **Check & refresh**. Tap it and confirm the
      control changes to **Checking…**, then returns with updated **Last check**
      and **Last reply** times without exposing a reusable session credential.
- [ ] Regression class (2026-09): install a TestFlight build configured for a
      preview over an older install that implicitly retained `thingtime.com`.
      Confirm the iPhone migrates to the configured origin, the Watch displays
      that origin plus matching iPhone/Watch build numbers, and notification
      history downloads. Then explicitly select production and confirm a
      relaunch preserves that deliberate choice.
- [ ] Update only the iPhone app while leaving an older companion on the Watch.
      Confirm the Watch connection section displays both build numbers, warns
      that they differ, and clears the warning after the Watch app updates.

- [ ] Launch the Watch app with the paired iPhone app closed, then open
      Thingtime on iPhone. Confirm the Watch visibly moves through **Waiting for
      iPhone** / **Checking Thingtime sign-in** to **Connected to iPhone**,
      displays the last reply time, and reconnects without exposing or copying a
      reusable web session credential. Repeat while signed out and confirm it
      settles on **Sign in on iPhone**.
- [ ] Leave the iPhone unreachable through the Watch's bounded 2, 5, and
      10-second retry sequence. Confirm loading stops with an actionable status,
      **Retry connection** starts a fresh attempt, and opening the iPhone later
      consumes the safely queued refresh without duplicate work.
- [ ] On a signed-in paired Watch, confirm the inbox initially shows the newest
      10 notifications. Tap **Load previous 10** repeatedly and verify each page
      appends in newest-first order without duplicates or gaps, including when
      two notifications have the same `createdAt` timestamp.
- [ ] Open **Notification history**, choose **One date**, and fetch the first
      10. Confirm only notifications inside that local calendar day appear.
      Switch to **Date range**, choose inclusive From and Through dates, and
      confirm **Fetch 10 more** pages through that full period without crossing
      either day boundary.
- [ ] Tap **Download whole period**, background or close both apps while the
      transfer completes, then reopen the Watch app offline. Confirm the archive
      persists, initially reveals 10 rows, and **Show 10 more** reveals the rest
      without network access. Mark an archived row read, relaunch, and confirm
      its read state remains saved. The archive must contain no more than the
      service-retained latest 500 notifications.
- [ ] Queue both a historical page request and a period download while the
      iPhone is unreachable, then open the signed-in iPhone app. Confirm each
      request resumes once, a stale response cannot overwrite a newer selected
      period, and malformed or metadata-mismatched archive files are rejected.

- [ ] On a signed-in paired Watch, open **Add private Thing**, pick one and five
      Photos-library screenshots, and record a short audio clip. Confirm every
      item remains queued across a Watch app relaunch until the iPhone reports
      success, then appears as a searchable owner-only Thing with exactly one
      bound attachment and `acl: ["tt:user"]`.
- [ ] Put the iPhone offline before choosing a Watch screenshot, then restore
      connectivity and open the signed-in iPhone app. Confirm the same stable
      request resumes without duplicate attachment Things; repeat while signed
      out and confirm the Watch explains that Thingtime must be opened and
      signed in, without losing the queued bytes.
- [ ] Tap **Record**, deny microphone access, and confirm Apple's
      native recorder returns safely without crashing. Grant access, save a
      several-second recording, and confirm the completion callback does not
      falsely report that Thingtime could not prepare it while the file is still
      finalizing. Confirm the `.m4a` appears under **Saved recordings**
      after relaunch. With **Upload after saving** enabled, confirm it queues
      automatically; disable that preference, save another recording, and
      confirm it waits for selection in the saved-recording screen.
- [ ] Open **Saved recordings**, tap one retained Watch recording, and
      confirm it creates a new private Thing without altering the retained
      original. Swipe-delete another saved
      recording and confirm only that on-watch copy disappears. Confirm the
      explanatory copy does not claim third-party access to Apple's sandboxed
      Voice Memos library and directs existing Watch Voice Memos to the synced
      iPhone Thingtime upload flow.
- [ ] Against an origin missing or breaking any required attachment/Things
      capability, confirm the iPhone fails closed before reserving storage and
      the Watch shows the compatibility error. Verify normal uploads use the
      active WebView origin and never copy its session credential to watchOS.
- [ ] Regression class (2026-09): `WCSessionFile` is temporary on receipt. Kill
      the iPhone app immediately after delivery and confirm the inbox copy still
      resumes on next launch; the Watch must retain its original until the
      private Thing creation result arrives.

- [ ] Regression class (2026-09): build the signed iPhone + Watch IPA with
      Xcode 26.2, verify the locally exported IPA, and upload the same archive
      through `xcodebuild -exportArchive` with `destination: upload` and the App
      Store Connect API key. Confirm App Store Connect accepts the upload
      without relying on Xcode 26 `altool`, which can report a platform error
      while incorrectly exiting with status 0.
- [ ] Regression class (2026-09): inspect the exported IPA and confirm the
      companion watchOS app is under `Payload/Thingtime.app/Watch/`, not
      `PlugIns/`; App Store Connect rejects the latter as an invalid directory.
- [ ] With an iPhone paired to an Apple Watch, open Thingtime on the iPhone and
      sign in. Launch the watch app and confirm it leaves “Pair Thingtime” without
      asking for a password or exposing a session credential on the watch.
- [ ] Tap Enable alerts on the watch, approve the system prompt, relaunch both
      apps, and confirm the iPhone and watch APNs registrations appear through
      `/api/v1/notifications/devices` without either token appearing in the JSON
      response or generic Thing APIs.
- [ ] From a second account, create a friend request, follow, comment, reply,
      reaction, share, and mention. Confirm the watch alert names the actor, the
      inbox refreshes, the unread count matches Thingtime, and tapping an unread
      row marks that same notification read on the phone/web inbox.
- [ ] Send the same payload to the paired iPhone and watch registration and
      confirm only one user-visible alert appears. Repeat in Debug/sandbox and a
      signed Release/production build so each token uses the matching APNs host.
- [ ] Disable a push type and then the push master in Settings → Notifications;
      confirm new events of those types produce neither a watch alert nor a
      watch inbox row. Re-enable them and verify delivery resumes.
- [ ] Sign out on the paired iPhone and confirm the watch returns to the pairing
      screen and later activity for that account produces no device alert. The
      registration may await cleanup, but its revoked/expired session binding
      must make it immediately ineligible. Then sign in as another account and
      confirm both device tokens move to the new owner without leaking the prior
      inbox.
- [ ] Exercise signed-out, empty, unread/read, denied-alert, long actor name, and
      two-line preview states on the smallest supported watch. Scroll top to
      bottom; no row, badge, toolbar item, or permission message clips or overlaps.
- [ ] Regression class (2026-09): APNs device tokens are variable-length binary
      values. Register a token longer than 32 bytes and confirm it is accepted,
      deduplicated by hash, retained only in protected secure storage, and removed
      after APNs reports `BadDeviceToken`, `Unregistered`, or HTTP 410.
- [ ] Regression class (2026-09): a device row is keyed by token alone, so
      re-registering must REBIND it to the caller. Sign in, register the device,
      sign out (revoking that session), sign back in, and re-register the same
      token: the alert must still arrive. Repeat as a different account on the
      same device and confirm alerts follow the new owner. Pinning `ownerId` or
      `targetId` at insert makes both cases permanently undeliverable — the row
      keeps a dead session id and re-registration cannot heal it.

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

## Branding page (`remix/app/routes/branding/_index.tsx`, `remix/app/components/Branding/`)

- [ ] `/branding` renders full-width with a centred max-width column at desktop
      (≥1280px) and mobile (375px); no horizontal scrollbar at either size and
      no borders/cards/checkerboard grids anywhere — previews sit on soft
      panels only.
- [ ] Every variant section (wordmark, icon, both pink cuts) shows its live
      SVG preview; the light/dark panel dots swap the preview surface.
- [ ] "Download SVG" and "PNG · 1024px" point at real committed files under
      `/branding/generated/<slug>/…` (200s, not client blobs); the ready-made
      grid lazy-loads (`loading="lazy"`) one `<img>` per size up to 10000px,
      wordmark sizes keep the 27:5 trimmed aspect (e.g. 1024×190).
- [ ] Ready-made sizes render as two lines — the SVG line
      (`SVG · scalable · <size>`) above the PNG line — and every PNG chip is
      labelled `PNG · <W>×<H> · <KB/MB>`; chips wrap without horizontal
      scroll at 375px.
- [ ] Custom export: format PNG/SVG, any width, padding all-sides and
      per-side, background transparent/white/ink — downloads a file named
      `thingtime-<slug>-<W>x<H>.<ext>` where W/H include padding, and fires a
      Lopu success toast (errors also route through Lopu, never `alert`).
- [ ] Exports and previews are whitespace-trimmed: `npm --prefix remix run
    test:branding` passes (trim + padding + pixel-size unit tests).
- [ ] Press kit grid renders all generated marketing images; the portrait
      phone wallpaper previews as a centre crop and must not stretch its grid
      row (no giant empty gap beside it).
- [ ] Palette swatches copy their hex via clipboard with a Lopu toast.
- [ ] After changing `logoMatrix.ts` matrices/colours, re-run
      `npm --prefix remix run branding-assets` and commit the refreshed
      `remix/public/branding/` + `brandingAssets.generated.json` (byte-stable
      when nothing changed).

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
      Seed more than 25 text posts or 10 attachments and verify a full,
      failure-free cron pass returns a `continuationRunId`; the durable runs
      keep draining immediately until a short batch remains. Introduce one
      provider failure and verify that surface stops its chain and waits for
      the next hourly cron instead of retrying in a tight loop.
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
- [ ] Upload and publish a small MP3, M4A (including an Apple Watch recording),
      FLAC, WAV, Ogg/Opus, and WebM audio attachment. Each final card and its
      `/thing/<attachment-id>` detail view shows native controls instead of a
      download-only row; the content response is `inline` with its detected
      audio MIME; a multi-audio post advances through its queue in attachment
      order; and "Save full file offline" plays the complete same-account
      IndexedDB copy after a reload. Check desktop and 390px mobile widths for
      no overflow, then remove the offline copy and confirm streaming resumes.
- [ ] With two or more selected files, drag the ⠿ grip (mouse AND touch) to
      reorder media tiles and file rows; arrow keys on a focused grip move one
      step, Home/End jump to the edges. Tiles reorder live while dragging, a
      tile drag never triggers the panel's file-drop styling, and the posted
      card renders images and files in exactly the chosen order after reload.
- [ ] Composer type badges are additive toggles: Text stays selected while
      Photos, Marketplace, and 📦 Things each switch their field group on and
      off independently (Things + Marketplace + Photos can all be live at
      once); clicking Text switches every extra group off. A plain text post
      shows no media/attachments panel until Photos is toggled on, and the
      saved post type is derived (things > marketplace > photos-with-visual >
      text) so files-only media still saves as a text post.
- [ ] URL media is unified into the Media & files panel: the add-by-URL input
      sits inside the panel below the upload grid with an `Add` button (Enter
      adds too). Each valid URL mints a linked attachment via
      `POST /api/v1/attachments/link` and lands in the SAME grid/file list as
      uploads — image/video extensions become media tiles, file extensions
      (pdf, zip, md…) become file rows, and extensionless URLs are probed
      (image if it loads, file otherwise). The same URL added twice creates
      two separate attachments. `javascript:`/credentialed/over-long URLs are
      rejected; a `.pdf` can never claim a visual kind. URL adding works even
      while uploads await beta approval (no storage is consumed).
- [ ] Linked attachments render on cards exactly like uploads — same gallery,
      layout modes, lightbox, reorder — but their bytes come straight from the
      external URL (`referrerPolicy=no-referrer`); linked file rows and the
      lightbox/media-page Download open the original URL in a new tab. Delete,
      post-delete cascade, and draft reaping of linked media never touch S3
      (works with private storage unconfigured).
- [ ] Edit a post with 2+ attachments: the composer shows exactly one Media &
      files panel containing the original attachments and new-media controls;
      no duplicate gallery or second drop zone appears. Dragging or arrow keys reorder the
      bound set, Save persists the order (card + `/post/:id` + reload agree),
      and saving with no changes sends no attachment sync. A stale edit saved
      after the post's attachments changed fails with the refresh-and-try 409
      rather than half-applying.
- [ ] Edit a post and add a new upload AND a new URL: Save binds both into the
      post after the existing media (PATCH attachmentIds = full desired
      order), the updated card shows them immediately and after reload, and
      the same flow works on a rich comment (purpose stays `comment`).
      Removals never happen via Save — a list missing a VISIBLE bound id is
      rejected with the 409, while moderation-hidden bound ids are exempt and
      keep their binding + trailing order.
- [ ] In both new-post and edit-post composers, every ready uploaded or linked
      attachment has a visible, keyboard-labelled delete button. Deleting an
      existing bound attachment removes only that exact post binding and
      attachment; a stale/mismatched target fails closed and restores the tile.
- [ ] Edit a legacy post that still carries crystal.images URLs: they appear
      in the media panel as linked tiles, reorder/remove like anything else,
      and Save migrates them into linked attachments (crystal.images empties;
      the card renders identically through the attachment gallery).
- [ ] Upload an image where a moderation provider is configured: while
      analysis runs the OWNER still sees the media with a "Checking…" badge
      (card tile + file row + edit composer), other accounts don't see it yet,
      and saving an edit during that window succeeds instead of 409ing.
      Blocked media stays hidden for everyone including the owner.
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
      post's images, a filename link to its canonical `/thing/:id` permalink,
      an Open-page link to `/media/:id`, a download button, and a visible X,
      Esc, and backdrop close. Those toolbar controls sit below the persistent
      navigation at desktop and 375px mobile widths. Error-state tiles never
      open a broken lightbox.
- [ ] Opening an image attachment's generic `/thing/:id` permalink shows the
      raw, safe image in an attachment card — never a blank post-shaped card.
      Its expandable "Referenced by" section stays compact and links to the
      direct post or comment without rendering that reference inline.
- [ ] `/media/:id` renders inside the Thingtime UI shell (nav, centered
      max-width): large media, title/description, author, a link back to the
      parent post, plus working reactions and comments on the media thing
      itself. Comments/reactions persist after reload, an unknown or private id
      404s safely, and `GET /api/v1/things?id=<attachmentId>` leaks no private
      object fields.
- [ ] As the owner, use the pencil affordance on a ready composer tile, an
      edit-gallery tile, and the `/media/:id` page to set/edit Filename preview
      (≤255), title (≤200), and
      description (≤2000). The editor saves via `/api/v1/attachments/annotate`,
      updates optimistically (revert + Lopu toast on failure), clears fields
      when emptied, and the saved values survive reload on card, lightbox, and
      media page. Filename preview replaces the rendered filename while the
      immutable original remains the download filename. A non-owner and an unauthenticated caller get no pencil and a
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
      Auto 🧱 / Rows 🥞 / Grid 🔳 in the composer AND in edit mode. Auto and
      Rows show the same labelled final-view preview as Grid. Rows uses visual
      add/remove-row controls and +/- image counts rather than a text pattern;
      extras repeat the last row size. Grid gets a 1-6 column stepper plus
      visible clickable 1×1 per-tile badges cycling
      normal → wide → tall → big. Saved layouts persist through create, edit,
      reload, and render identically for a non-owner viewer; Auto clears
      `mediaLayout` from the crystal. Layout controls only appear with 2+
      visual attachments and never break the drag-reorder grips.
- [ ] Search by the Reaction schema with Emoji contains `heart`: matching ❤️
      reactions return their parent post cards even when the text query was
      previously non-empty. Search `ReplacementBladesV2.3mf` (and an attachment
      title, description, and Filename preview) from Commander/full search;
      the Attachment schema is offered by default and opens the media Thing.
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

## Editor.js rich text styles

- [ ] In builder inline/modal editors and the post composer, select paragraph,
      heading, list/checklist, quote/caption, table-cell and warning text. The
      palette button opens the same full styling panel for every rich-text field.
- [ ] Test wheel dragging/keyboard controls, HEX/RGB/RGBA/HSL/HSLA input,
      transparent colours and highlights, all decorations, font family, and
      px/em/rem/pt/% sizes with both direct input and minus/plus controls.
- [ ] Apply, save, reopen, and read the rendered content. Builder HTML round trips
      retain selected-text styles and block colours, alignment and custom sizes.
      Changing a substring keeps neighbouring and mixed formatting; Cancel leaves
      the document unchanged, Reset clears styling, and Undo restores the edit.
- [ ] At desktop and 390px mobile widths, select text near each viewport edge and
      scroll top to bottom. The toolbar stays above the selection, wraps within
      the viewport, and remains usable. Scroll the colour panel to both ends;
      controls and Save/Cancel stay reachable without horizontal overflow.
      Hover a desktop toolbar hint then shrink to mobile: hidden hints must not
      leave a horizontal scrollbar.
- [ ] Change a styled heading to paragraph, list/checklist or quote. Text colour,
      size, decoration and alignment carry by default. In Changes, uncheck a
      carry property and confirm only that whole-block property is omitted.
- [ ] Open an unstyled colour picker: lightness starts at 50%. Change colour,
      opacity, size and decoration while watching the actual text. Save keeps
      the preview; Cancel restores the original without losing the preview events.
- [ ] Type, style, insert an empty block, check a checklist item, add a table row,
      convert, move and delete blocks. Undo/Redo buttons and Cmd/Ctrl+Z / Shift+Z
      restore the complete draft, including unfinished blocks and focus.
- [ ] Undo twice and type a different edit. Changes retains both futures with
      their parent events; Restore point revisits either. Revert/reapply a colour
      event preserves later text/size changes; overlapping field edits display a
      conflict without overwriting the current document. Expand Changed properties.
- [ ] Reopen the builder floating editor and toggle inline editing off/on: their
      session histories remain available. Keep two editors with the same block
      IDs open; styling one does not change the other's tune registry or focus.
- [ ] Resize block settings, the style picker and the advanced editor using the
      corner handle and arrow keys. Move the style picker by its title; resize
      the viewport and scroll each panel to both ends. Controls remain reachable.
- [ ] Compare edit/view text bounds with left, centre and right alignment at
      desktop and mobile widths. There is no reserved toolbar gutter; +/dots
      float right for left/centre text and left for right text, using clear space
      beside the text or above the editor. Previous headings and history controls
      remain visible, including inside the advanced modal.
- [ ] On physical iOS, repeat selection with the native context menu and keyboard
      open, including keyboard viewport panning and text near the screen top.
- [ ] Local regression fixture: `/tests/editor-rich-text.html` under Vite uses the
      real editor and builder components with ephemeral data and no API writes.
- [ ] Editor-sink style scrub (`editorJsHtml.ts` `scrubElement`): save a block whose
      stored html carries raw CSS on a NON-span inline carrier — for example
      `<b style="position:fixed;inset:0;z-index:99999">` or
      `<mark style="background-image:url(https://example.invalid/x)">` — then reopen
      it in the inline and advanced editors. Editor.js renders `data.text` as live
      innerHTML there without the render-side allowlist, so every element's style
      must be re-validated through the style-token gate: no fixed-position overlay
      and no outbound `url()` request on open. Legitimate `<span>` colour/size
      styles and block-level `text-align` must still survive the round trip.

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
- [ ] In the Text post composer, style several Editor.js blocks (heading,
      colour, alignment, size, repeated whitespace, and a hard line break),
      then tap Post immediately after the final style change. The new feed
      card and `/post/:id` preserve the exact latest block document after a
      reload; no heading appears as literal Markdown such as `## Posts`.
- [ ] At desktop and 390px mobile widths, focus the first, middle, and final
      Editor.js blocks in the Text post composer: the + and settings buttons
      stay on the active block's right/inline-end edge, never below its text or
      outside the editor card. Long and right-aligned text keeps a readable gap;
      both button menus open without clipping or horizontal page overflow.
- [ ] Repeat the same create-and-reload check with a rich comment. Inspect the
      create request and exact-id readback: both must contain the complete
      native `richText` document as well as the canonical `text` fallback.
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
- [ ] Global undo/redo shortcut guard (`useThingtimeMachine.tsx` `keyListener`):
      inside the post composer, a comment box, the login form, and any
      contentEditable (Editor.js block), Cmd/Ctrl+Z performs the editor's own text/history undo —
      no thingtime state changes. With focus on the page background (no editable
      focused), Cmd/Ctrl+Z undoes and Cmd/Ctrl+Shift+Z REDOES (Shift reports
      `e.key === 'Z'`, so redo was unreachable before this guard normalised
      case). Mid-IME composition (Japanese/Chinese input) Cmd/Ctrl+Z never
      triggers a thingtime undo. The guard predicate itself is covered by
      `npm run test:editable-target` (`app/utils/editableTarget.ts`); this
      manual pass is for the wiring and the real browser key codes.
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
- [ ] An owner can still open their own image attachment at `/thing/:id` when
      its historic inherited parent is missing: it renders as raw media with
      zero available references. Anonymous, other-user, and visibility-scoped
      token reads still return 404 (the owner recovery exception applies only
      to persisted `attachment` Things).

## Poll voting (`remix/app/api/utils/things/vote.ts`, `PollRenderer`)

- [ ] Compose a poll from the feed composer's 🗳️ Poll tab (question in the
      main box, 2–6 option rows with add/remove) and post it: the card renders
      the poll (question + tappable options), NOT the raw Thingtime tree.
- [ ] Tap an option while logged in: the bar fills and the ✓/accent highlight
      lands INSTANTLY (optimistic), then the server tally reconciles.
      Tapping a different option MOVES the vote (totals unchanged); tapping
      your own option again REMOVES it. `POST /api/v1/things/vote` returns
      `pollVotes { counts, totalVotes, viewerVote }` matching what renders.
- [ ] One vote per user per poll survives races: double-tap fast / two tabs —
      the `things_vote_key_unique` index keeps ONE vote doc per
      (`crystal.voteKey` = `<pollId>~<userId>`); reloads converge.
- [ ] Logged out: the poll shows results only (bars + percentages visible,
      no vote recorded); tapping toasts "Log in to vote 🗳️".
- [ ] A poll on a private/friends-only post can't be voted on by a viewer
      outside the audience (404 from the vote endpoint — acl + `tt:inherit`
      chains re-checked per vote), and out-of-range `optionIndex` 400s.
- [ ] Generic CRUD refuses the kind: `POST /api/v1/things` with
      `thingtime: ["vote"]` answers 403 (votes mint only through the vote
      endpoint, which writes the server-owned `voteKey`).
- [ ] Vote endpoint failure (devtools: fail `/api/v1/things/vote` once)
      reverts the optimistic bars to the pre-tap tally and shows a Lopu
      error toast — never a stuck wrong count.
- [ ] A shared poll's nested sub-card shows the live tally read-only; voting
      happens on the original's own card/permalink.
- [ ] Deleting a poll post cascade-deletes its vote things (no orphan `vote`
      docs pointing at the gone poll); vote docs never list as /things rows
      and folder copy skips them like reactions/saves.
- [ ] A foreign doc squatting the `crystal.voteKey` slot (e.g. a free-form
      data crystal) makes the vote endpoint answer 409 — never a silent
      `ok: true` that drops the vote.

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

## /things Duplicate (`remix/app/components/Things/ThingsPage.tsx`, `thingsMenuModel.ts`)

- [ ] Right-click a named thing (data/folder/schema) → Duplicate 🐑: a copy
      named "Copy of X" appears beside the original — in the ORIGINAL's own
      folder, not the browsed folder — immediately (real server id painted
      from the bulk response, reconciled by the refetch); the original keeps
      its name, content, and folder. The menu row shows the 🐑 emoji (emoji
      icon style) / copy-plus (lucide), never the 🤷‍♂️ fallback.
- [ ] Duplicate from SEARCH results (type a query, right-click a result from a
      different folder): the copy lands in that result's own folder, the
      active search re-runs, and "Copy of X" appears in the results.
- [ ] Duplicate from an ANCESTOR column in columns view: the copy appears in
      the column you acted in (the original's folder), not the deepest one.
- [ ] The per-item ⋯ kebab menu offers 🐑 Duplicate for duplicable things
      (this is the only path on iOS/touch, where right-click never opens).
- [ ] Multi-select N things → Duplicate N things duplicates all of them
      (one bulk copy per source folder; "Duplicated N ✨" Lopu toast;
      per-item failures report as "Duplicated n, m skipped" with the first
      error).
- [ ] Duplicating a folder copies its whole subtree (bounded server-side);
      uncopyable child kinds inside are skipped with honest counts.
- [ ] Uncopyable kinds (comment/reaction/save/share/vote — the server
      UNCOPYABLE set) never show a Duplicate item in the context menu.
- [ ] No ⌘D keyboard shortcut (that's the browser bookmark chord) — Duplicate
      is context-menu only.

## Post engagement row & comment threads (`remix/app/components/Feed/PostCard.tsx`)

- [ ] MODERATION/PERMALINK: when comment moderation is temporarily pending,
      the comment author still sees the new standalone comment and its count
      after reloading `/post/:id`; another viewer does not see it until it is
      released. The permalink projection and `GET ?target=…&thingtime=comment`
      listing must agree (regression: the batch post projection filtered every
      pending child, including the owner's own comment, and rendered zero).
- [ ] COUNT LAYERS: a post with direct comments plus nested replies reports
      viewer-relative `commentCounts.direct`, `replies`, `total`, and `loaded`;
      legacy `commentCount` equals `total`. A viewer excluded from a comment
      layer never learns that hidden row through any count.
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
- [ ] EMOJI SPLASH (`emojiSplash.ts`): ADDING a reaction (quick-tap heart,
      quick-row pick, full-picker pick — post or comment) erupts 5–8 floating
      copies of the chosen emoji from the react button; a live poll vote
      bursts the option's leading emoji (🗳️ fallback) from the tapped row.
      REMOVING a reaction / un-voting never bursts, guests never burst.
      Spam-tap: at most 3 concurrent bursts (oldest culled) and the DOM
      returns to its pre-tap node count within ~1.5s (no leaked spans).
      With reduced motion emulated (or `--tt-motion: 0`), zero DOM is
      created — same `motionOK()` gate as confetti.
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

## Lopu toast placement (`remix/app/components/Lopu/lopuPosition.ts`, `useLopuPosition.tsx`)

- [ ] Fresh browser (no stored preference): every Lopu toast pops up at the
      BOTTOM-LEFT corner, clear of the iOS home indicator, with the card's
      countdown ring and ✕ working; nothing sits behind the fixed nav.
- [ ] Settings → Appearance → "Lopu messages 🦄" is a dropdown listing Top
      left / Top centre / Top right / Bottom left / Bottom centre / Bottom
      right. Picking one fires a confirmation toast AT the new position
      immediately, the drawer's quick-settings modal shows the same value,
      and the choice survives a reload and a second tab (broadcast).
- [ ] Top-row positions clear the fixed nav (translateY 70px) on desktop and
      375px; centre positions stay centred with no horizontal scroll; corner
      positions hug the safe-area edge with the 8px Chakra margin.
- [ ] A toast fired while the left drawer is open, or from inside a modal
      (Profile save, 2FA), stays visible above them (`--toast-z-index`
      10260); DevKit still floats above the toast.
- [ ] Streaming musings (`useLopuStream`) pop at the chosen position and stay
      there while typing (Chakra cannot move an open toast).

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

## Shared page shell & footer (`remix/app/components/Layout/Main.tsx`, `remix/app/components/Nav/Footer.tsx`)

- [ ] On the landing page and a short authenticated route, scroll from top to
      bottom at desktop and 375px widths. The shared footer follows content
      with ordinary visual spacing, not a large blank/dead-scroll region; its
      links and controls remain reachable without horizontal overflow.

## Profile page (`remix/app/components/Profile/ProfilePage.tsx`)

- [ ] The self-profile action row is Edit profile ✏️ / All settings ⚙️ /
      Log out 🗝️ (+ Resend verification when unverified): All settings
      navigates to /settings, and the buttons wrap cleanly on mobile with no
      overflow.
- [ ] Activity heatmap (`ActivityHeatmap.tsx`, `/api/v1/users/activity`):
      a profile with visible things shows the contribution grid between the
      header and Posts (month labels, hover tooltip `<n> things · <date>`,
      `<n> things in the last year 🌱` caption); logged out it counts public
      things only while the owner's own view also counts private ones (create
      a public + a private post and compare); a profile with zero visible
      things renders no Activity section at all; on mobile the grid scrolls
      inside its own container (auto-scrolled to today) without widening the
      page; cell colors follow the active theme accent in light and dark
      themes; server-minted records (the `user` doc, notifications, friend
      state) never count while reactions/comments/votes do.

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

## Content-addressed Graphify snapshots (`scripts/graphify`)

- [ ] Run `npm run test:graphify-cas`. Confirm Graphify-only edits leave the
      source fingerprint unchanged, source edits change it, and computing a
      fingerprint leaves the real staged index byte-for-byte unchanged.
- [ ] Finalize the same portable output twice and confirm it deduplicates to
      one artifact path. Finalize two valid variants for one source fingerprint
      and confirm both remain immutable while the deterministic selector picks
      the richer graph.
- [ ] Seed several valid portable snapshots, select a non-richest snapshot as
      active, and run `scripts/graphify prune`. Confirm the active snapshot is
      retained, the checked-out store is bounded to one snapshot by default,
      empty fingerprint directories are removed, compatibility aliases resolve,
      and `GRAPHIFY_SNAPSHOT_RETENTION=0` fails closed. Confirm deleted paths
      remain readable from the prior Git commit.
- [ ] Create two branches that each add a distinct
      `graphify-out/snapshots/v1/<source>/<artifact>/` path. Merge them in a
      fresh clone without installing a custom merge driver and confirm Git
      reports no generated-file conflict and both snapshots remain present.
- [ ] Start two local mutation commands together. Confirm the repository writer
      lock serializes them, a live writer is never stolen during owner-file
      creation, and a dead writer lock is recoverable.
- [ ] Run the lock regression cases in `npm run test:graphify-cas`: pause a
      stale reaper while a replacement writer acquires, then resume cleanup.
      Confirm it cannot delete or enter the replacement lock. Verify six
      processes complete 30 writes without overlap, SIGKILL recovery, timeout
      cleanup, callback-error release, and a query retaining its snapshot lock
      until its subprocess exits.
- [ ] With a legacy root graph present, run `scripts/graphify update .`, remove
      the four mutable root outputs from tracking, and run
      `scripts/graphify ensure`. Confirm root paths become ignored symlinks,
      `scripts/graphify snapshot` matches the current source fingerprint, and
      ordinary `graphify query` still succeeds through the aliases.
- [ ] Change a Markdown file and run semantic extraction through the local
      Codex LLM proxy. Confirm the wrapper clusters and exports after extraction,
      records the Graphify version and source tree in `snapshot.json`, keeps the
      mutable semantic cache private, ingests it into
      `cache/semantic-cas/v1/<input-key>/<content-hash>.json`, and never prints
      the proxy key. Write two valid responses to one input-key filename and
      confirm both immutable variants survive while hydration selects the richer
      response deterministically.
- [ ] Corrupt a portable file at an existing artifact-hash path and attempt to
      finalize identical output. Confirm the wrapper rejects the violated hash
      invariant instead of overwriting or accepting it.
- [ ] Delete the snapshot currently selected by a root compatibility symlink,
      then activate a new valid snapshot. Confirm the dangling alias is replaced
      without treating it as an unrelated filesystem object.
- [ ] Merge a source branch, run the trusted Lopu Graphify publisher, and
      confirm the post-merge source fingerprint has a valid immutable snapshot.
      Confirm no controller job pushes mutable root aliases or cancels an
      already-running Lopu/Graphify job.

## AI merge-conflict resolver (`.github/workflows/resolve-pr-conflicts.yml`)

- [ ] Queue two all-branch rebuild signals through the default `main` Lopu PR
      manager. Confirm `.github/workflows/all-branch.yml` is absent from the
      product branch, no standalone **Build all branch** workflow run appears,
      and both signals enter the protected `lopu-maintenance-build-all`
      namespace. The active rebuild must finish without cancellation while
      only one newest not-yet-started union snapshot waits for the shared Lopu
      fleet slot.
- [ ] Push a new commit to an older open PR whose head branch does not contain
      the current Lopu push listener, including one targeting a non-default
      branch. Confirm the default-branch `pull_request_target: synchronize`
      listener dispatches that exact PR to the protected controller, duplicate
      push/target signals collapse to one live snapshot, and the repository
      fleet still runs no more than one model-backed Lopu job at a time.
- [ ] Queue two all-branch rebuild signals through the default `main` Lopu
      listener — the `53 * * * *` backstop and a manual `build-all` dispatch.
      Confirm the thin caller has no concurrency block, both calls reach the
      protected implementation, and its `queue: max` worker completes the
      first request rather than cancelling it when the second arrives.
- [ ] Push once to `develop`. Confirm GitHub creates one public **Lopu PR
      manager** run containing the standing-promotion and per-feature-promotion
      reusable jobs, with no separate **Promote develop to main** or **Promote
      features to main** workflow run. Push once to `main` and confirm its Lopu
      run contains the main→develop synchronization job with no standalone
      sync workflow. Queue a second event while each component is active and
      confirm the first run is not cancelled. Exercise each
      `maintenance_operation` choice manually through Lopu and confirm the
      removed workflow files do not reappear in Actions.
- [ ] On the default branch, complete a check run and create/edit a normal PR
      comment. Confirm each `Lopu PR manager` run compiles and creates its
      controller jobs instead of failing at workflow startup with a nested
      `security-events: none` permission error. Also confirm scheduled and
      push-driven all-branch signals enter that same Lopu manager (never a
      standalone **Build all branch** listener), and that CodeQL alert
      mutations occur only in the controller's separately fenced disposition
      writer.
- [ ] After changing a product-branch listener, compare the active default
      `main` listener with the reviewed `develop` listener before calling the
      rollout complete. PR synchronize/draft/edit/close signals, the hourly
      all-branch rebuild cadence, and the `build-all`/`backfill-codeql` manual
      operations must already be present on `main`; a half-hour sweep is only
      recovery coverage, not proof that every repository change wakes Lopu.
- [ ] Fail or cancel one listed GitHub Actions PR workflow after the opening
      review has finished. Confirm the default listener receives a completed
      `workflow_run`, routes only the associated non-successful PR to one Lopu
      review, preserves the exact source run id for log diagnosis, and never
      listens to `Lopu PR manager` itself. External checks remain covered by
      `check_run`; first-party Actions checks must not rely on that suppressed
      event.
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
- [ ] Promote two independently green features that add the same workflow
      caller contract at different source offsets. The combined promotion must
      keep one declaration/assertion block, and
      `node remix/scripts/workflow-caller-contract.mjs` must pass before the
      promotion is considered release-clean.
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
- [ ] Musing requests budget for reasoning: the OpenAI call sends
      `max_completion_tokens` and never the deprecated `max_tokens` (o-series
      and GPT-5 models reject it), and both providers leave enough output
      headroom that a high/max-effort entry still streams visible text. Put a
      reasoning entry first and confirm a real musing arrives, not an empty
      one. If a decorated attempt finishes without a single text delta, it
      must retry once bare on the same model before falling through to the
      next provider and then the canned library — never emit a blank provider
      meta event or render a blank message. Run `npm --prefix remix run
      test:lopu-streaming` to exercise both provider request bodies and every
      starvation/fallback transition with local SSE doubles.
- [ ] With an availability failure on the first configured model, Claude
      Code tries the ordered native fallback chain. A completed run that still
      leaves conflict markers stops for manual review; it does not silently
      spend another model attempt.

## Lopu internal PR/stack rebase engine (protected `github-actions` implementation)

- [ ] Push one commit to a branch with PRs targeting and originating from it.
      Confirm exactly one automatic `Lopu PR manager` run owns merge, stale,
      rebase, and stack detection. Product branches must contain no
      `rebase-pr-stacks.yml`; `Lopu PR manager` accepts both exact merge and
      rebase repository-dispatch events, so `rebase-pr-stack-ai` reaches the
      protected engine only through that one listener's `repository_dispatch`.
      The protected rebase engine is `workflow_call`-only and cannot create a
      competing public run that later gets cancelled by Lopu's embedded rebase
      lane.
- [ ] From Admin → CI Control, dispatch rebase (with cascade both enabled and
      disabled), feature promotion, standing promotion, and main/develop sync.
      Confirm each audit record names `resolve-pr-conflicts.yml`, the request
      retains its original allowlisted operation key, and the translated Lopu
      inputs preserve the requested PR/branch, cascade, dry-run, and lookback.
- [ ] Create standalone same-repo PRs against `main` and against a non-default
      branch whose heads are `mergeable: true` but `rebaseable: false`.
      Confirm automatic, scheduled, push-triggered, PR-triggered, and blank
      manual scans leave both histories untouched: they are not stacks and
      already merge cleanly. An explicit PR-number retry may still replay one
      deliberately. Then make a standalone PR genuinely merge-conflicting and
      confirm only the **Lopu PR manager** base-merge lane owns it. Regression
      class: standalone replay failures were incorrectly force-rebased and
      could ping-pong with a merge-resolver update.
- [ ] Create a two-PR stack (child PR based on the root PR's head). After the
      root is rebased, confirm the child dispatch receives the old and new
      parent SHAs, replays with onto semantics, and completes root-to-leaf
      without duplicating the parent's commits. Confirm a stack member with
      either `mergeable: false` or `rebaseable: false` remains rebase-owned,
      while a clean stack is left alone.
- [ ] Exercise detection through Lopu from a branch push, PR opened/reopened
      event, the scheduled scan, and a manual PR-number dispatch. Automatic
      scans evaluate every same-repo PR regardless of base branch, never
      dispatch a standalone history rewrite, route standalone merge conflicts
      to Lopu's base-merge lane, do not race a blocked child ahead of its parent, and
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
- [ ] Whenever a builtin crystal schema is added, removed, or changes its
      projected fields, run `npm run test:schemas`: the pinned projection table
      must name the builtin and its exact retained fields so schema seeding
      cannot drift silently or fail only in Web CI.
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
- [ ] Desktop AI import hashes and device idempotency hashes also ride root
      Binary `uniqueKeys`, never one unique index per crystal field. Run
      `npm --prefix remix run test:collections`, `test:devices`, and
      `test:messenger`; the complete home Things plan must remain at or below
      60/64, repeated device/import writes must reuse the original row, and a
      home bootstrap must backfill then retire the five
      `things_{ai_connection,external_*,device_unique_keys}` generations.
      A custom data endpoint must receive only the current additive index plan:
      it must never run Thingtime's home-only backfill/drop migration.
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
- [ ] Paginated appends never duplicate a post id (`appendPostsDeduped` in
      `feedTypes.ts`): scroll the feed through several pages in BOTH latest and
      ranked modes and on a profile with >20 posts, then confirm every rendered
      `[data-thing-id]` is unique (ranked re-scores a moving window, so later
      pages can re-serve earlier ids; duplicates collide as React keys).
      Every `setPosts` path — including the reset/first page — runs through the
      helper, so a single page that repeats an id is collapsed too. The helper
      itself is covered by `npm run test:feed`
      (`app/components/Feed/feedTypes.test.ts`); this manual pass is for the
      wiring (which pager calls it, and with which `prev`).

## Commander palette (`remix/app/components/Commander/CommanderV2.tsx`, `commanderCommands.ts`, `commanderShortcut.ts`)

The `>` registry and the Cmd+K chord rule are unit-tested headlessly
(`npm run test:commander`, including a route contract that every `>command`
navigation target is a route the router declares). These are the browser-only
halves.

- [ ] `Cmd/Ctrl+K` from anywhere on the page (nothing focused, a button focused,
      mid-scroll) opens AND focuses the nav Commander; pressing it again closes
      it. Exactly one Commander reacts — the nav instance — with a second
      Commander mounted on the page.
- [ ] `Cmd/Ctrl+K` inside an Editor.js block opens the editor's **link tool
      only** — the palette must not open on top of it or steal focus. Editor.js
      binds `CMD+K` to its core link inline tool, so the editor wins inside its
      own blocks (`targetOwnsCommanderChord`, keyed off the `.codex-editor`
      holder). Everywhere else the palette still wins, because nothing else
      binds the chord: check the login form, a comment box and the search field
      still open the Commander, and that Cmd+K still closes the Commander while
      its own input is focused.
- [ ] Typing `>` flips the dropdown to command rows (usage + description) and
      fires NO search request (check the network tab). Backspacing back to
      ordinary text restores the pinned `Search things for…` row and the live
      results.
- [ ] Highlight a row (arrow keys or mouse), then edit the input across the `>`
      boundary in BOTH directions. The highlight must never carry over onto an
      unrelated row of the new list — Enter must not run a command the user
      never selected (`>undo` sits at row index 2).
- [ ] Highlight a row, then keep typing an ARGUMENT (`>the` → highlight
      `>themes` → finish typing `>theme Midnight`). Arguments don't narrow the
      rows, so the stale highlight must not win: Enter applies the Midnight
      preset rather than navigating to /themes.
- [ ] Enter runs the typed command even with no row highlighted: `>theme
      Midnight` applies the preset, `>theme neon` lists the presets without
      switching, `>undo`/`>redo` walk the timeline, `>help` toasts every
      command, and an unknown `>xyz` toasts a pointer to `>help` instead of
      falling through to the path/setter machinery.
- [ ] Selecting a row: argument-less commands run and close the palette;
      argument-taking rows (`>theme`, `>search`, `>docs`) complete to `>name `
      and keep the palette open and focused.
- [ ] Mobile (375×812): the command dropdown is full width with no overflow or
      clipping, and the usage/description columns stay readable.

## Search page (`remix/app/components/Search/SearchPage.tsx`)

- [ ] Build the Vercel output and exercise `/api/v1/things/search` from the
      deployed function with both a plain ranked query and a reaction
      `crystal.emoji contains <name>` condition. Neither path may depend on an
      untraced `unicode-emoji-json` runtime file or return `MODULE_NOT_FOUND`.
- [ ] Commander typeahead searches the live Things + people APIs after the
      debounce: it shows contextual platform posts/data/schemas/people before
      the bounded `Local paths` tier, arrow/Enter and click open the selected
      result exactly once (without then falling through to the typed local
      `/thing/:path` command), and `Search things for…` still opens the complete
      `/search?q=…` result set. With ordinary text and NO highlighted row,
      Enter defaults to that pinned full-search row; an explicitly highlighted
      result still wins, and `path = value` setters still execute instead of
      becoming searches. A failed typeahead leaves full search + local commands
      usable.
- [ ] Commander result visuals use the shared `thingIcon` mapping (including
      filename-aware Thing icons). A person with `avatarUrl` shows that profile
      image with a small `👤` user-type badge; a person without one gets an
      initial fallback plus the same badge. Verify the compact rows remain
      readable and unclipped at desktop and 390px mobile widths.
- [ ] Search results default to `Standard`: posts use the real interactive
      post card and other Things use their native rendered `ThingView` (with
      its rendered/tree toggle where supported). Switching to `Data` restores
      the compact crystal-field cards, and every Data card's `Open thing` link
      opens the ACL-aware canonical `/thing/:id` page. Toggle labels remain
      visible and usable at desktop and mobile widths. A ranked text search
      shows each Thing result's real server `rankScore` as tiny subdued
      `ranked match · N` metadata in BOTH views; chronological/unranked results
      never invent or display a score.
- [ ] Open a post result's canonical `/thing/:id` page. It renders the full
      interactive PostCard inline under `Post view`, keeps `Open post page` as
      a permalink, and still shows the complete `Thing data` panel below it.
      Non-post Things and private admin diagnostics do not show an empty post
      section. Verify the inline card and JSON remain unclipped at desktop and
      mobile widths and survive a full top-to-bottom scroll.
- [ ] Open a non-post `/thing/:id` permalink. Its `Views` controls independently
      toggle the rendered preview and raw `Thing data`, with both enabled by
      default. A component Thing resolves its sanitised live preview; turning
      either switch off hides only that section, and either/both sections may
      be disabled without overflow at desktop and 390px mobile widths.
- [ ] Turn `Thing data` OFF on a normal `/thing/:id`, then navigate — without
      reloading — to a `/thing/migration-diagnostic-*` permalink. The redacted
      error still renders: a diagnostic shows no `Views` card, so it must never
      be gated by a switch carried over from a Thing, or the page would be
      blank with no control left to bring it back. Navigating back to a Thing
      still honours the remembered OFF state.
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

## Hashtags & tag chips (`remix/app/components/Feed/hashtags.ts`, `PostCard.tsx`, `PostComposer.tsx`)

- [ ] Publishing a post whose body contains inline `#tags` stores them in the
      post's `tags` array (lowercased, deduped case-insensitively, merged
      after any comma-separated explicit tags, 12-tag cap) while the literal
      `#Text` stays in the post body. The composer's chip preview shows
      inline tags live as you type.
- [ ] PostCard renders `post.tags` as tappable pill chips (feed, /explore,
      /post/:id, comments with tags — all PostCard surfaces) and linkifies
      inline `#tags` in post text and quote captions. Both land on
      `/search?tags=<tag>` with a visible `tags is <tag>` filter row seeded
      and the search already run; tapping the same chip twice in a row still
      re-runs (the post-search URL cleanup resets the deep-link guard).
- [ ] The linkifier never matches URL fragments (`example.com/page#section`),
      HTML entities (`&#39;`), mid-word hashes (`foo#bar`), or pure numbers
      (`#42`) — those render as plain text — and Unicode tags (`#日本語`)
      linkify correctly (unit-tested in `hashtags.test.ts`; spot-check one).

## @Mentions (`remix/app/utils/mentions.ts`, `MentionAutocomplete.tsx`, `api/utils/notifications/mentions.ts`)

- [ ] Posting `hey @<user> 👋` (or commenting it) mints a `mention` bell
      notification for that user — "mentioned you" + preview text, click
      lands on the post — and sends the mention email when their email
      channel is on. Self-mentions and unknown `@nobody` names emit nothing;
      at most 10 unique mentions per text are honoured.
- [ ] A mentioned user gets exactly ONE notification per event: mentioning
      the post author inside a comment on their post yields only the
      `comment` notification, and a mentioned friend/follower is skipped by
      the post fan-out (no `mention` + `post-from-friend` double-ring).
- [ ] Mentions are visibility-gated (`emitTextMentions` in
      `api/utils/things/things.ts`): mentioning a user in a PRIVATE post
      emits nothing for them (no bell, no email, no preview leak — verify
      their `/api/v1/notifications` stays empty while the post 404s for
      them); a friends-only post's mention rings only accepted friends of
      the author; a `tt:user/<name>` acl grant makes that user's mention
      ring; comments gate on the parent thread's effective (inherited) acl.
- [ ] Editing a post/comment text to add a NEW `@name` notifies that user
      (same visibility gate); names already present in the pre-edit text and
      the direct target owner never re-ring, and an edit that only removes
      or keeps mentions emits nothing.
- [ ] Typing `@` + ≥1 char in the composer body (post AND comment composers)
      pops the people dropdown under the caret (debounced users/search);
      ArrowUp/Down move, Enter/Tab/click insert `@username ` at the caret
      with no cursor jump, Escape closes. Emails (`bob@example.com`) never
      trigger it.
- [ ] PostCard linkifies `@username` tokens in post/comment text to
      `/profile/<username>`, composing with `#hashtag` links in one pass —
      no nested/double links, `#tag@name` seams stay plain, and the literal
      `@Casing` text is preserved (grammar unit-tested in
      `mentions.test.ts`). Mentions in Settings → Notifications has its own
      push/email switch row.

## Admin migrations & collection generations (`remix/app/components/Schemas/MigrationsPanel.tsx`)

- [ ] Before and after deploying any `USER_STORAGE_ACCOUNTING_VERSION` bump,
      call `/api/v1/health/nitro`: it reports `degraded` with
      `storageAccounting.state: "migration-required"` while any current user
      ledger is missing, malformed, non-ready, or on the old version. Dry-run,
      then run the named `backfill-user-storage-accounting` migration; confirm
      health becomes `ready`, a tiny image upload completes instead of returning
      `accounting_unavailable`/503, and a second migration dry-run reports 0
      pending.
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
- [ ] When `merge-legacy-collections` reports `0 pending`, stale physical
      generations remain visible in the Storage generations table without an
      orange adoption warning. Make one legacy document genuinely pending and
      confirm the warning returns until the merge converges again.
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

## Single-file embed bundle (`remix/vite.embed.config.ts`, `remix/scripts/verify-embed-bundle.mjs`)

- [ ] `pnpm --dir remix run build:embed` writes exactly one generated asset
      (`dist/embed/thingtime.min.js`) and `[verify] Single-file embed ready`
      prints — no `.map` file and no second chunk.
- [ ] The source-map guard matches an *annotation*, not a substring: appending
      `//# sourceMappingURL=thingtime.min.js.map` to the built bundle fails
      `verify:embed`, while the vendored css-loader/style-loader runtimes that
      Editor.js ships pre-webpacked (they contain the literal
      `/*# sourceMappingURL=data:…` inside code that builds an inline map at
      runtime) must NOT fail it. `pnpm --dir remix run test:embed-bundle`
      covers both directions.
- [ ] `verify:embed` counts only what the embed build *generated*. Adding a file
      to `remix/public/embed/` (the client build copies it into `dist/embed/`
      before the embed build runs) must not fail it; a real second chunk or a
      `.map` still must.
- [ ] `/embed/demo.html` reaches `✓ Host globals untouched` (`data-passed="true"`
      on `#host-integrity`) when served under the **production** CSP, not just on
      the dev server. Deployed paths get `script-src 'self'` with no
      `'unsafe-inline'` and no hash/nonce, so any inline `<script>` on that page
      is silently refused and the verdict hangs on "Checking host isolation…"
      forever — while `devCsp` allows inline scripts and hides it locally. The
      demo's code must stay in `/embed/demo-host.js` and
      `/embed/demo-integrity.js`; `verify:vercel-output` fails the build if an
      inline executable script reappears in `embed/demo.html` or
      `embed/bridge.html`.

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

- [ ] Run `corepack pnpm --dir Commander test:raycast-extension` and confirm
      regex replacement escapes are decoded once, unsupported escapes remain
      intact, and decoded backslashes are not decoded a second time.

- [ ] In General, turn custom resize handling off and verify AppKit's standard edge resizing works. Turn it back on,
      begin a resize, then release the mouse, press Escape, change focus, hide, close, insert an emoji, or press
      Return to paste from Commander’s Emoji & Symbols picker; later pointer movement must never continue resizing
      the launcher. Relaunch and verify the selected mode persists.
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
- [ ] In General settings, turn “Open new Commander windows pinned” off, use
      Open New Window, and verify that launcher dismisses on focus loss; turn
      it on, open another window, and verify it remains visible on focus loss.
- [ ] Right-click the launcher pin icon and toggle “Open New Windows Pinned”
      both ways. Its checkmark must agree with General settings after reopening
      the menu and relaunching; existing windows keep their own pin state and
      Open New Window uses the newly selected default.
- [ ] Search apps with prefix, substring, keyword, and fuzzy queries; navigate
      with arrows, execute with Return, open Command-K, traverse actions, and
      dismiss actions/launcher with Escape. Long names must not clip or create
      horizontal scroll in default or compact mode.
- [ ] With Apps first in search category order, search `magician` and `recovery`:
      SamsungMagician and Thingtime Recovery should lead even with over 30
      matching files/folders. Full app names must still match; `Magician.png`
      and `recovery.c` must prefer their exact files. File-first category order
      and learned preferences must still work, and `emoji` must retain its
      built-in picker priority. Repeat after relaunch to check cached ranking.
- [ ] With over 1,000 indexed apps, files, and folders, verify complete catalogue
      reads include records beyond the former cutoff. Repeat short app searches
      after background indexing completes: apps must not disappear. Relaunch
      with a fresh saved index and type several queries; neither action should
      start an indexing run. A numeric result-page size must not truncate the
      stored catalogue or discard candidates before the indexer ranks them.
- [ ] Run a broad query with at least 30 path-backed results and move selection
      quickly through the list. Results must stay interactive, rendering generic
      or cached icons immediately and progressively resolving every visible
      Finder icon (selected first) through the bounded queue. Rerun the query
      to confirm cached icons return without a bridge burst; macOS must never
      show a rainbow beachball once rows are visible.
- [ ] Search typo variants such as `settngs`, `extensoin`, and `raycsat` across
      apps, commands, extensions, files, and folders. Repeatedly choose a lower
      equivalent result, rerun the same query, and verify device-local learned
      ranking promotes it after a full Commander relaunch without changing an
      unrelated query.
- [ ] On a large mixed application/file index, search `raycast stop`; verify
      the separator-equivalent `raycast-stop` application is present above
      `raycast-start`, `raycast-status`, and noisy one-token file matches. Run
      the indexer regression with a one-result output limit and verify all 129
      matching FTS candidates are evaluated before ranking; rapid refinements
      must keep only the active and latest uncapped query in flight.
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

## Cross-tab Thingtime sync (`remix/app/Providers/thingtimeSyncChannel.ts`)

- [ ] `npm run test:autosave` passes, including safe-codec Date/string/cycle
      round-tripping, runtime-function stripping, explicit `undefined`,
      malformed/foreign message rejection, self-echo suppression, channel
      cleanup, and the no-`BroadcastChannel` fallback.
- [ ] In two same-origin tabs, set a drawer preference in Tab A and a different
      preference in Tab B. Each change appears in the other tab without reload;
      then trigger another write from the formerly stale tab and confirm neither
      preference is reverted by its next full-tree autosave.
- [ ] Send at least 20 rapid path-level writes from one tab. Both tabs converge,
      a reload restores the final values, undo/redo remains local to each tab,
      and neither console shows an echo storm, serialization error, or channel
      lifecycle error.
- [ ] Make at least two local edits around an unrelated remote edit, then undo
      locally. The restored data path reaches the peer, the peer's independent
      value remains, and root `timemachine` metadata never crosses tabs.
- [ ] In the Commander, assign the root itself (`tt = …` / `thingtime = …`) in
      Tab A. Tab A replaces its own tree as before, but Tab B's tree and undo
      timeline are untouched — a whole-tree replacement is never broadcast,
      while a named child of the root (`tt.settings.…`) still syncs.
- [ ] Repeat that root assignment through a doubled alias (`tt.tt = …`,
      `thingtime.tt = …`) and write a doubled-alias timeline path
      (`tt.tt.timemachine.… = …`). Neither crosses to Tab B: its root
      `tt`/`thingtime` self-reference and its undo timeline both survive
      intact, while `tt.tt.settings.…` still syncs as ordinary data.
- [ ] View chrome stays in its own tab. With the Commander open and a query
      half-typed in Tab B, open and then close the Commander in Tab A: Tab B's
      palette neither opens, closes, steals focus, nor loses the typed query.
      Open and close the nav drawer in Tab A: Tab B's drawer does not move.
      Reload Tab B afterwards — both still restore from its own persisted
      state, exactly as before the channel existed.
- [ ] Drawer section selection follows each tab's own route. Put Tab A and Tab B
      on routes under two different top-level drawer items, with both drawers
      open, then click a third top-level item in Tab A. Tab B keeps its own
      selection and submenu — it does not jump to Tab A's section, including
      while Tab B's drawer is closed and after reopening it. Reload Tab B: it
      still restores the section it last selected itself.
- [ ] Editor open-config handoff stays in its own tab. With Tab B sitting on
      `/editor` with windows open (and no config opened there since it loaded),
      open a saved config from the drawer in Tab A. Tab B's layout is untouched.
      Then set an intent in Tab B's drawer without navigating yet, open a config
      in Tab A, and confirm Tab B still opens its own config when it arrives.
- [ ] DevKit prefills stay in their own tab. With a real username/email/password
      typed into the register form in Tab B, open DevKit in Tab A and click
      "prefill register". Tab B's fields are untouched and its password field
      stays masked. Repeat for the login form and "prefill login". In Tab A the
      prefill still fills that tab's own form, and still does after a reload.
- [ ] Drawer *preferences* still sync in the same session: change the width and
      `opens.direction` in Tab A and confirm Tab B follows without a reload.
      (This is the pair that distinguishes the fix from over-blocking.)

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
      like design mockups/components select the exact entry). On mobile,
      tapping a result keeps the drawer open so another destination can be
      chosen; the explicit close button remains the only dismiss action.
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
- [ ] At mobile widths, selecting a top-level docs route, nested API endpoint,
      or query-param entry updates the active destination without dismissing
      the drawer; only the header close button dismisses it. Desktop menu
      navigation likewise leaves the drawer expanded until its collapse
      button is pressed.
- [ ] At desktop widths, the drawer header starts directly below the global
      navigation with no duplicated top spacer, and its collapse control sits
      in the Thingtime Docs title row. At mobile widths, opening the full-screen
      drawer keeps its close control visible in that same header row.

## API docs Try-it runner (`remix/app/routes/docs/ApiTryIt.tsx`, `api.tsx`)

- [ ] Every request example on /docs/api shows a "Try it" panel; nothing ever
      auto-runs on page load or navigation — a request only fires from an
      explicit Run click.
- [ ] Run on a GET example (health or things/trending) shows a green
      `HTTP 200` badge, a grey `<n> ms` timing badge, and pretty-printed JSON
      in a dark code block with its copy button; the response headers list is
      hidden behind the "Show response headers" toggle.
- [ ] The things/rss example renders the Atom XML response as highlighted
      raw text (content-type aware), not a JSON parse error.
- [ ] Editing the query string input and re-running changes the request
      (e.g. add `limit=1`); the URL is always the documented endpoint path —
      typing an absolute URL (`https://evil.example/...`) or a
      protocol-relative `//host` into the query input is rejected with an
      inline error and no request is sent.
- [ ] Invalid JSON typed into the body textarea shows an inline "not valid
      JSON" error without sending; fixing the JSON clears the error.
- [ ] Mutation examples (POST/PUT/PATCH/DELETE) are two-step: first click
      arms a red "Really run" confirm with a cancel and a plain-English
      warning; only the confirm click sends. GET examples run in one click.
- [ ] The Run button is disabled (spinner) while a request is in flight and
      never retries; a network failure or 30s timeout renders a friendly
      inline message, not a toast or a crash.
- [ ] Requests send the viewer's own session cookie (same-origin
      credentials): logged out, a session-auth mutation answers 401 — and
      that 401 renders as a normal red-badged response, the documented
      teaching moment.

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
      Things, posts, comments/reactions, themes, algorithms, every user-owned
      Messenger row (including relationship edges), imported AI history, and
      registered app data.
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

## Account birthday & profile.birthday scope (`api/utils/auth/birthday.ts`, `/api/v1/oauth/userinfo`)

- [ ] Settings → Profile: set a birthday, Save — a reload shows it back; clear
      the field, Save — it stays empty after reload (meta.birthday removed).
- [ ] POST /api/v1/users/profile with `birthday: '2001-02-31'` (or a future
      date, or `1899-12-31`) returns 400 and writes nothing; `'2024-02-29'`
      saves (leap day).
- [ ] The birthday NEVER appears on a public profile: GET
      /api/v1/users/profile?username=… has no birthday field, the profile page
      shows none, and /api/v1/users/search results carry none.
- [ ] The consent screen lists "Birthday 🎂" as its own line; a grant of plain
      `profile` does NOT cover `profile.birthday` (exact consent — no ancestor
      coverage), so /oauth/userinfo omits birthday for profile-only grants.
- [ ] A grant that ticked the birthday returns it from /oauth/userinfo and in
      the authorize handoff user object; untick/decline and both omit it.
- [ ] GET /api/v1/oauth/scopes from a cross-origin page (embedding platform)
      succeeds — the catalog response carries CORS headers so platforms can
      feature-detect `profile.birthday` before opening the popup.

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
- [ ] Visibility fence ("Visibility 🌗" toggles, `meta.visibility`
      'all'|'public'|'private'): a public-only token sees ONLY world-visible
      things — a private thing 404s on GET ?id= even for its owner, listings/
      feed/search omit private things, creating with a private acl 403s, the
      no-acl create default stays public, and PATCHing a public thing's acl
      to private 403s (boundary locked both directions). A private-only token
      mirrors it: public posts 404, the feed shows only non-public things,
      no-acl creates default to acl ['tt:user'] (private), creating/patching
      to tt:all 403s, and reacting/commenting on a public post 404s (target
      invisible). Inherited audiences resolve through the target chain — a
      public-only token CAN comment on a public post and list its comments
      (children carry ['tt:inherit']). 'all' and legacy pre-field tokens stay
      unrestricted; mint 400s on unknown visibility values; /tokens/self and
      the mint response report the fence; the settings row badges 🌐/🔒
      restricted tokens; combines with the 🧸 sandbox. Covered by section F
      of `node scripts/verify-pat-tokens.mjs`.
- [ ] The fence survives the edge cache: `?anon=1` on feed/search is answered
      as the Bearer credential rather than anonymously, the fenced answer
      carries `private, no-store`, and the credential-less cacheable answer
      carries `Vary: Authorization` — `public, s-maxage` is exactly what
      licenses a shared cache to replay a stored response to an
      Authorization-carrying request, so without the Vary a warm anon entry
      reaches a fenced token without the origin ever being asked. Same
      section F.
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
      the dashboard for admins; `/admin/users`, `/admin/apps`,
      `/admin/moderation`, `/admin/tiers`, `/admin/ci-control`,
      `/admin/external-integrations`, and `/admin/system` each open the exact
      matching tab, remain correct through refresh/back/forward, and an unknown
      admin section safely returns to `/admin`. The drawer's Account section
      shows the 🛠️ Admin item only for admins.
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

## CI control-plane storage (`ciControl` satellite, retention, relocation, index rebuild)

Regression class fixed 2026-09-02: `things_v2` in production held 1.82M docs of
which 99.75% were `ci-*` telemetry, paying an entry in each of its 64 indexes
(3.15 GB of index for ~4.5k content docs) and growing ~270k rows/day.

- [ ] Every `ci-*` write lands in `ciControl_v1`, never `things_v2`: send a
      signed synthetic `workflow_job` delivery to
      `/api/v1/integrations/github/webhook` on a local stack and confirm
      `things_v2` gains no `thingtime: ci-*` rows while `ciControl_v1` gains
      the repository, job, and event rows (admin query workbench, collection
      `ciControl`).
- [ ] Retention stamps: a `ci-event` row carries `expiresAt` ≈ createdAt + 14d,
      a `job:` `ci-workflow-run` row ≈ updatedAt + 30d, a top-level run/
      deployment/preview ≈ 90d, and `ci-repository` / `ci-pull-request` /
      `ci-branch` / policy / dispatch rows carry NO `expiresAt`. Re-delivering
      an update to a job refreshes its stamp from the new `updatedAt`.
- [ ] Env overrides: `THINGTIME_CI_EVENT_RETENTION_DAYS=0` removes the stamp
      from new events (kept forever); a non-numeric value falls back to the
      default; values above 3650 clamp.
- [ ] Repository no-op suppression: two consecutive deliveries for the same
      repository with status `active` record ONE `ci-event` whose parent is the
      repository row (the insert), not one per delivery; an `archived`
      transition records one more. Entity events (PR `synchronize` with an
      unchanged status) are still recorded.
- [ ] `GET /api/v1/admin/ci` dashboard: runs, events, stats counts, and
      `freshness.latestEventAt` still populate from the satellite; the
      per-parent history drawer still lists events newest-first.
- [ ] Boot ensure on a database that carries the seven retired `things`
      index names (`kind_1_typeId_*` ×4, `kind_1_deletedAt_*`,
      `thingtime_1_parentId_1_createdAt_-1_shareId_1`,
      `things_ci_repository_updated`) drops them; the unfiltered `kind_1_*`
      and `sandboxExpiresAt_1` originals are replaced by the partial
      `things_v1_kind_*` / `things_sandbox_expires_at` indexes with the new
      index created BEFORE the old name is dropped (`db.things_v2.getIndexes()`
      never shows neither).
- [ ] `ciControl_v1` ends up with exactly `_id_`, `ci_control_share_id_unique`,
      `ci_control_repository_updated`, `ci_control_repository_status`,
      `ci_control_repository_external_id`, `ci_control_parent_created`, and
      `ci_control_expires_at` (TTL, `expireAfterSeconds: 0`).
- [ ] `relocate-ci-control-telemetry` (admin **/migrations**): on a database
      holding pre-satellite `ci-*` rows in `things_v2`, the dry run reports
      per-kind relocate/expired counts and writes nothing; the confirmed run
      copies live rows (insert-if-absent by shareId — a satellite row that
      already exists keeps its newer state), deletes every matched `things`
      row including already-expired ones, and reports `drained`. A run that
      hits its time budget says so and the panel's pending count keeps the
      migration actionable until it reads 0. Non-CI things are untouched.
- [ ] `rebuild-things-indexes`: the storage-generations table shows document,
      on-disk, and index bytes per physical collection with an orange `N× docs`
      badge when index bytes exceed 8× document bytes (and 64 MB); the dry run
      lists plan-owned indexes and any residue it would leave alone; the
      confirmed run rebuilds them (twins named `<name>__rebuild` appear only
      during the run), `db.things_v2.getIndexes()` matches the plan afterwards,
      total index bytes drop, and a duplicate `shareId` insert attempted during
      the run is still rejected with E11000.
- [ ] `GET /api/v1/admin/migrations` generation rows carry `dataBytes`,
      `storageBytes`, `indexBytes`, `indexes`; capabilities advertise
      `api.admin-migrations` `1.1.0` and `api.mongodb-raw-results` `1.1.0`
      (collection allowlist now includes `ciControl`).

## Admin CI control plane (`/admin` → CI Control, `api/utils/ciControl/`)

- [ ] With a prior snapshot cached, CI Control paints the last-known feature
      rows on first render without a spinner, then reconciles in the background.
      A failed refresh preserves those rows, says they are cached, and retries.
- [ ] Grow CI event/run/deployment history beyond MongoDB's 32 MiB blocking-sort
      threshold and confirm `/api/v1/admin/ci?limit=0` still returns through the
      repository-scoped `things_ci_repository_updated` index. Confirm every
      selectable feature, branch, and PR is returned, recent run/deployment/
      preview/dispatch rows are capped, and the four summary totals remain exact
      through independent counts. Leave the page foregrounded for at least two
      30-second polls and confirm no live-refresh warning appears. While that
      snapshot is unavailable, load a saved stack: every saved PR number stays
      visible as restoring, its count remains honest, and the rows rehydrate in
      order when the live snapshot recovers without another click.
- [ ] Force the CI snapshot reader to raise MongoDB code 292 and confirm the API
      returns a private 503 with `Retry-After` and
      `code: ci_dashboard_query_capacity`. The browser preserves cached rows,
      coalesces overlapping 5s/30s refreshes, backs off 30s → 60s → 120s up to
      five minutes, and a manual Refresh bypasses that wait. Runtime logs contain
      `ci_dashboard_query_failed`, the route, and Mongo code 292 without query,
      namespace, credential, or document details.
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
- [ ] Build and save multiple Feature Stacks with one or more feature rows and
      one or more targets. Reload, edit each stack, and confirm order, name,
      targets, auto-decide state, and target progress persist. Save & merge must
      be enabled with exactly one valid source/target and have no product count
      cap or hidden confirmation gate. Verify the server snapshots live
      same-repo PR base/head refs and SHAs, rejects drafts/forks/moved refs and
      duplicate targets, and forwards only canonical base64 through the thin
      `develop` listener.
- [ ] Rerun a saved Feature Stack after one selected PR has merged, another has
      closed, and another has become a draft. The new run safely omits those
      inactive entries, preserves the relative order of every remaining live
      source, and rejects only when no compatible live source remains.
- [ ] Mix PRs targeting `github-actions`, `main`, and `develop`, keep Auto
      decide branches selected, and prove the immutable plan routes controller
      sources only to `github-actions`, main sources only to `main`, and develop
      sources only to selected product targets. Include a selected source and a
      selected target with no compatible partner: both are safely omitted while
      the remaining compatible pairs still queue, and a zero-pair plan is rejected.
      Confirm skipped saved targets are labelled skipped rather than running forever.
      Uncheck it and prove the
      explicit merge-everywhere mode remains available.
- [ ] In the protected Feature Stack run, confirm each target starts from its
      admitted SHA, every source becomes exactly one two-parent merge commit in
      list order, clean merges are byte-identical to Git, AI edits touch only
      recomputed conflict paths, source/target movement aborts publication, and
      a target-specific PR is opened with auto-merge while branch protection
      remains the final gate. The target worker must remain active until that
      PR is actually merged, and must fail if the PR closes unmerged. Pause or
      opt-out labels must stop the batch.
- [ ] After a large Feature Stack publishes its target PR, run the required
      Web CI aggregate against the combined head. Cross-branch additions must
      retain every shared runtime import and keep the typecheck ratchet at or
      below its baseline; repairing the published head must rerun required
      checks without replacing the immutable stack history or disabling
      auto-merge.
- [ ] While a Feature Stack is active, confirm Lopu posts a signed progress
      snapshot immediately, whenever its target phase changes, every ten
      minutes while unchanged, and once when all target workers are terminal.
      Reload CI Control between updates: the stream must retain chronological
      messages, exact per-job GitHub links, progress percentage, and a refreshed
      finish estimate in the browser's local timezone, even after more than 500
      unrelated CI events arrive between heartbeats. A changed body, stale
      timestamp, mismatched repository/stack/run, or replayed delivery ID must
      not create a second event, and reporter failure must not cancel the merge.
- [ ] In AI credential waterfall, add Anthropic, OpenAI, and a custom platform
      from the dropdown's Add value field. Add two named OAuth tokens and confirm
      neither value appears in GET/mutation responses, browser storage, page
      text, logs, or copied metadata. Reorder them, reload, toggle one off,
      rotate it, and delete it; ordering and enabled state remain stable.
- [ ] Send a fresh exact-body HMAC request to
      `/api/v1/integrations/ci/credentials` from each allowed protected/listener
      workflow ref. Confirm the response is `no-store`, contains enabled tokens
      in admin order, and the same nonce, a stale timestamp, another repository,
      another workflow filename/ref, a changed body, or bad signature is
      rejected without disclosing a credential.
- [ ] With an empty vault and the legacy preferred/primary OAuth repository
      secrets present, run one protected Lopu job and confirm they import once
      with the intended names/order. Run again to prove no duplicates, then
      remove the account-specific GitHub secrets and prove a Claude-backed job
      fetches from Thingtime using only `THINGTIME_CI_ROUTER_SECRET`.
- [ ] Force classified capacity failures through at least three enabled vault
      rows and verify Lopu tries them strictly top-to-bottom. A non-retryable
      model/tool failure must stop immediately. Max-turn continuation and
      Graphify reuse the exact selected mode-0600 token without restarting the
      waterfall or printing any value.
- [ ] Fetch `/.well-known/thingtime-capabilities.json` from localhost and the
      preview origin. Confirm its `origin` matches exactly, every generated API
      and `-docs` route has one semantic feature, `api.admin-ci-dispatch` is
      `2.1.0`, the CI snapshot is `1.0.1`, passkey registration/login options
      are `1.0.1`, admin credentials are `2.0.0`, signed credential delivery is
      `1.1.0`, signed stack progress is `1.0.0`, saved stacks are `1.3.0`, admin PR previews are `2.0.0`, and the Feature Stack UI refuses a missing, older-minor, or
      breaking-major manifest before dispatch. CI dispatch 2.1 adds
      compatible-pair omission during automatic Feature Stack routing.
- [ ] Start a saved Feature Stack, then use its Pause control while the linked
      GitHub Actions run is queued or active. Confirm only that exact run is
      cancelled, the saved definition and historical GitHub link remain, the
      stack reads paused after late webhook/progress receipts, and ordinary
      Save & merge refuses until Restart is used. Repeat with Stop, then use
      Restart and confirm a new immutable run id and GitHub run are appended
      without replacing prior history. At desktop and 375px mobile widths,
      all three controls remain visible, labelled, non-overlapping, and show a
      clear confirmation before Stop or active-run Restart.
- [ ] Select one trusted open PR and independently enable Develop and
      Production/Main previews, including both at once. Develop must use only
      the configured Custom Environment; Production must require the explicit
      warning acknowledgement, and use Production values server-side. Confirm
      one GitHub Actions-owned marker comment appears before either deployment starts,
      with a row for each enabled environment, its expected persistent URL, and
      a clearly labelled estimated ready time. Confirm the same comment updates
      each row with the immutable `*.vercel.app` snapshot and its distinct
      PR-scoped persistent URL. A READY receipt must move only that environment's
      alias to the verified current SHA; synchronize must update both rows
      without adding another marker comment. Disable one environment and close
      the PR to prove only owned aliases/deployments are removed, while `thingtime.com` and
      `dev.thingtime.com` never move. Neither response, browser state, log,
      comment, nor status event may contain a credential value.
- [ ] Inspect both selected-environment build jobs and confirm they check out
      the exact controller-authorized SHA, receive no GitHub Environment or
      Vercel token, and upload only a symlink-preserving prebuilt archive. The
      protected publisher must validate each archive, use `--prebuilt` plus
      `--skip-domain`, and reject a deployment whose actual Custom Environment
      or production target does not match its selected row.
- [ ] Push a new commit to that PR and verify the signed `synchronize` delivery
      rebuilds each enabled environment at exactly the new live head SHA.
      Drafts, forks, moved heads, another repository, and closed PRs fail
      closed. Disable each environment and close the PR; cleanup must delete
      only deployments carrying the exact Thingtime PR/environment markers,
      while stable develop and production deployments remain untouched.
- [ ] Save each supported automation with GitHub Actions, then Vercel Sandbox,
      and verify the cached dashboard updates optimistically and rolls back with
      authored copy on failure. Web CI and Electron release visibly remain
      GitHub-only rather than accepting an unsupported provider. The section
      presents Feature Stack, conflict repair, rebases, promotions, and sync as
      operation lanes of the one Lopu PR manager; Web CI and Electron remain a
      separate supporting-build group, never competing repository managers.
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
- [ ] Desktop: search and use the Vercel-style multi-select PR status filter,
      including All statuses, Clean, Conflicting, Draft, Merged, Closed, Unknown,
      and every mixed combination; confirm each choice matches the status badge exactly,
      then select a PR, open its GitHub and
      preview links, inspect topology, Actions runs, and the full status
      timeline. Scroll the page top-to-bottom and the sticky detail panel to its
      bottom without clipping, overlap, or horizontal page overflow.
- [ ] Select and remove at least 30 Feature Stack PRs while the selectable PR
      table is in view. The ordered stack and selectable PR table remain separate
      scroll regions, the composer height stays fixed, and the row under the
      pointer does not jump vertically after any selection.
- [ ] Run a saved Feature Stack and keep it selected. Its live merge stream
      refreshes dispatch, workflow/job, skipped-target, and target-PR updates
      without a page reload; progress never decreases; links open the matching
      GitHub run or PR; and the clearly labelled estimated finish uses the
      browser's local timezone. Terminal success and failure stop live polling.
- [ ] Complete the public Feature Stack controller while deliberately skipping
      its target worker. The timeline remains strictly chronological, the card
      changes from Live to Needs attention without inventing another ETA, and
      current plus bounded historical rows link only to their exact GitHub runs.
- [ ] Collapse and expand the Lopu automation, AI credential waterfall, and
      Feature Stack cards from their headings. Reload and navigate away/back;
      the per-admin collapsed state persists, the closed cards consume only
      their heading height, all heading toggles expose `aria-expanded`, and a
      selected actively running Feature Stack can remain collapsed until the
      admin deliberately opens it again.
- [ ] Open `/admin`, then every bookmarkable tab route (`/admin/users`,
      `/admin/apps`, `/admin/moderation`, `/admin/tiers`, `/admin/ci-control`,
      `/admin/external-integrations`, `/admin/system`). Reload and use Back and
      Forward; the selected tab and content must match the URL without a page
      jump, and an unknown section must fail closed to Users.
- [ ] Desktop and 375px mobile: add/remove Feature Stack rows and targets, save,
      load, edit, archive, toggle auto-decide, and inspect target progress;
      verify long branch/feature names truncate without hiding
      their remove controls, the ordered list remains readable, every control
      is keyboard-focusable, and the full page has no horizontal overflow.
- [ ] Desktop and 375px mobile: exercise every credential row control, the
      add/rotate password fields, long labels, eight-row maximum, delete
      confirmation, and error alerts. Scroll top-to-bottom; no credential
      control clips, overlaps, or creates horizontal page overflow.
- [ ] Admin → System: edit an existing non-default model row in place, change
      model, effort, and speed, cancel once, apply once, reject a duplicate,
      save, reload, and confirm its priority is preserved without delete/re-add.
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

- [ ] Lopu drawer alignment: at desktop widths, open/close and resize the left
      and right drawer with a notification visible. All six placements stay
      within the page content; centred messages use the remaining content centre.
      At 390px, the temporary drawer leaves notifications readable and dismissible
      without horizontal overflow. Check both page top and bottom.

## Notification history (`/notifications`, `remix/app/components/Notifications/`, `api/utils/notifications/listQuery.ts`)

- [ ] `/notifications` (auth) lists every notification the viewer has received
      newest first (server keeps the newest 10,000 per recipient), with the
      unfiltered first page painting instantly from `tt-notif-history-<id>`
      and reconciling in the background; a cold start shows one spinner only.
      Signed out, the page renders the quiet "Log in" state and never 401s.
- [ ] Category chips All / Social 🤝 / Engagement 💬 / Feed 📰 / System ⚙️, the
      Type dropdown (grouped by category), "Unread only", the search box
      (debounced ~300ms, literal match over preview / actor name / username /
      system title — `(.*)` finds nothing), and From/To day pickers all write
      to the URL (`?category=&type=&unread=1&q=&since=&until=`); reloading or
      sharing the URL restores the exact view, and "Reset filters" clears it.
      Picking a type outside the active chip flips the chip to that type's
      category; picking a chip that cannot hold the type drops the type.
- [ ] The summary line shows `N notifications match · M unread` (server
      `total` with `withTotal=1`); changing filters dims the current rows
      instead of flashing empty; "Load older" appends via the `before` cursor
      with no duplicates.
- [ ] Clicking a row marks it read optimistically (row tint clears, unread
      count drops, bell badge cache updates) and follows its click-through:
      system notes → their `href` (`/actions/<key>`), else `/post/<id>`, else
      the actor profile. "Mark all read ✓" clears every row + the bell badge
      and reverts with a Lopu error toast on failure.
- [ ] System notes: running an action from its detail page (or the API)
      lands an `action-run` row — 🦄 Lopu avatar in a rainbow ring, headline
      `Action “<name>” finished ✅` / `failed 🌧️`, detail `<ms> · <ops>` or
      the error, System tag, click-through to `/actions/<key>`. A delegated
      component click (`source: 'component'`) only notifies when it FAILS.
      Own social actions still never notify yourself.
- [ ] Settings → Notifications gains the "Action runs ⚡" row (push ON, email
      opt-in by default) and a "History 📜 → Open" row; switching a type off
      hides it on `/notifications` too; the bell popover's "See all →" opens
      the page and the drawer's Account group lists Notifications 🔔.
- [ ] `GET /api/v1/notifications` rejects nothing new: unknown `types` /
      `category` values match nothing (empty page, `total: 0`), `q` is capped
      at 100 chars, `since`/`until` are inclusive, `unreadCount` ignores the
      filters, and the capabilities manifest advertises
      `api.notifications-list` and `api.notifications-settings` at 1.1.0.
- [ ] 375px: chips, inputs and the date row wrap without horizontal scroll;
      rows never clip the category tag; the Lopu avatar ring stays round.

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

## Thingtime desktop mesh packaging (`electron/`, `MCP/`, `macos/ThingtimeNode/`)

- [ ] Refresh Recovery and compare its published-release count with GitHub, including
      prereleases and older pages. Desktop and Recovery rows must arrive as one
      snapshot; a later-page rate limit keeps the previous complete list visible.
      Intel Macs must never select arm64-only archives.
- [ ] Publish desktop and Recovery assets in the same GitHub release, then select
      each row. Exactly one row must select, and its title and download filename
      must match that component even though the GitHub release ID is shared.
- [ ] Download the legacy build 4 ZIP: its missing code-signature resource seal
      must produce an actionable error, remove extraction staging, and preserve
      installed apps and caches. During valid ZIP extraction the window remains
      responsive and duplicate cache/install actions stay disabled.
- [ ] A release with the documented component withdrawal marker remains in the
      catalogue as UNAVAILABLE, explains that its archive is damaged, and cannot
      start a download. Its unmarked companion and newer releases remain usable.
- [ ] Run Recovery unsigned packaging with an absent cache root. It must build
      and verify the archive round-trip on a fresh machine, without requiring a
      previous local build. Corrupt an existing cached app and repeat the cache
      request: verification must reject it rather than reusing the stale entry.
- [ ] Replace a damaged installed app with a valid cached bundle. Preserve the
      damaged bundle separately, never add it to the verified cache, and report
      its backup path. An invalid replacement must leave the current app intact.
      A detached installer failure must reopen Recovery with a visible error;
      the automatic catalogue refresh must not erase that explanation.

- [ ] Build and open the signed `Thingtime Recovery.app`; it must remain running
      after launch without an `App.init()` nil-optional crash, and its recovery
      store must render before the first refresh completes.
- [ ] Recovery follows every GitHub Release `Link` page (no arbitrary history
      cap) so older rollback bundles remain discoverable; a repeated next-page
      URL fails closed instead of spinning or presenting a partial catalog.
- [ ] Before publishing, production packaging must extract every desktop and
      Recovery ZIP into a clean staging directory and run the same full
      signed-app, Gatekeeper, and notarization checks used for the unpacked
      artifact. A malformed ZIP must block release creation rather than
      becoming a broken recovery option.
- [ ] With all six Developer ID/notarization secrets absent, run the
      owner-approved PR worker and confirm it produces only a SemVer suffix of
      `.unsigned`, `UNSIGNED` desktop and Recovery asset names, and release
      notes that direct people to **Privacy & Security → Open Anyway**. With a
      partial secret set, it must stop before publishing. In Thingtime Recovery,
      verify the UNSIGNED badge, explicit cache acknowledgement, cache entry,
      launch, and atomic install path; it must never appear as a verified
      update. With all six secrets present, repeat the strict signed/notarized
      ZIP round-trip instead.
- [ ] From an ad-hoc unsigned Recovery app, launch and atomically install an
      explicitly acknowledged `isUnsigned: true` cached desktop bundle. The
      detached helper must derive the unsigned lane from that cache manifest,
      re-check the ad-hoc bundle before each use, and preserve the prior bundle
      on failure. Remove that manifest marker and confirm it fails closed as a
      signed release rather than silently downgrading verification.
- [ ] Run the Swift tests and release-build both `ThingtimeNode` products; run
      MCP typecheck, tests, and `build:desktop`; then run the Electron tests.
      Cancellation/timeout cases must terminate the connector child and mark
      ambiguous in-flight work for review, while queue scheduling still lets
      steer and interrupt overtake a blocked queued send. Keep a real connector
      pipe active beyond two minutes: incremental `AsyncBytes` reads must
      deliver output before EOF, and a stale reader generation must never clear
      or terminate its replacement process.
- [ ] Build with the repository's exact Corepack pnpm version. Confirm the
      package-manager preflight and electron-builder's nested dependency
      collector both resolve that same version even when a different global
      pnpm is first on the inherited `PATH`; the temporary shim is removed on
      success and failure.
- [ ] Build the local app with a stable Apple Development identity, then run
      strict deep `codesign` and the repository verifier against the unpacked
      bundle. Install only that verified bundle with `install:local`, rerun
      both checks against `~/Applications/Thingtime.app`, and compare the outer
      app/node/bridge team identifiers, designated requirements, and executable
      hashes between build and install.
- [ ] Confirm electron-builder compiled `electron/build/Thingtime.icon` into
      the installed app. Inspect Finder/Dock in light and dark appearance: both
      must keep the exact green canopy/brown trunk artwork legible against the
      adaptive background, with no stale generic Electron icon.
- [ ] Inspect the embedded
      `Contents/Helpers/Thingtime Node.app/Contents/Resources/ThingtimeNode.icns`
      and its `CFBundleIconFile` declaration. The prompt/Finder artwork must
      show three separated green canopy nodes and one brown trunk node, each
      visibly joined to the central pink/red square. It must retain transparent
      outer corners and remain recognizable at 16, 32, and 128 px instead of
      showing the generic app blueprint.
- [ ] Build with `THINGTIME_DESKTOP_DEFAULT_ENDPOINT` set to the intended PR
      deployment. In **Thingtime desktop** settings, confirm production,
      development, and that preview are pre-populated; add at least two named
      custom origins, select between them, remove an inactive custom entry, and
      reject credentials/query/fragment/non-loopback HTTP. A selected endpoint
      must serve `/api/v1/devices` (authenticated data or 401/403, never 404),
      become the bundled server's API proxy target and the LaunchAgent API
      origin together, and keep its Keychain/journal pairing scope isolated
      from every other endpoint. The BrowserWindow itself must stay on the
      packaged loopback renderer, never navigate to the selected remote API
      origin, and still render the packaged interface with the API target
      unavailable.
- [ ] With a previously selected preview that returns a real API 404, open
      desktop Settings and confirm the saved preview remains selected while its
      compatibility line says it does not expose the computers API. No managed
      node restart, registration, or endpoint rewrite may occur; all unrelated
      settings remain interactive while the small **Check now** indicator is
      active. Once the deployment returns authenticated `/api/v1/devices`
      data (or 401/403), use **Check now** and confirm the app additionally
      accepts it only when the bundled loopback proxy reports that exact
      fallback origin. Repeat with a proxy fallback mismatch: it must remain
      incompatible even when the remote route itself exists.
- [ ] Fetch `/api/v1/capabilities` from production, development, and a PR
      preview. It must return schema version 1, exactly one semver `api.*`
      contract for every entry in the API-doc registry, and a `route.*` entry
      for every executable API route (including intentionally undocumented
      diagnostics), plus a valid explicit data-authority identity. Verify the
      desktop accepts a
      compatible `api.devices` minor/patch update, rejects a missing or new
      major, and uses the legacy `/api/v1/devices` probe only when an older
      deployment returns a manifest 404.
- [ ] Configure the same private `THINGTIME_PEER_DISCOVERY_SECRET`, a distinct
      persistent Ed25519 private key, and exact public origin on two first-party
      deployments. A dual-signed announcement must create/renew only its own
      relational peer lease and pin its public key; a changed public key for
      the same origin must fail closed. `GET /api/v1/peers`
      must return capped NDJSON peer rows plus an opaque cursor—never a single
      unbounded JSON list—and must reject missing/expired/bad-body signatures,
      non-first-party hostnames, and loopback origins in production. Trigger a
      self-signed sync and verify it first announces to `thingtime.com`, then
      discovers only the bounded peer budget; every NDJSON event must verify
      against the sending deployment's public key. No browser request may
      possess either private credential. Repeat against a deployment with a
      different `federationId`: its signed request and peer rows must be
      rejected rather than merging distinct production/development/custom
      data environments.
- [ ] Select a build-seeded preview, reload, quit/reopen, reinstall the same
      signed bundle, then install a build which omits or renames that endpoint
      profile. `desktop-settings.json` must retain the normalized selected URL
      and label, migrate schema-v1 IDs when their old metadata is available,
      and never fall back to production merely because a build-specific ID is
      missing. Verify the node registration still uses the same selected API
      origin after every step.
- [ ] Navigate the packaged loopback renderer directly to `/things` (including
      a `?device=` drawer deep link) and press Cmd+R. Both `/` and the deep link
      must return the bundled React shell with HTTP 200; the window must never
      show `Client app has not been built yet.` or fetch a remote UI shell.
- [ ] On an existing paired computer, confirm the account badge is softly green
      and **Action permissions** starts on **Always allow** without hiding any
      other device controls. In a disposable account/device pairing, change to
      **Ask every time** and confirm the next supported command enters the
      existing approval flow; change to **Deny** and confirm a new command is
      rejected before leasing. Return to **Always allow** and confirm supported
      commands no longer create repeated Thingtime approval cards. Pairing,
      capability, locked-session, and macOS privacy/TCC gates must still block
      unsafe work in every mode.
- [ ] Explicitly register the installed node login service, verify its
      plist passes `plutil -lint`, uses valid `<key>` fields, its executable and
      runtime resolve inside the verified installed app, and its registry
      resolves to the exact private user-data file. Bootstrap must not issue an
      unconditional immediate kickstart. Replace an exact old managed node,
      then confirm launchd owns one new PID with `runs = 1` and no exit.
- [ ] With **Auto-start node on Thingtime launch** left at its default-on
      setting, use the native menu-bar **Quit Thingtime**, confirm launchd is
      stopped while the managed plist remains, then Cmd+Q/reopen the installed
      Electron app. It must bootstrap exactly one node from that existing plist.
      Turn the setting off and repeat: reopening Electron must leave it stopped;
      turn it back on and confirm it converges immediately. A Mac with no
      managed plist must still require the explicit **Start node** confirmation.
- [ ] Open the exact installed Electron app, record its bundled loopback
      renderer origin and separately selected API origin, and Quit with Cmd+Q. Electron must
      stop while the launchd node and
      connector remain alive from the installed bundle for more than two
      minutes. Signed-parent status must remain responsive; relaunch Electron
      and unregister through the same confirmed UI without touching a foreign
      agent/process.
- [ ] In that exact installed app, verify the draggable desktop region stops at
      the 52px titlebar background: Commander, nav controls, Lopu notification
      text, and the notification's 28px close target remain selectable,
      hoverable, and clickable. The titlebar order is drawer, Back, Forward,
      home, search, account, notifications; Back/Forward must traverse real
      renderer history. Kill or delay the async desktop-info response once:
      the preload platform hint must still apply Electron titlebar mode on the
      first paint, without a missing drawer/history row or right-side account
      regression.
      Pin, hover, and focus the drawer: its temporary z-index lift must remain
      below the titlebar controls, its hover popup must use the same 10px top
      and side gutter, and the first menu row must not retain extra Electron-only
      top padding. Recheck the open and closed drawer at 390 CSS px and scroll
      the page through the footer with no horizontal overflow.
- [ ] Select every built-in menu-bar artwork (colour/template/black/white/pink/
      blue tree and colour/template/black/white wordmark), plus one custom
      image. Verify one image-only status item with a readable accessibility
      label; a fresh settings file must choose the pink four-square variant,
      while an existing choice survives upgrade. The full colour wordmark must
      render from the bundled tightly cropped raster at 86x16pt, sit vertically
      centred, and show no SVG rectangle-join seams. Open its menu and verify
      `Refresh Status`, `Open Thingtime`, optional `Restart Thingtime`, and
      `Quit Thingtime`; no `Thingtime Node` menu copy or private custom path may
      reach renderer or cloud state. `Quit Thingtime` must boot out the managed
      LaunchAgent rather than immediately respawning under KeepAlive; opening
      Thingtime again may explicitly register/start it.
- [ ] Exercise **Pair this Mac**, resume, unpair, and **Request access** through
      the signed Electron app. Each presence-gated operation gets one native
      confirmation and can remain open for normal human response time without
      the one-shot bridge timing out. In Privacy & Security, click Apple's
      **Quit & Reopen** only as the user: launchd must replace the helper with
      exactly one node PID and one menu item; a direct LaunchServices start of
      the embedded helper must exit instead of creating a duplicate.
- [ ] Before network pairing, verify the exact signed helper can create, read,
      and delete a disposable `AfterFirstUnlockThisDeviceOnly` item in the
      traditional macOS login Keychain without `errSecMissingEntitlement`
      (`-34018`). A forced local Keychain failure must end as
      `credential_store_unavailable`, make no prepare/complete request, and
      never surface the remote-ambiguity “response was not confirmed” copy.
      After a successful pair, confirm the device appears under `/things`,
      then Quit/relaunch Electron and verify the launchd node and pairing remain.
- [ ] During pairing, inject one lost/ambiguous prepare or complete response.
      The already-approved native operation must replay the exact same signed
      claim internally, succeed without a second confirmation, and create only
      one device relationship. Then exhaust all three bounded attempts: the
      Keychain proof must remain durable, `/things` must refresh from **Pair
      this account** to **Resume pairing**, and that explicit resume must
      reconcile without generating a replacement pairing secret.
- [ ] After a successful pairing, trigger a background local-node refresh. The
      last-known `1 account paired` (or plural) badge, **Add Codex project**, and
      every unrelated setup control must remain present and interactive; only a
      small green checking spinner may be added. A real action may mark only its
      own button as working.
- [ ] Open a paired computer from `/things`. The page overlay may dim the page
      behind the right drawer, but it must sit below the drawer portal: close,
      scroll, and non-destructive drawer controls remain clickable at desktop
      and 390 CSS px, with no invisible full-page interception.
- [ ] On a paired online Mac, quick controls and Applications must open first;
      Audio & routing, Network & connectivity, Node & pairing, Action
      permissions, Power, Connectors, Screen, Approvals, and Command activity
      must start collapsed and retain that layout per computer. Open the three
      audio-route menus and choose a reported device, then verify microphone and
      alerts/effects level and mute controls are shown only when that exact route
      reports support. Use the Wi-Fi controls
      only with a saved/open SSID (never a password), open an application's
      **More** context menu for Focus/Open, Hide/Show, Quit, and the
      approval-required **Force quit**. Use the Applications heading menu for
      **Hide other apps**, and expose **Sleep** from Power. Menus must stay
      above the drawer overlay and remain usable without clipping or horizontal
      overflow at desktop and 390 CSS px.
- [ ] In the exact installed Electron app, open that device drawer and click
      its 44px X while it overlaps the native title-bar band. Reopen it and
      confirm the left edge has an always-visible centred grip with a forgiving
      in-panel hover target; drag that grip narrower and wider until both bounds
      engage. Confirm both the accessible splitter value **and the visible
      panel boundary** move together; a changing value behind an unchanged
      full-width panel is a failure. Then focus the separator and use Left/Right
      (Home resets). Collapse and reopen Node, observed state, applications,
      connectors, screen, approvals, and command activity independently; no
      section toggle may close the drawer or block another control. At 390 CSS
      px the resize edge is absent, the drawer remains full width, and every
      section still toggles without horizontal overflow.
- [ ] On `/things`, collapse a different selection of sections and choose a
      different width for two paired computers. Close/reopen each drawer and
      refresh the page: only that computer's locally stored section layout and
      width may return; device state, messages, approvals, and commands must
      never be written into this layout preference. In a regular desktop web
      browser, the drawer, home, Commander search, account, and notification
      controls must all share the 52px nav bar's 36px centerline. The Commander
      button must open the global Commander on web as well as Electron.
- [ ] Pair two different Macs to one disposable Thingtime account, then pair
      one disposable Mac to two different Thingtime accounts. Every pairing
      link must remain one-use, but the Mac must retain both account credentials
      in its bounded Keychain vault, advertise both opaque device IDs locally,
      and maintain one isolated heartbeat/command/live-sync loop per account.
      Each account's `/things` view must match only its own device ID, while
      prompts/responses never cross accounts. Repeat from a renderer origin
      different from the configured node origin: completion must fail before
      claim with the two explicit origins in the error, then succeed after an
      intentional endpoint switch. Existing single-account credentials must
      migrate without re-pairing.
- [ ] Permission preflight must not prompt. Without grants, Accessibility and
      Screen Recording operations fail closed with actionable instructions.
      The explicit **Request access** action must invoke the matching native
      system request before opening the exact settings pane, then refresh after
      focus/relaunch. After the user grants the exact installed signed bundle,
      relaunch that bundle and prove one harmless protected Accessibility
      focus/read and one real bounded frame capture. Never automate a TCC
      toggle/reset, and do not invoke the system-lock action without explicit
      confirmation.
- [ ] Treat the local Apple Development result only as stable local/TCC proof.
      Gatekeeper rejection is expected for that non-distribution identity.
      Before any direct-distribution release, patch the protected
      `github-actions` workflow, import a Developer ID Application identity in
      its ephemeral keychain, provide notarization credentials, remove every
      unsigned fallback, and require strict signature, Gatekeeper, and stapler
      validation before assets publish.

## Messenger (chats, communities, custom emojis) (`remix/app/components/Messenger/`, `/api/v1/chats*`, `api/utils/messenger/`)

Automated first: `node scripts/verify-messenger.mjs` from `remix/` against the
running dev stack (86 live-API checks: permissions, requests, receipts,
reactions, custom emojis, generic-things escape hatches). Then in a browser:

- [ ] Run `npm run test:messenger` and `npm run test:storage` from `remix/`.
      Against a disposable loopback MongoDB replica set only, run
      `npm run verify:messenger-storage` with
      `TT_MESSENGER_STORAGE_TEST_ALLOW_LOCAL=1` and a loopback-only
      `MONGODB_CONNECTION_STRING`: posts, native Messenger rows, AI
      projects/chats/messages, and relationship rows all increase the same
      account ledger; identical re-import adds zero bytes; a 1-byte allowance
      rolls back the container plus owner membership; the v2 backfill recounts
      legacy Messenger content.

- [ ] `/messages` requires login (guests bounce to `/login`) and the page owns
      the viewport: no body scroll, no footer under the composer, nav
      clearance intact at desktop and mobile widths. In local/dev builds the
      draggable DevKit trigger is omitted on this full-viewport route, so it
      cannot cover message actions, Send, attachment, emoji, or textarea
      controls.
- [ ] Mode toggle (🏛️ Spaces / 💬 Chats) swaps the SAME conversations between
      Slack-style rows and Messenger bubbles; the choice survives reload
      (per-account localStorage key `tt-messenger-mode:<uid>`).
- [ ] In the installed Thingtime Electron app, **✦ AI** opens the connection
      modal in both Spaces and Chats modes. It independently identifies
      ChatGPT, Claude, and Claude Thingtime; the browser build instead explains
      that desktop discovery requires the app. At desktop and 390px mobile
      widths, open every modal state, scroll top-to-bottom, and confirm buttons,
      provider links, progress, and close controls neither clip nor overlap.
- [ ] With a paired online Mac, **✦ AI** lists only its active bounded
      connectors. Refresh a Codex connector, open one mirrored live chat,
      create a chat under an opaque project id/label, and send while idle and
      while a turn is active: Queue, Steer, and Stop map to distinct native
      operations, stable request ids reconcile an ambiguous retry once, and
      reopening/reloading the chat resumes from its event cursor without
      repeating completed text.
- [ ] In a live Codex chat, observe several exact streaming deltas (including
      whitespace boundaries), a completed assistant item, and a command/file
      approval. The activity panel updates without a spinner replacing cached
      history. Reload with an approval pending: only its opaque/redacted safe
      projection replays, and approve/deny still acts on that one request.
      Completed visible user/assistant text survives event expiry as relational
      quota-accounted Messenger messages, while reasoning, command lines/output,
      tool payloads, cookies, credentials, and local paths never appear in UI,
      API payloads, logs, or rows.
- [ ] For a semantic Accessibility connector, permission preflight never
      prompts on launch. Only the already-visible selected chat can be read;
      create, send, or queue appears only when that exact connector advertises
      the capability, and every semantic mutation first requires Thingtime
      approval. Locked, denied, missing-permission, ambiguous-selector, or
      selector-drift states fail closed. Steer, Interrupt, arbitrary app
      selection, coordinates, AppleScript, and shell execution remain
      unavailable unless a future connector explicitly implements and safely
      advertises a narrower operation.
- [ ] Sync one local source and one official JSON/ZIP export. Projects appear
      as Spaces, grouped conversations as channels, ungrouped conversations as
      chats, and user/assistant messages retain order and provider badges.
      Provider rows cannot be edited/deleted; reactions, threads, and new
      Thingtime replies work without posting back to the provider.
- [ ] Repeat the exact sync, interrupt one multi-batch sync and resume it, then
      compare row counts and account usage: stable source rows are reused,
      no message is duplicated, read receipts/mute state survive, and quota
      usage is unchanged after the identical replay. Fill the account and
      confirm the next transactional unit 507s without an orphan Space/chat,
      membership, partial invite redemption, or unmetered row.
- [ ] Inspect the Electron boundary: renderer code receives normalized batches
      only; the selected export path, app data roots, provider credentials,
      cookies, hidden reasoning, tool traffic, and internal context do not
      appear in network payloads, API responses, logs, or persisted connection
      rows. Expired/cancelled sync ids cannot be read again.
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

## Linked deployments (Settings → Linked deployments, `api/utils/deployments/*`, `/api/v1/deployment-links*`)

- [ ] SSRF fence on the link URL (`normalizeDeploymentBaseUrl`): linking to an
      IP literal (`https://10.0.0.5`, `https://169.254.169.254`,
      `https://[fd00::1]`) or an internal-only name
      (`https://metadata.google.internal`, `*.internal`, `*.local`) is refused
      with a 400 — the server must never be steerable at its own network by a
      signed-in user. `http://localhost:<port>` stays allowed for the
      dev-against-dev flow above. Covered by `npm run test:deployments`
      (`app/api/utils/deployments/remote.test.ts`); this row is the live check
      that the route surfaces the refusal instead of attempting the fetch.
- [ ] Two isolated stacks for testing: second mongod (`mongod --port 27018
      --dbpath <tmp> --fork ...`) + second dev stack (`TT_WEB_PORT=11120
      TT_HMR_PORT=11121 TT_API_PORT=11122
      MONGODB_CONNECTION_STRING=mongodb://localhost:27018/ npm run dev`).
      `/api/v1/health/mongodb` on each stack must report its OWN host.
- [ ] Link via password: Settings → Linked deployments → Link a deployment →
      URL + remote username/password → row appears with the remote @username
      and a success toast. With email-2FA enabled on the remote account, the
      form asks for the emailed code first (`requiresOtp` branch).
- [ ] Token upgrade at link time: a password link against a deployment that
      HAS this feature stores a non-expiring link token (`tokenExpiresAt:
      null` in GET /api/v1/deployment-links); the login-derived 30-day
      session is revoked after the swap. Against an OLDER deployment the
      30-day token is kept and `tokenExpiresAt` shows its expiry.
- [ ] The upgraded token actually AUTHENTICATES: right after a password link,
      Sync now must succeed rather than 401 with "no longer accepts the link's
      token". Regression — a session `purpose` that is not in
      `sessionPurposeCanActAsAccount` (`api/utils/auth/credentialPurpose.ts`)
      is dropped by `getCurrentUser`, so minting `deployment-link` without
      allowlisting it stored a token that could never authenticate, and the
      swap had already revoked the working one. Pinned by `npm run
      test:deployments` (`app/api/utils/deployments/linkTokenPurpose.test.ts`);
      re-check this row whenever a new `purpose` is added to `SessionDoc`.
- [ ] Link via token: Create a link token 🔑 on deployment B (shown exactly
      once), paste into deployment A's "Paste a token" form → link works
      without a password crossing between deployments.
- [ ] Sync now (two-way): things move BOTH ways keyed by shareId; a comment
      never lands before its post (dependency ordering); schemas land before
      data things citing them. Immediately re-running sync reports planned 0
      / everything unchanged — copied things must never ping-pong (content
      equality beats updatedAt).
- [ ] Conflict: edit the SAME thing on both sides → two-way keeps the newest
      edit on both, `conflictsResolved` increments. Push/pull modes only ever
      move data in their one direction.
- [ ] Profile path: displayName/bio/avatar/banner sync; two-way prefers the
      non-empty side (a fresh local account pulls the remote profile instead
      of blanking it).
- [ ] Path rules: `things/<kind>: off` suppresses exactly that kind (preview
      shows planned 0 for its pending changes); first matching rule wins,
      then `things`, then the link mode. Invalid paths (`nonsense path!`)
      are rejected with the profile/things/things/<kind> hint.
- [ ] Collisions + skew are AUDIBLE: a shareId owned by a DIFFERENT account
      on the destination reports "belongs to a different account — skipped";
      a kind unknown to the destination registry reports its schema error.
      Sync continues past per-thing errors; 401/429 from the remote abort
      with `remaining` > 0 and re-running continues.
- [ ] Guards: base URL must be https (http only for localhost), an origin
      only (no path/query/credentials); redirects are refused. Link/unlink/
      token-mint ride `deployments.link` (10/5min) and sync rides
      `deployments.sync` (6/5min), both fail-closed — hammering Sync now
      429s with the breather toast.
- [ ] Secrecy: remote tokens live only in the user thing's `secure` blob
      (meta.deploymentLinks) — GET /api/v1/deployment-links never returns a
      token field, and unlinking best-effort revokes the remote session.
- [ ] Optimistic UI: the section paints its last-known roster from
      `tt-deployment-links-<userId>` localCache instantly; mode taps apply
      optimistically and revert on failure; sync summary line updates after
      each run. Mobile (375px): rows wrap, no horizontal scroll.

## Things page (`/things`, `remix/app/components/Things/`, `/api/v1/things/bulk`)

- [ ] A paired Mac appears at `/things` root and search from the dedicated
      devices projection, with cached-first name/presence and current system,
      volume, brightness, lock, open-app, permission, and connector state.
      Open `?device=<id>` at desktop and exactly 390 CSS px, exercise every
      drawer section, collapse/reopen each section, and resize the drawer from
      its left edge at both widths. Confirm the generous edge target draws only
      the slim hover/focus line (no grip pill), the visible boundary follows the
      splitter value, and the 390px panel can shrink to 280px without clipping
      or horizontal overflow. Scroll top-to-bottom: stale and offline state is
      explicit, and desired controls confirm or revert against a newer observed
      revision.
- [ ] Device rows never enter generic selection, copy/move/share/delete,
      context-menu, or preview flows. Capability, permission, lock, connector,
      version, local-only, offline-queue, and approval policy each disable or
      gate the relevant control before a command is sent. Approve and deny one
      command, replay its request id, and confirm the node leases only approved
      work and never blindly re-executes an expired/ambiguous lease.
- [ ] Pairing uses prepare + complete with a server nonce and exact signed
      claim. Simulate a server-committed complete response being lost, restart
      the node, and confirm the persisted pending credential/proof replays into
      one paired device. A changed proof, nonce, credential, or descriptor 409s;
      the legacy unsigned claim is rejected. Treat this as key continuity and
      replay fencing, not platform attestation.
- [ ] Publish a newer complete connector snapshot that removes one connector,
      then replay both the old snapshot and a same-revision changed snapshot:
      the removal stays tombstoned, the changed replay 409s, and live sync is
      rejected for a stale, removed, or revision-mismatched connector. Flood
      bounded command/events in a disposable account and confirm count/byte
      pruning plus TTL indexes prevent quota-neutral control rows becoming an
      unmetered archive; submitted chat text remains once in the billed message.
- [ ] In a disposable account, record storage before pairing and publishing a
      persistent device/state/connector mirror. The canonical stored bytes
      increase the same account ledger as posts and Messenger content; an
      identical revision replay adds zero bytes, while attachments remain
      separately metered and expiring command/event transport does not become
      quota-free durable content.
- [ ] Screen sharing says `not installed` and exposes no fake video stream when
      peer transport is absent. The signed native capture primitive itself
      preflights without prompting, refuses a locked/unapproved session, caps
      display size/FPS/queue/frame bytes, disables audio and input injection,
      and stops on permission loss or display disappearance.
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
- [ ] Create and edit a Text post whose body contains hard line breaks,
      repeated spaces, inline bold/italic/highlight/link marks, and at least
      one block style tune. Verify the exact presentation survives save and
      reload in Feed, profile, nested repost, comment, and `/post/:id` views at
      desktop and mobile widths; legacy plain-text posts must still preserve
      newline breaks without horizontal overflow.
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

- [ ] `node remix/scripts/verify-actions.mjs http://127.0.0.1:<nitro-port>` passes
      end to end (89 checks: closed-vocabulary + capability-coverage + scope +
      ref-grammar refusals at save; run-by-key, $refs/$$-escape/ttConcat/$now,
      run-time scope enforcement, shared budget across actions.invoke, direct +
      ping-pong recursion refusal, ops exhaustion, run-record forgery 403,
      owner-private history, private-action 404, delegated (`source: 'component'`)
      runs refusing a foreign action by id, docs twins).
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
      see public pages read-only (ttActions inert — owner-only interactivity).
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
  with the text composer folded away and the voice deck below it — gear ·
  64px mic (idle card / listening rainbow pulse / thinking spinner / speaking
  breathe) · Stop while Lopu replies — plus a single rounded "Or type to
  Lopu…" field whose Enter sends a normal chat turn (the same brain, tools
  included). With no SpeechRecognition (the in-app Browser pane) the mic
  click toasts "No microphone here" and the typed path still works; with a
  mic, listening pauses for the whole turn and for Lopu's speech (never its
  own voice back), then resumes. The gear popover (never a full-width card)
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
- Messenger: the conversation appears under Chats with the 🦄 rainbow disc,
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
# Storage ledger operator diagnostics

- Validate both immutable legacy four-field and current five-field quota snapshots (and partial overrides). Optional speed-test quotas accept null or safe integers 0–1000, reject coercible strings/fractions/unknown fields, and never change the stored assignment. After deploying, dry-run the production accounting migration before a separately authorized real run; verify storage readiness and a real upload before calling uploads healthy.

- As an admin, dry-run `backfill-user-storage-accounting`; invalid ledgers must report only deterministic ledger IDs and fixed validation-field labels, at most ten records. Confirm zero ledger writes, no raw values or arbitrary key names, and unchanged strict envelope validation. Anonymous and non-admin callers remain denied by the existing migrations API gate.
