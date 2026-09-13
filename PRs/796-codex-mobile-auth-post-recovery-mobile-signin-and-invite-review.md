# PR 796: mobile sign-in, uncertain post recovery and invite review

## Causes and behavior

The reported text/link post had committed successfully. The composer expected `mediaLayout: null`, while the canonical server omitted that optional field. Strict comparison rejected the saved object, even on subsequent successful reads. Recovery now normalizes only the empty layout and still requires exact ID, owner, content, audience, tags and attachment identity. Explicit nonempty layouts remain significant. Retry checks the existing UUID before attempting the same immutable submission.

Create requests have a 30-second deadline; recovery reads have individual five-second deadlines. A deadline means an unknown outcome, never proof that a write failed. The draft stays frozen and retryable until the same submission is confirmed.

A foreign preview cannot use a Thingtime-domain passkey directly. Manual sign-in now navigates in the same tab to the data authority, avoiding Safari popup activation/blocking. Approval uses the existing origin-bound, one-use SSO handoff; the callback carries its code in the fragment and requires an initiating-tab nonce with a ten-minute lifetime. Replay, different origin, expired state and unsafe destinations are rejected. Return state contains only a safe route, without query/fragment credentials. The authority frontend must be deployed together with preview clients.

Live image-review requests returned HTTP 429. OpenAI image/text review now retries short throttles once with bounded timeouts, avoids retrying insufficient quota or long cooldowns, and logs only safe status/code diagnostics. Invite failures retain the draft and offer explicit removal of the optional photo. No invite or credit reservation is created before successful avatar validation. Persistent upstream quota or credential failures still require operator repair; no unreviewed image is approved to bypass an outage. Capability `api.auth-invites` advances to 1.0.1.

## Verification

- 216 focused regressions and 12 invite integration tests pass.
- Production build and Vercel output verification pass; TypeScript ratchet passes at 107 existing diagnostics against baseline 108. New helper lint passes.
- Chrome login checked at desktop and 390x844 through the footer; no overflow or overlapping hint card. Composer checked expanded at both sizes.
- Live local browser test: a private text/link post returned 200, Chrome response interception discarded that response, and exact-ID readback recovered one saved post. Composer reset successfully; the disposable post was deleted through the normal UI.
- Production and development health reported storage accounting ready. Only the localhost test database required repair: backed up three legacy subscription rows, restored missing plan snapshots while preserving overrides, and backed up/removed one ownerless security-test artifact. The canonical storage migration completed successfully.
- Hosted exact-commit build: https://thingtime-nlhq2g3ia-lopugits-projects.vercel.app (4e968cff70ffaad47f0cdd99266bc80f267c8211). Custom production/development domains were not reassigned for this check.
- Local PM2 stack uses 13210/13211/13212 with zero restarts. Tailscale wrapper references an absent application executable, so no Funnel URL was available.
- Graphify structural snapshot/report/HTML refreshed. This installed update command rejects semantic-backend arguments; changed Markdown was not semantically re-indexed.

Physical iPhone Face ID/third-party passkey-provider acceptance remains separate from desktop Chrome checks. Hosted authentication round-trip and persistent moderation availability are rollout acceptance checks, reported in the PR.
