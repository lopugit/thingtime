# PR 680 — index rollout compatibility

2026-09-09: merge released main `60b4c4bd638728aed7126112a314a658e1bede93`
into the existing promotion branch before activating the index migrations.
This does not promote unfinished feature work to main.

The audience feature is already present in released main. Reconcile equivalent
viewer enrichment and hidden-key query blocks with main, retain its shared
audience type/metadata and drawer modal layering, and remove duplicated viewer
fields, composer state, ACL assignment and post modal rendering introduced by
the merge. The resulting application source is identical to released main.

Validation: run the full Remix unit suite and production build, check the
Vercel output, and verify the preview's exact deployment SHA and semantic
capabilities before treating it as upgraded. Database migration activation
remains a separate, gated operation until older live clients are retired.
