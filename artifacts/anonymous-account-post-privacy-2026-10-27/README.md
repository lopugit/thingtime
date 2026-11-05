# Account owner privacy transition — 2026-10-27

**PASS: final execution is attempt 7 (`account-privacy/`).** Native test `remix/app/local-workspace/accountPostPrivacy.browser.test.ts` and scoped lint pass. No product fix was needed.

Two disposable synthetic local identities and a guest use the archived real API/database. Before offline, reader and guest can read the synthetic public fixture. The owner changes it to Private through the normal Post options → Share / permissions menu, edits through normal Edit → Save, waits for composer close and rendered content, then cold reloads offline. Both the revised body and selected Private menu survive. Reconnect produces the exact revised canonical body and `['tt:user']` ACL; reader and guest each receive 404. No offline mutation requests or page errors. Full scrolling at 1440/390/320 has no horizontal overflow; normal controls and opened Private menus are exercised and top/bottom/menu screenshots retained. The 320 top/menu, 390 bottom and 1440 menu captures were inspected.

`verification.json`, `boundary.json`, `network-proof.json`, `resources.json`, and `cleanup.json` inside `account-privacy/` record final evidence. The root is read-only, network none, no mounts or published ports, and Chromium retains its sandbox. Backend and browser IPv4/mapped IPv6/IPv6/DNS/redirect egress are denied. OOM counters remain zero and cleanup has no owned containers. Runtime, browser/profile/database and private temporary manager state were removed. Public visibility exists only inside this isolated local fixture. No provider, production, existing account or installed-app data was used.

`source-equivalence.json` verifies exact archived sourcemap contents for eleven relevant client modules. Server-source and whole-archive equivalence are unestablished. This is local package/browser acceptance, not installed-app, provider, cross-device, CI or deployed acceptance. Private Character/overview authentication was unavailable to the parent; no identity or workspace record was invented. Parent owns shared docs, Graphify refresh and integration.

## Reproduce on the configured isolated host

```sh
node artifacts/anonymous-account-post-privacy-2026-10-27/prepare.cjs
node artifacts/anonymous-account-post-privacy-2026-10-27/run.cjs
corepack pnpm --dir remix run lint:files -- app/local-workspace/accountPostPrivacy.browser.test.ts
```

Run from the repository root with exclusive acceptance-runtime capacity. Host dependencies: `MCP/node_modules/esbuild`; sanitized `tmp/continuation/post-draft-app.tar.gz`; installed `/Users/lopu/Applications/Thingtime.app/Contents/Resources/agent-browser.mjs`; configured Colima socket `/Users/lopu/.colima/thingtime-agents/docker.sock`; exact image recorded in `run.cjs`. Re-establish provenance if changing the archive. Do not redirect to an account service or reuse personal browser state. The shared proxy/key and VM configuration were unchanged.

## Retained attempts and harness corrections

- Attempt 1: invalid public ACL spelling (`tt:public`); reader 404 before offline. Also OOM1 under concurrent runtimes; entire attempt invalid. Corrected to documented `visibility: 'public'` and exclusive runtime allocation.
- Attempt 2: owner permalink entered unverified offline workspace before offline actions. Explicit fixture cookie injection and CDP network-state override corrected the fixture; OOM0.
- Attempt 3: normal offline Private action succeeded; Edit selector wrongly assumed no leading icon. Grounded exact icon-aware menuitem selector corrects it; OOM0.
- Attempt 4: premature reload while save was still running; edited-text locator matched contenteditable. This does **not** establish a product defect. Source trace: PostComposer awaits local update before finishPost/onPosted closes the editor. OOM0.
- Attempt 5: speculative Lopu notification-text selector timed out although composer closed and revised body rendered; removed unsupported notification locator. OOM0.
- Attempt 6: permalink has no list-only `data-thing-id` wrapper. Removed that absent wrapper; wait for Save and editor paragraph disappearance, then rendered text. OOM0.
- Attempt 7: all final assertions pass. OOM0.

All attempts have retained logs and cleanup evidence. Attempts 3–6 retain their executed hashes. Final `execution-hashes.json` records source, executed bundle and archive hashes. Trailing whitespace was normalized in text logs only before final artifact hashing; JSON, PNG, test and executed bundle bytes were unchanged. `artifact-hashes.json` covers retained evidence except itself.
