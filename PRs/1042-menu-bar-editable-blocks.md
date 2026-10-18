# PR 1042 — Editable menu bar blocks

The previous menu page was one HTML-template Component. This change exposes each visible element and repeated-card field as a normal editable block. It adds element, collection and condition primitives, safe typed property bindings, source bindings on subtrees, and a conversion control for supported existing templates. Unsupported template operators fail explicitly rather than silently losing behavior.

Pagination adds Show all and keeps authored defaults changeable by the viewer. Menu telemetry adds optional 64px PNG thumbnails: a matched status window when already permitted, otherwise an explicitly labelled application icon. No display or unrelated application window is captured. Locked snapshots remain empty.

Contracts: api.things 1.35.0; api.things-update 1.6.0; api.webpages-resolve and api.webpages-suites-install 1.6.0; api.devices 1.12.0; api.devices-node-state 1.13.0.

Verification: 156 webpage tests pass with four existing skips; 100 capability tests, 89 device tests, 24 focused composition tests and five menu telemetry Swift tests pass. Synthetic desktop/mobile checks passed under the OS network boundary: 47 icons and Show all by default, searching the last row, zero versus unavailable values, seven data states, full-page scrolling, and individual title/button/icon/card-field edits saved through the real validator and retained after reload. Full typecheck reports 92 unrelated baseline diagnostics and no changed-file diagnostics. Installed app and deployed saved-page acceptance remain open until the coordinated signed bundle and production contract are available.

Integration: the ChatGPT runtime/settings workstream consumes the shared block primitives. Coordinate one signed app install; do not merge its assembly PR.
