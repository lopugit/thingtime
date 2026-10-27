# Connections and password tools web/backend release

Based on `origin/main` at `0658a78b035c95716d8a95ca223e124e9e78dd44`, selectively
integrated from PR #1240 `fd43dafd8da4f0d85e5322b254790e6e7f3c0e08`.
Branch: `codex/oauth-web-release`.

## Scope and boundaries

Retains Connections 2 account-library/OAuth routes, encrypted owner-bound v1/v2
vault compatibility and Lopu credentials, editable service/password blocks,
request redaction/client guards, capability docs/runtime registration, and
fail-closed environment-gateway contracts. Old client provider/fields/id request
shapes remain supported; current server session selects ownership. New clients
add expected-owner fencing. Older clients cannot acquire that new stale-intent
fence automatically, so switch/reload and provider ceremonies remain acceptance
requirements.

No Apple, Electron, iOS or macOS files change. The desktop-loopback apiFallback
adapter stays on main. Native setup source regression is deferred whole; the
native-build source assertion remains with its implementation in PR #1240.
The public ES256 fixture/verifier, cleanup/timeout tests and canonical password
suite gate stay here against the unchanged main Swift core. Old password bridge
1.x remains supported with conservative unknown status; absent setup bridge
remains unavailable without unsafe persistence/URL fallback.

## Exact working-tree checks

- Connections: 171 passing, including new real HTTP handler legacy-client
  shape/authentication tests, encrypted account isolation/migration/rotation,
  failure/replacement/redaction and owner-switch fences.
- Passwords: 119 passing plus positive real macOS Swift public ceremony output
  independently verified by JavaScript (ES256 registration/assertion, UV,
  synchronized backup and wrong-RP rejection). No native provider/Keychain access.
- Capability/gateway/request/Builder/schema contracts: 247 passing, including
  unchanged base desktop apiFallback tests. Test boundary denies external network;
  only loopback allowed where a real local HTTP server is required.
- Canonical Vercel build passed with all local dotenv files temporarily excluded,
  a clean allowlisted environment and synthetic bootstrap only; external network
  denied. No real credentials or accounts used.

## Pending integration and acceptance

Parent independent review and deployed desktop/mobile real action/readback/reload,
exact-hosted-head Web/API/CodeQL/GitGuardian and deployment provenance, gateway
configuration/callback checks, Google-secret save and real Google/GitHub provider
ceremonies are pending. All native signing/install/OS indexing/physical-device
requirements remain open in PR #1240. This web slice does not complete the overall
goal. No workflow dispatch, CI admission change, deploy or merge performed here.
