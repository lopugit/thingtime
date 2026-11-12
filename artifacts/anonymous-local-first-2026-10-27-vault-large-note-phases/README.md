# Bounded large-note diagnostic — 27 October 2026

One isolated rerun passed normal no-login vault creation, entry editing, save,
close, cold offline reload, unlock and exact readback of 2,800,039 JavaScript
string code units, including Unicode and exact whitespace. It used the same
built app as suite retry9; only diagnostic phase markers changed.

`large-note/result.json` reports success with no page errors.
`phase-history.jsonl` retains timestamped before/after markers through exact
readback; `memory-samples.jsonl` records cgroup and process observations.
The actual browser's sandbox was verified. The browser and real backend retained
the task-owned network-none, read-only, no-mount/no-published-port boundary and
unchanged 4 GiB / one-CPU limits. All OOM counters remained zero. Cleanup left no
task runtime. The shared proxy, key and VM settings were unchanged.

This is a successful current mechanism run, not a proven fix or explanation for
the [earlier OOM](../anonymous-local-first-2026-10-27-vault-memory/README.md).
The earlier sample peak was below its cgroup limit and did not identify a kernel
victim or failing UI action. This run does not isolate that cause. It contains
no attachment, account/provider transport or full responsive UI matrix; the
[66 MiB and mobile checks](../anonymous-local-first-2026-10-27-vault-clearance-r3/README.md)
are a separate fixture. No general capacity or performance guarantee follows.
