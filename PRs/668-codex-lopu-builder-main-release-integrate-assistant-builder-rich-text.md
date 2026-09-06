# PR #668 — Lopu assistant, Builder and rich-text main release

[Pull request](https://github.com/lopugit/thingtime/pull/668)

User-selected integration into main, not an entire develop promotion. Source
heads: component catalog #291 `6c9a243e`, Builder suites #578 `e87f9ff3`, live
details #612 `b169d31e`, Lopu assistant #592 `2233103d`, rich text #635
`ddf4658a`. Watch release #667 is included in the ancestry.

## Integration decisions

- Retain the existing 4,000-value and 256 KiB component output budgets across
  Builder loops, scope paths and action data. Clone nested literal data without
  interpreting template-shaped objects; reject cycles and oversized output.
- Preserve detail-section visibility controls with the live webpage provider.
- Preserve all account/logout cache cleanup and signed-out Watch rendering.
- Embed both native Watch and Lopu widget targets. Exclude iOS ActivityKit
  shared attributes from the Watch target; XcodeGen remains canonical.
- Keep the Lopu textarea border box within its composer at mobile widths.
- Propagate disabled automatic restarts through the actual PM2 CLI start path.

## Verification

Full combined unit run: 1,934 passed before final focused corrections. Follow-up
editor/kind tests: 87; Lopu UI: 91; notifications: 31. Component expansion and
detail tests passed. Targeted lint has no errors; TypeScript retains the existing
108-error ratchet baseline. Combined iPhone/Watch/widget and XCTest products
build successfully; XCTest products compiled but were not executed on a newly
booted phone simulator.

Isolated Chrome at 1280px and 390px exercised Builder filtering and nested
preview, signed-out pairing, actual whole-code clipboard paste preserving a
leading zero, Lopu unsent drafts and settings popovers. Screens were scrolled
top to bottom and checked for horizontal overflow. Composer clipping found by
visual inspection was fixed and measured within the parent card. No chat
provider request or real Watch approval was sent by these checks.

Latest rich-text source receipt records desktop, 390px and 320px history overlay,
selection and nested dialog checks; integrated editor tests pass. Physical iOS
native editing-menu behavior remains device acceptance.

Local development: http://localhost:17890, HMR 17891, Nitro 17892. The one
worktree PM2 entry has autorestart disabled. Tailscale/Funnel is unavailable:
the installed shim references a missing Tailscale.app binary. No mapping changed.

Hosted exact-SHA checks and preview readiness are reported on the PR. Main merge
must retain all required checks; no bypass is authorized or used. Recording
automation remains a separate #665 release with provider acceptance and APNs
integration still pending.
