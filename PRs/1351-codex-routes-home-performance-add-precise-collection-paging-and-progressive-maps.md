# Precise collection paging and progressive maps

## Problem and behavior

Saved Builder apps previously displayed page-local totals and needed sequential coordinate enrichment before presenting useful map data. Shared primitives now provide authenticated, ACL-equivalent unpaged counts; ordinal paging through authorized rows; ordered exact-ID joins; collection totals, adjacent-page prefetch and selected-row reveal; progressive map pages; precise/batched Mapbox suggestion metadata; and safe URI-component expressions.

Every read preserves the selected owner, data plane, audience and capability checks. Batch reads retain positions and return null for inaccessible/protected/missing records. Count and offset paths do not use Mongo skip over coarse visibility. Failed or stale prefetches cannot publish another source or identity’s rows. Provider data stays transient unless the existing permanent-geocoding ceremony applies. No new endpoint, index, MCP, data schema or private Routes definition is introduced.

Dependency bootstrap now reports an exited or unknown lock owner promptly and preserves the lock until its possible child installer has been checked. It no longer deletes locks merely because time elapsed.

## Verification

- Raw TypeScript, changed-file ESLint, full client build and Nitro node-server build passed.
- Schema: 297 passed; Actions: 165 passed, 1 existing opt-in skip; capability: 137 passed; Things: 329 plus 31 passed; Maps: 36 passed; webpages: 199 passed, 4 existing skips. Focused dependency-lock tests passed separately.
- Built Maps HTTP smoke used a disposable replica set, API-created independent accounts and no production credentials. It checked manifest/origin, anonymous refusal, absent-Vault behavior, exact schema/parent intersections, cursor paging, owner and child ACL boundaries. This is not real Mapbox provider acceptance.
- Final built Things HTTP acceptance passed against a disposable replica set: 120 owner records, 113 unarchived records, an independent account and visibility-scoped PAT, count/list parity, offset/cursor equivalence and ordered batch joins. Synthetic 25 serial joins took 3349.33 ms versus one batch at 24.75 ms; the count body was 23 bytes versus 997517 bytes across three full list pages. Restart/repeat count latency was 1059.65/336.65 ms and distant-page latency 722.02/263.78 ms; these are isolated-machine observations, not production promises. The existing generic writer limits each text field to 5000 characters, so the disposable fixture uses two 4096-character fields; this PR does not change that existing writer behavior.
- Actual collection renderer/hook browser regressions passed desktop/mobile: same-account source and data-plane changes, late failed prefetches, thrown/returned 401/403 clearing, no redundant covered-page prefetch, selected row 48 reveal, draft retention, full-page scroll and narrow overflow. Fixture transport was synthetic 40 ms: loaded changes 5.7–6.9 ms, cold offset changes 101.3–124.7 ms. These are not production timings.

## Count and distant-page planner diagnosis

The initial isolated counts/pages spent time exploring owner-library managed-kind
OR branches that could not satisfy an explicit data-only request. The shared
owner query now prunes only those impossible exact-kind exceptions; mixed
protected-kind exclusions, retained exception guards, legacy post handling and
exact ACL checks are unchanged. Truth-table/projection regressions passed 39/39.

After this change, final rebuilt HTTP acceptance passed with count latency
103.92/51.77 ms (restart/repeat), distant-page latency 68.54/31.62 ms and batch
join latency 17.91 ms. These isolated synthetic measurements meet the 150 ms
target under the fixture conditions; production verification remains separate.
Raw TypeScript and the node-server build passed again after the predicate change.

## Remaining acceptance boundary

The private Routes page/Actions and personal records are outside this source PR. Their reviewed, immutable saved-definition plan requires its ordinary current mutation approval after deployed capability verification; live Routes behavior, real geocoding accuracy and production latency must be checked after that separate application. Native apps are unaffected.
