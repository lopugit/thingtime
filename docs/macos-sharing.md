# macOS system sharing

Thingtime's signed Mac app includes a Share extension. Enable **Thingtime** in
System Settings → General → Login Items & Extensions → Sharing if macOS has not
enabled it. Finder and other apps can then send text, links, images and files
through their ordinary Share menu. Availability depends on the source app's
provided representations.

Choosing Thingtime opens the existing `/share` composer in a separate Thingtime
window using the app's current session. **New post**, **Message** and **Save to
Things** use the same editable controls, API capability negotiation and upload
path as iOS. Sharing into Thingtime does not publish or send anything by itself.
The main window and its unsaved work stay in place. Close the composer to leave
a pending local share; use **File → Resume shared content** or **Saved shares**
to reopen it. Pending entries are filtered to the selected API endpoint.

## Native boundary

- `macos/ThingtimeShare` builds `ThingtimeShare.appex` and `ThingtimeShareBridge`.
  The extension copies the selected provider representations while their
  temporary URLs are valid, then commits one UUID batch by rename.
- The team-prefixed App Group is `<TEAM_ID>.com.thingtime.desktop.share`. macOS
  checks the signed team. Both native binaries use the FileManager container API;
  renderer input cannot supply a filesystem root. The extension is sandboxed.
- The fixed `thingtime-share://incoming/<UUID>` handoff contains only the batch
  identity. The extension selects its containing application explicitly.
- The bridge reuses iOS `ShareInbox` and `ShareComposerSession`: descriptor-relative
  file reads, no symbolic links, bounded transfer chunks, a single composer
  lease, account binding and immutable submission/outcome receipts. The desktop
  also binds the selected API endpoint independently of its loopback UI origin.
- Electron permits only the selected main frame, composer route, UUID and
  current verified account. Account/endpoint changes invalidate the window.
  No cookies or tokens are transferred through the extension or App Group.
- Interrupted imports roll back their unpublished batch. A committed share is
  retained after cancellation, launch failure or an uncertain submission.
  A successful native receipt removes its pending menu entry; original content
  remains local. No upload, post or message is created by opening the extension.

## Build and fork setup

Run `corepack pnpm@10.12.1 --dir electron run test:share-native` and the Electron
tests, then use the canonical `electron` build and install commands. The normal
`build:resources` pipeline builds the extension and helper. Electron packaging
places them under `Contents/PlugIns` and `Contents/Resources` respectively,
preserving their separately signed App Group entitlements. The signed verifier
checks their identities, group, team, executable and URL registration. Old
signed releases remain valid restoration candidates; partial new packages fail.

For a fork, provide your installed signing identity through
`THINGTIME_NODE_SIGNING_IDENTITY` (the parent build normally supplies it) and
your Apple team via `APPLE_TEAM_ID` or the selected certificate. The group is
derived from that team, never from a committed credential. The native build also
accepts explicit `THINGTIME_SHARE_SIGN_IDENTITY` and `THINGTIME_SHARE_TEAM_ID`.
No new server endpoint or cloud secret is required. App Group acceptance must
be checked with the final signed app; an ad-hoc unsigned package does not prove
the OS will grant shared-container access.

These macOS binaries use the team-prefixed App Group without provisioning
profiles. Do not add `com.apple.application-identifier` or
`com.apple.developer.team-identifier` entitlements: those restricted claims make
macOS require a provisioning profile and refuse launch even when signature
verification passes. The signing certificate still supplies the verified team.

## Acceptance

Use the installed app, check that macOS registers its extension, then share a
known text string, URL, image and file through the system sharing service.
Compare the visible composer text, filenames and file bytes with the independent
source. Exercise warm and cold launch, repeated invocation, each destination,
close/resume, reload, identity changes, long names and narrow windows. Use
isolated test accounts/backends for submissions. Verify the final app signature
and preserve the prior installed app if verification fails.

Apple references: [Share extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html),
[App Group containers on macOS](https://developer.apple.com/documentation/xcode/accessing-app-group-containers),
and [opening URLs in a specified app](https://developer.apple.com/documentation/appkit/nsworkspace/open(_:withapplicationat:configuration:completionhandler:)).
