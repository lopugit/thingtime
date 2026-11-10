# Saved Component queue dependencies

A page that references a newly created saved Component now waits for that Component's remote acknowledgment. Other account writes continue. The dependency list comes from the canonical stored composition traversal, including nested children; arbitrary text does not become a dependency.

Lost-response recovery uses the immutable operation's original dependencies. A newer local edit cannot prevent acknowledgment of an earlier request that already completed remotely. Once recovered, the newer edit keeps its own dependencies and expected remote revision.

The author agent ran 40 focused tests: 25 account-sync cases and 15 canonical traversal/fork cases. A negative control reproduced page-before-Component upload without the new gate. Independent review caught the frozen-request issue; its regression and final re-review passed. See [checks](checks.json) for commands, source hashes and evidence attribution.

The sanitized client/Nitro build and scoped lint passed. TypeScript retains exactly the existing 91 normalized diagnostics, with none added or removed; this is not a clean typecheck. Native queue acceptance for this increment has not run.

[CI](ci-84058.json) and [preview](preview-84058.json) receipts apply to prior pushed source `84058ca5`, before this increment. Web CI and CodeQL succeeded; the alias and immutable frontend were reachable. Their transfer capabilities remain ahead of the shared gateway, so this is not deployed functional acceptance.

The independent [instructions run](../anonymous-local-first-2026-10-27-instructions-current/README.md) also applies to `84058ca5`. [Vault evidence](../anonymous-local-first-2026-10-27-vault/README.md) distinguishes native mechanism passes from failed UI stress checks. [Signed-in suite installation](../anonymous-local-first-2026-10-27-account-suite-candidate/README.md) remains incomplete; its unsafe candidate was not included in the runtime.

The progress tracker also corrects its Remaining filter to include all 25 unfinished rows (14 partial, 11 todo), and keeps the static current-verification overview visible during filters/search. The isolated plan check covers all counts, search, filters and complete scrolling at 1440/390/320 px. Earlier rechecks retained here expose outdated test assumptions about taskless sections; the final test separately asserts overview visibility.
