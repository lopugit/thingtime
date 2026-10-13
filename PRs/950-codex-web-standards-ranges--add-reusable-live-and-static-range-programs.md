# PR #950: reusable live and static range programs

Forty previously requires-context catalogue entries now contain complete editable
Thingtime programs. Range boundary changes, comparison, cloning, extraction,
insertion, wrapping and basic contextual fragments use actual native receivers.
StaticRange examples compare fixed offsets with live ranges following text edits.
Existing surface geometry recipes remain in place. Selection API work remains.

The program, inputs and projections are ordinary Component data and save through
the existing catalogue Action and private Things API. No native feature-specific
component renderer, collection, endpoint or alternative persistence is added.

The bridge checks current endpoints before reads/operations and parents before
relative setters. Constructors need an owned context and native new Range()
must be initialized to owned nodes before reading. Concrete native prototype
chains handle Chromium's unnamed boundary-accessor layer. Native exceptions
remain catchable; run/handle/node/work/deadline budgets remain unchanged.

Mutations use the detached document's checked projection. Active-surface tree
edits remain unavailable. Contextual fragment input is limited to 4,096 characters
and 128 basic tags without attributes, executable/resource/custom/foreign tags or
comments; validate before parsing. This bounded vocabulary is documented rather
than described as arbitrary HTML support. Both manifests/client use actions-run
1.31.0.

Validation at implementation commit: platform 146 pass / 1 opt-in skip;
capabilities 87 pass; schemas 236 pass; Actions 156 pass / 1 skip; Components 46
pass; pages 138 pass / 3 skips. Full build, Vercel-output verification and focused
lint passed. TypeScript baseline/current both contain 91 diagnostics; none added.
Focused native browser audit: 102 pass, no failures/unsupported. Sixteen edited
programs round-tripped exactly through authenticated APIs; anonymous reads 404.
Canonical install was idempotent. Actual Builder save, full reload, native
wrapping of the edited word, second-page reference, Stop/fresh Run and 390px
overflow check passed. Broader browser and hosted delivery receipts are recorded
in the PR description after completion.

Inventory after this batch: 4,679 interactive / 18,798 total, 11,930
requires-context and 2,189 inspection entries. The full user goal is incomplete.

Primary sources: [DOM ranges](https://dom.spec.whatwg.org/#ranges) and
[HTML contextual fragments](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-range-createcontextualfragment).
