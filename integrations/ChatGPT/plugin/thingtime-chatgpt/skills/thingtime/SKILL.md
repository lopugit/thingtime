---
name: thingtime
description: Use connected Thingtime accounts safely through the Thingtime MCP tools.
---

# Thingtime

Use the Thingtime MCP tools only for accounts the user has connected. Start a
new task by listing accounts when the requested account is ambiguous, then
select the requested account explicitly.

Treat `@Thingtime login` as an explicit request to call `login_thingtime` in
the current task. When no connection exists, the tool's
`mcp/www_authenticate` result asks the invoking ChatGPT/Codex host to open its
native OAuth browser, complete PKCE through the host's registered callback,
store the resulting credentials, and attach them to later requests in this
same task. After authentication, call `login_thingtime` again or call
`list_thingtime_accounts` to verify the connection. Do not start a separate
CLI listener, rewrite an OAuth URL, or move the flow to another browser/task.

Only in an actual standalone Codex CLI session whose host cannot surface the
tool-level OAuth handoff may you use `node scripts/desktop-oauth-login.mjs` as
a compatibility fallback. For an actual remote CLI session with no native
OAuth surface, `node scripts/mobile-oauth-login.mjs` may return its short-lived
tappable link and optional QR image. Keep that helper running through its
PKCE-bound callback. Never use either CLI helper as the authentication
mechanism for a ChatGPT or Codex desktop task, and never ask the user to paste
a token, authorization code, URL, or credential into chat.

Treat `@Thingtime list accounts` as an explicit request to call
`list_thingtime_accounts` and return only its safe account metadata.

Never ask the user to paste a Thingtime personal access token into chat. The
first-party connection page uses Thingtime SSO and defaults to a generated
read/write-all Things token; Advanced settings are the only place to narrow or
regenerate its scopes. A connected client’s revocable bridge credentials do
not expire by default; tell the user to reconnect only if a connection is
revoked or an account is missing.
Never expose token values, authorization codes, bridge credentials, or refresh
credentials in a response.

For authorized provider provisioning, use the Thingtime checkout's
`docs/agent-credential-workflows.md`. From that checkout run
`npm --silent --prefix remix run credentials:import -- --preflight --origin <origin> --format <format>`
before opening the credential source. Use `google-oauth` for a Google web
client export and `oauth-client` for a scoped Meta Connections client update.
The root administrator reviews the exact destination and revision in the
assigned Thingtime browser. Provider bytes go directly from an authorized
file or protected pipe to the encrypted vault. Connected Things permissions
do not grant vault access. Keep secrets out of MCP arguments and saved Things.

Private agent task lifecycle reporting has dedicated tools:
`prepare_thingtime_agent_task`, `get_thingtime_agent_task`, and
`report_thingtime_agent_task`. Select the exact connected account and preserve
its HTTPS origin. These tools require the independent `agents.report` grant;
`things` alone does not grant it. When absent, explain the one-time Advanced
connection authorization and reconnect requirement. Never silently expand
permissions or read credentials. Use the host's supported authorization flow
for an authorized permission change; never substitute the owner's public identity.

For a task with standing authorization for private lifecycle reporting, use
these tools without repeated routine confirmation. Prepare once using a stable
chat/task identity; reuse the returned distinct Character and task IDs after
resuming. Report only actual progress, verification, blockers, artifacts and
measured values. Keep secrets and private source content out of summaries. A
failed capability, membership or saved workspace check means reporting remains
unavailable; continue independent authorized work and state the precise gap.
This exception applies only to the bounded private lifecycle tools.

Read/search actions may proceed when the user asks. For direct mutations,
call `get_thingtime_confirmation_requirements` for the selected account and
follow its current Thingtime settings. If required, state the intended account,
target, and effect and obtain clear confirmation before passing
`confirmed: true`. Omit `confirmed` when the account does not require it.
Treat `confirmation_required` as a request for approval and never fabricate
it. The user can adjust Thingtime's prompts under Settings → Connections →
Thingtime connector confirmations; the AI app's own approval, permission, and
credential rules still apply.

For more than one exact ID, use `get_thingtime_things`; preserve its ordered
per-ID found/not-found results. Discover and validate schemas before creating
typed data. Use `list_thingtime_related` for target, parent, folder, backlink,
or bounded thread traversal, and `list_thingtime_changes` for resumable polling
(it is not a deletion change stream).

For composed mutations, workflows, and undo, always obtain a fresh signed
preview first. Inspect the complete plan, following preview pages when needed,
and apply only its exact receipt. If `confirmationRequired` is true, obtain
explicit approval for that account and plan and pass `confirmed: true`. If it
is false, omit `confirmed`. Apply rechecks current settings and preconditions:
rebuild a stale preview and never skip account, revision, or scope checks.
Capability Things may only compose the published mutation grammar — never
invent URLs, API paths, database queries, operator objects, or executable code.

When the user or task supplies an exact Thing ID, always call
`get_thingtime_thing`. Never rely on `list_thingtime_things`, a recent page, or
`search_thingtime_things` to locate a known ID. Use list/search only for
discovery when the exact ID is unknown. When a Thing or comment ID is already
known and its attached comments are needed, call `list_thingtime_comments` with
that `targetId`; do not fetch a global Things page and discard unrelated rows.

If a tool lacks an independent OAuth scope, first call `login_thingtime` with
the exact selected `accountId` and `requiredScopes`, such as `["agents.report"]`.
Use the invoking host's supported OAuth prompt for explicit permission and
verify the same owner and origin plus the live scope on the new account ID
before retrying any write. Use Advanced connection settings only as a supported
host fallback. Removing the final
account revokes every bridge and refresh credential in that ChatGPT connection.
Do not suggest an unrestricted account-session credential.

`coordinate_thingtime_agent_task` maintains one stable task post in the bound
private Thingtime Agents subspace under the task Character. Supply a stable
UUID-v4 `requestId`, `title`, `text`, and explicit `renderComponent` object.
Keep content editable and reuse the existing post after restarts; verify its
readback. This bounded operation uses standing private coordination authorization
and retains the same scope, capability, membership and privacy checks.

Coordination uses the existing private-subspace audience rules. It never changes
the subspace visibility. If its owner deliberately changes that visibility,
the ordinary product sharing rules apply and further reporting is refused.
A successful coordinate receipt includes the stable `coordinationPostId`; use
`get_thingtime_agent_task` to read the saved post back independently.

Before delegation, prepare the child with its own stable `externalTaskId` and
`parentExternalTaskId` set to the existing parent's stable task identity. The
parent must already have a prepared live binding, project and task in the same
owner, origin and exact saved workspace. The server derives `parentTaskId`,
`sharedTaskId` and the inherited project, and grants the child's distinct
Character read access only to the exact parent roots. Child records retain
their own task parent while sharing the root task; the child cannot update
parent roots. Preserve returned IDs and pass them to the delegate. Never invent
parent IDs or silently create a replacement project.
