# PR 1409: Device folders and explicit backup start

The Photos draft previously needed a manually chosen cloud folder; saved cards
hid Start inside collapsed settings, and new configurations were paused by
default. The delivered flow shows a default Device / Files / Source label,
keeps ordinary folder navigation, and exposes explicit Start on the saved card.

## Contracts and boundaries

- api.devices 1.16.0 exposes an origin/account/content-plane rootFolderId.
  api.devices-folders 1.0.0 lists references with canonical cursor paging and
  resolves ordinary private folders through normal Things ACL/accounting/parent
  checks. Identity uses device/connection IDs, never label matching.
- Explicit destinations, opaque native grants, saved drafts and pause defaults
  survive. Save/open never start or unpause. Moved child folders and a deleted
  nonempty root require explicit destination recovery; surviving contents are
  never moved implicitly. A deleted root itself reuses its original identity.
- configurationStart performs a fresh owned revision read, refuses selected
  retained drafts and stale scope, CAS-patches only paused=false, and requires
  an acknowledged save plus matching fresh read before existing runner admission.
  CAS refusal and ambiguous completion never admit or blindly retry a transfer.
  Other connections (including Home) and draft bytes remain unchanged.
- Builder path, Change, option templates, quick action and error fields remain
  individually editable. Cloud paths and device discovery are searchable and
  paginated. Show Folder reads existing roots while physical devices are offline.
  Native onboarding is a compact Things link into dedicated Device setup.

## Evidence and delivery

- Focused folder/capability/card checks, the full Devices test family, typecheck,
  lint and built Nitro API/disposable replica acceptance cover the shared model.
- Desktop/phone browser checks cover draft preservation, paths/search/paging,
  More devices, immediate selected path, Builder selection, collapsed actions,
  CAS refusal, ambiguous resume acknowledgement and identity withdrawal.
- Synthetic users/devices are created through APIs only. No personal Photos or
  files are transferred/deleted and no native grants are changed by this branch.
- The parent coordinates one signed Mac build/install with Photos runtime work.
  Initial source heads 5a9a7f5 and main-integrated b4095092 were superseded by the
  explicit paused-start correction; final delivery uses the latest reviewed PR
  head. A build from an older web head must not be treated as this final UI.
- A 108-slice semantic refresh of the three long existing docs was bounded and
  stopped without activating partial output. Their semantic coverage remains
  historical. Structural outputs are refreshed; this short PR note is the
  scoped semantic record for the final change.
