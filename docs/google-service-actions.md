# Google service actions

Named authorizations keep consent and Thingtime operation permission separate.
Under Connections → Named auth connections, choose the service, select the
specific read operation, finish normal Google consent, then select that saved
connection under “Use a saved connection”. Existing authorizations do not gain
new operations automatically: reconnect the same external identity and explicitly
allow the operation. Removing one authorization preserves its siblings.

The client requires selected-origin `api.connections` 2.2.0 and `api.connections-named` 1.1.0 and compatible
`api.connections-oauth-begin` / `api.connections-oauth-callback` 2.2.0 before
starting the expanded flow. Both capability manifests derive these versions
from the canonical endpoint registry in `apiDocs.ts`.

| Operation | Provider | Required scope suffix | Input |
| --- | --- | --- | --- |
| `drive.list-files` | `google-drive` | `drive.metadata.readonly` | Optional page token |
| `gmail.list-messages` | `google-gmail` | `gmail.readonly` | Optional page token |
| `calendar.list-calendars` | `google-calendar` | `calendar.readonly` | Optional page token |
| `docs.get-document` | `google-docs` | `documents.readonly` | Document ID |
| `sheets.get-spreadsheet` | `google-sheets` | `spreadsheets.readonly` | Spreadsheet ID |
| `contacts.list-contacts` | `google-contacts` | `contacts.readonly` | Optional page token |

Scope prefixes are `https://www.googleapis.com/auth/`. Scope selection alone
does not authorize an operation. Each request checks the owning user, selected
origin/environment, exact named credential, operation, and provider-confirmed
scope. Refresh uses only that credential. A second authorization check discards
results if the grant was removed or reconnected during the upstream read.

POST `/api/v1/connections/named` takes `expectedOwnerId`, `id`, `operation`, and
optional `resourceId` or `pageToken`. Resource IDs contain only letters, digits,
underscores and hyphens; they are not URLs. Pagination tokens are opaque strings,
encoded once into the fixed provider endpoint. No arbitrary host, method, query
shape or header is accepted. The editable action template exposes resource-ID
inputs and a next-page button only when appropriate. Results replace the previous
page; they are not silently concatenated or truncated.

Successful Google service JSON preserves all returned fields, strings, records
and continuation tokens, without an application byte or total-page ceiling.
Drive requests all metadata fields, Docs includes tabs, and Sheets includes grid
data. Contacts uses an explicit supported person-field mask; Gmail list returns
message/thread IDs, not message bodies. Calendar lists calendars, not events.
Provider page sizes control each call and do not cap the total accessible data.
Runtime memory, provider quotas/access and deployment transport limits still apply.
Authentication transport fields and exact access/refresh/ID-token values are redacted,
including echoed property names. Generic user-data properties named password, secret or token are preserved unless they contain an actual known credential. Provider errors remain sanitized and bounded;
user-supplied feed URLs retain their existing body protections. Results and next
page tokens stay in transient component state and clear on selection changes.

Google references: [Drive list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list),
[Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[People connections](https://developers.google.com/people/api/rest/v1/people.connections/list),
[Docs get](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get),
[Sheets get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get),
[Calendar list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list).

## Delivery evidence

Task branch: `codex/google-service-actions-current`; isolated worktree:
`/Users/lopu/.codex-2/worktrees/google-service-actions-current/thingtime`.
Fresh fetched base: `origin/main` at `0d8cf373344434d8341882db9a681ded3807c81e`.
Implementation ports surviving behavior from PR #1252 without merging its older
branch or replacing current named-grant/native contracts.

Synthetic tests establish request validation, scope/owner/origin admission,
independent same-subject credentials, result redaction/completeness, opaque
pagination, and reconnect races. They do not establish real Google consent,
API enablement, data access or production acceptance. Parent task owns those
checks and private lifecycle reporting; the legacy reporting-binding adoption
gap remains, so this worker does not create duplicate workspace records.


Focused Connections/component/capability batch: 261 passing, zero skips. After
rendered fixes, the updated named-service and block-upgrade suites passed eight
tests, including rejection after a refresh loses scope. The isolated real
Connections UI fixture passed at 1440×900 and 390×844, exercising Docs resource
inputs, exact Drive continuation requests, result clearing, saved Builder edits,
page scrolling and long-scope/result overflow. Synthetic screenshots and fixture
records are in `/tmp/thingtime-google-service-actions-ui`; no provider credentials
or real-account data were used. Changed-source ESLint passed.

The source tree has changed since the carried Graphify snapshot. Hook-triggered
refresh did not produce an updated snapshot; its writer PID had exited. A heavy
fresh extraction is deferred on the overloaded host. Structural/semantic freshness
is not claimed; the parent coordinates the final shared refresh and real provider
acceptance independently.


Compatibility: current clients explicitly request `includeServiceOperations=1`
with `includeNamed=1` after negotiating Connections 2.2.0. Older named clients
receive only original identity/profile/email operation IDs, avoiding crashes in
their exhaustive label maps. This is a read projection; stored grant permissions
and exact-action authorization remain unchanged.
