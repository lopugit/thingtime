# System share-sheet acceptance

This standalone fixture app opens the real iOS `UIActivityViewController`. Its UI test selects Thingtime and waits for the extension's durable-save confirmation, then launches the main app to drain the inbox. It covers text, URL, image, PDF, ZIP, audio, video, a custom UTI, mixed types, and 25 attachments. Fixtures are generated in temporary storage; no personal photos, accounts or simulator data are used.

The harness requires Xcode command-line tools, an installed iOS Simulator runtime, XcodeGen, Python 3 and FFmpeg. It respects the active Xcode selection or an explicit `DEVELOPER_DIR`.

After building the final Thingtime simulator app, sign its host and share extension with the resolved App Group entitlements (an ad-hoc identity is sufficient on the isolated simulator). A build with signing disabled does not carry those entitlements and cannot prove shared-container delivery. Run from the repository root:

```sh
THINGTIME_SIMULATOR_APP=/absolute/path/Thingtime.app iOS/scripts/share-acceptance.sh
```

The script creates its own iPhone simulator using the newest available iOS runtime under the active Xcode selection. `SHARE_ACCEPTANCE_RUNTIME` and `SHARE_ACCEPTANCE_DEVICE` can override that selection. `SHARE_ACCEPTANCE_SIMULATOR` can name an existing task-owned simulator, and `SHARE_ACCEPTANCE_STATE` can choose a fresh output directory. XcodeGen project files, DerivedData, logs and `.xcresult` screenshots remain outside the source tree. The script prints their location and retains imported synthetic files before deleting an internally-created simulator. It compares SHA-256 digests for file fixtures and exact bytes for all 25 attachments and the unknown UTI after main-app import. The UIImage case intentionally allows iOS to encode the image, so it does not assert the source PNG digest.

These are real system-sheet tests with synthetic fixture content. A separate Photos test generates a JPEG/MOV pair with Live Photo metadata, verifies its `PHAsset.photoLive` subtype, then opens the actual Photos share sheet. The byte verifier requires both original resources to survive import. These checks do not prove physical-device behavior, iCloud hydration, or access to a user's library.

Preserve the output directory as acceptance evidence. The script shuts down and deletes only simulators it creates, on success or failure. An explicitly supplied simulator is retained. After review, clean up a retained task-owned simulator with:

```sh
xcrun simctl shutdown <task-simulator-id>
xcrun simctl delete <task-simulator-id>
```
