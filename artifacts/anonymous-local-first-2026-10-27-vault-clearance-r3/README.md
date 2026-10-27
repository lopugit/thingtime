# Native vault mobile clearance acceptance — 27 October 2026

The normal no-login password editor passed this focused test against the
sanitized local application package identified in `source.json`. This is local
native-browser evidence; it is not CI, deployed or installed-device acceptance.

- Normal upload of 69,206,016 bytes (66 MiB), cold offline reload/unlock and
  download returned the exact bytes, independently verified by SHA-256
  `153dbfbf1a1f76e9fa494a6d7ea3ec99a561ac9a6e69d74886d164310391191f`.
- The actual application browser ran with Chromium sandboxing enabled and no
  `--no-sandbox` argument. The manager retained a task-owned `network:none`,
  read-only container, no mounts or published ports, and its 4 GiB / one-CPU
  limits. Browser and backend direct-IP, IPv6, hostname and redirect egress
  refusals were verified separately.
- Password reveal/hide and keyboard focus passed. At 390px and 320px, measured
  scroll checkpoints confirm the floating Lopu shortcut hides while its bounds
  intersect the marked editor and returns when clear. The navbar entry remains
  available. DevKit is absent on the password route at all tested widths.
- Full-page screenshots and top-to-bottom checks cover 1440, 390 and 320 CSS
  pixels. Visual inspection found no editor/control overlap. Desktop retains
  the floating shortcut outside the editor.
- The run reported no OOM events or page errors. Cleanup left no task runtime.

See `small-note-file/result.json`, `download-verification.json`,
`actual-browser-sandbox.json`, `layout-observations.json`, `network-proof.json`,
`resources.json`, `cleanup.json` and the three PNGs in `small-note-file/`.

Earlier clearance attempts are retained: the first stopped before UI assertions
because command-line inspection required `--enable-automation`; the second
verified the exact file download but used the wrong accessible reveal-button
name. This run uses `Show Password` / `Hide Password` and passes those controls.

This fixture uses a small synthetic note. Large-note OOM diagnosis, actual
browser quota exhaustion, provider behavior and the full vault matrix remain
open. Historical file-only evidence did not enable the application browser's
Chromium sandbox; this run explicitly verifies it and does not retroactively
change that earlier evidence.
