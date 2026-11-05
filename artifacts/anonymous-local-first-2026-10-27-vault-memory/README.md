# Password memory diagnosis — 27 October 2026

These two fresh-browser trials isolate file upload from the large note. They are diagnostic evidence, not complete PasswordManager UI acceptance. Both used source `9f24113dd883b450e9d3086753b6cfd027d175a8`, a freshly sanitized application package, the same network-none/sandbox boundary, 4 GiB and one CPU. No product code changed and no failed trial was automatically retried.

## Small note plus 66 MiB attachment

The normal file picker dispatched its change event, encrypted frames reached native IndexedDB, and the UI displayed the completed attachment. The test then stopped on a fixture selector defect: both the editor and another control had the accessible name **Close**. Cold reload/readback was not reached.

There was **no OOM**. Cgroup peak was **2,513,661,952 bytes** (about 2.34 GiB). The largest observed Chrome process was PID 643 at 514,244 KiB RSS. The source file was written in 1 MiB chunks; the test did not retain a 66 MiB Node Buffer. This does not reproduce an upload-only OOM, but it also does not establish full file acceptance.

## Large Unicode note alone

The normal large-note fill and Save action returned. While processing this flow, Chrome PID **641** (parent 563) rose from 418,596 to **947,004 KiB RSS**. At the first sample showing an OOM-kill counter increment, that PID's RSS had fallen to zero. It is a strong victim candidate; no kernel victim record or exit signal was captured, so the exact killed process remains unconfirmed. The subsequent Close action timed out; exact cold readback was not reached.

Cgroup peak was **2,966,077,440 bytes** (about 2.76 GiB), below the configured 4 GiB limit. `memory.events` showed `max 0`, `oom 0`, and `oom_kill 1`. This is consistent with an OOM triggered outside this cgroup, such as parent/VM-wide pressure. It does **not** prove this task exhausted its own memory limit or that the product has a 66 MiB capacity defect. Parent/VM pressure was not measured.

## Measurement and remaining uncertainty

A separate ordinary-code observer sampled cgroup current/peak/events, selected memory categories, and PID/PPID/command-name/RSS every 500 ms. No process arguments, environment, credentials or application content were read. The observer had a 480-second deadline and stopped with each trial. Fast phases can occur between samples; phase labels therefore do not give exact incremental allocation. The large-note trial had a seven-second sampling gap around the kill, consistent with pressure but insufficient to recover the precise peak process state.

The production upload implementation streams individual 1 MiB encrypted frames and awaits each IDB write. No explicit accumulation of all frames was found in the earlier source review. Rendering, browser file transport, IndexedDB internals and VM pressure remain possible contributors; no cause is established. The prior combined large-note/file OOM must remain unresolved.

`summary.json` contains phase/process aggregates and source/package/helper hashes. Each scenario retains raw bounded `memory-samples.jsonl`, result, resource, network, boundary and cleanup receipts. The executed test and observer are copied here for reproducibility. Full concise runner stdout remains in ignored temporary logs. Both cleanup receipts report no remaining owned runtime.
