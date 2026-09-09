# PR #707 — Shared root inheritance and read-only app use

PR: https://github.com/lopugit/thingtime/pull/707
Branch: `codex/shared-root-inheritance`

## Intended behavior

Anyone with the link can view and use the shared app without editing its
original. Signed-in visitors can create an independent private copy in Builder.
The stored composition author's namespace resolves included components and
actions; a visitor's similarly named private component must not replace them.

Root audience authorization is checked again on every shared action and copy.
Same-author contained dependencies inherit that read audience only inside this
context. Foreign dependencies retain their own ACLs. Neither author nor visitor
account privileges are borrowed to run the app. Mutating saved data is refused;
computed results and local interaction state remain usable. Shared editors may
not add references to unrelated private author dependencies they cannot read.

## Evidence, 2026-09-09

- Local real-API regression covers keyed anonymous reads, wrong/revoked keys,
  custom groups and membership removal, foreign dependency exclusion, child
  actions, explicit private data reads, mutation refusal, editor-injection
  refusal, and independent private copies.
- Isolated Chrome at 1440px and 390px: Draw updates the app, original Edit is
  absent, signed-out Copy opens sign-in, and authenticated Copy opens the new
  page in Builder. Top/bottom scrolling and button bounds checked; mobile
  clipping repaired.
- Action tests: 69 passed. Webpage tests: 68 passed and opt-in fixture skipped.
  API capability tests: 22 passed; manifest assertions: 5 passed. Changed-file
  ESLint and whitespace checks passed.
- Whole-project TypeScript still reports pre-existing unrelated errors. No new
  errors were reported in the implementation files.
- Safari on preview commit `722c5f4bdbbc55d1ee348a652b83c689ed552525`,
  logged out: the actual Tarot page renders its complete card and Draw control.
  Clicking Draw changed Temperance to Judgement. Copy to my Builder is present
  and original Edit is absent. The original develop URL still uses old code.

## Media authorization follow-up, 2026-09-09

- Page/post attachment reads now use the canonical ACL evaluator with the
  supplied link key and current friend/group audience. Owner token fences,
  moderation, exact target shape and home-storage boundaries remain enforced.
- Shared renderers forward the key only to the exact relative attachment
  content endpoint, after negotiating `api.attachment-content` 1.1.1.
  External URLs and independently keyed links are not rewritten.
- Attachment suites: 6 worker/cache tests and 157 service/route tests passed.
  Webpage suite: 69 passed, 1 opt-in fixture skipped; capability suite: 22 passed.
  The separately enabled real-API/Chrome fixture passed at 1440px and 390px,
  including local image-key transport and external URL non-disclosure. Image
  bytes are stubbed in this browser test; it does not prove S3 storage or
  attachment copying. Changed-file lint and whitespace checks passed.
- Whole-project TypeScript still fails in unrelated existing files. On pushed
  commit `4d48b5bcb915565d83a44aecd576a47014bcb080`, CodeQL passed; Web CI
  failed the inherited notification schema projection test (`Field fields
  maxLength caps at 5000`, introduced by the notification-history base change).
  This is not a green-CI or rollout receipt for the media follow-up.

## Standalone content follow-up, 2026-09-09

- Copy now supports ordinary standalone post/data/schema content as well as
  page/component/action roots. It preserves extended content and copies an
  included private schema through the same root-audience context. Account,
  credential, subspace machinery, app-storage, relationship and organizational
  folder lifecycles are not cloned through the generic content endpoint.
- `api.things-fork` is 1.1.0 on both manifests; the copy button requires this
  version before the write. Eligibility stays a small browser-safe predicate,
  checked against the canonical registry in tests.
- Real API assertions prove extended content, independent schema identity,
  private default, wrong-key refusal, editable copy and unchanged original.
  The enabled Chrome fixture passed at 1440px/390px, including signed-in copy
  into Builder and the ordinary Thing copy control/sign-in boundary. Fixture
  image bytes remain stubbed. The observer now registers cleanup from successful
  copy responses and waits for the control before its response timer. Earlier
  observation failures left four test copies; exact identities/references were
  verified and removed through the local API.
