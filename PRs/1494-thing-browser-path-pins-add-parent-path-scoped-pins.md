# PR 1494 — Thing browser parent-path pins

Date: 2026-11-13  
PR: https://github.com/lopugit/thingtime/pull/1494  
Base: `main`  
Initial published source: `fdbd80cd`; subsequent fixes and this note remain subject
to the final PR-head checks.

## Behavior

Thing browser items expose the standard **Pin / Unpin** context action. Item and
background menus expose **Reorder pins**, with pointer/touch dragging, keyboard
movement and move buttons. Pins retain one mixed order across Things and owned
devices, independently of normal kind grouping and sorting.

Placement is a personal preference scoped to the owning account, origin,
selected data plane, stable page and complete ordered parent path. Things,
Builder and cloud-files surfaces retain independent placements. Pinning does
not modify the source Thing, its parent, content, ownership or audience.
Grid/list/columns share the order, and filtered reordering preserves hidden pin
slots. Optimistic updates preserve usable content while saves reconcile.

Each pin is a private relational Thing; a billed scope header retains a random
revision and append sequence. The API uses canonical storage admission and
transactions, revision CAS, current target authorization and paginated reads.
Concurrent stale writes receive 409. Unpin refunds its row while retaining the
scope header, preventing an empty-set revision reset. The origin-scoped contract
is `api.things-pins` 1.0.0, negotiated before dependent client operations.

Owned archived dedicated content uses the canonical minimal archive card:
generic label, kinds and timestamps, without source bodies, participants or
media bindings. Active protected content and foreign-owner archive cards remain
unavailable. Devices and archived dedicated metadata are home-plane only.
Filesystem ancestry and pin requests follow the selected plane; listing caches
and mounted state are separated by account and plane.

## Recorded verification

- Full lint: zero errors; 456 existing warnings. Raw TypeScript and the ratchet:
  zero errors.
- Things tests: 402 passed. Focused pin route/protected cases: 10 passed;
  UI/helper cases: nine passed.
- Built server manifest: the selected isolated origin returned
  `api.things-pins` 1.0.0.
- Real isolated API receipts verify 66 persisted pins across two GET pages,
  same-revision concurrency (one success, one 409), independent accounts/paths,
  ACL revoke/regrant, invalid-cursor recovery and header/row storage accounting.
- Protected-target receipts verify active-owner and foreign-archive refusal,
  safe owned archived-card pin/read, and omission after restore.
- Completed isolated browser receipts verify reload persistence; mixed ordinary
  Things ordering; select-all including pins; grid/list/columns, grouping and
  sorting; filtered hidden-slot preservation; fresh StrictMode hydration;
  independent parent paths; exact target hydration; cloud-files reorder/reload
  and mobile list; independent Things/Builder placement; background-menu mode;
  keyboard, pointer and mobile touch reorder; and desktop/mobile opened-menu
  scrolling without overflow. Signed synthetic device pairing, mixed device/Thing
  ordering, reload, unpin and final mobile full-column bounds also pass.
  These receipts contain no page errors.

Evidence: `/tmp/thing-pins-acceptance/{api,manifest,accounting,protected}-receipt.json`,
`upstream-ui-receipt.json`, `remainder-ui-receipt.json`,
`device-ui-receipt.json`, and task-owned screenshots.
These are local isolated acceptance results, not production acceptance.

## Remaining acceptance at note creation

The final browser pass is still checking independent account behavior.
Earlier retained receipts identify the completed cases; screenshots alone are
not recorded passes.
Positive live custom-plane acceptance was unavailable; selected-plane routing
and fences were reviewed, without switching a real account's database.
Final PR-head checks, preview/deployed behavior and production acceptance remain
to be recorded by the task owner. No production success is claimed here.
