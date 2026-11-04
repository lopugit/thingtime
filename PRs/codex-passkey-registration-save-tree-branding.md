# Passkey registration recovery and official tree branding

A site's excluded saved passkey now ends the current native/browser registration
with an explicit Return to website action. It preserves working keys and returns
the bound platform error rather than offering a futile retry or automatic
fallback. Network failures remain retryable; stale failures cannot terminate a
replacement request. Native registration details expose request lengths and
shared-policy counts without credential IDs, handles or keys.

Password manager, provider, guides/settings and extension surfaces use the
existing official tree. Editable migrations retain authored headings/styles/IDs
and deletions; legacy default provider controls gain terminal-state guards.
Extension 0.2.1 carries manifest/action PNGs; native 1.0.7/build 8 carries ICNS/PNG
resources in both host and extension. Google/website-controlled passkey artwork
is independent. The current iOS target does not consume PasswordProvider.

## Verification

- Extension 48, password 113, Electron 350 tests pass; raw TypeScript and ratchet
  report zero errors. Full lint results are recorded in release evidence.
- Swift 38 tests, two existing opt-in skips, no failures; isolated native build
  and resource verification pass. Actual owned native preview covers expanded
  long-site/large-count terminal state at 340x560 and 300x380.
- Disposable replica real API tests preserve two independent encrypted vault
  records, retry/readback and cross-account boundaries. This is distinct from a
  site's discoverable-credential policy.
- Isolated Chrome renders all extension tabs, editable document gallery and
  actual vault tool fixtures at desktop/narrow sizes. The actual provider
  component/ceremony/content/background/action path with synthetic in-memory API
  responses proves excluded create has no approval/refresh/fallback/password
  input and explicit Return preserves both request-ID hops and requester focus.
- Native bundle icon readback matches official resources. This is not acceptance
  of the final installed OS picker. Real site/user-presence acceptance follows
  the signed installed release; no personal browser or stored credential is used
  by these fixtures.

## Graph coverage

Final source-staged structural Graphify snapshot, manifest and portable HTML are
validated before publication. Semantic extraction remains unavailable after
repeated hollow responses from the configured local proxy earlier in this task;
changed Markdown/images are not claimed to be semantically indexed.
