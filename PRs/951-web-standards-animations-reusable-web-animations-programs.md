# PR #951: reusable Web Animations programs

111 previously requires-context entries now contain complete editable Thingtime
programs. Keyframes, timing dictionaries, playback, copied effects, timelines,
computed timing and native finish/cancel/remove handlers are ordinary Component
data. Existing catalogue/save Actions and private Things persistence preserve the
entire program and inputs. A second Builder page can reference the saved Component.

Generic bounded native primitives back Animation, KeyframeEffect,
DocumentTimeline and AnimationPlaybackEvent. Native KeyframeEffect copying keeps
independent timing; worker callback transport restores the animation's `this`
receiver and opaque identity. Ready/finished reads await native promises and are
refused inside synchronous DOM batches. Native Event.isTrusted is read from its
unforgeable own accessor. No feature-specific native UI or alternate storage is
introduced. Both origin manifests and the client require actions-run 1.32.0.

Only owned surface elements/effects are usable. Native object count, keyframes,
properties and scalar values are bounded before construction. Document queries
filter to owned effects; shadow queries retain the same scope. Stop and completion
cancel tracked animations and fence late callbacks/promises. Sampled element
styles are explicitly committed; pseudo-element samples report computed values
because the native commitStyles operation refuses those targets.

Ignored getAnimations pseudoElement filters and missing iterationComposite fields
are reported as unsupported. Group/Sequence effects, scroll/view timelines,
attachment ranges and triggers remain separate work; draft inventory status is
preserved instead of implying universal browser support.

Validation: platform 151 pass / one opt-in skip; capabilities 88 pass; schemas
236 pass; Actions 156 pass / one skip; Components 46 pass; pages 138 pass / three
skips. Full production build, Vercel-output verification and focused lint passed.
Base/current TypeScript both have 91 existing diagnostics, none introduced.
Native animation audit: 241 cases, 231 pass, ten unsupported, zero failures.
Final broader audit: 2,534 cases, 2,334 pass, 200 unsupported, zero failures.

Sixteen edited programs round-tripped exactly through authenticated canonical
APIs; anonymous reads returned 404. Canonical installation was idempotent. Actual
Builder save/full reload, second private page reference, exact midpoint opacity
0.6 and translation 100px, Stop/fresh Run and 390px bounds passed. All nine
disposable local fixtures were removed. Hosted preview and production evidence
is recorded in the PR description after deployment verification.

Coverage: 4,790 interactive / 18,798 inventory entries; 11,819 requires-context,
2,189 inspection. The user's full mapping goal remains incomplete.

Sources: [Web Animations publication](https://www.w3.org/TR/web-animations-1/),
[Level 1 editor's draft](https://drafts.csswg.org/web-animations-1/),
[Level 2 additions](https://drafts.csswg.org/web-animations-2/).
