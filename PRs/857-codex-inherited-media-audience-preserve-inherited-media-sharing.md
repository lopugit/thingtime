# PR #857 — Preserve inherited media sharing and display effective audiences

Branch: `codex/inherited-media-audience`
PR: https://github.com/lopugit/thingtime/pull/857

Standalone media sharing lost the root secret key, owner feed cards scoped it
only to their direct attachments, and inherited child cards displayed a generic
link icon. The shared context now surrounds the whole card, including nested
comments, gallery links, timestamps, menus and navigation back through ancestors.
Quoted originals establish their own context instead of receiving a secret from
an unrelated quoting post.

Single-Thing reads project `audience: {sourceId, acl, linkKey?}` separately from
the stored child ACL. Resolution follows the canonical cycle-safe inherit chain
using a coalesced per-level lookup. The root owner or a viewer already holding
its exact key may share it; group membership, child ownership and remembered
collection grants do not disclose it. App namespace reads omit this metadata.
Changing the root policy remains effective immediately; no ACL is copied onto
children. Intermediate blocked/pending comments also constrain descendant reads.

Cards show the resolved privacy icon and a muted description of the audience.
Direct grants show usernames; groups show their selected group count without
expanding private rosters. Long post labels ellipsize; inherited owner/friends
wording refers to the parent rather than the media uploader.

API features: `api.things` 1.21.0 (legacy contract 1.20.0),
`api.attachment-content` 1.8.1. Client reads negotiate these versions.

Validation on 2026-09-19:

- Production build and Vercel output verification passed.
- Thing, attachment and capability suites passed; regressions exercise nested
  media/comment chains, mixed audiences, key ownership/presentation, missing or
  cyclic ancestors, moderation and link transport.
- Full TypeScript check still reports 116 errors in unchanged files against the
  existing 108-error warning baseline. No changed-file errors remain.
- Chrome desktop and 390x844 checks used the real PostCard, menus and media popup
  with synthetic transport: photo/video navigation, standalone Share, Copy link,
  top-to-bottom scrolling and no horizontal overflow. The audit shows the exact
  keyed Thingtime URL. Synthetic assets do not prove private S3 access.
- Local capability manifest returned the new feature versions. The originally
  supplied media was already readable by the signed-in production account; the
  reproducible defects were lost key transport and mismatched audience display.
- Semantic Graphify extraction recovered its initially truncated response and
  indexed the changed documentation; graph/manifest and portable HTML verified.

Local: http://localhost:18420/scripts/inherited-audience-preview.html
(Vite 18420 / HMR 18421 / Nitro 18422, existing managed worktree stack).
Funnel unavailable: installed Tailscale launcher references a missing app bundle.

Exact-head CI, preview and final production evidence are recorded on the PR and
in the delivery message after they complete.
