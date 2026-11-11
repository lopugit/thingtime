# PR 1463: Shared Archive and Restore in persisted Thing menus

The shipped owner-library implementation excluded Builder mode, so the actual
app cards in the reported iPhone screenshots never received Archive. The repair
moves availability and dispatch into the shared persisted Thing menu rather than
adding a Builder exception. Common action descriptors are resolved for the exact
root on open and reauthorized at write time. Explicit root identities cover posts,
comments, messages, library cards, cloud files, linked Things and saved raw trees.
Raw nested fields name their containing Thing; unsaved values and remote inodes
do not invent persisted identities.

Archive changes private owner library placement only. It never unpublishes,
changes an audience, moves children or alters original source content. Protected
records appear in Archived as static labels with Restore only; generic content
reads, inherited source access and namespace boundaries remain intact. Non-owner
or protected refusal is settled unavailability; transient lookups offer Retry.

Validation: focused menu tests 11/11; backend route/predicate/capability 171/171;
projection 35/35; real built API archive/restore on posts/comments/chat messages;
Chrome at 1440/375 px actual Builder app-card Archive/reload/archived search/Restore,
post/comment/message menus, protected metadata/no-anchor restoration, foreign
refusal, transient retry and controlled same-ID reopen race. Evidence is retained
in the task artifact folder. Final reconciled typecheck passes with zero errors. Mobile menu top/bottom
checks pass. Graphify structural refresh is current; the 127-chunk scoped
semantic attempt exceeded its 150-second bound, so full doc semantics are not
claimed. Native source is unchanged;
production/installed acceptance remains release work after independent review.
