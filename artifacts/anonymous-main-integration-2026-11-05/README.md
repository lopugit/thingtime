# Main-into-feature integration — 5 November 2026

Source: feature `ad2ea0524eebc818ee1274dc227a0d2438664029` merged with freshly
fetched main `f07a96dea1821d10180dab82737460e2c9a79995` in the isolated
`anonymous-main-integration` worktree. Final source fingerprint is recorded by
the committed Graphify snapshot. No PR merge into main or deployment occurred.

## Accepted checks

| Check | Result |
| --- | --- |
| `npm --prefix remix run typecheck` | Exit 0, zero diagnostics; baseline not raised |
| `npm --prefix remix run build:client` | Exit 0 from missing generated client output; includes canonical platform, library, embed, draft and offline shell |
| `npm --prefix remix run sync:nitro-template` and `build:server` | Exit 0; Node/Nitro server build |
| `npm --prefix remix run test:local-workspace` | 909 passed, 110 explicit browser opt-ins skipped; offline shell 4 passed |
| Combined capability/draft/recovery/vault-envelope/password-client files | 152 passed, zero skips |
| `npm --prefix remix run test:timeline` | 266 passed, zero skips |
| `npm --prefix remix run test:schemas` | 297 passed, zero skips |
| `npm --prefix MCP test` | 63 passed, 3 explicit isolated-render integration opt-ins skipped |
| MCP typecheck and build | Exit 0 |
| `node --test electron/test/agent-browser-application.test.cjs` | 11 passed, zero skips |
| `npm run test:graphify-cas` | 27 passed, zero skips |
| `npm --prefix remix run test:vercel-config` | 22 passed, zero skips |
| Focused Builder/Action UI | 15 passed |
| Device password vault | 14 passed |
| Trusted Action operation policy | 2 passed: nested denial, refusal before write/read and search-result exposure |
| New Builder transport negotiation regression | 1 passed |
| Focused lint | 0 errors, 8 warnings in each of two overlapping scoped batches |
| Progress HTML | Chromium at 1440, 390 and 320px; document width equals viewport, bottom scroll completed |
| Compiled local CLI refusal smoke | Exit 1, actionable configuration error, empty stdout, zero output directory; isolated HOME/state cleaned |

Counts overlap and must not be summed as independent product coverage. Tests
were run against the combined source before the documentation-only finalization.
No skipped browser/provider/device check is called a pass.

## Failures found and corrected

- Initial workspace run: 841 passed, 66 failed, 110 skipped. Main now marks
  Builder-created definitions with `builder-thing`; old local cache and Action
  predicates rejected that provenance. Canonical predicates now accept the marker
  only with a real permitted content kind, retain protected-kind refusals, and
  negotiate Builder support before account transport. The full rerun passed.
- Five raw TypeScript integration diagnostics were repaired: a Schema detail
  ownership hook, navigation helper arity, duplicate test fixture property,
  unsupported `Promise.any` readiness helper, and narrowed structured conditions.
  The final canonical typecheck reports zero errors.
- First clean client build failed because main put platform generation after
  Vite while the feature imports that document during compilation. The canonical
  build now generates platform assets first; the existing plugin emits the
  exact document/runtime pair after Vite cleans dist. Full client/server builds
  and runtime bundle tests pass.
- Isolated asset checks initially used a fixed port for secondary bundles.
  They now use the selected origin; middleware and all bundle refusal tests pass.
- Fixture-only integration mismatches were corrected: copied CSP fixtures now
  include main's shared SSO-origin dependency, and Graphify retention fixtures
  compare canonical paths and commit recoverable snapshots before testing pruning.

## Remaining acceptance

The corrected `siteEditableBlocks` native/browser fixture was not executed in
this maintenance slice. Its full real-app acceptance, identity/origin/data-plane/
Character/provider/device matrix, signed installed-native behavior and current
head CI remain independent pending work. Deployed acceptance needs separate
user authorization under this task's hold. The current hosted MCP catalogue
lacks rendering; historical stdio artifacts prove only their recorded path.

Device attachment icons remain explicitly unavailable until entry/file queues
can remap receipt-bound identifiers safely. Upload refuses before storage;
ordinary encrypted files and imports remain available. There is no account or
external-network fallback for device icon previews.
