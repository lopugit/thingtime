# Native paste defaultValue diagnostic

This diagnostic did not reproduce the earlier slowdown and does not establish a fix. No product code changed. The strict under-five-second requirement remains unchanged; earlier failed evidence remains valid.

Source: `84058ca5e097efc4150fdc3ebba773488d6aedeb`. The existing final application build was repackaged with temporary diagnostic controls. All four modes used the same Settings document, preceding editing history, actual clipboard, and exact 120,068 UTF-8 bytes / 12,002 lines.

| Control | Paste completion | beforeinput to input | Exact text / native undo / redo |
| --- | ---: | ---: | --- |
| Product textarea after editing history | 2,358 ms | 2,282 ms | Pass |
| Native DOM clone after editing history | 2,411 ms | 2,343 ms | Pass |
| Clone synchronizing defaultValue to value | 2,303 ms | 2,200 ms | Pass |
| Product clearing defaultValue after React bubbling | 2,286 ms | 2,211 ms | Pass |

The defaultValue/textContent lengths before paste were 119,094 for the normal product and synchronized clone, and zero for the clone and cleared product. The intended distinction was exercised, but it produced no meaningful timing separation. These results do not implicate React's defaultValue synchronization or justify changing the editor.

An initial preflight found that the original hard-line payload alone was 120,048 UTF-8 bytes. Appending the existing 20-byte edit suffix produced the required 120,068 bytes without changing line count. No timing was recorded before that correction.

See [measurements](paste-compare/paste-defaultvalue.json), [source provenance](paste-compare/source-provenance.json), [package](paste-compare/package.json), [container boundary](paste-compare/boundary.json), [egress checks](paste-compare/network-proof.json), [resources](paste-compare/resources.json), and [cleanup](paste-compare/cleanup.json). Chromium retained its sandbox inside the network-none, read-only container. No OOM occurred, and the owned runtime was released with none remaining.

This is a diagnostic comparison, separate from full Settings save, reconnect, conflict and cold-reload acceptance.
