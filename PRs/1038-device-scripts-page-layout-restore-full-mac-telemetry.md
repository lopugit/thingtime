# PR 1038: Restore full Mac telemetry and center Device scripts pages

Live acceptance found two issues after the initial menu bar and device script delivery.

## Device capability admission

A fully equipped Mac advertises 65 unique capabilities, including menu bar inventory, Bash, and display brightness. Pairing and heartbeat admission rejected more than 64 identifiers, while owner projection silently retained only 64. The installed node stayed connected through its command channel, but every heartbeat failed with HTTP 400 and the cloud retained an older state snapshot.

Admission and projection now share a bounded 128-entry contract. The device read, pairing claim, and node state manifests advertise compatible minor versions. A regression test derives the capability vocabulary from the native controller, checks every identifier survives admission and projection, and covers the 128/129 boundary and malformed identifiers.

## Installed page layout

The Device scripts suite omitted its own centered container. Its browser fixture supplied centering and padding, concealing the defect. The suite now owns that layout; the fixture no longer compensates for it. Assertions check both desktop and mobile form bounds.

## Validation

- 98 focused device and capability tests passed.
- Isolated browser checks passed at 1440px and 390px, including inventory search/pagination, seven inventory states, script controls, expanded result reader, and bottom-of-page overflow.
- Both private cloud pages were saved and their privacy verified. The saved Device scripts page was corrected through Builder and inspected at desktop/mobile sizes.
- A reusable harmless Bash Action was saved through the actual page.
- The combined installed app signature verifies. Live menu bar and script execution acceptance remains pending the capability fix deployment and coordinated installed-app UI recovery.
- Structural graph outputs refreshed; semantic documentation extraction remains unavailable from the failing local backend.
