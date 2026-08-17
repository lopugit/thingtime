# TESTING.md — per-area manual test checklists

Run the checklist for every area a PR touches, in a live browser against the
local dev stack (`npm run web-pms`, worktree stacks get their own port trio —
see `AI_ALL.md`). Each list is the distilled regression history of that area:
every line exists because it broke once. Add a line whenever a new bug class
is fixed, and cite the checklist you ran in the PR description.

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
      script are present on the default `main` branch before expecting
      `pull_request_target` to run; a workflow present only on the feature PR is
      deliberately inactive.
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
      and Custom Environment bindings are empty, Vercel reports
      `misconfigured: false`, and the PR alias presents a valid certificate.
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

## Required Web CI contexts (`.github/workflows/web-ci.yml`)

- [ ] On a PR that changes `remix/`, confirm the real build and API jobs report
      `Build + typecheck ratchet + unit tests` and `API suite (headless /tests
      runner)`, while both required-context companion jobs have distinct
      skipped names and cannot satisfy a failed real job.
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
      `node .github/scripts/resolve-pr-conflicts-routing-contract.mjs
--self-test` to prove all AI runtime YAML remains in this contract.
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
