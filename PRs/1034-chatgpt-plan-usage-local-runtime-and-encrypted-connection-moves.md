# Portable ChatGPT plan connections and Electron local runtime

## Behavior

Thingtime can explicitly enable a local Electron account API backed by an app-owned authenticated MongoDB replica set, or a configured remote database. Existing installations retain their endpoint selection until the user opts in. Local accounts are independent of cloud accounts. Generated signing/database/vault secrets use OS credential protection; ChatGPT records use encrypted Mongo storage.

The public dynamic-registration OAuth flow uses loopback, PKCE and verified OIDC identity. Lopu uses discovered account models, streaming Responses and existing tool permissions. Both explicit and saved plan selections fail closed instead of switching to API billing. Disconnect/move abort active inference and subsequent tool work.

A destination generates an expiring, account/origin/session-bound recipient code. The source seals one connection to the destination public key, durably disables source use and returns only ciphertext. Retriable receipts recover interrupted delivery; imports retain the receiving runtime host identity and enforce one refresh authority. A remote self-hosted GUI can manage and use imported connections; initial consent stays local. Generic content-database switching never relocates credentials.

Desktop API changes apply on restart with endpoint-specific browser sessions. Shared connection controls remain accessible from session recovery, so a fresh or offline installation can enable its local backend without a cloud sign-in. The proxy pins the negotiated target, rejects changes during requests, strips forwarded-origin metadata for private operations and propagates streaming/cancellation.

## Scope and acceptance

- MongoDB installation is optional: discover/select an existing Community executable, with an official download link when absent. No automatic binary downloader, Homebrew mutation or system service installation is included.
- Persistent self-hosted runtimes and encrypted database storage are supported; ephemeral serverless execution and automatic cloud-to-desktop job relay are not implemented.
- Public OpenAI docs explicitly describe self-hosted remote VMs. The implementation does not claim partner status or approval for every hosted service.
- Real OpenAI consent, live model discovery and plan inference remain to be verified on the intended installed runtime. Fixture/browser/unit results alone do not establish those outcomes.

## Verification

Client/server builds, focused suites, desktop/mobile fixtures, and a real isolated Electron local API/Mongo restart passed. Actual installed-app consent remains pending; final results and live acceptance status are recorded in the PR delivery. Coverage includes protocol/session/transfer ownership, Mongo authority fencing, API negotiation, streaming tool loops, desktop managed Mongo lifecycle and endpoint isolation. Client/server builds, changed-file lint and TypeScript baseline comparison apply. Built Nitro/Vite network isolation checks block direct-IP and redirected egress before synthetic testing.

The final documentation semantic-index refresh returned incomplete output and was rejected by Graphify’s integrity guard. A structural refresh retains the last complete semantic graph; the latest documentation edits are not claimed as semantically indexed.

## Public contracts

`api.capabilities` 1.2.0; `api.ai-chatgpt-plan` 1.1.0; `api.ai-models` 1.7.0; `api.lopu-chats-reply` 1.20.0. Setup and key ownership are documented in README and acceptance cases in TESTING.

## References

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions


## 2026-10-18 bundled database and session continuity

macOS packaging now includes checksum-pinned MongoDB Community 8.0.34, upstream source, SSPL license and notices. Fresh profiles select the included server; existing database executable choices and data stay intact. It remains an opt-in loopback child process, not a system daemon, and requires macOS14 for this bundled version. New builds require and execute-check it after signature verification; old-release recovery and macOS13 updates validate present signed resources without executing the optional database or enforcing the new pin.

Explicit legacy session recovery binds the verified original API and exact historical loopback content origin, reopens the whole defaultSession in place, and preserves the newer partition independently. One shared transition guard prevents backend/configuration changes racing recovery. A bounded window visibility fallback handles renderer failure/slow first paint. Responsive recovery controls passed 1280/375 viewport checks with full scrolling, cancellation, errors, recovery/switch-back and disabled states. Real Electron storage continuity in a nested network sandbox was blocked by Chromium sandbox initialization, so this is not claimed as installed user-session acceptance.

The signed combined699e02e build started its local API and authenticated MongoDB successfully, but its window remained hidden after restart. The fixes above are pending the next installed acceptance. Real ChatGPT consent/model discovery/inference remains unverified; PR1034 is not merged. IntegrationPR1035 also includes the scoped Linux native runtime repair from268858367 (separate browserPR1033), preserving the final combined installation.
