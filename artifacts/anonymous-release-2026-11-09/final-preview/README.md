# Final deployed preview acceptance — 10 November 2026

[The immutable branch preview](https://thingtime-7i7q4srza-lopugits-projects.vercel.app/draft-preview/index.html)
is associated by GitHub's successful commit status with `4492bc7eaf8fdf577c88af513c03a98ccca984ae`.
Its fetched runner SHA-256 matches the reviewed `021173e8` build. That association
and exact asset hash are the evidence; no separate runtime Git-SHA marker is implied.

A fresh task-owned Chrome for Testing context, with Chromium sandbox enabled
and no account session, used the actual Render draft and Download JSON controls.
The exported [editable JSON](thingtime-draft.json) contains both required Things
and matches canonical hash `9707745a860b84a11abf034e85f02d9850cfa2f2abbe021683fe133b3b711af4`.
Exact wording and line breaks, 400×560 desktop card, 24px phone margins and no
horizontal overflow passed at 1440×1000, 390×844 and 320×844. [Verification](verification.json).

Actual screenshots: [desktop](viewport-1440x1000.png), [mobile](viewport-390x844.png),
[narrow](viewport-320x844.png), [card](card.png). Invalid JSON disabled export
while preserving the last good preview; reload cleared the in-memory draft.
Only the static index and renderer were requested. There were no account writes,
failed requests, page errors or console errors. The owned browser was closed.

This is deployed preview-browser acceptance. The public origin manifest matches
its preview URL and advertises `api.chatgpt-mcp` 2.2.0, `api.things` 1.58.0 and
`api.actions-run` 1.45.0. The ChatGPT manifest does not advertise render/export.
Actual hosted MCP artifact delivery and production activation remain separate.

API suite, build/typecheck/unit checks, native compilation and both CodeQL analyses passed on published checkpoint `4492bc7e`. [Exact checkpoint check receipt](published-checkpoint-checks.json). Any subsequent evidence-only commit has its own CI state; these results are not relabelled as that later head.
