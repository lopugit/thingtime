# PR 1227 — Explicit render Components for Things

PR: https://github.com/lopugit/thingtime/pull/1227
Branch: `codex/thing-render-components`; base: `develop`.

## Contract

Human-facing data Things declare `crystal.renderComponent: { id: "<Component Thing ID>" }`
or embed the canonical Component crystal, for example
`crystal.renderComponent: { render: { tag: "p", children: ["{text}"] } }`.
The displayed Thing data supplies ordinary Component template arguments and the
`thing` binding. Component defaults and saved arguments remain supported.

An explicit declaration takes precedence over all legacy type/kind resolution.
Malformed, missing or inaccessible explicit Components show an unavailable
state; they never select another renderer based on data shape. Existing legacy
Things without a declaration retain their compatibility behavior. The data
inspector remains an explicit user-selected view.

Saved Components are read through the ordinary Things API with their own access
checks, account/Character/data-plane identity and stale-request fencing. A Thing
reference grants no additional access. Display templates use the canonical
sanitizers and bindings with isolated data scope; Component source, Actions,
uploads, integrations and native controls are inert in this read-only surface.
No new endpoint or server contract is introduced.

Global and repository AI guidance requires explicit render Components, editable
content, exact-Thing readback and placement-specific rendered verification.
Only the canonical global file was edited; its instruction symlinks passed the
supported verification command.

## Regression coverage and acceptance

The isolated real-API harness creates saved-pointer and embedded Components,
reads their exact persisted data back, checks both feed and sidebar placements,
tests escaped text, rendered/data toggles, reloads, Component template changes
and independent Component ACL revocation. Its existing subspace tests also
exercise saved views, messages, embed administration and nested Builder edits.

Browser acceptance exposed two additional defects: the transient layout host
intercepted ordinary nested buttons, and an overflow-hidden page container could
retain horizontal scroll after data inspection. The host now captures only its
own transient controls. The main content container uses `overflow: clip` rather
than becoming a hidden scroll container; repeated desktop/mobile resizing,
view switches and strict element-bound assertions passed with this fix.

Feed 89/89, hooks 57/57, explicit Component 9/9, HTML renderer 13/13 and transient
boundary 5/5 tests passed. Changed rendering files lint clean; useApi has no lint
errors and retains existing warnings. Raw TypeScript checking returns 92
diagnostics, identical to an unchanged develop-source comparison; none occur in
changed files. The stored ratchet baseline is 89, so it still warns. The baseline
was not increased. The final client build and isolated real-API/browser
acceptance both exited 0 on 26 October 2026. Desktop (1440px) and mobile (390px)
rendering, reloads, view toggles, saved template updates, ACL revocation,
messages, drafts, embed administration and independent nested Builder edits
passed with no page errors. Direct-IP and redirect network-denial checks passed;
both browser and backend used the harness's enforced disposable test boundary.
Task test processes exited and ports 19741–19744 were verified released.

Saved Component definition changes were verified through the real API and
rendered reloads. The existing subspace layout's nested labels, buttons and
repeated card titles were edited through Builder. This does not claim visual
Builder editing of every block inside a saved render Component.

Local evidence is under `/tmp/thing-render-components-evidence/`; these are
temporary verification artifacts, not production state or committed fixtures.
The installed agent-browser manager socket was unavailable, so acceptance used
the supported OS-fenced standalone runner and existing Chromium for Testing.
Its cached vendor bundle was left untouched; strict bundle-signature validation
did not pass and is not claimed as part of browser evidence.

## Delivery boundaries

The existing production Thing from the screenshot has not been repaired.
Assigned Chrome identity was verified, but extension page control timed out and
native control could not complete reliably. Public capability discovery passed;
authenticated Character/overview reporting and saved Thing writes did not.

The initial PR preview controller dispatch failed with HTTP 403. A local build
or isolated browser pass does not prove a preview or production deployment.
No merge, primary-branch update or production deployment is authorized here.

Graphify's structural refresh is retained. The semantic path treated the corpus
as broadly changed rather than incrementally reusing it; changed documentation
has not been semantically refreshed. Do not interpret structural presence as
complete semantic indexing.
