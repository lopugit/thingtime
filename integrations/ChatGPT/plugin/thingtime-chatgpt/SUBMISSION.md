# Thingtime plugin submission handoff

This package is ready to be scanned as an MCP-backed plugin once its server is
deployed at the final production origin. Do not submit a Vercel preview: OpenAI
pins the MCP origin after review, so the submitted URL must be the stable
production URL.

## ChatGPT workspace deployment

This is the supported way to test and distribute the connector within a
ChatGPT Business or Enterprise/Edu workspace. It is separate from a public
Plugins Directory submission.

1. An admin/owner enables Developer Mode from Workspace Settings → Apps →
   Create (Enterprise/Edu may grant developer access by RBAC).
2. Create a custom MCP app with the remote HTTPS MCP URL, select OAuth, and
   choose **Scan Tools**. Complete the first-party authorization form and
   verify that `offline_access` is requested so the rotating refresh grant is
   issued.
3. Create the draft, then test it from the tools menu or with an @mention in a
   new web chat. Verify a read, a confirmed write, a refresh, and a final
   disconnect using the cases below.
4. An admin/owner reviews the write-action safety warnings and publishes the
   draft from Workspace Settings → Apps. Enterprise/Edu may constrain actions
   and access before publication.

Custom MCP apps are web-only. Full write/modify support is currently a
Business/Enterprise/Edu beta; Pro can use only read/fetch MCP connections.
ChatGPT freezes scanned tool definitions at approval. Enterprise/Edu admins
must refresh and enable future server tool changes before they are available;
Business workspaces currently must recreate and republish an app to change
tools or metadata.

## Codex Desktop smoke test

Install the package locally, restart Codex Desktop, and add/authenticate the
bundled Thingtime streamable-HTTP server in **Settings → MCP servers**. Codex
uses a callback-specific ChatGPT Client ID Metadata Document and a bounded
`127.0.0.1` loopback callback. Confirm the authorization page accepts the
matching callback, shows the encrypted multi-account form, and that Codex
discovers all thirteen tools before entering a least-privilege reviewer PAT.
This validates the shared local Codex-host configuration; it does not enable
custom MCP apps in ChatGPT iOS chats.

## Required owner-provided materials

- An OpenAI Platform organization with **Apps Management** write access.
- A ChatGPT Business or Enterprise/Edu workspace, with an admin/owner who can
  create, test, and publish the custom MCP app.
- A verified Thingtime developer or business identity in that organization.
- Public, publisher-matching website, support, privacy-policy, and terms URLs.
- A production MCP URL at
  `https://thingtime.com/api/v1/integrations/chatgpt/mcp`, or the final stable
  Thingtime production origin if it differs.
- A reviewer-only Thingtime account and least-privilege PAT that can complete
  the first-party authorization form without MFA, email confirmation, or
  private-network access. Never commit or paste those credentials into this
  repository.
- Country/region availability and the final release notes.

## MCP metadata justification

All thirteen tools require the `thingtime` OAuth bridge scope and are scoped to
one selected Thingtime connection. The server does not proxy arbitrary URLs.

- **Read-only:** account listing, profile lookup, list, and search only
  retrieve data.
- **Private mutable:** selecting a default account and saving a Thing change
  only the connected account or its private library; neither is irreversible
  or open-world.
- **Irreversible:** disconnecting an account revokes its bridge session;
  updates can overwrite content; deletes remove Things; comments and shares
  can publish content that cannot be reliably recalled. These tools advertise
  `destructiveHint: true`.
- **Potentially public:** create, update, delete, comment, react, and share
  can affect public Thingtime content, so they advertise `openWorldHint: true`.
  Every write-tool description tells ChatGPT to obtain the user's confirmation
  first.

## Reviewer test cases

Positive cases:

1. Connect two named accounts at allowed Thingtime origins; verify only labels,
   endpoint origins, and opaque account IDs return from `list_thingtime_accounts`.
2. Select the second account and verify future reads use it without exposing a
   PAT.
3. Search a known Thing and verify the selected account is returned with a
   minimal, relevant result.
4. Create a private draft after explicit confirmation, then update it after a
   second explicit confirmation.
5. Add a comment or share a test post after confirmation and verify the action
   card reflects the write-oriented metadata.
6. Request `thingtime offline_access`, exchange the returned refresh token
   once, then confirm the replacement token works and the original does not.

Negative cases:

1. Invoke a protected tool before OAuth; expect a 401 plus the
   `mcp/www_authenticate` resource-metadata challenge.
2. Supply an endpoint outside `THINGTIME_CHATGPT_ALLOWED_ENDPOINTS`; expect
   the authorization form to reject it without storing a credential.
3. Supply a revoked, expired, or scope-insufficient PAT; expect first-party
   validation to fail without returning the token.
4. After the final account is removed, retry both a previously issued bridge
   token and refresh token; expect neither to recover the connection.

## Submission sequence

1. Deploy the reviewed server to its fixed production origin and smoke its
   protected-resource, authorization-server, capability-manifest, `tools/list`,
   unauthorized `tools/call`, and first-party authorization form responses.
2. Open the OpenAI Platform plugin submission portal, create a **With MCP**
   draft, enter the production URL, configure OAuth, verify the domain when
   prompted, and select **Scan Tools**.
3. Check the discovered schemas, OAuth security schemes, titles, output
   schemas, and annotations against the justifications above. Add the listing,
   legal links, starter prompts, region availability, test cases, credentials,
   and release notes.
4. Submit for review. Publish from the portal only after OpenAI approval.

OpenAI currently documents custom MCP apps as web-only. A public submission
can make the plugin discoverable in the universal Plugins Directory, but it
does not override that MCP mobile-surface limitation.
