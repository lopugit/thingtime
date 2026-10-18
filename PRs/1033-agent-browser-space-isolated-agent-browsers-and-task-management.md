# PR #1033 — Isolated agent browsers and editable task management

## Behavior

Development acceptance receives a task-owned browser, private profile, temporary
Mongo replica set and explicit local authentication. The default container has
no external network interface or route, so browser and backend cannot fall back
to production. Restricted mode enforces literal IPv4/IPv6/CIDR/protocol/port
rules in the task network namespace, including redirects and Docker DNS;
unrestricted access is a deliberate choice. Each claim freezes its policy.

The Mac app fetches official Chrome for Testing and Chromium builds, preserves
publisher signatures/provenance, and installs independently claimable copies.
Native copies require unrestricted mode. The pinned Chromium runtime bundles
the actual packaged Thingtime server/client with isolated mutable data.

Tasks, todos and progress are editable Data Things composed with ordinary
Schemas, Components, Actions and Pages. The native adapter owns browser
installation, exclusive claims and the live viewer. Task identity includes the
selected API origin, database identity, owner and task ID. Device defaults live
under Settings → Things → Agent browsers; tasks can opt into custom security.

See [the runbook](../docs/agent-browsers.md) for setup, the shipped CLI, credential
rules and cleanup. The canonical global instructions now require isolated test
browsers and the Thingtime password manager on the executing device. Passkeys
use supported sign-in/user-presence flows; private keys are never exported.

## Verification on 18 October 2026

- Two independent agents ran concurrent full-app containers. Each created a
  temporary identity, installed the editable suite, wrote task/todo/progress
  records and read them back. Foreign record IDs returned 404; authentication,
  mutable data and browser storage stayed separate. Cross-claim access refused.
- Direct public IPv4/IPv6 and redirect probes failed at the enforced boundary.
  Container inspection confirmed no published ports or host mounts, non-root
  execution, dropped capabilities and independent temporary data. Restricted
  port rules and Docker DNS denial were tested separately.
- Desktop/mobile task board and detail acceptance exercised creation, progress,
  todo completion and reload. Completion with a nonempty adjacent add-todo form
  now changes only the selected todo. The shared app shell remains centered with
  mobile gutters and no horizontal overflow.
- The unsigned parallel Mac app used a private stdio relay to the real container
  backend. UI checks covered publisher catalog fetch, Chrome installation,
  runtime duplication, claim/launch, live navigation, image clicks, typing,
  scrolling and 375px/1280px viewport changes. Policy readback showed a saved
  unrestricted task while its existing claim/session remained isolated.
- Restricted device defaults persisted through reload. Task overrides persisted
  through the normal API with owner/update CAS. Acceptance restored isolated
  defaults and released all owned claims/sessions and the native test copy.
- 124 Electron tests, 108 focused backend/capability/suite tests and 40 Settings
  tests pass. Lint passes. Full TypeScript checking reports 91 existing errors
  outside changed files; it is not a clean typecheck.
- Independent source review found no additional actionable issues after fixes
  for cleanup failure handling, selected API origin scoping and ownership.

Final signed-app, settings-link and deployment results are recorded on
[PR #1033](https://github.com/lopugit/thingtime/pull/1033). The local app assembly
also preserves the password-provider and menu-bar branches already installed on
the device; those features are outside this PR’s changes to main. Build success
alone does not establish installed-app acceptance.

The graph refresh retained portable outputs and structural indexing. Some
semantic extraction chunks returned empty responses after three attempts, so
Markdown and other non-code semantic coverage is partial, not fully refreshed.

## Acceptance fixes

- Removed accidental form-field collection from adjacent todo controls.
- Centered the shared app shell using supported kebab-case CSS properties.
- Recognized both capitalizations of Docker's explicit missing-object errors,
  while keeping daemon errors fatal and cleanup retryable.
- Scoped claims to the selected API endpoint, rather than the fixed bundled
  renderer origin.
- Routed the general-security link to the existing Things category and its
  auto-opening Agent browsers disclosure, rather than an unknown desktop tab.

## Boundaries

The container isolates browser/backend execution, not an agent's other host
shell tools. A local device-user socket limits the exposed operations and uses
private claim handles; it does not separate mutually hostile processes sharing
the same host user. Restricted and unrestricted sessions may reach production.
No timeout or authentication recovery widens a policy automatically.

Native browser copies keep official publisher provenance, including publisher
ad-hoc signatures where supplied. They are never re-signed by Thingtime.
The dedicated Colima VM remains available after task cleanup; unrelated Docker
profiles, containers, personal Chrome windows and credentials are untouched.
