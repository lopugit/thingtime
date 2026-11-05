# Instruction recovery and model-routing follow-up

This continues pushed checkpoint `7f4803f9a8eb000806e56d08d60abbf172785656`.
Its [Web CI run](https://github.com/lopugit/thingtime/actions/runs/40283025198)
passed API tests and failed the assertion that recording model selection remained
inline. The updated contract retains model priority and verifies use of the
resolved model; a mocked real-SDK test checks that instruction validation and
the request agree before provider contact. No live provider is contacted.

- Backup inventory/recovery: **58 passed, zero skipped/failed**. [Log](checks/backup-linear.log).
- Instruction sync/transfer: **14 passed, zero skipped/failed**. [Log](checks/sync-transfer.log).
- Recording provider: **9 passed, zero skipped/failed**; model-routing contract
  and focused lint also pass.
- Sanitized client, template synchronization and Nitro server rebuild: passed
  from the follow-up source. Build log remains task-local at
  `/tmp/thingtime-instructions-final-rebuild.log`.

Recovery resolves a generation through one shared verified inventory traversal,
rather than reopening the full manifest for each part. Requested IDs use batches
of 64, and each selected payload is read once. Metadata memory scales
with actual instruction inventory; decoded content scales with the selected
generation and is released as the complete editable result is assembled.
Inflated declared counts do not cause proportional allocations. Exact owner,
generation, ordinal, byte fingerprint and digest-chain checks remain enforced.
Fixtures cover multiple inventory pages, hashed-ID ordering, a fragmented row,
chunk mutation after metadata verification and foreign-owner refusal before I/O.

The fresh sanitized client/Nitro package includes the 15-second newer-edit
scheduling correction. Its [native run](instructions/capacity-paste-result.json)
passed offline save/cold reload, lost-reply reconciliation and both explicit
conflict choices, then failed the unchanged five-second paste gate: all 12,002
lines were preserved in **6,665 ms**. The renderer metrics attributed 6.687 s to
tasks, 0.625 s to layout and 0.0425 s to script. This points to native editing
work, but does not establish a product fix or remove the performance requirement.
The previous 9,114 ms failure remains separate historical evidence.

[Boundary checks](instructions/network-proof.json) denied browser and backend
outbound traffic, including direct IPs and redirects. [Resource checks](instructions/resources.json)
show no OOM; [cleanup](instructions/cleanup.json) found no owned runtime remaining.
Follow-up harness instrumentation will record paste/input/frame timing and long
tasks without instruction text or changing the acceptance threshold; that added
instrumentation has not yet been exercised by a native run. Desktop unified MCP connectivity, larger enabled inference and
the wider local-first matrix remain open. No merge, manual deployment, real
account mutation or public publication was performed.

The progress plan retains 87 items (61 completed checkpoints, 14 partial and
12 planned). Its final static browser check is indexed in
[plan verification](plan-links/verification.json): desktop, 390px and 320px,
full traversal, search/filter states and no horizontal document overflow.
This verifies the plan UI only, not completion of the features it tracks.

The link audit found 118 unique missing temporary targets. Current canonical JSON,
viewport/card PNGs and render diagnostics now link to the retained unified MCP
artifacts; importer evidence links to its explicit 25 October run. Other missing
historical targets are readable unavailable labels, not broken download links.
[Repair inventory](checks/plan-link-repair.json) and
[remaining local-link validation](checks/plan-links.json) preserve the boundary.
