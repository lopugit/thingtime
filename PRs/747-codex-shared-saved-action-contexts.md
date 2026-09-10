# PR 747 — shared saved action contexts

Implementation: <https://github.com/lopugit/thingtime/pull/747>.
Focused main promotion: `codex/promote-saved-action-sharing-main`.

Stored component defaults, savedArgs and each page-block override select
executable dependencies in that precedence order. Same-author containment
inherits the freshly authorized root audience, without modifying standalone
ACLs. Shared action execution remains read-only. Runtime query/result/viewer
data, action inputs and arbitrary metadata never confer private authority.

Copies preserve argument templates and rebind executable references through
bounded `ttActionRefs` pairs on authored controls. Labels and inputs stay
unchanged; unused pairs are not grants. Every required contextual dependency
is preflighted. Non-owner argument edits cannot introduce unreadable private
dependencies, including new instances of already included components.

Regression coverage includes defaults/saved/block precedence, inactive branches,
bounded loops, two distinct instances, copies and forks of forks, wrong/retired
keys and collaborator injection denial. The opt-in real API/browser fixture
checks signed-out desktop/mobile use, copied action execution, source edit
denial and the existing retry/media paths. Exact-head build, CI, security and
deployment receipts are recorded in the PR checks and comments.

The main promotion carries only this sharing implementation and its tests,
API contracts, client requirements and documentation. Graphify is refreshed
for the actual promotion tree. This does not claim independent binary-upload
copies, universal multi-page composition coverage or request timeouts.
