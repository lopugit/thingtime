# PR #900 — Expand standards language demos and preserve Builder filter values

## Behavior

The production Web standards page exposed a shared Builder field problem:
asynchronous result defaults did not update an initially empty select. The URL
and results could retain HTML while the control displayed All languages.
`HtmlTemplateField` adopts late defaults only when the current value matches the
previous default, preserving visitor edits. Local `$ui` bindings stay controlled.

Workers previously counted browser process startup against the two-second
program limit. Readiness now has a separate ten-second bound. The execution
deadline still terminates runaway code after two seconds; duplicate readiness,
late results, errors and cancellation cannot restart or extend that deadline.

`javascriptSyntax.ts` and `javascriptSymbols.ts` author reusable data programs
for operators, control flow, optional access, computed symbol members and their
receivers. The compiler adds optional property reads and const/var declarations.
No feature-specific dispatch or raw-source escape is added to the runtime.
Abstract clauses without an exact fixture retain inspection coverage.

The inventory remains 18,798 entries. Current coverage is 1,886 interactive
recipes: HTML 227, CSS 1,059, JavaScript 576 and Web APIs 24. The rest remain
explicitly inspection/context dependent. This increment does not complete the
broader all-standards goal.

## Validation

- Chrome 153.0.8010.53, actual built opaque iframe/worker: 576 JavaScript recipes,
  565 passed, 11 unsupported, zero program failures and zero frame-load failures.
  The additional unsupported symbol examples depend on SharedArrayBuffer in the
  isolated context. Report: `/tmp/tt-syntax-js-browser-audit.json`.
- Node 24 worker-source audit: 565 passed, 11 unsupported, zero failures. Test
  inputs are reconstructed inside the VM realm to match worker clone semantics.
- Focused renderer/runtime tests: 23 passed, one opt-in API-install check skipped.
  The skipped check is not counted as completed API acceptance.
- Actual bundled field-component browser regression passed: delayed defaults
  update untouched controls and preserve edited inputs, textareas and selections.
  Report: `/tmp/tt-syntax-fields-bundled.log`.
- Full production build and Vercel artifact/CSP verification passed.
  Log: `/tmp/tt-syntax-full-build.log`.
- Hosted preview runtime: Optional Chains and Intl.Collator.compare both passed
  in Chrome. Runtime SHA-256 matched the locally audited build byte-for-byte:
  `19b94d2699baca4418a8c68f564be89fc7cfcb1e49a6ad45a3ba45e6d02b63a1`.
  The anonymous demo page correctly asks for sign-in before server Actions;
  no preview account or production credentials were created/copied for that check.
- The built Nitro handler returned HTTP 200/status ok and the new Optional Chains
  interactive entry through the authenticated local catalogue Action. This uses
  the existing disposable local account and real API, not direct database writes.
- The local built-client flow passed search, filter reload/repeat search, dialog
  open/close, CSS computed output and changed JavaScript inputs. It then timed
  out waiting for the save receipt. API readback found the newly created fixture;
  its exact ID, timestamp and program were checked before API cleanup returned
  200. The full script is not reported as passing; later mobile/isolation/Stop
  assertions in that run were not reached. Earlier Vite/full-page attempts also
  stalled under host load. Log: `/tmp/tt-syntax-built-acceptance-diagnostic.log`.

The bundled component fixture needs no app server/account. The full browser
script can intercept only public built client assets while retaining real API
requests on the explicitly checked disposable local stack. Off-origin API
requests are blocked in that test context. Production credentials are never used.

## Delivery and remaining work

Branch: `origin/codex/web-standards-syntax-and-controls`.
PR: https://github.com/lopugit/thingtime/pull/900.

The prior installation remains on production @lopu at
https://thingtime.com/p/web-standards, page Thing
`a5e106e6-b880-4b97-b42b-ab2bea541122`. PR #898's merge
`ddcb4c1129f5243c45f8106a3c206be84170d932` and runtime hash were verified on
production. Its new Intl controls rendered, but startup/loading deadlines were
observed during that production test; those findings motivated this fix.

Initial head `6a8bbae31d51d43e84d48f6bb0da5537cfdae7bf` passed the remote build,
typecheck/unit, API and both CodeQL checks. Its verified ready preview is
https://pr-900.previews.dev.thingtime.com, with immutable deployment
https://thingtime-iveq3b7ph-lopugits-projects.vercel.app and provider record
https://vercel.com/lopugits-projects/thingtime/dpl_2YTXxrAqwbnZk26eXLJe38AnaeSh.
Those results are scoped to that head, not later documentation/graph commits.
Final-head checks and deployment provenance remain recorded on the PR. Graphify
is refreshed structurally; new document semantic coverage is not asserted.
Snapshot identity must match the final source fingerprint before merge.

Remaining broader work includes language constructs without fixtures,
DOM/browser-context adapters, permission-dependent APIs, deeper CSS/HTML demos,
and saving edited workbench drafts as reusable definitions.
