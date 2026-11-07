# Thingtime provider accounts, credentials and device setup

Last reviewed: **28 October 2026**. This is a setup checklist, not a claim that every integration has passed production acceptance.

This guide covers the current Connections registry, the requested ChatGPT/Claude/Google/Facebook flows, native passwords and passkeys, and the developer services needed to ship them. You do **not** need to create every optional account now. Start with priorities 0 and 1, reuse existing Thingtime registrations, and leave optional providers disabled until needed.

## 1. The short list: what is needed from you

| Priority | Account/access | What you may need to do | What the agent can do |
| --- | --- | --- | --- |
| 0 | Your Thingtime account and installed Passwords companion | Sign in through the supported flow; complete device verification when macOS requires it | Repair the native link, configure it, verify it and test recovery |
| 0 | Existing Google Cloud project and OAuth web client | Complete a Google security challenge if required; retain project ownership and recovery access | Configure branding, APIs, callback and encrypted server-vault record |
| 0 | Existing Meta developer app | Complete any account/business verification and provider-required confirmations | Reuse the app, configure metadata, callbacks, roles and scope-specific tests |
| 0 | Existing GitHub account | Complete sensitive-operation verification or Touch ID if required | Navigate to passkey registration and test the Thingtime provider |
| 1 | OpenAI developer registration | Obtain hosted Sign in with ChatGPT approval if that deployment requires it; approve account consent | Configure the approved client and distinguish identity from plan-backed inference |
| 1 | Claude Console organization/workspace | Enable the intended API access/billing if wanted | Implement/configure the supported credential route; verify it before enabling it |
| 1 | Apple Developer team | Maintain membership, agreements, signing access and any required physical-device approval | Build/sign the native provider through approved tooling and verify installed behavior |
| 2 | Optional social/developer services below | Supply only the accounts you actually want connected | Register/configure supported apps, store credentials and run acceptance checks |

**Do not send passwords, client secrets, recovery codes or exported vaults in chat.** Account login credentials belong in Thingtime Passwords. App client secrets belong in the encrypted **server integration vault**. Per-user OAuth tokens should be created by **Add account**, not copied from browser storage.

A cloud coding chat does not automatically have access to your Mac, its signed apps, Chrome session, Keychain or Touch ID. Local setup and cloud deployment acceptance remain separate.

## 2. Keep these credential types separate

| Type | Example | Correct destination | What it authorizes |
| --- | --- | --- | --- |
| Human login | Developer-console username/password, TOTP seed | Thingtime Passwords on the device being used | Interactive access to the provider's website |
| Passkey | A new GitHub passkey created with Thingtime selected | Thingtime's native credential-provider flow | Signing a challenge for that site's relying-party ID |
| App registration | Google client ID + client secret | Admin → Integrations → Secrets | Thingtime's OAuth code exchange, for the registered client and callback |
| User OAuth grant | Access token, refresh token, scopes | Encrypted connection created by Add account | Only the APIs/scopes that account approved |
| API key | OpenAI project key, Claude workspace key | The matching supported encrypted AI/API credential store | API requests billed to that provider account |
| Deployment authority | Cloudflare scoped token, Vercel team token | Approved deployment/platform vault | Administration of the named infrastructure resources |
| Signing key | Apple certificate private key | Keychain or approved CI signing store | Code signing; never a Passwords attachment or ordinary Thing |

Thingtime's approved encryption model is **server-assisted**, with recovery and background access. It is not zero-knowledge encryption: an authorized Thingtime server can decrypt the credentials needed for those operations. Keep the existing encryption bootstrap keys stable and backed up with the database; do not regenerate them to repair a login problem.

For each saved human login, use a clear title such as `Google Cloud — Thingtime owner`, and retain the exact website, intended account, organization/project and environment. Add TOTP through its supported secret/QR setup. Store recovery material only in protected fields, and keep an independent recovery method available while testing the new provider.

## 3. Shared app registration and callback setup

