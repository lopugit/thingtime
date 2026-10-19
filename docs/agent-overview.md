# Agent overview read adapter

The committed feature is reusable framework and API code for reading an
authorized work graph. It does not ship a dashboard page, component, schema, or
Action definition. Create those as ordinary saved Things in Thingtime; the
adapter supplies data, while the saved page controls presentation and writes.
Keep the authored page and its Thing IDs in the intended private account. Do
not commit account-specific page or schema Things as application source.

Clients negotiate `api.agent-overview` **2.0.0** at the selected origin before
using the adapter. This is a breaking contract from the earlier preview. The
saved-page authoring client also negotiates `api.things` 1.37.0,
`api.things-update` 1.11.0, and `api.webpages-resolve` 1.7.0 for live-source
persistence and rendering. A 1.36.0 Things origin supports file-sync records
but does not promise the live-source addition.
The
caller supplies schema names or IDs for task and any available project, agent,
question, progress, and todo records using `taskSchema`, `projectSchema`,
`agentSchema`, `questionSchema`, `progressSchema`, and `todoSchema`. A task
schema is required. Optional role schemas can be omitted. The adapter queries
the selected schemas through canonical Things search and returns a public
allowlisted projection; schema references never grant access to records.

The GET endpoint accepts `view`, `q`, `status`, `projectId`, `taskId`, `cursor`
and optional comma-separated `activeStatuses`, `blockedStatuses`, and
`completeStatuses`. The default classifications are `active,in-progress,running`,
`blocked,needs-attention,waiting-approval,waiting-question`, and
`complete,completed,done`. Supplying an empty classification list disables
that group. The classification values are part of the cursor context; start a
new scan when schemas, filters, view, or classifications change.

The adapter supports hierarchy, projects, agents, kanban, reports, and
questions views. It returns raw status values and numeric hierarchy `depth`; display
labels, indentation, titles and other layout belong to the saved Thing page.
There are no generated fallback titles or CSS-ready indent fields. Rows without
a title stay untitled. Cursor pages contain up to 50 rows, with `nextCursor`
when more remain; this processing size is not a record cap. Hierarchy traversal
preserves detached records and cycles. Complete scans can identify orphans;
partial scans mark unresolved parents. `coverage.complete` and
`coverage.countsLabel` distinguish full authorized results from lower-bound
partial counts. Source pages are individually consistent, not a database-wide
snapshot.

The response includes measured values only when they are valid and present in
the source Things. Missing progress, token usage, and timestamps remain
`null`; a missing token aggregate is `null`, never zero. Runtime can be
calculated from actual reported start/end times only. The API does not infer
usage from status or elapsed wall time and does not capture ChatGPT/Codex
messages, tool calls, process state, billing or agent runtime.

## Saved Things and reporting

Author the page and its reusable components, schema references, and any
write Actions in Thingtime's Builder as saved Things. Use the normal ACL-checked
Thing APIs and write controls. Keep task records relational: link a subtask to
its parent with `parentId`, and associate project, task and agent Things with
their corresponding IDs. Store todos, questions and progress reports as
separate Things linked to the task using `parentId`; answer a question by
updating its question Thing. Record a milestone and final report explicitly.

For optional classification, configure the page's `activeStatuses`,
`blockedStatuses`, and `completeStatuses` to match its own status vocabulary.
Keep titles, status labels, and CSS layout in the saved page. Do not treat the
API response as a rendered dashboard or a task-control interface.

Progress percentages, token counts, and start/end times are agent-supplied
measurements. Record them only when measured and attributable; omit values that
are unknown. Never put credentials, tokens, private page contents or other
secrets in Things. Follow the existing Character and private-subspace
coordination rules for task identity and authorized audience; the work-graph
API does not bypass account, Character, ACL, app namespace, scoped-token, or
database-selection restrictions.

## Live reads and recovery

Append `stream=1` for server-sent events. The stream emits an initial
`snapshot`, later changed snapshots or `heartbeat` events, and explicit
`forbidden`/`error` events. It revalidates the actor and selected data plane
before each read. On revocation or account/database change, stop presenting the
old snapshot as current. On a transient error or disconnect, open a new
authorized read and reconcile from its current snapshot; missed events are not
replayed. A request without `stream=1` returns one snapshot. Responses are
private/no-store.

## Developer acceptance

The regression harness uses **`AGENT_OVERVIEW_AUTHORED_THINGS`**, an external
JSON fixture that identifies the locally authored page and its required schema,
component, Action and sample data Things. Keep this fixture outside the repo;
do not seed or commit the authored Thing definitions. Use disposable local
identities and data only. Verify fixture references, origin and current schema
contract before running the saved page. Production account credentials and
production Things do not belong in this test.

On 2026-10-19 the isolated acceptance runner created six Schema Things, sixteen
Action Things and two Webpage Things through the normal Things API from an
external authored file. It verified the 2.0.0 adapter, streaming writes without
reload, saved Actions, all four views, desktop/mobile layouts, ticking/stopped
runtime, separately editable heading/control/icon/repeated-card blocks,
reconnect and revocation. Production verification remains a separate release
step. Future acceptance must compare a
rendered row and measured value with source Things, check supported views,
filters, classifications, cursor paging, unknown values, partial coverage,
orphan/cycle cases, stream update/reconnect/revocation, and independently edit,
save and reload nested blocks in the actual Builder. Inspect desktop and mobile
top-to-bottom, including expanded saved-page controls. See
[the manual checklist](../TESTING.md#agent-overview-and-task-reporting).
