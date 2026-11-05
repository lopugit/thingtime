# Agent credential and authentication workflows

Use the existing authenticated account when it is sufficient. When credentials
are needed, select the intended account, service, origin, environment and task
before taking action. Permission to act and an authenticated connection are
separate prerequisites. Secrets belong in their approved vault, never in chat,
Builder Things, task notes, screenshots, traces, shell arguments or logs.

## Choose the destination

| Need | Supported destination and flow |
| --- | --- |
| Thingtime-owned provider client secret, API key or server configuration | Admin → External integrations → Import provider credentials; direct file/paste import or the agent handoff below |
| A person's website username/password, TOTP or custom credential fields | Their `/passwords` vault; normal entry/import UI and supported AutoFill |
| Reusable third-party OAuth permissions | `/connections`; choose the service and requested access, create a named authorization, finish provider consent and verify the saved connection |
| A passkey for another website | That website's Add passkey flow, selecting the installed Thingtime provider; verify registration and a subsequent sign-in |
| Lopu's AI access | Saved provider connection or the supported ChatGPT-plan runtime flow; select the account in Lopu settings/chat, then verify a real request |

These destinations are not interchangeable. An OAuth application client secret
does not sign a person in, an API key does not become a ChatGPT subscription,
and a saved session cookie is not a supported OAuth connection. Use provider
permissions as granted; do not scrape browser profiles or extract passkey keys.

## Direct provider import

1. Verify the signed-in **administrator** and the selected Thingtime origin.
   Open `/admin/external-integrations`. The receiving API must advertise
   `api.credentials-import` **1.0.0** or a compatible 1.x version at that same
   origin's `/.well-known/thingtime-capabilities.json`.
2. In **Import provider credentials**, select the format. File selection is
   primary; masked paste is available when the source has a supported Copy
   operation. Keep the value in that direct transfer; do not reveal it to a
   model, terminal or progress record.
3. Set the deployment environment and review the destination metadata. A new
   label creates a new secret. Replacing an existing label requires its exact
   current ID and update revision. Reload metadata after a conflict; never
   overwrite a newer value by retrying a stale revision.
4. Save and verify the returned credential ID/revision and metadata after
   reload. Then exercise the consuming provider flow. A saved receipt proves
   encrypted storage, not that the provider accepts the credential.

**Google web OAuth JSON:** download the `client_secret…json` for a **Web
application** client. The importer accepts Google's `web` wrapper, checks the
selected callback against `redirect_uris`, and saves to
`connections-google-oauth`. The callback is the selected origin plus
`/api/v1/connections/oauth/callback`. An installed-client or service-account
file is a different credential and is refused. The write preserves the
existing bundle's other environments and origins. Google Mail's
`google-mail-oauth` bundle is separate and is not configured by this adapter.

**Other providers:** text and JSON imports save to an explicit admin-vault
label. Use the consuming integration's documented label and structure. JSON
import validates JSON; it does not infer every provider's schema or call an
arbitrary endpoint to test it. A provider-specific adapter must validate its
format and preserve existing configuration before it can claim that support.
See the Connections setup in [README](../README.md) for provider registration.

There is no invented file-size or character quota in this UI. JSON parsing,
memory, the deployed ingress and MongoDB's document format still impose real
resource/protocol constraints. A rejection is explicit; the importer never
truncates a credential. Credential files are not general attachments and are
not persisted in a public upload store or editable layout.

## Agent file handoff: macOS, Linux and Windows

The Node helper sends a selected local file directly to the receiving API.
The model receives status and safe destination metadata only. Use Node 22+
and this checkout's canonical dependencies (`npm run worktree-setup`). A
cloud agent can use the same protocol when it has the selected file and the
user's authorized browser can reach the **same** receiving origin.

```sh
npm --prefix remix run credentials:import -- \
  --origin https://thingtime.example \
  --account <expected-admin-account-id> \
  --environment production \
  --format google-oauth \
  --file <selected-downloaded-client.json>
```

For a provider API key, use `--format text --label <integration-secret-label>`;
for its documented JSON bundle, use `--format json`. Existing labels require
both `--replace-id <credential-id>` and
`--replace-updated-at <current-ISO-revision>`. These are metadata, not secrets.
`--stdin` replaces `--file` for a supported protected pipe. Do not use an
inline secret, shell substitution, a here-document containing a real secret,
or a command that prints the input. The helper intentionally has no `--value`
argument. It does not create a persistent session or grant file.

The helper prints one `approval_required` record with a non-secret verification
URL. Open that exact URL in the assigned, independently authenticated Thingtime
browser. Verify the displayed administrator, origin, environment, label, format
and create/replace revision. Click **Approve this handoff** when it matches the
authorized task; an agent may perform that ordinary click through supported
controls. Cancel mismatched or unsolicited requests. No default browser is
opened automatically, so the helper cannot silently choose another profile.

The CLI keeps a random verifier in transient process memory and sends only its
S256 challenge during initiation. It reads the file only after approval, then
sends the bytes over HTTPS (explicit loopback HTTP is allowed for isolated
tests). The server rechecks the approving session, administrator and immutable
destination before the transactional vault write. The request expires and is
one use; no general account bearer credential is returned. A configured signed
home-data gateway may carry that same original origin to its home API; ordinary
origin fallback is refused.