Use the real Thingtime brand, support contact, home page, privacy policy, terms and account-data-deletion instructions. Check that policy pages are publicly reachable and describe the actual features. Reuse the existing logo and developer apps; do not create duplicate production projects simply because a session expired.

### Exact Connections callbacks

| Destination | Callback |
| --- | --- |
| Production | `https://thingtime.com/api/v1/connections/oauth/callback` |
| Development | `https://dev.thingtime.com/api/v1/connections/oauth/callback` |
| A specifically approved preview | `https://<exact-preview-host>/api/v1/connections/oauth/callback` |
| Disposable local test deployment | `http://localhost:<actual-web-port>/api/v1/connections/oauth/callback` |

Register only destinations you intend to operate. Use a separate test client/project where practical. A local/preview flow must not borrow production credentials or silently return to production. Some providers impose their own HTTPS/loopback rules; a callback template is not proof that a provider accepts it. `localhost` and `127.0.0.1` are different origins.

The **ChatGPT local plan flow uses its own host-registration and callback contract**. Do not paste the generic Connections callback into that flow.

### Server-vault configuration

The current resolver reads fixed labels from **Admin → Integrations → Secrets**, with an explicit environment and origin. Despite legacy source selector names such as `GOOGLE_CLIENT_ID`, provider client secrets are **not** read from provider-specific Vercel environment variables.

Example structure — placeholders only; enter real values directly into the protected vault UI:

```json
{
  "environments": {
    "production": {
      "origins": {
        "https://thingtime.com": {
          "clientId": "<registered-client-id>",
          "clientSecret": "<registered-client-secret>",
          "redirectUri": "https://thingtime.com/api/v1/connections/oauth/callback"
        }
      }
    }
  }
}
```

Use the deployment's actual `THINGTIME_DATA_ENV` identity: `production`, `development`, or the stable ID selected by `custom:<id>`. The exact origin must appear under that environment. Public ChatGPT clients explicitly use `authMethod: "none"` and `clientSecret: ""`; confidential clients use `authMethod: "client_secret_basic"` and their issued secret. Do not choose the public mode merely to avoid a missing secret.

Only irreducible database, authentication, environment-selection and vault-unlock bootstrap values belong in deployment environment variables. Preserve existing owner-vault and admin-vault keys. The separate mail integration uses `google-mail-oauth`; do not overwrite that record when configuring `connections-google-oauth`.

## 4. Google and Google Cloud — priority 0

**Access needed:** a Google account authorized to manage the existing Thingtime Cloud project and OAuth client. Google Cloud console access uses the Google account's normal security methods; it does not need a separate Cloud passkey.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in the intended project. Reuse the existing app/client where possible.
2. Confirm branding, support contact, authorized domains and intended audience. Add the two intended test accounts while the app is in Testing mode. Domain verification or Workspace administrator approval may be required.
3. Use an OAuth client of type **Web application** for the hosted connection flow. Register each exact callback above. A service-account JSON key is not a replacement for a user's OAuth grant.
4. Save the client ID and secret directly into `connections-google-oauth`. The pending Google secret in this task has **not yet been created or saved**; inspect the existing client before creating or rotating anything.
5. Enable only the APIs used by the chosen service cards, then authorize each account through Thingtime.

The server flow requests offline access for refresh tokens. A successful identity login alone does not grant mail, files or calendar access. [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server)

### Current service cards and requested scopes

These scopes come from Thingtime's current source registry; they are deliberately separate grants/features.

| Card | API to enable | Scope in addition to `openid profile email` |
| --- | --- | --- |
| Google account | Identity endpoints | None |
| Drive | Google Drive API | `https://www.googleapis.com/auth/drive.metadata.readonly` |
| Gmail | Gmail API | `https://www.googleapis.com/auth/gmail.readonly` |
| Calendar | Google Calendar API | `https://www.googleapis.com/auth/calendar.readonly` |
| Docs | Google Docs API | `https://www.googleapis.com/auth/documents.readonly` |
| Sheets | Google Sheets API | `https://www.googleapis.com/auth/spreadsheets.readonly` |
| Contacts | People API | `https://www.googleapis.com/auth/contacts.readonly` |
| YouTube account | YouTube Data API | `https://www.googleapis.com/auth/youtube.readonly` |

