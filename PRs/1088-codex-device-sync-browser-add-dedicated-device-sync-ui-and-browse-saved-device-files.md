# Device sync UI and saved device folders

Devices in Things open their saved cloud folders on double-click, keyboard activation or touch. Single desktop clicks select; the context menu keeps quick settings and the dedicated device page accessible. Saved roots are derived only from valid private file-sync configurations belonging to the active account and selected device. Folder descendants use the existing Things browser and its ACL checks. Connection state never claims that every payload is backed up.

The shared drawer/page detail tree includes a lazy File sync & backup section. Fresh section defaults are collapsed; explicit saved preferences remain respected. Live device filesystem browsing is labeled separately. Native sync management is limited to the selected owned, paired device and mounts only when opened. Opening saved files starts no transfer.

The overview uses editable intrinsic Builder blocks and an editable collection template. UI/UX Pro Max informed neutral semantic surfaces, readable hierarchy, 44px actions, keyboard/touch access, progressive disclosure and reduced motion. An isolated browser check found the existing expand control overlapping Close because a Chakra spacing token fell back to pixels. Explicit positions and reserved header space fix it; both drawer actions remain separate.

## Verification

- Seven focused unit tests pass: owner/device/private filtering, duplicate roots, encoded navigation, valid individually editable block fields and collapsed preference defaults.
- OS-isolated Chromium passes desktop 1440x1000, mobile 375x812, touch entry and reduced-motion landscape. It exercises double-click/keyboard navigation, saved cloud-root links, both settings views, all collapsed defaults, Refresh folders, drawer Close, scrolling/overflow, and no transfer capture.
- Actual Builder interactions independently change the heading and repeated folder-link template, save through the normal private webpage adapter, reload, and retain live bindings. These checks use synthetic data; they do not establish production acceptance.
- Focused lint passes. The repository typecheck ratchet passes with 92 existing diagnostics against a baseline of 89; the three ratchet additions are unrelated legacy test files. No diagnostics appear in this change's sources.
- The prior home source stays removed and sync stays paused. Android and the earlier throughput investigation remain deferred.

CI initially caught an eager account hook requiring a data router when the standalone device page had no selected device. Account ownership is now passed from the existing Things page boundary, keeping the closed device view independent of account/router hooks. The standalone renderer regression includes an explicit owner input. The full device suite passes after the correction.

## Delivery and remaining acceptance

PR: https://github.com/lopugit/thingtime/pull/1088
Branch: `codex/device-sync-browser`.
Live production/device-data acceptance is pending deployment. No local dev service or public Funnel was started for this change; isolated fixture runs own and release loopback port 28213. There is no new API endpoint or capability contract.

Graph outputs are structurally refreshed without LLM extraction and include portable HTML. Existing semantic nodes are retained; changed Markdown is not semantically re-indexed. The 22 pre-existing dirty graph entries are preserved and excluded from the owned commit.
