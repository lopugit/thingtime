# Raycast extension compatibility

Status meanings: **supported** executes with equivalent behavior; **partial** has a real execution path with named
limits; **planned** is recognized and rejected with a capability diagnosis rather than silently ignored.

| Surface                                              | Status    | Current behavior                                                                                                                                                                                          |
| ---------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current/legacy manifest discovery                    | Supported | Reads `package.json` or `extension.json`, imports enabled and disabled commands, and preserves source path.                                                                                               |
| `view`, `no-view`, `menu-bar` modes                  | Partial   | All index correctly. Prebuilt `no-view` entries have isolated-worker execution; view/menu-bar reconciliation is planned.                                                                                  |
| Folder/ZIP sideload                                  | Supported | Native picker accepts folders or ZIPs. ZIP extraction rejects traversal, links, malformed archives, unsafe paths, and resource-limit violations.                                                          |
| Source preparation/build                             | Partial   | Source/build entries and compatibility diagnostics are detected. Build scripts run only after explicit trust consent, with bounded output and a process timeout; dependencies are not auto-installed yet. |
| Store browsing                                       | Supported | Reads Raycast’s official live JSON Feed for the latest 100 extensions and links complete searches into the current public Store.                                                                          |
| Store source installation                            | Partial   | Public source is available through `raycast/extensions`; automatic sparse checkout/build/update remains planned.                                                                                          |
| Per-extension containment                            | Partial   | Node workers have memory limits, execution timeouts, forced termination, and structured failures. They retain Commander’s filesystem/network permissions and are not a security sandbox.                  |
| `List`, `Grid`, `Detail`, `Form`, `ActionPanel`      | Planned   | Platform-neutral render tree and JSON Patch protocol specified in `ARCHITECTURE.md`.                                                                                                                      |
| Preferences and LocalStorage                         | Planned   | Manifest data is retained; runtime API not exposed yet.                                                                                                                                                   |
| Clipboard, open, show in Finder, selected files/text | Partial   | Commander native bridge covers clipboard/open/reveal; Raycast API shim bindings are next.                                                                                                                 |
| Toasts, HUDs, alerts                                 | Planned   | Requires trusted Commander presentation mapping.                                                                                                                                                          |
| OAuth                                                | Planned   | Commander’s own Thingtime OAuth works; extension OAuth token sets are not wired yet.                                                                                                                      |
| AI, browser extension, window management             | Planned   | These need dedicated service/capability adapters.                                                                                                                                                         |

Compatibility is evaluated per command and per platform. A macOS extension that shells out to AppleScript or
bundles an Apple Silicon executable cannot become Linux-compatible merely because its manifest loads. Commander
will distinguish supported, degraded, platform-blocked, and missing-API states.

## Runtime direction

Raycast extensions use Node 22 and React 19. Commander uses the same major runtime lines. The end-state loader:

1. validates manifest and assets;
2. installs/builds source in an isolated cache;
3. aliases `@raycast/api` to Commander’s shim while supporting ESM, CommonJS, Node built-ins, and declared external modules;
4. launches one worker-thread V8 isolate per active command instance;
5. translates extension React through a trusted render tree rather than untrusted DOM;
6. reports unsupported capability names directly in Extensions Settings.

Official sources:

- https://developers.raycast.com/information/file-structure
- https://developers.raycast.com/information/manifest
- https://developers.raycast.com/information/security
- https://developers.raycast.com/information/lifecycle
- https://developers.raycast.com/api-reference/user-interface
- https://developers.raycast.com/information/developer-tools/cli
- https://github.com/raycast/extensions
- https://www.raycast.com/blog/how-raycast-api-extensions-work

## Commander-owned lifecycle commands

Commander's built-in extension uses Raycast-shaped `no-view` manifests for Close Commander, Close Commander Window,
and Open Commander, then maps those trusted built-ins to the native lifecycle bridge. The repository's existing
Raycast extension now lives at `Commander/extensions/raycast/` and also ships a real Raycast `Open Commander`
no-view command that launches the installed macOS app by bundle identifier. The complete legacy extension moved
with it, including its image commands and assets. These Commander-owned commands do not expand the compatibility
claims for third-party extensions in the matrix above.
