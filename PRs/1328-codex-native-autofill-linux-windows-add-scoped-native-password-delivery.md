# PR #1328 — Scoped native password delivery on Linux and Windows

Branch: `codex/native-autofill-linux-windows`.
PR: https://github.com/lopugit/thingtime/pull/1328

## Delivered behavior

Linux and Windows dispatch to a private desktop broker instead of reporting the
macOS-only helper unavailable. A shipped CLI negotiates `native.passwords` 1.0.0,
requests a bounded account/origin/task/target grant, generates a vault-saved
password with encrypted retry state, and requests direct delivery without raw
credential output. Chromium profiles are task owned, isolated and sandboxed.
The editable per-entry approval UI returns verification proof to an exact native
window/frame; the existing protected `fill` API authorizes the website delivery.

The Linux GNOME consumer verifies the existing daemon over D-Bus and Unix peer
credentials and uses its upstream PAM control operation. It cannot initialize,
replace or change a keyring. Windows uses actual private DACL checks and DPAPI.
`api.passwords` 1.7.0 adds exact canonical catalog origins to avoid decrypted
credential reads during discovery. The macOS Apple provider is unchanged.

[Contract, prerequisites and installation](../docs/native-password-agent.md).

## Decisions and boundaries

- Keep first OS-keyring setup and Thingtime sign-in separate from broker access;
  no session/profile handoff is invented.
- Use existing saved verification policy and editable UI. Broad task consent is
  not credential confirmation. Native approval accepts one response; the API
  retains its existing bounded same-ceremony retry semantics and lock revocation.
- HTTPS top-level documents and unique visible fields are the supported browser
  target. No automatic submit, arbitrary OS typing, private-key export, Windows
  local-app consumer or system-wide autofill is advertised.
- Browser code runs normal networking with the Chromium sandbox. Generated
  credentials stay in the vault, OS-encrypted pending journal or transient
  direct-delivery memory; output is metadata only.
- Portable platform builds exclude Apple helpers. Windows directory artifacts
  are unsigned; installer signing/distribution is a separate release boundary.

## Verification evidence

- Full Electron suite: 423 passed, 4 platform skips (initial implementation).
  Includes existing macOS provider behavior and service shutdown ordering.
- Password suite after main integration: 153 passed, 1 skip. Capability suite:
  130 passed. TypeScript and its zero-error ratchet passed. Full Remix lint:
  0 errors, 402 existing warnings; this does not claim zero warnings.
- Desktop web build and resource verification passed. Built Nitro smoke returned
  the origin-scoped `api.passwords` 1.7.0 manifest and active password route.
- Debian 13 ARM64: actual Electron 43.1.0, libsecret encrypted journal, private
  Unix socket/CLI, sandboxed approval window/preload IPC, Chromium direct fill,
  changed-document/cross-origin-action refusal and release cleanup passed in a
  separate D-Bus/HOME/profile. This is fixture runtime evidence, not an installed
  personal-account ceremony.
- GNOME locked-keyring test: same PID/owner unlocked; wrong password and revoked
  grant left it locked; a same-user wrong-PID peer received zero bytes.
- Ubuntu 24.04 ARM64: installed Snap Chromium passed direct synthetic delivery,
  changed-document and cross-origin-action refusal, sandbox flags and task
  profile cleanup in its normal desktop user session. Snap's systemd dependency
  prevents using the private D-Bus fixture for that browser; it does not require
  a personal browser profile or account. Hosted Ubuntu 24.04 x64 also passed the
  full Electron/keyring/browser fixture.
- Native Windows x64 packaging and the packaged CLI-discovery smoke passed. The
  portable build loads one standalone configuration: Electron Builder otherwise
  merges resource arrays twice and races copying DLLs. A regression test checks
  the actual resolved resources and exclusion of Apple helpers. This is not a
  Windows ARM64 build or personal-account GUI acceptance claim.
- Actual editable React approval with a disposable real vault/API checks desktop,
  narrow and error layouts, current-password verification, exact proof binding
  and protected fill. Electron IPC is an explicit fixture adapter in that test;
  the real Electron window/IPC is exercised separately by the runtime suite.
- Native Linux/Windows CI and Windows unsigned package artifacts are attached to
  the PR workflow. Final results are recorded in the PR checks, not inferred
  from static code or cross compilation.
- Graphify's semantic refresh returned partial results after hollow backend
  responses. The available structural/semantic map and portable outputs are
  retained; this does not claim every changed document was semantically indexed.

Installed real-account login and final VM rollout are separate acceptance work.
Neither synthetic tests nor package success proves external service sign-in or a
passkey ceremony. Keep the parent rollout task open until those checks finish.