The browser must be in its root administrator identity. A request header cannot
override a selected Character. Switching away and back invalidates the approval;
begin a new authorized handoff after confirming the previous request did not
save. The approval page must be top-level: framing is refused by both browser
headers and the client. Pending requests expire after ten minutes; completed
receipts remain available to the same proof for one hour. Anonymous initiation
uses request and aggregate metadata-byte admission controls before persistence;
a temporary rate refusal is not a credential file-size quota. The status proof
uses a fixed 1 KiB JSON control envelope for its UUID and verifier; that bound
does not apply to credential content or user-entered labels.

Keep the CLI process running while approval completes. It polls with bounded
backoff. A lost write response is reconciled using that same request/proof;
an exact retry reuses the same bytes and never creates a second intent.
`saved` includes only the credential ID, label, environment, format and revision.
Treat `TRANSFER_UNCONFIRMED` as an uncertain outcome: inspect the vault's current
metadata and consuming connection before starting another import. Ctrl-C before
upload cancels local work; cancellation after upload starts does not roll back
a server commit. Approval can be revoked in its browser page. A stopped helper
does not retain its proof for a later process; do not reconstruct it from logs.

## Saved passwords, first sign-in and AutoFill

- Prefer the current authenticated browser/app. For a required password, match
  the entry's account and exact destination origin, including nondefault ports.
  Use supported AutoFill or scoped delivery. A redacted tool observation is not
  permission to bypass the tool's controls or scrape protected storage.
- Cross-device use of an authorized credential source is allowed when the task
  authorizes it: deliver directly to the verified destination through a supported
  interface, keep it transient, and verify the resulting account. A missing
  vault session on the destination does not itself require the user to type.
  Never copy whole browser sessions or profiles between devices.
- The password editor's **Copy password** is a supported user-facing operation.
  Use it only when a permitted direct clipboard-to-destination path exists;
  never run a clipboard-read tool that echoes a real secret into the transcript.
  Do not claim an autofill succeeded just because Copy was clicked.
- Linux/Windows desktop builds may expose the private `native.passwords` 1.0.0
  CLI. Follow [the exact native contract](native-password-agent.md): discover
  installed paths, negotiate, verify status, authorize the exact task/target,
  catalog, generate/save or select an entry, open its isolated browser, fill,
  then release. That bridge needs `api.passwords` 1.7.0 and an OS-encrypted
  connected vault. It does not bootstrap a signed-out guest or provide arbitrary
  native-app typing. macOS uses the signed Apple provider and optional Chromium
  extension, not that Linux/Windows socket contract.
- For a new persistent account, generate **and confirm storage** in an authorized
  vault before registering it. A disposable isolated test identity is different
  from a real account that will own tokens, subscriptions or user data.
- Complete the normal login action and independently read the resulting profile
  or account page. Form fill alone is not a successful authenticated session.

## OAuth, multiple grants, passkeys and TOTP

Use `/connections` to create each account or authorization separately, including
multiple authorizations for the same provider account with different selected
access. Preserve each label, account, granted scopes and token lifecycle. Finish
the exact callback and verify the requesting Thingtime client sees the connected
account. Test a permitted action, refresh/reload, reconnect and independent
removal as appropriate. Do not silently broaden scopes or substitute another
provider account to make a test pass.

For another site's passkeys, select Thingtime in its normal provider chooser.
The site's RP ID, requesting origin and selected entry must match. Preserve
provider/device verification and explicit user presence; an existing
"never ask again" preference is effective only when the server's current
policy accepts it for that session and request. Follow
[password-manager.md](password-manager.md) for registration/assertion and
native/extension differences. A QR handoff is not a portable private key.
Authenticator `otpauth` QR codes can supply a TOTP secret; passkey handoff QR
codes use their supported device ceremony. Never extract passkey private keys.

For TOTP, use the selected vault entry's current code through a supported
fill/copy-to-destination operation. Avoid screenshots of setup QR codes or
codes; verify the provider's success state. Device unlock, Touch ID, hardware
keys, CAPTCHA and some consent challenges can still require the person. Report
the exact observed dependency once, complete independent work and resume after
it changes; do not repeatedly probe or weaken it.

## Recovery and evidence

Inspect fresh state after a timeout before repeating a write. Follow the shared
bounded browser recovery budget and preserve assigned profiles, tabs, sessions
and unrelated data. A tool failure is not proof of an application defect. Never
switch interfaces to evade an explicit tool prohibition.

Record only account/credential IDs when non-sensitive, the intended origin,
environment, operation status and verification result. Distinguish source tests,
synthetic browser transport, deployed capability, installed native acceptance
and a real provider action. No one layer proves the others. Close task-owned
tabs and release only the task's own browser claims when finished.

## Implementation and checks

- Shared contract: `remix/app/credentials/importContract.ts`.
- API family: `/api/v1/credentials/import/{start,status,inspect,approve,revoke,upload,direct}`.
- Approval: `/credentials/import?requestId=…`; direct UI: admin external integrations.
- CLI: `remix/scripts/credential-import.ts`; it does not take session tokens.
- Run `test:credentials-import`, `test:credentials-import:browser`, the real
  `test:credentials-import:acceptance` after a canonical build, API capability
  coverage, lint and TypeScript gates. The real acceptance uses an isolated
  replica set and synthetic credentials; it never uses the production database.

The web/Node transfer contract is portable. That is not evidence of an installed
native provider, extension, OS clipboard or live third-party consent flow on
every operating system. Record those platform/provider checks separately.
