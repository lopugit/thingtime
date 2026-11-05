# Suite browser retry 5 — real alias gap exposed

The final clearance build passed offline installation/edit/reload, canonical
receipt adoption and conflict detection. The bounded scroll check then detected
that the underlying Component definition inspector disappeared during refresh.
The three conflict comparison panes had already been observed; the disappearing
fourth pane belonged to the original local Component URL.

Source tracing found that definition browse still passed the old provisional
family ID into local and remote lookups after alias adoption. This is a product
acceptance failure, not a completed flow. The next change must resolve that scoped
alias and prove the original URL remains usable; navigating early to the canonical
URL would conceal the failure. No version-choice or complete native acceptance is
claimed for this run.

The run failed in 27.17 seconds without OOM. Its network-none boundary and cleanup
receipts are retained under `suites-ui/`. `source.json` identifies the exact pending
source/package. Build passed and TypeScript remained at 91 existing diagnostics.
