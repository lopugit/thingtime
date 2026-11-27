# PR 1417: Back up iOS Photos newest first in one queue

The iOS Photos adapter groups each asset's originals and companions, orders
them by PhotoKit capture date, and uses modification date and opaque identity
to break ties. Local and iCloud-only resources use the same queue. Existing
Wi-Fi-only and charging policies remain in force. A cloud-only original stays
visible as unavailable when it cannot be retrieved; the same source version
can be tried again in a fresh epoch.

The first native membership read builds one metadata index. PhotoKit changes
refresh it, and newly captured assets can preempt the next batch. The Rust
indexer reuses exact observations and seals the selected resources without
creating a skip record for every untouched original. After the first complete
cloud checkpoint, each batch reads only the exact selected destination paths
and commits a sparse change to the existing baseline. The canonical path
endpoint still performs its server-side alias checks. Each batch advances only
after the file and Timeline checkpoint and an independent native check of the
published fingerprints. The queue preserves prior receipts when a source
changes, keeps current and last exhausted state across reopen, and prunes
superseded completed epochs without touching Photos or cloud files. A fresh
empty selection is required before reporting completion.

Focused tests covered latest-first canonical publication, Live Photo
companions, a new arrival during the last batch, mixed iCloud and local
availability, a stale selected original, reopen and the same-version retry.
Ten native batches used only two full membership reads after one new arrival.
Three sparse batches and the terminal check used two full destination reads
for initial setup, then exact reads. Isolated Chromium covered the collapsed
states at desktop and phone widths. The installed simulator build and
accounting preflight passed, but the disposable login request timed out before
any Photos action. That fixture did not verify installed newest-first
operation or real iCloud-only content. Physical wake and lock acceptance
remains a separate check from signed/TestFlight delivery.
