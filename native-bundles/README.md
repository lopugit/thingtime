# Native web bundle release contract

This foundation describes, signs and verifies complete renderer/local Nitro
payloads. It does not publish an API, fetch URLs, install a native shell, supply
production trust keys, or establish installed updater acceptance. Native shell
updates and changes to the Node runtime/native ABI remain separately distributed.

`release.cjs` implements the version 1 JSON contract; `inventory.cjs` verifies
complete payload directories. Node/server consumers share these modules. A Swift
consumer must implement the same contract and cryptographic checks before use;
these JavaScript modules do not provide an iOS Node runtime.

## Descriptor and trust

A signed envelope has exactly `format`, `keyId`, `releaseId`, `descriptor` and
`signature`. The descriptor has exactly:

- `version`: a complete SemVer release version; `channel`: a selected channel;
  `sequence`: a positive safe integer, monotonically assigned by the publisher.
- `target`: exact `platform` (`darwin`, `win32`, `linux` or `ios`) and `arch`
  (`arm64` or `x64`). Device/simulator and runtime distinctions belong in the
  exact runtime ID. There is no implicit cross-target compatibility.
- `runtime`: exact `id` and `nativeAbi`, plus inclusive `minShellVersion` and
  `maxShellVersion`. Shell versions use complete SemVer, including prerelease and optional build
  metadata. Numeric prerelease identifiers cannot have leading zeroes. Precedence
  compares numeric identifiers numerically, sorts numeric identifiers below
  nonnumeric identifiers, and ignores build metadata. Prereleases are preserved
  and are lower than the corresponding stable version.
- `entrypoints`: a relative `renderer` path and optional relative `server` path.
- `files`: the complete, nonempty, lexically path-sorted inventory of regular
  files, each with exact `path`, integer `bytes` and lowercase SHA-256 `sha256`.

Unknown fields, path traversal, absolute/encoded paths, backslashes, device
names, case-folding collisions, symbolic links, special files and recognized
private state (`.env*`, credential directories, local databases and signing
keys) fail closed. No environment file is a bundle input. Empty directories
carry no executable content and are not included in the inventory.

Canonical JSON recursively sorts object keys, preserves array order and emits
compact JSON without whitespace. Strings use JSON escaping; only safe integers
are accepted as numbers. Contract identifiers/paths use ASCII. `releaseId` is
SHA-256 of the UTF-8 canonical descriptor. The Ed25519 signature covers UTF-8:

```
thingtime.native-web-bundle.v1\n
```

immediately followed by canonical JSON containing exactly `format`, `keyId`,
`releaseId` and `descriptor`. The displayed `\n` denotes one LF byte. Signatures
are standard padded Base64, exactly 64 decoded bytes. The signature does not
include itself. `canonical` is exported for independent test-vector comparison.

The shipped native shell supplies `trustedKeys`: entries with `keyId`, an
Ed25519 `publicKeyPem`, and explicit `channels`, `platforms` and `runtimes` lists.
Downloaded descriptors cannot add keys or widen those lists. A verifier requires
all three scopes and a valid signature. Production trust provisioning and key
rotation must use the native distribution's supported signing/release process.

`verifyEnvelope(envelope, {trustedKeys, host})` returns a separately cloned
validated descriptor. `host` contains exactly `platform`, `arch`, `runtimeId`,
`nativeAbi`, `shellVersion`, `channel` and persisted `minimumSequence`.
`verifyDirectory(root, descriptor)` verifies every byte and rejects missing or
extra files. Retained rollback to a previously confirmed release needs the
host's explicit recovery policy; it must not lower the persisted update floor.
The host must own and serialize its cache and protect it from concurrent writers
throughout verification, copying and activation. Verification is not a filesystem
lock, and the trust policy must remain outside payloads and mutable cache state.

## Actual build and packaging

The Electron `build:web` path packages actual `node_middleware` output into
`electron/dist/web`, including `.output/public` and `.output/server`. It records
`metadata.json.nativeBundle` from the installed Electron executable's runtime
identity, rather than the build driver's Node version. Shell version uses the
trimmed `THINGTIME_ELECTRON_RELEASE_VERSION` override when nonempty, matching
production/unsigned packager metadata, and otherwise the package version. It
preserves prerelease/build metadata rather than stripping version distinctions. A sibling
`electron/dist/web-integrity.json` inventories the completed payload without
including itself. `verify:web` rechecks that inventory. Native addon loading
still requires the runtime smoke tests; host identity alone is insufficient.
The browser service worker's offline shell manifest remains a separate cache
integrity mechanism and grants no executable update authority.

`package-release.mjs` reads this completed staged directory. Its public metadata
JSON supplies descriptor fields other than `files`; target, runtime and
entrypoints must match the build's `metadata.json.nativeBundle`. The publisher
supplies the public trust policy independently. The signer is accepted only from
a protected stdin pipe (`--signing-key-stdin`), never a command-line secret,
repository file or environment variable. Use an authorized secret-store delivery
command to supply that pipe; do not print or save a real private key.

```
node native-bundles/package-release.mjs --source electron/dist/web \
  --output /selected/release-output --metadata /selected/public-release.json \
  --key-id selected-publisher --trusted-keys /selected/trusted-public-keys.json \
  --signing-key-stdin
```

The displayed command requires a protected signer pipe; it fails closed without
one. Output is `<releaseId>/release.json` plus `<releaseId>/payload/`. Packaging
uses a private staging directory, verifies copied bytes against the descriptor,
then renames the complete release. Repeating identical inputs produces the same
signed bytes and validates an existing immutable destination before reuse.
No archive unpacker or arbitrary URL fetching is provided.

Run `node --test native-bundles/*.test.cjs` (also Electron `test:web-bundles`).
Fixtures generate synthetic Ed25519 keys in memory and use temporary files only.
They establish contract and packaging behavior, not real signing authority,
production API availability, installed Mac execution, or iOS compatibility.
