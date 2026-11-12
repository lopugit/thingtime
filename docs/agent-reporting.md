# Private task reporting through MCP

The reporting gateway connects an authorized account to its existing saved
Agent overview workspace. It creates a distinct, switch-only Character for a
stable external task identity. It never issues a general Character session or
returns credentials. Dashboard pages, Components, schemas and write Actions
remain ordinary private saved Things; the gateway does not ship replacements.

## Authorization and setup

Negotiate the selected origin's `api.agent-reporting` 1.0.0,
`api.auth-characters` 1.0.0 and `api.agent-overview` 2.0.0. The MCP client checks
these contracts afresh on each reporting call and refuses a wrong-origin or
incompatible manifest. A failed check can be retried after the origin is fixed.

Reporting requires the independent `agents.report` PAT permission. Existing
`things` or `things.read` grants do not include it and are never upgraded
silently. In the current host, list accounts and verify the connected profile.
Call `login_thingtime` with the exact `accountId` and
`requiredScopes: ["agents.report"]`, or call a reporting tool with the exact
account ID. For the same Thingtime origin, an account missing the permission
returns an `insufficient_scope` tool challenge. The host opens its registered
OAuth flow; authorize **Private agent reporting** for the verified signed-in
Thingtime account. Additional Things access is optional and explicit. Cancel
leaves the existing grant unchanged and creates no reporting credential.
Reopening the same scoped OAuth attempt after approval or cancellation is
refused during its replay retention window; start a fresh host authorization.

OAuth approval can return a new named account ID in the host. Previous grants
are not changed or copied to that connection. After approval, list accounts and
verify the owner, origin and live `agents.report` scope with
`get_thingtime_profile`. Use that exact account ID before resuming any reporting
write. The stable reporting identity stays bound to its owner, origin and
`externalTaskId`; a new named account ID for the same owner and origin does not
require a new task. Keep credentials within the host's connection. Existing
grants that already explicitly included the reporting PAT permission still work.

The upgrade contract requires `api.chatgpt-mcp` 2.2.0,
`api.chatgpt-oauth-authorize` 1.3.0 and `api.chatgpt-oauth-token` 1.1.0, or
compatible versions at the exact host origin. For a host that does not act on
the challenge, use its supported OAuth connection controls and the existing
Advanced connection settings permission selector; verify the resulting profile
before doing any reporting.

The permission delegates only the closed private reporting workflow. Public-only
and creation-only sandbox tokens cannot use it. The account must own the exact
saved workspace references and administer the existing private coordination
subspace. The feature refuses a custom data plane. Character disablement,
membership removal, credential revocation and removal of a saved reference's
access are checked again on later work.

## MCP workflow

1. Call `prepare_thingtime_agent_task` with the connected account, a stable
   `externalTaskId`, display name, and `workspace`. The workspace identifies its
   `pages.overview` and `pages.taskDetail`, six schema roles (`project`, `task`,
   `agent`, `todo`, `progress`, `question`), and named saved Actions. Supply the
   existing subspace ID or slug when known. Discovery without one requires a
   unique authorized private **Thingtime Agents** result.
   For a delegate, pass the parent's stable `parentExternalTaskId`. The server
   verifies the same owner, origin and workspace, reuses its project, and derives
   the actual parent and shared root task links. It grants the child's distinct
   Character read access only to those parent roots; the child cannot mutate
   them. Prepare the parent's project and task before preparing a child.
2. Reuse the returned binding and Character. Preparation adds only the required
   private Character read grants to the supplied saved references and membership
   in the selected private subspace. It preserves the saved definitions and does
   not restore revoked membership.
3. Use `report_thingtime_agent_task` for the configured lifecycle Actions. Create
   the project, task and agent records before their related progress, todo and
   question records. Use actual parent/task IDs and measured values only.
4. Call `get_thingtime_agent_task` for independent record readback. Use exact
   `recordIds` to read relational progress, todo or question records. Repeated
   preparation with the same identity and references reuses the binding.
5. Use `coordinate_thingtime_agent_task` with a stable request ID, title, text
   and explicit saved or embedded `renderComponent`. It creates one post as the
   task Character in the bound private subspace, then updates that same post.
   Read it back through `coordinationPost` and `binding.coordinationPostId`.

Coordination uses the existing private-subspace audience rules. The gateway
never changes subspace visibility and refuses further work if it is no longer
private. An owner deliberately changing visibility later retains the normal
product behavior; reporting does not add a separate visibility lock. A
private-only reporting token can read this exact bound post through reporting
even though its base audience is `tt:all` within the private subspace. This
does not grant access through the general Things API.

Each report requires a UUID-v4 `requestId`. Retrying an uncertain response must
reuse both that ID and the immutable inputs. A different payload with the same
ID is rejected. Completed receipts return their existing result; pending or
ambiguous effects are never blindly replayed. Task operations are serialized.

Saved Actions run through the canonical executor with a trusted operation
policy. Their resolved writes are limited to the bound Character's private
workspace records and configured schema roles. The policy refuses arbitrary
HTTP, credential lookups, nested Action escalation, deletion, foreign targets
and reparenting. The existing HTTP-based `readOverview` Action is not executed
by this write gateway; use the reporting readback tool or the independently
authorized overview read adapter.

## Failure and recovery

Missing capability, permission, private reference, membership and Character
liveness are distinct failures. Do not substitute owner posting, public records,
new schemas or a different origin. Complete independent task work while the
specific dependency is unavailable.

Readback exposes safe operation state when a request was interrupted. A failure
proved to precede any data mutation releases its task lock; an ambiguous write
retains its receipt and lock. Do not change its request ID to retry or directly
delete protected records.

With compatible `api.agent-reporting` 1.1.0 or later, a coordination receipt can
reconcile a saved post after text moderation releases it. Inspect `activeOperation`
and retry the original `coordinate_thingtime_agent_task` arguments, including the
same request ID, title, text and renderer. The server does not create or update
the post on this retry. It checks the saved post's exact Character, normalized
content and private subspace projection, confirms authorized reads and anonymous
refusal, and releases the task lock only when the binding and receipt are complete.
A still-pending, blocked, changed, or unverifiable post leaves the operation
unresolved. Readback still reports the active operation even if moderation
temporarily makes a previously bound post unreadable. An interrupted update
without a saved write confirmation stays pending even if the previous post
has the same content. Older initial creates lack that confirmation; only the
deterministic first post created at or after the receipt can qualify, while
the task still holds that request's lock and has no bound post. Saved Action
mutations do not use this coordination recovery path.

## Verification

Run `test:chatgpt`, `test:agent-reporting`, `test:characters`, `test:pat-scopes`
and `test:api-capabilities` from `remix`. The HTTP acceptance runner is
`node remix/scripts/agent-reporting-acceptance.mjs --scoped-reconnect` after a
Node-server build. It verifies actual reporting through the upgraded MCP grant
using synthetic workspace Things created through the API. To test the broader
reporting lifecycle, omit `--scoped-reconnect` and supply
`AGENT_REPORTING_AUTHORED_THINGS` as an external synthetic saved-workspace
fixture. It uses a disposable replica set, synthetic accounts, normal API
fixture writes and a real OAuth/MCP exchange; no production credential or
personal browser profile belongs in this test.

Local acceptance is separate from the actual connected ChatGPT/Codex path.
After deployment and host tool discovery refresh, verify the selected origin,
the existing private saved workspace, distinct Character, lifecycle record
readback and reuse on a subsequent MCP call. A missing authorization upgrade or
host tool refresh is a remaining acceptance dependency, not a successful run.
