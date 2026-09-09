# PR 709: Shared settings views and Mac panel preferences

Both settings entry points render `SettingsContent`; the page and popup only own their surrounding presentation and navigation. Popup-only desktop and per-menu-item controls moved into shared sections. Only the selected category mounts its panels. Profile is the default; category URLs and legacy Secure Vault/Lopu anchors select the same content. The popup query preserves the underlying page and supports reload, back, close, and opening the matching dedicated page.

`localNodeIsHealthy` is the shared presentation/dismissal policy. A user may dismiss a healthy Things-page node panel for this browser/account. Status polling continues while hidden and reveals stopped, mismatched, offline, unpaired, or permission-failed state. A pending first check preserves the dismissed first paint. Settings → Things always mounts the same panel, with a restore switch synchronized across mounted views and browser tabs.

Validation: 33 settings tests, 64 device tests, 95 Electron tests; typecheck ratchet remains at the pre-existing 108-error baseline; changed-file ESLint reports no errors. The production desktop web bundle and native helper verification pass. Browser QA includes popup/page navigation, 390px and desktop layouts, and a simulated node failure to exercise dismissal without changing system permissions.

Local validation uses the worktree PM2 server at http://localhost:13040 (HMR 13041, Nitro 13042). Tailscale Funnel is unavailable because its CLI points to a missing installed executable. There are no new API contracts, credentials, or setup variables.
