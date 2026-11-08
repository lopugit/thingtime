# Resume and continue iPhone Photos backups automatically

[Pull request #1424](https://github.com/lopugit/thingtime/pull/1424)

## Recovery and managed transfer

The iOS bridge had been cancelling a native scan whenever UIKit briefly
resigned active. Existing WebViews received “Folder access paused. Try again
when the app is active.” Enabled backups now check the exact saved private
connection and native Photos grant on launch. They retry after five minutes
and can wake for a new lifecycle, connectivity or power observation. Explicit
Pause is durable before admission, including offline. Serialized v1–v3 jobs
remain readable, and changed settings for the same source can safely park old
work while preserving confirmed receipts.

The first milestone is `f792b4652`. Mounted browser fixtures exercised recovery
on cellular while unplugged, retry, Pause, power and hourly waits. The built
1.1 API verified the same canonical receipt from the browser and the paired
device, with no publication authority for an older staging-only handle.

## Background refill

The second milestone is `cb9775111`. The owning browser can open an exact
revocable Photos run. The paired iPhone checks that run before native source
reads and requests reservations for individual originals as iOS permits.
The built 1.2 API fixture published six paired-only originals beyond the first
batch, including a multipart original, and recovered the exact reservations
and verified attachments. Pause, revocation, changed configuration and
pairing, owner logout and upload-permission withdrawal fence later publication.

Controlled browser recovery verified a matching native publication both
before foreground preflight and during guarded publication. The browser
observes the exact content and keeps the native Timeline receipt. Differing
bytes require foreground review. An upload already in flight can leave
private staged bytes for canonical cleanup.

The managed upload rate defaults to 5 Mbps and the summary cadence defaults
to 30 minutes. The hourly budget is optional and shares a device usage
ledger. An individual provider part must fit the selected allowance. iOS
controls when background work and notifications can run. Native simulator
execution and physical background scheduling are separate acceptance gates.
