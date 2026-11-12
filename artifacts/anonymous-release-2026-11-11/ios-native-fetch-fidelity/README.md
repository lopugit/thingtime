# iOS global Fetch fidelity: passed

11 November 2026. `verification.json` records genuine global Fetch on arm64
iOS Simulator27.0 (SDK27.0), Mobile24.22.1-0, Node24.22.1 and Undici7.30.1.
The exact canonical Nitro SHA39be8cf1b16f9eb99455cd337adb26e32829521d2643de72addc4169cb0dbfde
was imported unchanged. Fetch returned HTTP200 JSON from its actual capability
route, matching the selected origin and registering367features/729operations.
No `node:http` client fallback was used for acceptance.

## Corrected diagnosis

The prior `Unsupported instruction: 0xFD` came from a **harness environment
sanitization bug**. The pinned Node Mobile bootstrap already sets
`UNDICI_NO_WASM_SIMD=1` when installing its polywasm implementation. Undici's
SIMD parser otherwise passes construction and fails during lazy execution.
Our probe deleted that required, non-secret runtime default. The fix preserves
exactly that setting and requires its pre-sanitization value to be `1`.
The native receipt independently observed that initial value and the polyfill
implementation. There was no runtime/framework patch, parser substitution,
Fetch replacement, JIT enablement, protection change or fake response.

Primary pinned source:
- [Mobile bootstrap](https://github.com/fogtape/nodejs-mobile/blob/b5bcc8d8e70f055333cd5efc317e3eb55bf0c9a5/lib/internal/process/pre_execution.js)
- [Bundled Undici parser selection](https://github.com/fogtape/nodejs-mobile/blob/b5bcc8d8e70f055333cd5efc317e3eb55bf0c9a5/deps/undici/src/lib/dispatcher/client-h1.js)
- [Polywasm provenance](https://github.com/fogtape/nodejs-mobile/blob/b5bcc8d8e70f055333cd5efc317e3eb55bf0c9a5/deps/polywasm/README.md)

`upstream-source-pins.json` records exact source hashes and release/tag
identities. Polywasm0.2.0's npm tarball/index hashes were independently verified;
the vendored file matches its single documented CommonJS export rewrite.
Source-to-binary reproducibility remains unproven. The original failed receipts
remain unchanged in `../ios-native-api-startup/` and establish what the broken
sanitizer did, not an unresolved runtime defect.

## Representative behavior and boundaries

A repeated real Nitro manifest Fetch passed. A separate synthetic, read-only
HTTP fixture verified exact chunked binary/UTF8 bytes, automatic gzip decoding,
redirect follow/manual/refusal, and AbortSignal cancellation. This fixture was
used only for transport behavior; the capability response came from genuine
Nitro. Both HTTP servers closed, the simulator was deleted, and the reserved
non-listening database fence passed before/after. No data writes, real backend,
credentials, production services or user devices were used.

The pinned bundle still advertises Things1.63/search1.7; this does not verify
later merged1.64/1.8 contracts. Authenticated/database-backed routes, persistent
storage, TLS/remote-provider acceptance, WebView/device integration and release
signing remain separate. Node sqlite exposed DatabaseSync without opening a DB.
Final JS syntax, exact executed template/entry byte checks and artifact/source
hash validation passed. Tooling changes are limited to the probe and its README.
