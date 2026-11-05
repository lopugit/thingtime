# Native offline vault file acceptance — 27 October 2026

The normal no-login Passwords UI created a device vault and a small synthetic note, uploaded a 66 MiB file, cold-reloaded offline, unlocked the vault, and downloaded the saved attachment. Every downloaded byte matched the source SHA-256: `153dbfbf1a1f76e9fa494a6d7ea3ec99a561ac9a6e69d74886d164310391191f` (69,206,016 bytes). Exact note readback passed; no page errors or OOM occurred. No account session or remote persistence was used.

This corrected the earlier test's ambiguous Close locator by scoping it to the Edit entry heading. The product was unchanged. The fixture streamed the source file in 1 MiB chunks and hashed the downloaded file as a stream. One test passed in 14.84 seconds. Both browser and backend used the enforced network-none container boundary, 4 GiB and one CPU. The separate egress-proof browser enabled Chromium's sandbox, but this historical vault fixture omitted Playwright's explicit `chromiumSandbox: true`; it does not establish that the actual vault browser had Chromium's sandbox enabled. The corrected follow-up explicitly enables and checks it. The cleanup receipt confirms no owned runtime remained.

The actual UI was scrolled and captured at 1440×1000, 390×844 and 320×844 CSS pixels. Horizontal overflow assertions passed. These are full-page screenshots; floating assistant controls are visible over the editor at phone sizes, so this evidence does not claim every control is unobscured. The source package is from `9f24113dd`; later suite source edits were not built into this trial.

This closes the file-only cold-reload/download check. It does **not** close the large-note OOM, combined large-note/file case, physical quota exhaustion, provider/identity/race matrix, full vault archive export/import, or installed native AutoFill/passkey acceptance. The preceding diagnostic remains in `../anonymous-local-first-2026-10-27-vault-memory/`.

A read-only host check showed the entire test VM had 4,095,636,456 bytes RAM and no swap. That observation was made after the earlier failures, not at the OOM, and establishes a possible outer capacity constraint rather than a proven cause. No VM limits, shared service, proxy, key or security settings were changed.

See `provenance.json` for executed helper/package hashes; `small-note-file/` contains the screenshots, exact download verification, raw memory samples, boundary, network and cleanup receipts.
