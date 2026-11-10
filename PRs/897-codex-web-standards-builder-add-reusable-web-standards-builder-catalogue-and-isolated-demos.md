# PR #897 — Reusable web standards Builder catalogue and isolated demos

Date: 2026-09-23. Branch: `codex/web-standards-builder`. Base: `main`, explicitly
authorized by Lopu for incremental delivery of the Web standards app.
PR: https://github.com/lopugit/thingtime/pull/897

## What this increment delivers

The `web-standards` suite installs six private Things: navigation, explorer and
workbench Components; catalogue and save Actions; and a Webpage. Navigation,
filters, cards, pagination and save controls are authored definitions. No native
app block is present. The underlying `tt-web-platform` primitive accepts an
entire editable document/CSS/JavaScript data program, rather than dispatching
hardcoded example IDs. Saved templates retain their complete program and can be
edited and composed on another Builder page.

The source snapshot contains 18,798 entries: 1,784 generated interactive recipes,
2,680 inspections and 14,334 entries requiring additional contexts. Inventory
coverage is **not** completed interactive coverage. Sources include WHATWG HTML,
ECMAScript/ECMA-402 2026 and W3C Webref; draft status and source provenance remain
visible. The complete specification set is a continuing goal beyond this PR.

## Shared framework changes

- Pure `webstandards.browse` and `webstandards.component` Action expressions.
- Browser-runtime metadata retained by suite materialization; save uses owned
  browser Actions, negotiated API versions and canonical private Things writes.
- `$ui` query controls opt into form fields with `form: true`. Only declared
  parameters are collected from the component's bounded fieldset. Empty values
  clear queries; reserved query parameters and password/file contents stay fenced.
- Runtime build/watch joins the existing PM2 lifecycle. Vite and Vercel serve a
  response-header CSP enforcing the same opaque-origin boundary as the iframe.
- Named JSON inventory exports avoid Nitro dropping array-default module
  initialization. This was found through actual HTTP testing, and the built
  Vercel handler was exercised after the fix.

## Validation performed

- `test:web-platform`: all 18,798 recipes compile and pass the real Component
  schema; source metadata, suite materialization, template binding, search,
  compiler limits, malformed descriptors and containment checks pass.
- Opt-in real HTTP test against a disposable local Mongo replica set: install
  twice without duplicates; search; create/read/update a reusable private
  component; anonymous read denial; remove only exact fixture-created Things.
- `scripts/check-web-standards-browser.mjs` passed in a fresh headed Chrome
  context. It tests real search field values, dialog open/close, CSS computed
  display, changed Array.at arguments, private template save/read, desktop and
  390px layout, infinite-loop termination, blocked network/account access, Stop
  and the direct runtime CSP. It supports an explicitly supplied local test
  session file to reuse a disposable test account after temporary-account rate
  limits. It refuses non-local origins and checks the database host first.
- Schemas 230 pass; Action packs 138 pass; Actions pass with the existing opt-in
  integration skip; capabilities 82 pass; Components 44 pass; Webpages 122 pass
  with 3 existing opt-in skips. Targeted lint has no errors or warnings.
- Full `build` passes, including client, static platform runner, server,
  embedded bundle budget and Vercel output verification. Direct execution of the
  built Vercel handler returned HTTP 200 with catalogue results.
- Raw TypeScript reports 89 diagnostics in unchanged files and none in changed
  files. No baseline was changed. This is not a clean repository-wide typecheck.
- Graphify semantic extraction through the local proxy and structural update
  refreshed the immutable graph snapshot; the new documentation and runtime
  were checked in both graph and manifest.

Local validation used the isolated PM2 worktree stack on 18730/18731/18732 and
a disposable Mongo replica on 18733. No production account data was used or
modified. Tailscale is unavailable because the installed CLI wrapper points to
an absent `/Applications/Tailscale.app` binary.

## Remaining work and boundaries

The catalogue intentionally labels incomplete demos. Secure-context, device,
network, navigation, media and specialized worker APIs need further reusable
capability implementations. Some built-in methods require suitable receiver or
argument combinations; browser errors are shown without pretending the feature
is supported. Syntax/specification clauses still need more authored examples.

The initial runtime grants no network/account access. JavaScript is compiled
from bounded data nodes into a worker terminated after two seconds, with no
raw-source escape or eval. DOM operations are allowlisted; executable markup,
embedded documents and main-thread regexp validation are excluded. Input state
and running frames reset across account/component changes.

**Save example template** saves the catalogue definition; the live program
editor is a scratch draft. Retaining edits currently uses the saved Component
Thing's ordinary Fields/Source editor. Production `@lopu` installation still
requires an authenticated account session or account API credential; none was
available to this task at the time of this validation record.
