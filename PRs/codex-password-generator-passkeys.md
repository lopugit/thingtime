# Password generator, entry icons and passkey setup

## Scope

Branch `codex/password-generator-passkeys` starts at `origin/main`
`70c0df25d33c225c6a6339b3717fc55c69ad2003` in the isolated
`password-generator-passkeys/thingtime` worktree. The user explicitly requested
merging this Thingtime feature into main before creating the VM credential.

- Configurable WebCrypto password generator, editable source-linked platform
  presets, selected password-field target and masked draft insertion.
- Encrypted icon presentation metadata, encrypted image uploads, explicit
  anonymous HTTPS image/favicon loading, safe fallback and backup ID remapping.
- Editable passkey setup guide using the existing native bridge. Native ES256
  registration code already exists; this change does not create an arbitrary
  website passkey from the web editor or alter native packaging.
- New controls are composed from individually editable Settings/Builder blocks;
  generated credentials stay outside layout data and shared application state.

## Decisions

Default length is 20 characters. Platform guidance links to official sources;
Microsoft is explicitly a recommendation because consumer-account constraints
were not independently verified. A service's acceptance checks remain authoritative.
URL icons are opt-in, client-fetched without credentials/referrer/redirects and
require anonymous CORS; encrypted uploads remain available when a site blocks it.
`api.passwords` advances to 1.3.0 for optional icon metadata. Existing vault keys,
account/session boundaries, encryption purposes and retry identities are retained.

Integrated freshly fetched `origin/main` at
`79b46b081aaefa3dcb82c9f85a2926b9f0720436` inside the task worktree. Shared
Theme Studio/select contracts from main are retained alongside passwords 1.3.0.
The unrelated primary checkout was not modified.

## Evidence

- Password suite: 68/68 passing; targeted rendered-control regression also passes.
- Capability suite: 113/113 passing; stale exact version expectations updated.
- Isolated real source-handler HTTP verifier: 44/44 passing, including ownership,
  revisions, recovery, encryption and logout. This is separate from built routing.
- Canonical Nitro node-server build passes with scrubbed environment. Built HTTP
  discovery advertises password capability 1.3.0 in both manifests and registers
  password GET/POST operations. Honest unconfigured 503 remains JSON. OS network
  probes prove allowed loopback and denied hostname/direct-IP/redirect targets.
- Typecheck reports 92 diagnostics across 15 files. Those files are byte-identical
  to the starting base and none of the diagnostics name changed files. A base
  typecheck was not rerun; this is not a claim that global typecheck passes.
- Native installed provider signature/provisioning/entitlements verify and declare
  passkey support. A real target-site registration and sign-in remain separate
  unverified device acceptance.

## Rendered acceptance

The task-owned synthetic fixture mounts the actual PasswordManager in isolated
Chromium with its own sandbox, inside a dedicated no-network container. Desktop
1440 px and mobile 390 px acceptance passed: every preset, character exclusions,
password-field target selection, masked generation, synthetic save/read/remount,
icon selection/fallback/removal, and passkey-guide draft retention. Each of the
three new nested Builder control groups was individually edited, saved, remounted
and confirmed by exact document readback. Full-page scrolling found no overflow
or clipping; the final run reported zero errors. No production credentials entered
this fixture. These are synthetic rendered/data-adapter checks, separate from the
44 real source-handler HTTP vault checks above.

Initial rendered QA found duplicate sibling React keys because generator and
attachments shared the entry ID. Scoped key prefixes now preserve one generator
through draft updates, with a rendered regression.

Deployed live-vault acceptance and a real target-site native passkey registration
and sign-in remain pending. Native capability/signature inspection alone does not
establish that ceremony. Preview availability and current CI status are reported
on the PR independently of local acceptance.

Graphify uses the immutable snapshot workflow. The installed semantic extractor
cannot limit its 547 unstamped historical Markdown files to these changed
documents; the bounded structural refresh does not claim semantic indexing of
changed documentation. The available portable report, manifest and HTML remain
part of the refresh.
