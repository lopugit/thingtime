# Combined bootstrap + identity web build

Observed 12 November 2026 (Australia/Melbourne). All six canonical commands passed on base `b3eba7dbf293fe3cf4552d37416408f02283cbe1` **plus the recorded dirty source tree**. The metadata commit alone does not identify this payload.

- `corepack pnpm --dir remix run typecheck` — exit 0.
- `corepack pnpm --dir remix run typecheck:ratchet` — exit 0, zero baseline gate.
- `corepack pnpm --dir remix run lint` — exit 0; 0 errors, 372 warnings.
- `corepack pnpm --dir electron run build:web` — exactly one invocation, exit 0.
- `corepack pnpm --dir electron run verify:web` — exit 0.
- `node electron/scripts/test-bundled-local-runtime.cjs` — exit 0, with parent `TT_BUNDLED_RUNTIME_API`, `TT_BUNDLED_RUNTIME_FIXTURE` and `TT_BUNDLED_RUNTIME_ROOT` removed from its environment.

`source-before.json` and `source-after.json` hash all 5,185 tracked/nonignored untracked inputs under Remix, MCP, Electron, native-bundles and root scripts, plus root build manifests; all matched. They include 22 dirty inputs. Ignored generated output/dependencies/private environment files are excluded. This comparison concerns the stated build scope, not the entire worktree. Untracked identity and bootstrap source is explicitly inventoried. `verification.json` records exact command timestamps, results and artifact hashes.

`bundle-summary.json` identifies the canonical `electron/dist/web` output (1,823 files). Independent inventory recomputation matched `web-integrity.json`, and staged and canonical Nitro server entries matched. `metadata.safe.json` retains allowlisted compatibility/source metadata. No later payload changes were made by this build worker.

The existing genuine Mongo fixture proved normal API registration/session reads, private Thing create/read/update/delete, independently authenticated other-account and anonymous ACL refusal, stale revision conflict, account/session/content retention across API+database restart, unauthenticated database denial and its deliberate OS-enforced offline boundary. It used a fresh disposable authenticated single-node replica set and only canonical APIs for account/content creation. Its temporary profile was removed and ports 19881/19882 had no listeners afterward (`cleanup.json`). Synthetic password material stayed inside the isolated fixture.

Logs are sanitized for ANSI/trailing spaces and credential patterns; raw logs remain private in `/tmp` and are not repository artifacts. This proves the canonical bundled web payload and the scoped Mongo HTTP regression. It does not prove signed/installed app delivery, automatic activation, iOS WebView acceptance, SQLite HTTP registration, full native offline feature parity or production publication/trust.
