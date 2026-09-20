# PR 851 — Copy nested comments and attachment galleries

2026-09-18 · Codex

Copy to my Things now traverses stored relational comments rather than the truncated rendered preview. It includes galleries on each comment, comments on media, and galleries deeper in those media threads. Copied files keep their purpose and order; comments point to their new parent and inherit the private root. Image-only posts and comments validate against inspected copied media before insertion. Copied posts omit source community placement. Reactions and votes remain outside the copy.

The operation retains upload approval, quota reservation, exact-version object copying, moderation, source revocation and rollback. Discovery is batched by level and capped at 512 Things/files/comments; oversized trees fail explicitly. Source snapshots are revalidated before and after writes. Comment attachment reads use canonical inheritance through media parents, and direct comment projections request comment-purpose galleries.

## Validation

- Production build and Vercel output verification passed.
- Actions: 105 passing and one explicit opt-in integration skip; attachments: 218 passing; Things: 249 passing; API capabilities: 66 passing.
- The opt-in integration test was also run explicitly against a disposable local MongoDB replica set through real HTTP handlers: eight content Things, five linked attachments, ordered image-only root gallery, five reply levels, a media-comment thread, copy-again, unauthorized reads and source revocation all passed. Fixture setup and deletion used APIs.
- Chrome desktop and mobile: clicked the actual Copy to my Things button, confirmed the private destination and replies, opened copied comment media and media-thread galleries, and checked the page through its footer. Temporary viewport override was reset.
- Raw TypeScript results match the unchanged base: 116 existing diagnostics, no new diagnostics. The warning-only ratchet's tracked baseline is 108; it does not make the full typecheck green.
- Live acceptance uses linked images. Stored-byte copying is covered by mocked S3 lifecycle tests, including purpose isolation and cleanup; real S3 byte-copy acceptance was not performed.

Local validation URL: http://localhost:17020. Funnel verification was unavailable because the installed Tailscale CLI shim targets a missing `/Applications/Tailscale.app/Contents/MacOS/tailscale` executable. The task-specific app and MongoDB use stable PM2 entries with autorestart disabled.

## Contracts and delivery

`api.things-fork` is 1.5.0 and the copy button requires that minimum. Compatible corrections publish `api.attachment-content` 1.7.1, `api.things-comment` 1.5.1 and Things feature/contract 1.18.1/1.17.1. The user explicitly authorized this Thingtime PR to merge into main. Exact-head checks and provider deployment status are recorded on the PR; local success alone does not establish production delivery.
