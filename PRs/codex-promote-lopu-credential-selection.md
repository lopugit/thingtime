# Narrow production promotion: Lopu credential selection

This branch starts at production/main `83a709cfa0df49a7bbc74018f7f43f6f9066c29a`.
It promotes the Lopu defaults and per-chat credential selector from merged
PR [#1070](https://github.com/lopugit/thingtime/pull/1070), then applies the
account-isolation and concurrent-update corrections documented in
[codex-lopu-credential-acceptance.md](codex-lopu-credential-acceptance.md).

The source is the original selector commit
`40081185077b2d14c532525258f52a93207b6d06` plus fix `62d211be9`, cherry-picked as
`e62f4bf41` and `023b10aef`. Commit `a637b3745` preserves the existing #1070
review note and its changelog link. The production activity instrumentation
already present in `useLopuChat.ts` is retained.

## Scope and release boundary

The executable diff adds the Lopu default/per-chat selector, choice resolution,
store isolation and scoped rollback, with its unit tests and isolated browser
fixture. Existing saved unavailable pins remain visible. An explicit unavailable
send override fails before reply dispatch. Late requests cannot cross account
generations or overwrite a newer selection/provider save in the same account.

This is a narrow branch off main. It does not merge develop or release PR #1020.
The unrelated develop timer-test change is excluded. Provider-import work from
#1018 is already in main through #1021; this branch adds no provider-import delta.
The open service OAuth #992 and password-manager/native #996 branches are not
included and still require their own reviewed merges and acceptance.

## Exact-tree validation

Validation is recorded against the production-based tree, separately from the
original develop-based follow-up. Tests use synthetic accounts and credentials;
Node suites run in an isolated network namespace with only loopback enabled.

- Lopu UI: 255 passed.
- ChatGPT plan protocol/runtime/admission: 50 passed; one opt-in Mongo storage
  integration skipped.
- Application AI model-routing contract: passed.
- Changed-file lint: zero errors; one existing recovery-loop warning.

- TypeScript reports 92 existing diagnostics, exactly matching the fully
  provisioned develop comparison. The current main checkout reports those same
  92 plus 14 missing-dependency diagnostics; the promotion adds no diagnostics.
  This is a baseline comparison, not a clean TypeScript pass.
- Production client/server build and Vercel output verifier: passed.
- Isolated browser/HTTP acceptance: passed with zero errors at 1440px and 390px.
  Defaults survive reload, per-chat selection remains independent, endpoint/model
  and billing labels agree, popovers scroll fully, and separate Builder label
  and select edits save/reload with functioning controls. Synthetic writers
  enforce owner/data-plane and revision checks. Kernel isolation blocks browser
  redirects and backend direct-IP egress; Chromium sandbox is enabled. The local
  runtime lacks the Builder close symbol font; its accessible close control works.

Reproduce the unit checks from `remix` with `npm run test:lopu-ui`,
`npm run test:chatgpt-plan` and `npm run test:ai-model-routing`. The full build is
`npm run build`. The browser runner is
`node remix/scripts/run-lopu-credentials-browser.mjs` from the repository root,
using an installed isolated runtime image and Chromium seccomp profile. No
production environment or real credential is copied into this worktree.

Final local evidence is under `/workspace/artifacts/lopu-promotion-20261023/`;
final browser screenshots and report are under
`/workspace/artifacts/lopu-promotion-20261023-final/results/`.

Graphify validation uses structural indexing. No semantic proxy is available in
this environment, so changed documentation is not claimed as semantically indexed.

## Remaining acceptance

Public production was observed serving main `83a709cfa` while develop served
`f41cf6562`; the selector was present only in develop. Public capability version
numbers alone do not prove selector availability. The old #1070 preview now
shows a no-build placeholder and its capability endpoint returns 404.

No release has been merged or deployed by this preparation. Promotion requires
review of this exact branch, its checks, and release approval. Real saved-account
model discovery, an actual provider response, reload, explicit Thingtime-credit
routing and revoked-session behavior remain unobserved in the intended
authorized runtime. This branch does not establish native device or provider
setup acceptance for #992/#996.
