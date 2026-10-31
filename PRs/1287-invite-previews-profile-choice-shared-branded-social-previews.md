# PR 1287 — Shared branded social previews and recipient profile choice

Branch: `codex/invite-previews-profile-choice`
PR: https://github.com/lopugit/thingtime/pull/1287
Preview: https://pr-1287.previews.dev.thingtime.com/invite

## Problem and resulting behavior

`/invite` had no route-specific preview entry, so it inherited the homepage
metadata. Invite creation also required the sender to choose a recipient name
and username. Invitations now have a dedicated anonymous card; profile fields
are optional suggestions and recipients choose valid final values at signup.
Invite tokens remain in fragments and never enter preview resolution.

The public photo example contained four canonical JPEG attachments around
4–8 MB each. The old card loader skipped every original over 2 MiB, producing
coloured placeholders despite public access. The new loader uses canonical
bounded thumbnails and embeds the image bytes in the final PNG, with current
anonymous authorization and stored-version checks before inclusion.

The existing anonymous resolver now also supplies a documented JSON API at
`GET /api/v1/social-previews`. It reads saved public content and safe static
route descriptions, rejects other origins, strips queries/fragments and never
uses the requester's private access or custom database selection. HTML metadata,
JSON metadata and PNG cards remain parts of one shared resolution pipeline.

The cards use the canonical logo matrices/exporter, theme colours and licensed
brand fonts. A renderer revision changes dynamic image URLs after branding
updates independently of each post's content revision.

## Validation and delivery

The initial invitation commit is `650316939da9c88951295b9534cfd784339fe93a`.
Its 191 focused tests, production build, isolated real signup/readback and
desktop/mobile UI acceptance passed. Follow-up metadata, branding and photo
validation passed after integrating `develop` at `ba5e7a358`:

- Social previews: 54/54 tests; API capabilities: 121/121; invites: 27/27.
- Full lint: zero errors, 389 warnings; raw TypeScript: zero diagnostics;
  typecheck ratchet: zero errors against baseline zero.
- Canonical production build and Vercel output verification passed.
- Disposable replica/local object-store acceptance used real registration,
  admin upload approval, multipart upload and public Things API publication.
  A 3,525,095-byte source image produced 48,118 distinctive photo pixels in the
  final anonymous card. Blocking the attachment made its cached thumbnail
  return 404 and removed those photo pixels from subsequent cards; unblocking
  restored the image. No production data was changed.
- The built manifest advertised `api.social-previews` 1.0.0. The JSON resolver
  and public PNG were exercised over HTTP on the built handler.
- Browser inspection compared the generated PNG to the actual public source
  post at desktop and 390px mobile sizes; invitation branding and the source
  page from top to footer were also inspected. This follow-up used the in-app
  browser; the earlier invite form acceptance used Chrome.
- Independent read-only production evidence confirmed the supplied example's
  8,222,083-byte public JPEG already has a usable canonical 640px WebP variant
  of 183,866 bytes. That supports the original-size skip as the cause.

Non-secret local acceptance artifacts are in
`/tmp/tt-social-card-acceptance-20261029/` (`result.json`, `metadata.json`,
`public-card.png`, `blocked-card.png`). Raw checks are in
`/tmp/invite-final-*.log` and `/tmp/tt-invite-final-build.log`.

Graphify receives a structural refresh and portable report/HTML. Semantic
refresh is not claimed: the installed CLI does not implement `extract`, and
its separate default community labeller failed with an expired Claude session.
The new/changed documentation remains directly reviewable in this PR.

At the initial delivery, the preview served the invitation HTML but its PNG
returned HTTP 409 `ENVIRONMENT_GATEWAY_CAPABILITY`: the branch required a newer
social-card feature than the selected shared gateway. This was a rollout gap,
not successful deployed image acceptance. Production merge and a newly composed
messenger preview remain separate release checks. No primary-branch merge is
authorized by this task.


## Automatic defaults and optional page metadata — 2026-10-29

The actual application router now generates preview defaults for 97 declared
routes. Adding an ordinary route requires no second backend metadata entry. A
route module may optionally export literal public `socialPreview` copy; the
extractor never executes modules or scrapes private/runtime JSX content. Client
document-title defaults and the anonymous resolver share this generated data.
Unknown/wildcard paths retain the generic brand fallback, and route parameters,
queries and fragments never become default preview copy.

Public saved `/p/:id` and `/t/:id` pages infer their heading, prose and managed
photos from the authorized stored blocks and Component presentation. Existing
`name`/`description` override inference; placeholder names do not. Component
default/saved/instance arguments, literal text edits and known conditions use
canonical template semantics. Hidden content, unknown runtime bindings, Actions,
source queries, form values and unrelated private references are omitted.
Component copy edits contribute to the card revision without needing a parent
page edit. API compatibility manifests remain: metadata is 1.1.0 and cards 1.3.0.

Final automatic-preview source checks: 71 social-preview/generator tests and
121 capability tests passed; full lint reported 0 errors/389 warnings, raw
TypeScript and the zero-baseline ratchet passed, and the canonical production
build including Vercel output verification passed. Logs are retained at
`/tmp/tt-auto-final-{focused,lint,types,build}.log`.

Real API acceptance used a fresh task-only replica and local object store. A
new public page referenced a nested saved Component with no meaningful title or
description. Anonymous JSON and raw HTML inferred its actual heading/body,
and its 1200x630 PNG contained 48,118 distinctive pixels from the real 3.5 MB
upload. A guarded name/description PATCH overrode both metadata surfaces. A
separate private page exposed no content, and `/support` produced automatic
metadata and a branded PNG without a route override. Artifacts:
`/tmp/tt-auto-page-preview-acceptance-20261029/`.

Browser inspection matched source text to the generated card at desktop and
390px mobile widths and checked the page footer. It also exposed a shared-root
media compatibility bug: canonical new Builder Things carry `builder-thing`,
which the fork/composition predicate rejected. The public card could load the
photo but the page's media URL could not. The shared predicate now ignores only that passive marker alongside an otherwise
supported content kind; marker-only, unknown/control kinds, relationships and
inaccessible roots remain refused. The five affected API features and dependent
client minimums carry explicit compatible patch versions.

After the repair, six fork/copy regressions and 122 capability tests passed;
changed-file lint had zero errors, raw TypeScript passed, and a second canonical
build/Vercel output verification passed. The same fixture's page and Component
shared-root URLs returned the original 1300x1200 PNG and a 640px thumbnail.
Private page and unsupported attachment roots still returned 404. Both manifests
advertised the patched contracts. The card retained all 48,118 measured photo
pixels, and the exact JSON/HTML overrides still matched. Evidence and build log:
`result.json` in the acceptance directory and
`/tmp/tt-auto-shared-root-build.log`.

The final source photo was inspected in the actual browser at desktop and
390px mobile widths (natural dimensions 1300x1200; mobile rendered width 375px),
with top-to-footer scrolling and no horizontal overflow. The generated page and
Support cards were also inspected at desktop/mobile sizes. This follow-up used
the in-app browser. No Builder interface was added or replaced; saved content
remains ordinary editable blocks and Components. Task tabs were closed and the
temporary viewport override cleared.
