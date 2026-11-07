# Protected History and Theme Studio final review

The new Home local view in Theme Studio caused public shared-theme reads to fail when a custom content plane was selected: the generic remote guard compared the local Home destination against the selected account authority and refused before making the read.

`shared-theme-before.log` reproduces this regression before the correction. Shared-theme and gallery reads now use a dedicated selected-account remote lease. The actual fetch receives the selected actor, plane and origin plus an abort signal; the result is checked against the lease before disclosure. Generic Home remote operations remain refused, and retained Home themes still read offline.

`focused-tests.log` records 39/39 passing tests, zero skips, covering the new regression, lost remote confirmation, retired in-flight reads and local callbacks, Home History under a selected custom plane, reconnect reads, theme/algorithm restore, undo/merge, concurrent retries, stale previews, rollback and generic protected-write refusal. `lint.log` records zero errors and the pre-existing useApi getJson hook-dependency warning.

This is focused automated evidence. The shared-theme correction follows the prior integrated native snapshot and requires the final rebuilt-package acceptance recorded by the task coordinator. No additional actionable issue was found in the reviewed protected planner, phone History scroller or isolation harness.
