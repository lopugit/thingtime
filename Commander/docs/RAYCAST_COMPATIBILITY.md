# Raycast extension compatibility

Status meanings: **supported** executes with equivalent behavior; **partial** has a real execution path with named
limits; **planned** is recognized and rejected with a capability diagnosis rather than silently ignored.

| Surface                                              | Status    | Current behavior                                                                                                                                                                                           |
| ---------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current/legacy manifest discovery                    | Supported | Reads `package.json` or `extension.json`, imports enabled and disabled commands, and preserves source path.                                                                                                |
| `view`, `no-view`, `menu-bar` modes                  | Partial   | All index correctly. Prebuilt `no-view` entries have isolated-worker execution; view/menu-bar reconciliation is planned.                                                                                   |
| Folder/ZIP sideload                                  | Supported | Native picker accepts folders or ZIPs. ZIP extraction rejects traversal, links, malformed archives, unsafe paths, and resource-limit violations.                                                           |
| Source preparation/build                             | Partial   | Source/build entries and compatibility diagnostics are detected. Build scripts run only after explicit trust consent, with bounded output and a process timeout; dependencies are not auto-installed yet.  |
| Store browsing                                       | Supported | Reads Raycast’s official live JSON Feed for the latest 100 extensions and links complete searches into the current public Store.                                                                           |
| Store source installation                            | Partial   | Your Raycast can download an installed public extension's bounded source snapshot from `raycast/extensions`; dependency installation, automatic builds, and updates remain explicit/manual.                |
| Local Raycast profile discovery                      | Partial   | macOS lists profile-linked extensions from Raycast's exported preferences without opening Raycast's encrypted database or Keychain. Development source locations are not exposed and must be sideloaded.   |
| Per-extension containment                            | Partial   | Node workers have memory limits, execution timeouts, forced termination, and structured failures. They retain Commander’s filesystem/network permissions and are not a security sandbox.                   |
| `List`, `Grid`, `Detail`, `Form`, `ActionPanel`      | Planned   | Platform-neutral render tree and JSON Patch protocol specified in `ARCHITECTURE.md`.                                                                                                                       |
| Preferences and LocalStorage                         | Partial   | Your Raycast imports manifest-declared, non-password extension/command preferences and supplies them to compatible workers. Passwords, OAuth tokens, and LocalStorage remain protected and are not copied. |
| Clipboard, open, show in Finder, selected files/text | Partial   | Commander native bridge covers clipboard/open/reveal; Raycast API shim bindings are next.                                                                                                                  |
| Toasts, HUDs, alerts                                 | Planned   | Requires trusted Commander presentation mapping.                                                                                                                                                           |
| OAuth                                                | Planned   | Commander’s own Thingtime OAuth works; extension OAuth token sets are not wired yet.                                                                                                                       |
| AI, browser extension, window management             | Planned   | These need dedicated service/capability adapters.                                                                                                                                                          |

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

## Bundled Commands

Some Raycast commands are part of the host application rather than a public extension package, so there is no
source package for Your Raycast or Sideload to import. Commander lists its clean-room native equivalents under a
separate **Bundled** category instead of misrepresenting them as imported extensions.

The first bundled equivalent is **Emoji & Symbols → Search Emoji & Symbols**, inspired by Raycast's picker. It
provides semantic Unicode/CLDR
search, an eight-column keyboard-navigable grid, category and skin-tone filters, local recents, copy/Unicode actions,
and native paste-back to the app that was active before Commander opened. On macOS, automatic paste requires the
existing Accessibility grant; without it, Commander copies the selection and keeps the picker open with an explicit
fallback message. The emoji catalog uses [Emojibase](https://emojibase.dev/) data under its MIT license. This
Commander-owned view does not imply third-party Raycast `Grid` compatibility, which remains planned in the matrix.

**Calculator** is a separate bundled Commander extension and automatic root-search provider. A complete arithmetic
expression is parsed locally by a bounded whitelist parser and shown before ordinary search results without requiring
a Calculator command or prefix. Return copies the displayed answer through the native clipboard bridge. The bundled
card can disable automatic results or change maximum decimal precision. This currently covers arithmetic, powers,
percentages, factorials, constants, and common numeric functions; currency, date, and unit conversion remain outside
the compatibility claim.

## Your Raycast

On macOS, Extensions Settings includes a **Your Raycast** tab. It asks the native `defaults` tool for Raycast's
exported preference domain, derives a sanitized list of profile-linked extensions, and returns only metadata and
counts to the Commander UI. It does not open `raycast-enc.sqlite`, inspect Raycast's Keychain entries, or expose
preference values to the renderer.

**Add to Commander** downloads the matching public source snapshot through Commander's existing bounded Store
importer and copies manifest-declared, non-password settings. It does not install dependencies or execute package
scripts. Raycast development extensions need their source folder to be chosen through Sideload because Raycast's
profile does not disclose that source path.

**Sync to Commander** refreshes those safe preference values for an already installed extension. Password fields
are deliberately skipped even if declared in the manifest; OAuth credentials and Raycast LocalStorage are not
transferred. Compatible `no-view` commands receive the imported values through the same worker-data preferences
shape used by Raycast's API.
