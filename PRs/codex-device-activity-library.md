# Device sync placement, parent paths and activity ownership

## Problem and resulting behavior

Things home rendered device sync setup and unbound storage attachments as ordinary
root content. Relational workspace records with `crystal.parentId` also leaked into
root. Sync upload authority did not retain provenance before bytes became durable,
so a failed file publication could leave a pathless attachment.

The root now filters those structural children in server queries and cached first
paint. Devices link to `/things?device=<id>&deviceView=sync`, and file navigation
uses the saved folder tree. Unfiled files remain recoverable through a paged view
and search; nothing is moved, deleted or assigned a guessed path.

Scalar and adaptive batch reservations record immutable private sync origin and
intended file/folder before transfer authority. Exact queued retries may supply
that original descriptor; changed account/root/destination is rejected. Initial
publication must match it. Only the owner-session single-Thing projection exposes
origin. Capabilities: attachment-uploads1.7.0, files1.8.1, file-sync-batches1.2.1,
things1.40.0. Old blobs without provenance remain explicitly unknown.

The Thing page offers generated parent paths using the existing owner-library
query and canonical file, post/comment and webpage reference scanners. Scanning
is explicit, up to500 records per batch; path traversal performs at most200 ACL
reads with20 paths per page. Cursors/frontiers survive continuation, cycles and
unavailable relationships do not produce fabricated complete paths, and account
changes cancel the old scope. Other-account reverse references, arbitrary prose
and unsupported/private managed query kinds are outside this scan's coverage.
Original upload location is displayed separately from current references.

## Activity and performance

The editable `/things?activity=1` page controls registered polling, listeners,
selected-device long polls, sync discovery and transfer execution. Preferences
persist per device/origin; timers stop in hidden views; callbacks return their
Promises where available, avoiding overlapping work. Registry snapshots are
materialized only when read and UI notifications are coalesced.

Activity Disable uses durable Pause semantics and cancels independent native
capture work before closing its journal, including cancellation during journal
initialization. Visibility interruptions retain their existing recovery behavior.
Background node status retains last-known content and uses a30-second fallback;
paused/completed charts stop ticking and stable progress descriptors avoid
reopening journals for equivalent byte updates.

The versioned desktop activity adapter controls the fixed Thingtime Node launchd
service with durable disable intent and rollback. Required security/lifecycle
guards remain enabled. CPU/RSS measure Electron only; native Node children share
one owner control and external Mongo/API runtimes are not included. Dispatch-only
callbacks cannot attribute or cancel downstream work through their current APIs.
This is an explicit registered-owner inventory, not global instrumentation of
all third-party listeners or OS processes.

All new visible sections use individually editable Builder elements/templates.
Legacy saved transient JSON action-input props are normalized through the existing
closed scalar parser; user layouts are not rewritten.

## Verification at initial publication

-177 upload/backend/manifest checks passed.
-325 Electron tests passed.
-630 file-sync tests:629 passed initially; the sole failure was an outdated exact
 capability-version expectation. Updated it and all11 configuration tests passed;
 the additional module-mock suite passed.
-Things suite, focused activity/cancellation/path tests and scoped ESLint passed
 (existing warnings retained). Typecheck ratchet reports92 errors against the
 existing89 baseline; no new feature errors identified, baseline unchanged.
-Isolated browser checks cover desktop/mobile/landscape, full scroll, navigation,
 timer/listener stop, persistence, native adapter states, explicit native refresh,
 multi-parent paths, no scan on mount, bounded Unfiled paging, and independent
 heading/repeated-field/breadcrumb edits saved and reloaded.

Installed/native process-stop and production acceptance remain pending. Synthetic
native UI evidence is not proof of stopping a live launchd service. Home sync stays
paused; its removed grant is not restored. No personal transfer or local deletion
is part of this correction. The exact producer of the legacy search.svg remains
unproven despite its measured21October2026 creation time.