Drive metadata access does not authorize downloading every file or editing it. A later write/send action needs a separately implemented operation and appropriate consent.

Before broad release, review the requested scopes in Google's Data Access/Verification Center. Sensitive-scope review may need domain ownership, policy links, scope justification and a demonstration. Restricted scopes, including relevant Gmail access, can additionally require a security assessment when data passes through your server, unless an exception applies. Budget for that review before promising general availability. [Sensitive scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [restricted scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

**Acceptance:** connect two different accounts, verify the returned account identity, run one authorized read per service, test a later refresh, cancel a consent attempt, remove one account without breaking the other, then repeat after logout/login.

## 5. Facebook and Instagram — priority 0

**Access needed:** the existing Meta developer account/app, appropriate app role, and any business verification required by the selected products. Reuse the existing Thingtime app.

1. In [Meta for Developers](https://developers.facebook.com/apps/), select Thingtime. Review the logo, display name, domain, contact email, privacy/terms/deletion links and category. Prior task evidence records metadata/logo setup; verify it rather than recreating it.
2. Configure the Facebook Login use case and exact valid OAuth redirect URI. Record the App ID and App Secret in `connections-facebook-oauth`.
3. Use approved developer/tester identities for development-mode testing. Public availability must be checked independently of app-admin success.
4. Test **Facebook account** first: current source requests `public_profile`. The separate posts card requests `user_posts`; complete the permissions/access review shown by Meta before offering it publicly.
5. For Instagram, select the supported professional-account integration. Current source requests `instagram_business_basic`, and uses `connections-instagram-oauth` with the corresponding Instagram app ID/secret. It reads the connected account's own media, not an unrestricted personal home feed.

**Evidence limit:** Meta's official documentation returned HTTP 429/access refusal during this guide's review. The steps above are grounded in Thingtime's current adapters and the already-observed app dashboard. Recheck Meta's live product-specific requirements before submission. Reference destinations: [app setup](https://developers.facebook.com/docs/development/create-an-app/), [app review](https://developers.facebook.com/docs/app-review/).

## 6. ChatGPT and OpenAI — priority 1

There are three different setups. A single saved ChatGPT identity token does not make all three work.

### A. Hosted “Continue with ChatGPT” identity

Obtain an approved client registration for the actual hosted deployment. Save the issued client ID, permitted client-authentication method and any issued secret in `connections-chatgpt-oauth`. Register the exact hosted callback. Thingtime's current identity adapter validates and stores identity evidence; it does not turn the ID token into an API bearer token. Commercial client access is still selective in the documentation reviewed for this guide. [Client registration](https://developers.openai.com/siwc/request-client-id), [website flow](https://developers.openai.com/siwc/website)

### B. Eligible local/open-source ChatGPT plan use

Use Thingtime's supported **Continue with ChatGPT** host flow. The application must register its actual identity, retain the host/account-specific issued client ID, and request the appropriate inference permissions. The documented direct registration flow does not require a client secret or partner API key. This is separate from the hosted identity card and is not permission to copy another application's tokens. [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

### C. OpenAI API usage

Create or reuse a Thingtime project in the [OpenAI API platform](https://platform.openai.com/), arrange API billing, and create a project-scoped key for the intended workload. Store it in the supported encrypted OpenAI credential entry. Configure a supported model and endpoint in Lopu, then test it separately from Thingtime credits. Keep API keys server-side or in the approved native credential path. [API authentication](https://developers.openai.com/api/reference/overview)

**Acceptance:** for each supported route, select the credential explicitly, make a harmless request, verify the actual provider and accounting path, reload the chat and confirm selection persists. An unavailable custom credential must not silently spend Thingtime credits. Do not assume identity consent grants conversation-history access or inference. [Sign in with ChatGPT overview](https://developers.openai.com/siwc/quickstart)

## 7. Claude / Anthropic — priority 1

For a general third-party product, start with a [Claude Console API key](https://platform.claude.com/docs/en/get-api-key) in the intended organization/workspace and appropriate billing. Use separate development and production credentials. Store keys only in an encrypted store connected to an adapter that actually accepts that credential type.

**Current implementation gap:** this branch's existing Claude route uses the official Claude Code runtime and a Claude Code OAuth/setup token; it explicitly does not treat an Anthropic API key as interchangeable. Do not paste an API key into the Claude Code OAuth field, or assume creating a Console key completes the integration. A direct supported API adapter and acceptance check may still be required for the chosen product route.

Anthropic currently recommends API-key authentication or a supported cloud provider for third-party tools. Any subscription-based use must follow the provider's supported allowance; it may draw usage credits rather than subscription limits. There is no verified general-purpose “register a Claude SSO client and reuse all subscription access” setup in this task. Do not extract Claude browser cookies or impersonate an official client. [Current authentication guidance](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)

**Owner decision needed only if enabling spending:** choose the intended billing account and acceptable spend controls. The agent can prepare the adapter/configuration and tests before that decision becomes necessary.

## 8. GitHub developer access and passkeys — priority 0/1

GitHub website login has succeeded. That does not prove a Thingtime-held passkey was registered: the latest observed new key was saved through another provider, and Thingtime's save attempt failed inside its extension.

For account security, use GitHub's Password and authentication settings, add a passkey, choose **Thingtime**, and complete any required device verification. Afterwards, verify it is listed in GitHub and test an assertion through Thingtime. Preserve existing working keys until the new one is accepted.

**Current Connections limitation:** the `github` provider in this branch is a public-activity feed (`auth: none`). It does not yet provide private-repository OAuth access. No client secret is required for that public feed.

For future private repository/actions access, prefer a **GitHub App** with selected-repository permissions where appropriate. Record its app/client IDs, installation IDs and approved permissions; keep its signing key in an approved secret store. A user OAuth App is a distinct integration and requires its own callback and client secret. Creating either app does not make the current public-feed adapter support it. [GitHub app choices and registration](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)

Existing repository/CI access should use its already-authorized connection. Do not create an all-repository personal token merely to avoid a passkey prompt.

## 9. Apple: native passwords, TOTP and passkeys — priority 1

**Developer access:** retain the existing Apple Developer team, host and extension identifiers, provisioning profiles, stable signing identity and shared Keychain access group. iOS distribution also needs the applicable App Store Connect access and a real-device/TestFlight acceptance path. Reuse the project's signing workflow; do not export private signing keys into this guide or the password vault.

**Device setup after the fix is installed:**

1. Open the installed Thingtime Passwords companion.
2. Sign in to the intended Thingtime origin/account inside its supported connection flow.
3. Choose **Connect Password AutoFill** and verify that it confirms the selected account. This explicit standalone connection is being added by the current fix; it is not yet accepted on the installed build.
4. In macOS/iOS Passwords/AutoFill settings, enable Thingtime as a credential provider. The exact settings label varies by OS version.
5. On a service's security page, choose Add passkey and select Thingtime from the system provider picker. Complete Touch ID/device verification when requested.
6. Test a subsequent login/assertion, not just the save confirmation.

Password-manager extensions supply credentials through the operating system's selection flow. Login to the main Thingtime app and connection of the credential extension are separate states that must be verified. [Apple credential-provider security](https://support.apple.com/en-gb/guide/security/sec6319ac7b9/web)

**QR distinction:** an authenticator setup QR can carry a TOTP seed. A passkey QR commonly starts a cross-device authentication handoff; it is not a portable private key to import from a screenshot. Register a new passkey with Thingtime selected as the provider. Upload/scan support for TOTP does not establish cross-device passkey-handoff support. [WebAuthn specification](https://www.w3.org/TR/webauthn-3/)

Device presence cannot be supplied by an unattended coding agent. Supported API/OAuth tokens can reduce repeat interactive sign-ins for authorized background work, but do not remove a provider's reauthentication requirements.

## 10. Other providers already represented in Connections

These are optional. The scopes below describe the current source, not a promise that every provider has approved the app or that the deployed adapter is accepted. Each OAuth family uses its own `connections-<family>-oauth` server-vault record and the exact Connections callback.

| Provider | Account and registration | Credential / current scope | Setup and acceptance notes |
| --- | --- | --- | --- |
| TikTok | Developer account and app, preferably owned by the intended organization | `connections-tiktok-oauth`; client key/secret; `user.info.basic video.list` | Configure Login Kit and required products, callback, sandbox/testers, URL ownership and review. [Official setup](https://developers.tiktok.com/docs/en/getting-started-create-an-app) |
| Spotify | Developer dashboard app | `connections-spotify-oauth`; client ID/secret; `user-read-recently-played user-follow-read` | Register accepted redirects, test allowed users and current development-mode restrictions, then request wider access if needed. [Official setup](https://developer.spotify.com/documentation/web-api/tutorials/getting-started) |
| Twitch | Verified Twitch account with 2FA and a registered developer application | `connections-twitch-oauth`; client ID/secret; `user:read:follows` | Register callback/category, test user grant and refresh. [Official setup](https://dev.twitch.tv/docs/authentication/register-app/) |
| X | Developer account/app with the required API access | `connections-x-oauth`; OAuth 2 client ID/secret; `tweet.read users.read offline.access` | Enable OAuth 2, register callback and verify the required endpoint access/billing. An app-only bearer token is not a user's grant. [OAuth guide](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) |
| Pinterest | Verified business account and approved developer app | `connections-pinterest-oauth`; app ID/secret; `pins:read` | Obtain trial access, register exact redirect and verify access tier before public use. [Official setup](https://developers.pinterest.com/docs/getting-started/connect-app/) |
| LinkedIn | Developer app with the intended products approved | `connections-linkedin-oauth`; client ID/secret; `openid profile` | Configure redirect and product permissions. Identity scopes are not general feed or messaging access. [OAuth guide](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow) |
| Mastodon | Account and app registration on the intended instance | `connections-mastodon-oauth`; client ID/secret; `read` | The current adapter has one configured `MASTODON_INSTANCE`; arbitrary per-account instances need additional implementation. [Client registration](https://docs.joinmastodon.org/client/token/) |
| Reddit | Approved Data API access appropriate to the use case | `connections-reddit-oauth`; client ID/secret; `identity read` | Current official guidance restricts new legacy Data API registration; do not assume an existing feed adapter guarantees approval. Check eligibility before creating a client. [Official access guidance](https://www.reddit.com/r/reddit.com/wiki/api/) |
| Tumblr | Intended account and registered application | `connections-tumblr-oauth`; client ID/secret; `basic offline_access` | Verify OAuth 2 availability, callback and refresh against the current portal. Official docs could not be fetched in this review (HTTP 406); source support is not live acceptance. [Developer reference](https://www.tumblr.com/docs/en/api/v2) |
| Bluesky | Intended Bluesky account | App password through the current credential-connect form | Current adapter exchanges the app password for an encrypted session; it is not a registered generic OAuth client. Use the account's supported app-password controls and test revocation. Do not supply the main account password. |

Public RSS, Hacker News, public Reddit/Mastodon/Lemmy/Bluesky profiles, public GitHub activity and public YouTube-channel feeds do not require a user OAuth app in the current registry. They still depend on upstream availability and policy. An optional YouTube API key is separate from account OAuth.

## 11. Mapbox, Cloudflare and deployment access

### Mapbox — optional maps integration

Create/reuse a Mapbox account only if a Mapbox-backed feature is chosen. Start with a distinct public map token, restricted to intended URLs and required public scopes. Keep any upload/administrative secret token server-side and separate. Store project/environment information with the credential. Current trial-account rules can restrict creating additional tokens until a payment method is added; do not enable billing automatically. [Mapbox token management](https://docs.mapbox.com/accounts/guides/tokens/)

There is no Mapbox OAuth family in this branch's Connections registry. Treat this as a future API-token adapter, not an already-working Add account card.

### Cloudflare — developer infrastructure

Use the existing Cloudflare account with access to the intended Thingtime zone. For automation, prefer a scoped API token limited to the needed account/zone and operations, such as DNS editing only when DNS changes are required. Retain account/zone IDs and the token's purpose/expiry. Avoid a global API key. [Create a Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

A Cloudflare dashboard passkey is an account-login credential; an API token authorizes API operations. Neither automatically configures the other. Creating a future user-facing Cloudflare connection requires a separate adapter and capability registration.

### Vercel and GitHub Actions — release infrastructure

Reuse the existing Thingtime team/project and GitHub integration. Supply authorized team/project access through the approved platform vault only if existing access is missing. Preserve the established GitHub-built deployment flow; do not enable redundant Vercel source builds. No new secret is needed simply to inspect public previews.

The current feature work is tracked in [PR #1240](https://github.com/lopugit/thingtime/pull/1240). A passing preview is distinct from production deployment. Production promotion requires the repository-specific approval and the normal checks.

## 12. Useful later additions

After Google and the priority providers pass acceptance, Microsoft 365/OneDrive, Slack and Notion are useful next candidates for work data. Treat these as **future integrations**: each needs its official app registration, scopes, callback contract, user consent, encrypted storage and real API adapter. Do not create privileged credentials for unused integrations now. No generic saved browser session can substitute for that work.

## 13. Shared acceptance checklist

For each enabled provider:

- [ ] Correct owning account, app/project, environment and exact callback confirmed.
- [ ] Client secret saved in the appropriate encrypted server-vault record, with no value in notes/logs/source.
- [ ] Public capability negotiation passes on the exact selected origin.
- [ ] Catalog shows the intended provider ready; readiness alone is not acceptance.
- [ ] Two independent user accounts connect where supported; identity and scope are correct for each.
- [ ] A real authorized operation returns an expected result, checked against the provider's own UI.
- [ ] Refresh/reconnect, cancellation, refusal and expired sessions behave correctly.
- [ ] Removing one account leaves the other usable; another Thingtime user cannot use either grant.
- [ ] Selected credential/model persists per chat; custom-auth failure does not silently switch billing.
- [ ] Native password/TOTP/passkey paths are tested on the signed installed Mac app and physical iOS device where promised.
- [ ] Background work is explicitly authorized and works without exposing credentials.
- [ ] Production deployment and exact provider acceptance are recorded separately from local tests and preview CI.

## 14. Current task status and handoff boundaries

- GitHub website login succeeded. Thingtime passkey registration/assertion is still pending acceptance.
- The latest native fix adds an explicit standalone AutoFill connection, separates connection errors, and preserves the same pending passkey across retries. It must still pass final signed-install/live testing. The installed main app invokes its own bundled Passwords helper; updating the standalone companion alone cannot protect its session from that older helper. Rebuild and verify the affected main app with the updated nested helper, preserve the current production setup, and test both installed copies together before declaring this repaired.
- Google client-secret creation/storage and live two-account acceptance remain open.
- Hosted ChatGPT approval and Claude route eligibility must be verified for the intended deployment; no approval is inferred from possessing a token.
- The local chat owns Mac/device acceptance and the provider guide. The related cloud chat has been notified of the consolidated PR to avoid duplicate work.
- This guide contains instructions and public placeholders only. Provider secrets, account passwords and passkey material must never be added here.

Implementation references: `remix/app/api/utils/connections/oauthConfig.ts`, `remix/app/api/utils/connections/providers.ts`, `remix/app/connections/catalog.ts`, `remix/app/api/utils/connections/chatgptIdentity.ts`, and the native Passwords targets. Recheck the deployed version before treating source behavior as live behavior.
