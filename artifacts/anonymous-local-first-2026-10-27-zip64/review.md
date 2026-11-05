# Scoped review

Independent read-only review found the ZIP64 sentinels, extra-field ordering,
footer offsets, integer arithmetic and immutable payload composition consistent.
The real Node failure then led to a backend-specific early refusal guard.
Follow-up review identified compressed input below 4 GiB declaring larger output;
that is now rejected after manifest parsing and before inflation, with a regression
asserting the inflater receives zero calls. Parent reviewed the change and the
35 passing focused tests. Native browser capacity has separate evidence.

No claim is made that the heavy Node fixture passed. Both actual failed trials
are retained; the exact crash-owned sparse files were verified and removed.
