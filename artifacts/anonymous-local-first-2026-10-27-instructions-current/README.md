# Current-build instruction acceptance

The complete existing Settings acceptance passed once on source `84058ca5e097efc4150fdc3ebba773488d6aedeb`: **2 tests, zero failures or skips**. The sanitized application package is `9a5619443544a01446e9add380217453b735cfa676a597782040a3c9e1ea6628`; see [source provenance](source-provenance.json) and [run log](run.log).

- Actual native clipboard paste completed in **2,459 ms**, below the unchanged 5,000 ms gate. All 12,002 hard lines remained exact, including native undo/redo and subsequent typing. The final edit was 120,068 UTF-8 bytes.
- Local save completed in **138 ms**. Offline cold reload and the independent resumable account readback retained exact Unicode, line breaks and disabled rows.
- The real isolated API exercised lost replies, newer local saves, both explicit conflict choices, legacy protocol refusal, anonymous private-data refusal and bounded request bodies.
- Checks covered 1440×1000, 390×844 and 320×844 layouts and all nine guidance hit points. No page errors or offline writes were observed.
- Browser and backend ran inside a network-none, read-only fixture with Chromium's sandbox enabled. Resource records show no OOM; cleanup confirms no owned runtime remained.

See [verification](instructions/verification.json), [paste measurements](instructions/capacity-paste-result.json), [network checks](instructions/network-proof.json), [resources](instructions/resources.json), and [cleanup](instructions/cleanup.json). The test source hash is recorded in the provenance file.

This is a passing current-build run, **not a performance fix**. Earlier native paste runs exceeded five seconds, and the cause remains intermittent and unexplained. The separate [defaultValue diagnostic](../anonymous-local-first-2026-10-27-paste-defaultvalue/README.md) did not reproduce the slowdown. No editor change or relaxed threshold is included. Installed macOS acceptance, real inference and deployed account transport remain separate.
