# Remote file contract

The file browser adapts remote inode metadata into the existing Things views.
It never persists a Mac path as a server filesystem path. Thingtime copies are
private, quota-accounted attachment Things with immutable `attachmentPurpose:
file`; folders use ordinary Folder Things and canonical placement/deletion.
Portable exports retain `filePurpose: file`; imports require fresh `file-import`
drafts before the protected attachment writer commits them.

## Compatibility and dispatch

The browser negotiates these origin-scoped features before dependent work:

| Feature | Minimum |
| --- | --- |
| `api.devices-commands` | 1.9.0 |
| `api.devices-node-commands` | 1.9.0 |
| `api.devices-node-state` | 1.9.0 |
| `api.attachment-uploads` | 1.5.0 |
| `api.attachment-upload-complete` | 1.4.0 |
| `api.attachment-content` | 1.11.0 |
| `api.things` | 1.25.0 |
| `api.things-bulk` | 1.5.0 |

Portable Things export/import negotiate 1.15.0 and 1.11.0 respectively.
The native client separately requires pairing-claim 1.0.0, node-state 1.9.0,
node-commands 1.9.0 and node-live-sync 1.0.0. Missing features, a different
origin or major version fail closed. Node capability `filesystem.v1` is also
required, and changes to native support refresh through revision-fenced state
heartbeats. The capability manifest contains no account data or paths.

Commands use the existing authenticated, scoped lease channel:
`POST /api/v1/devices/commands` with `kind: filesystem`, one stable `requestId`,
a `deviceId` and a closed `input`. Poll an exact result with
`GET /api/v1/devices/commands?deviceId=...&commandId=...`. Node reports must
match the leased operation, lease identity and monotonic command state.

| Operation | Input fields beyond `op` | Result |
| --- | --- | --- |
| `list` | `path`, optional `cursor`, `hidden` | `path`, `entries`, `nextCursor` |
| `read` | `path`, `version`, `offset` | base64 `data`, `offset`, `size`, `version` |
| `write` | `path`, `transferId`, `offset`, `total`, `sha256`, base64 `data` | `path`, next `offset`, `complete` |
| `mkdir` | `path` | `path` |
| `copy`, `move` | `path`, `version`, `destination` | `path` |
| `trash` | `path`, `version` | recoverable `.Trash/` path |

Paths are home-relative; the empty path means home. There is no absolute path,
parent traversal, shell, symlink following or arbitrary URL transport. List
entries contain name/path, file/folder/symlink/other type, inode identity, source
version, size and modification time. Names that cannot be safely represented
must be renamed locally. Listing is bounded to 10,000 entries, 25 per page;
read/write chunks are 65,536 bytes and each file is at most 32 MiB.

## Transfer guarantees and retention

Remote access uses directory descriptors and no-follow opens. Writes bind a
UUID, destination, total length and SHA-256, stage privately, and publish with
an exclusive rename after the final hash matches. Existing destinations remain
untouched. Duplicate chunks must match exactly. Interrupted staging files are
hidden and expire after 24 hours when their directory is next browsed/written;
active locks, symlinks and unrelated files are excluded from cleanup. Native
folder copies stage the whole result and leave no partial destination on failure.

Browser folder transfers preflight at most 500 entries, 32 levels and 128 MiB.
Cross-location moves verify the source tree again after every destination is
saved, then remove sources. Remote sources go to Trash; cloud files use the
canonical attachment deletion writer and folders re-parent any late children.
A failed multi-item operation can retain completed copies; it does not silently
overwrite existing data. Cancellation stops waiting and subsequent steps, but
an already accepted remote action may still finish. Refresh before retrying an
uncertain result. The browser's file clipboard is account-scoped and stays in
memory in the current tab; it is separate from text pasted into inputs.

File bytes are absent from command history and event streams. Upload inputs
are redacted on terminal reports; exact owner-only results and terminal file
commands expire after ten minutes. The native journal keeps at most 512 KiB of
recent base64 read replies, then retains an expired-result receipt and payload
hash, rather than re-executing an old request. Mutation receipts retain the
existing journal behavior. Files copied into Thingtime are durable attachments,
not expiring command payloads. Normal storage accounting, moderation, upload
access and owner authorization continue to apply.
