# PR #953 — Allow Lopu Actions with per-chat Ask and Full access

## Behavior

A chat could previously reach `run_action` but browser preparation refused the
missing first-party identity. The tool now runs saved owned server and browser
Actions, including nested browser request flows, through the existing bounded
runtimes. The Equipment importer scenario is verified with a real workspace
upsert and exact-ID readback on disposable local storage.

The composer and Chat settings expose **Ask before running** and **Full access**.
Ask is the default and confirms all mutating tools and every Action, including
read Actions. Full is saved per chat and runs without cards. New chats do not
inherit it. Full-to-Ask changes take effect at the next tool/program operation.
A signed one-run approval still authorizes its exact Action. Builder streaming
previews wait for approval in Ask mode.

## Boundaries reviewed

- Permission settings require the matching first-party user session and owner;
  existing-chat reply bodies cannot write the mode. Other settings cannot
  overwrite it. Explicit same-value writes still commit to handle races.
- Browser request execution uses canonical data routes shared with Nitro.
  It carries no credential and binds the live actor to the exact Request only.
  Scoped/foreign/revoked sessions, forged headers and cloned Requests cannot
  inherit authority. Credential, reveal, admin and chat-control APIs are excluded.
- Server Actions revalidate before each step; browser requests/child preparation
  revalidate the original session and authorization. Normal ACL, transaction,
  quota and declared Action limits remain enforced.
- Permission writes serialize per chat; Send awaits the latest save. Rollback
  uses the last confirmed server value, including rapid-toggle ordering, and
  old-account completions are fenced. Refresh preserves a new unsent selection.
- Durable workflows use their existing private session reference. Scheduled
  recording handoffs remain read-only. Browser children remain browser-only.
- The data route registry avoids pulling auth/native bcrypt installer modules
  into workflow bundling; no handler implementation is duplicated.

## Validation — 2026-09-27

- Full production build including Vercel output verification and 83 workflow
  steps / 3 workflows passed, then passed again after integrating current main.
- `test:lopu`, `test:lopu-chat-streaming`, `test:lopu-ui`, `test:messenger`,
  `test:actions`, `test:service-workspaces`, `test:api-capabilities` and
  `test:auth-introspection` and `test:library` passed. The existing optional Mongo Action test was
  skipped; the new disposable integration below was explicitly enabled.
- `verify-lopu-actions.mts`: real HTTP registration; protected chat storage;
  signed Ask approval; persisted Full/Ask changes; nested browser equipment
  save/read; stable-ID retry produces one equipment row; Things read; server
  calculation; stale-reply refusal; logout revocation. Synthetic fixtures only,
  no provider inference and no production data migration.
- Production composer visually checked at 1280px desktop and 390px phone widths.
  Both choices work from the settings selector and the composer mode control;
  phone settings place the explanation below the full-width selector.
- Targeted TS/TSX and MTS lint passed with zero errors and two existing warnings.
  Raw typecheck matched the untouched base: 91 diagnostics, zero new ones.
- Reviewed diff for credential propagation, self-escalation, mode persistence,
  async races, runtime composition and error receipts. Failed Action execution
  now reports tool failure instead of an apparent successful tool result.
- CI exposed a source-text assertion expecting the Library route in the old
  catch-all file. It now verifies the actual route export and shared loader
  identity, preserving registration coverage after the map extraction.
- AST Graphify update succeeded. Documentation semantic extraction was attempted
  through the configured local Codex proxy, which returned HTTP 502
  `codex_execution_failed`; semantic freshness is not claimed.

See [the feature contract](../docs/lopu-action-access.md) and the fork-safe QA
setup in README. Main merge is explicitly requested by the user; remote checks
and deployment status remain separate evidence from these local results.