- Whole-project TypeScript reported 108 existing errors and none in sharing
  implementation files. Capability tests: 23 passed.
- Deployed `a056202d97837febbd65152b1810a6881658ca48` passed build/unit, API
  suite and CodeQL. Real logged-out Safari displayed that exact SHA and Draw
  changed The Emperor to Death. This receipt predates the standalone follow-up.

## Data template inheritance follow-up, 2026-09-09

- Shared Data Things now read included schema templates through the freshly
  authorized root, rather than an independent schema request. Only stored
  composition dependencies qualify; arbitrary ids, missing ids/list mode and
  app-token namespace escapes fail closed. Actual viewer/PAT fences remain
  intact. Contextual responses are private/no-store with no-referrer.
- The Things API advertises feature 1.6.0 / contract 1.5.0 on its two manifests;
  the renderer negotiates the feature before fetching. Shared templates are
  scoped to the root, key and viewer in memory, never persisted under a
  schema-only cache key. Owner-only optimistic cached rendering is retained.
- Route boundary tests: 3 passed. Capability tests: 24 passed. Real API and
  Chrome desktop/mobile regression passed for private template rendering,
  unrelated-id refusal, key retirement and group removal. The first browser
  run caught the client GET helper dropping `sharedRoot`; forwarding that
  field restored the intended template. Screenshots and top/bottom checks
  verify the template and Copy control at 1440px/390px. Changed-file lint passed.
- A clean full browser rerun passed in 61 seconds. Whole-project TypeScript
  still reports 108 existing errors, including the duplicate `headers` type
  declarations in the API docs; no new shared-read implementation errors.
- Previous pushed head `f8e8ec134b14a192f124e98da4bba176c92fdf95` passed build,
  unit, API and CodeQL checks. That receipt predates this follow-up.

## Nested media follow-up, 2026-09-09

- Attachment content accepts a root context for literal first-party URLs in
  included component/schema render positions and native media blocks. Only
  same-author stored references inherit; unrelated/foreign private media gets
  no new authority. Independently public profile media and comment chains keep
  their normal access. Drafts, moderation, home storage and exact S3 object
  versions remain guarded by the attachment service.
- Shared writers must independently read newly inserted private media refs,
  including schema templates. Attachment content advertises 1.2.0; Things
  advertises feature 1.6.1 / contract 1.5.1. Renderers negotiate before adding
  context, never rewrite external or independently keyed URLs, and explicit
  audio downloads preserve the context. Saved audio records do not store URLs.
- Service/route tests exercise per-read root checks, invalid input, revocation,
  foreign access, readiness and moderation. The real cache worker retains root
  context on validation. Real-API/Chrome regression passed at 1440px/390px with
  root/key URL transport and shared-writer injection refusal. Image bytes are
  still stubbed in that browser fixture; this is not physical-media-copy proof.
- Prior pushed `52b67ebff0` passed build/unit, API and CodeQL checks. These
  receipts predate this follow-up; independent S3 copying remains outstanding.
- Attachment checks: 6 cache-worker tests and 160 service/route/UI-core tests
  passed. Webpage tests: 73 passed plus the opt-in fixture; capability tests:
  24 passed, with 5 explicit manifest assertions also passing. Changed-file
  ESLint passed. TypeScript caught a test fixture missing the Thing envelope;
  the fixture now derives its envelope from the root document. Rechecking
  TypeScript returned the existing 108 errors and no related implementation or
  fixture errors.

## Remaining verification

The latest merged-head and develop/main rollout verification,
broader general-Thing/media inheritance and copy coverage, and the final
security/completeness audit remain. Dynamic dependency identifiers are not
treated as grants. Shared saved-data mutation workflows require an independent
copy. This note records an implementation milestone, not completion of the
entire sharing goal.
