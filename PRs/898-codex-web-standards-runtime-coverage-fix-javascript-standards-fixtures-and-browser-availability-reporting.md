# PR #898 — JavaScript standards fixtures and browser availability

Branch: `codex/web-standards-runtime-coverage`
PR: https://github.com/lopugit/thingtime/pull/898

## Change

Many generated built-in examples used unsuitable receivers or missing callback/iterable arguments. Authored Thingtime program data now covers Intl, Object/Reflect, Map/Set, promises, Atomics, buffers and byte encodings. Shared program builders avoid parallel representations. Saved Components still include the complete program and the native worker has no feature-ID dispatch.

Optional `requires` paths return an explicit unsupported result before executing steps. Availability checks do not invoke final getters or intermediate accessors. Worker regressions execute the same source the browser uses. A read-only audit runs catalogue examples against the served opaque iframe and worker, with separate unsupported and infrastructure outcomes.

## Validation checkpoint — 2026-09-23

- All 18,798 definitions compile and pass the Component schema gate.
- 12 focused catalogue/worker tests pass.
- Node worker execution audit: 475 interactive JavaScript examples, 464 passed, 11 unsupported, no program failures. This is not browser support evidence.
- Full local production build and Vercel-output verification pass. The bundled Nitro handler returns the new Reflect.apply fixture through the real authenticated local catalogue Action.
- Remote build, typecheck ratchet, unit tests and API suite pass for source commit `8bca2dca84e183b1b35d75e400590a37db9f2f69`.
- Chrome 153.0.8010.53 audit of all 475 interactive JavaScript recipes against built runtime assets: **466 passed, 9 unsupported, 0 program failures, 0 load failures**. The unavailable examples all require SharedArrayBuffer: its six examples and Atomics wait/waitAsync/notify.
- Hosted preview audit: 8 representative examples, 7 passed and 1 explicitly unsupported (SharedArrayBuffer.grow), no failures. Hosted runtime JS matches the local built asset SHA-256 `6b3fc53128180c2fc7e3bb719f01a8478347a637c72ef8774ae407325bf83ef1`; hosted HTML preserves sandbox allow-scripts without same-origin.
- Earlier local Chrome audit was interrupted: frame loads/timeouts were unreliable while the Mac used approximately 75 GB swap and the managed stack was restarting. That app-server audit attempt did not pass; the later built-runtime and hosted audits above did. A full local UI rerun after the managed restart stopped at the Mongo health request because Nitro reported `Runner did not become ready in time`; it created no additional data.
- Broader local schema suite encountered timing assertions and an action timeout under the same machine pressure. The clean remote CI run provides the broader unit-test evidence; the earlier local attempt remains a timing failure.

## Production account installation

The connected Chrome session was verified on `https://thingtime.com/profile` as `@lopu` (display name Nikk). Installed the first merged suite through its normal Install app control, which confirmed success and opened the owned page. The canonical page ID is `a5e106e6-b880-4b97-b42b-ab2bea541122`; its friendly URL is https://thingtime.com/p/web-standards. Production search returned the expected two HTML dialog results and the dialog example rendered, returning `HTMLDialogElement`. An anonymous API read of the installed page returned 404, preserving its private audience. No credentials were extracted or stored. This installation uses main from PR #897; PR #898 changes are not yet deployed.

## Remaining work

Complete final graph refresh and verify required CI for the final pushed head before merging. The overall user objective remains active: most Web APIs and many specification clauses still need worked interactive implementations; a complete standards inventory is not complete demo coverage.

Observed follow-up usability issue: the language dropdown paints All languages after query navigation even while the URL and returned results retain `language=html`. Preserve the selected filter across remounts in the next usability increment.

## Hosted preview for the source checkpoint

- Stable: https://pr-898.previews.dev.thingtime.com
- Immutable: https://thingtime-dhkze2h0y-lopugits-projects.vercel.app
- Deployment: https://vercel.com/lopugits-projects/thingtime/dpl_6JnJHNhd3EqdF8uSDvadJixfJpC8

These URLs were verified for `8bca2dca`; the preview controller may replace the alias after later commits and remove previews after merge.

## Graph refresh limitation

The semantic provider returned non-retryable HTTP 502 `codex_execution_failed` errors for its first two chunks after a long wait. Remaining semantic requests were interrupted. The repository wrapper's AST refresh preserves structural navigation; semantic coverage of changed documentation must not be inferred from that structural refresh.
