# Password UI merge acceptance — 11 November 2026

The final run passed nine cases in one task-owned Chromium process with separate
synthetic contexts: account-transport editor, actual anonymous device vault and
actual account-scoped device vault at 1440, 390 and 320 pixels. The browser,
contexts, private profile and loopback server closed on completion. No personal
browser, real account data or production service was used.

The canonical account fixture exercises typed nested edits, invalid-number save
refusal, field ordering, independently editable nested Builder labels, layout
save/reload, source/attachment relationships, masking, stale binding refusal and
identity changes. Account CRUD is route-backed synthetic transport. Layout
persistence uses the selected local-first adapter where active. Its test entry
now resolves the actual built Web Platform document through the canonical plugin;
the root fixture establishes the real workspace binding. The permanent runner
now includes 320px coverage.

The local variants use real IndexedDB, LocalPasswordVault, WebCrypto and
PasswordStorage. They seed through vault/reconciliation APIs, edit nested data,
compare the saved value through a separate direct vault read, download exact
stored file bytes, lock/unlock, cold reload and retire identity. Account-local
cases verify the not-yet-listed status and a retained file catalogue whose bytes
are unavailable: its Download control is disabled. These component fixtures do
not establish production authentication, full app routing, cross-device sync or
physical/native acceptance.

A 320px run found the incoming native icon file chooser expanding its grid.
The scoped repair constrains default picker sizing and migrates only legacy
inputs missing min-width, merging defaults before authored CSS. Explicit custom
width, max-width, min-width and box-sizing survive. Seven icon tests and targeted
lint pass. Final screenshots and scroll/bounds checks pass after the repair.
Earlier `*-failure*` files remain historical: initial fixture setup failures and
the pre-fix narrow overflow are superseded by separate successful receipts.

Known limitations remain explicit: device icon upload/receipt mapping is not
implemented, so a valid saved icon reference uses a safe local fallback; this
run does not claim an actual device custom-icon rendering success. Core device
CRUD/files make no account transport calls, but inherited global verification
preferences still make account API reads in these fixtures. Do not confuse this
with the separate no-login draft renderer's verified zero API traffic.

`verification.json` records source hashes, case receipts and scope. The final
local fixture/orchestration source remains in the task-owned build cache; the
canonical account browser fixture and its repaired runner are repository source.
