# PR 1430: Private page activation and map sources

Private saved apps need a deliberate opening/day-boundary Action without using
a display read as a write trigger. Maps also need independently refreshed point
layers that do not capture surrounding form commands or move the viewport.

## Reusable contracts

- `activationAction` is a saved Webpage opt-in. It runs only for the full owning
  account on a live private page, with exact page and Action revision checks,
  origin/actor/data-plane fences and current authorization before each step.
- Automatic programs can read or `things.ensure` a stable identity. Plain
  creates, updates, deletes, child invocation and unstable ensure keys are
  refused. Copies, forks and portable imports remove the opt-in.
- `things.ensure` uses the existing protected unique-key index and canonical
  creation transaction. Concurrent calls share one owner/Action/key identity;
  reuse keeps current values, placement and audience rather than overwriting
  later edits. No collection or index is added.
- A map `pointsSource` uses the existing delegated Action/source runtime,
  cursor pagination, refresh scheduling and account isolation. Failed reads
  clear only that extra layer. Per-point `fitBounds: false` excludes a moving
  marker from automatic viewport fitting.
- Versions: `api.things` 1.56.0, `api.things-update` 1.22.0,
  `api.actions-run` 1.44.0 and `api.webpages-resolve` 1.14.0.

The Routes settings, daily-date policy, native-location read adapter and marker
label composition are private saved Things. No user planner definitions, places,
contacts, coordinates or device identities are committed here.

## Validation

- Built Nitro server against a disposable local Mongo replica: 119 HTTP checks
  passed, including concurrent ensure, current edits/audience preservation,
  private/foreign/shared refusal, activation revision/date fences, unstable
  keys and copied-page opt-in removal. Fixtures use the real registration and
  Things APIs; application records are not inserted directly into the database.
- Full TypeScript passed; targeted lint passed with existing warnings.
- Capability coverage after integrating main: 160 tests passed.
- Focused activation/copy/import/fork coverage: 38 passed. Map paging, overlay,
  shared-reference discovery and copy rebinding: 31 passed.
- Isolated Chrome at desktop and mobile sizes covered opening, civil-day
  rollover, reload/reuse, manual/deep-link selection, inert preview/shared
  contexts, opt-out and retry.
- The private composition fixture exercised settings saves, location hidden,
  denied/no-sample/stale states, marker scale and menus, separate form commands,
  full-page overflow and a retained map instance. Its synthetic observations
  and mock map SDK do not establish live device or production acceptance.

Final integrated build, hosted preview, production rollout and private saved
Thing acceptance are tracked separately from these source/fixture checks.

Graphify: the full changed-document pass expanded to 116 semantic slices and
was stopped as slow. The bounded refresh covers the source graph and the focused
contract/feature-map/PR documents. The large TESTING and changelog files retain
their prior semantic coverage; their changed text is not claimed as reindexed.
