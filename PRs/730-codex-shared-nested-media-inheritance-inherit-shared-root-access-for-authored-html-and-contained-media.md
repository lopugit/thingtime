# PR 730 — Inherit shared-root access for authored HTML and contained media

Extends the root audience to same-author post-purpose uploads attached to
contained Things, and to actual media positions in authored rich/raw HTML.
The saved original remains read-only for link visitors. Managed-purpose and
foreign-owner media retain independent authorization; every read rechecks
the root, and a non-owner writer cannot insert unreadable private media.

## Validation and integration

- Initial source `8fd3541762140d223d7fc80d57af2bc894c7c99c` passed 83
  webpage/sharing tests, 26 capability tests, 6 origin-manifest tests and the
  production client/embed build. The final seven media discovery tests also
  cover detached DOMParser scripting mode and parser/render size limits.
- Real loopback API plus built-client Chrome 152 fixture passed in 20.15
  seconds, at 1440px and 390px. It exercised actions, no original edit
  control, copy/login and private-copy isolation, HTML image/CSS transport,
  key/group revocation and writer injection denial. Top/bottom screenshots
  were inspected. Image bytes are stubs, not proof of S3 media copying.
- Full typecheck reports repository errors including the pre-existing
  duplicate headers declaration and navigation/smarts errors. It is not green.
- Develop advanced to `ea8d4a199095570182f3c3648709f13f961fe2aa` after
  publication. Integrate its PR 726 recording/push work and graph retention
  changes, preserving both changelog entries; the only text conflict is the
  changelog. Fresh validation and the updated exact-head preview remain
  required before delivery.
- Graphify refresh uses the code-only fallback after the local semantic
  proxy health timeout. New Markdown is not semantically indexed; available
  structural snapshots and portable reports are retained.
- Integration `72dd13410` was pushed after the focused tests and build
  passed. Develop then advanced to `d0a4344d9` with the APNs follow-up;
  preserve that change and both changelog entries in the next integration.
- The first post-merge browser retry encountered an empty local 502 before
  fixture creation. The Nitro worker had stopped after a missing
  `@vercel/functions` import during the dependency transition. The installed
  dependency now resolves; restarting only this worktree restored the API.
  This local failure is not evidence of a deployed sharing regression.

## Still unfinished

The existing resolver misses media supplied through stored component args;
a direct default-argument image regression returned no attachment ids.
Forks still retain original protected media references and need independent
upload copies, without preserving the original root bearer. General
containment/performance auditing and retryable page-resolve errors also
remain in the active goal. This increment does not claim those are solved.
