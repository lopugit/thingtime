# Ethical adoption baseline

**Evidence snapshot:** 2026-09-01, Australia/Melbourne

**Scope:** `origin/develop`, the public GitHub repository state, and planning
artifacts available during this documentation run. This is not a production
analytics report and contains no private user data.

## Why preserve this note

Thingtime already has a wide surface for creating, finding, composing, and
sharing Things. The missing layer is a shared definition of healthy adoption:
which useful outcomes matter, how to learn without surveilling people, and what
quality gates must remain green before growth work scales.

The related [trustworthy adoption roadmap](../PLAN/trustworthy-adoption-roadmap.md)
turns these observations into phases. The executable backlog lives in
[`TODO/claude-todo/22-trustworthy-adoption-loop.md`](../TODO/claude-todo/22-trustworthy-adoption-loop.md).

## Evidence ledger

| Claim                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                              | Confidence and refresh trigger                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Thingtime's canonical model already supports data, social content, components, actions, apps, and protected control-plane records as Things.                    | [`FUNDAMENTALS.md` §3](../FUNDAMENTALS.md) defines the current kinds, storage rules, and protected writers.                                                                                                                                                                                                                                                                           | High for this commit. Re-read after registry or fundamentals changes.                                                                   |
| Search is a real product surface, not a speculative idea.                                                                                                       | `remix/app/components/Search/SearchPage.tsx` and `remix/app/routes/search.tsx` are present on `origin/develop`; PR [#552](https://github.com/lopugit/thingtime/pull/552) was merged on 2026-09-01 to repair deployed search metadata.                                                                                                                                                 | High for repository presence. Production behavior was not re-tested in this docs-only run.                                              |
| Richer Commander previews are active work, not shipped behavior on this baseline.                                                                               | PR [#554](https://github.com/lopugit/thingtime/pull/554) was open against `develop` during the snapshot. Its visible checks passed when inspected, but open status means the feature must not be documented as merged.                                                                                                                                                                | Medium and time-sensitive. Refresh when #554 closes or its head changes.                                                                |
| The roadmap already contains several share and delight concepts.                                                                                                | [`10-delight-and-growth-ideas.md`](../TODO/claude-todo/10-delight-and-growth-ideas.md) records post permalinks as shipped in #141 and lists theme, algorithm, tag, circle, and power-user ideas. Several corresponding PRs remain open.                                                                                                                                               | High for roadmap content, not proof of production behavior. Refresh individual statuses from GitHub before execution.                   |
| Consentful account invitations have a defensive design but no implementation claim.                                                                             | [`18-account-invite-links.md`](../TODO/claude-todo/18-account-invite-links.md) is marked not started and specifies editable prefill, opaque tokens, revocation, rate limits, and the canonical registration path.                                                                                                                                                                     | High for the current plan. Re-ground before implementation.                                                                             |
| A folder-backed composed-app surface is designed but unimplemented.                                                                                             | [`21-app-composition-surface.md`](../TODO/claude-todo/21-app-composition-surface.md) is marked not started and explicitly preserves the existing `app`/`appId` OAuth namespace.                                                                                                                                                                                                       | High for the current plan. Re-ground if component, action, or app namespace contracts change.                                           |
| Delivery automation is active and mostly healthy, but "green" is always run-specific.                                                                           | At capture time, recent `develop` Web CI and CodeQL runs were successful while newer Lopu manager and CodeQL runs were still in progress. PR #554's visible checks passed. One earlier Feature Stack workflow-dispatch run had failed and another was cancelled.                                                                                                                      | High for the timestamp only. Always re-query Actions and raw resolver receipts before making a current health claim.                    |
| The public backlog is PR-heavy and issue-light.                                                                                                                 | GitHub returned no open issues and 36 open PRs during the snapshot. Many old feature PRs still target `develop`.                                                                                                                                                                                                                                                                      | High for the timestamp only. Refresh before prioritization and do not interpret "no issues" as "no user problems."                      |
| The original planning snapshot lacked a cross-product accessibility, internationalization, and adoption measurement gate.                                       | The 2026-09-01 search found isolated accessibility requirements and privacy warnings but no shared metric dictionary or release-wide accessibility/i18n plan. The adoption metric gap is now staged here; the implementation gap is now grounded in the [accessibility and language-readiness baseline](./accessibility-and-language-readiness-baseline.md) and its proposed roadmap. | High for planning history, not implementation status. Re-run the dedicated baseline before any release or conformance claim.            |
| Existing community and automated-moderation controls do not yet form a user-report, appeal, or accountable-governance loop.                                     | The dedicated [community safety baseline](./community-safety-and-accountable-moderation-baseline.md) inventories shipped roles, invites, request buckets, mute, and model/admin review alongside the missing personal block, case, scoped moderator, appeal, and transparency contracts.                                                                                              | High for the 2026-09-03 repository snapshot. Re-run the dedicated baseline before scaling community or sharing work.                    |
| Strong app/OAuth primitives do not yet form a general release, review, incident, and discovery lifecycle.                                                       | The [trusted developer ecosystem baseline](./trusted-developer-ecosystem-baseline.md) connects app identity, scopes, revocation, user-owned namespace data, sandbox, capability manifests, and the one-off ChatGPT submission handoff to the missing publisher declaration, immutable release, review receipt, permission-diff, containment, and abandonment contracts.               | High for the 2026-09-03 repository snapshot. Re-run the dedicated baseline before launching public app or artifact discovery.           |
| Account-bound authorship and update timestamps do not yet explain material edits, source assertions, derivation, platform assistance, corrections, or disputes. | The [content provenance and correction baseline](./content-provenance-and-correction-baseline.md) distinguishes current post projection and edit behavior from the missing revision-evidence and assertion-authority contracts.                                                                                                                                                       | High for the 2026-09-04 repository snapshot. Re-run the dedicated baseline before widening public sharing, reuse, or provenance claims. |
| Point optimizations do not yet form a constrained-device, low-bandwidth, or environmental-evidence contract.                                                    | The [resource-conscious reach baseline](./resource-conscious-reach-baseline.md) connects current route splitting, immutable assets, lazy media, exact byte ledgers, and opt-in offline audio to the missing journey budgets, data-saver, local-footprint, backend-work, and claims boundaries.                                                                                        | High for the 2026-09-05 repository snapshot. Rebuild and rerun the dedicated baseline before quoting current budgets or impact.         |

## What the evidence suggests

### Strengths to compound

- A broad creation substrate already exists: free-form Things, schemas,
  components, actions, search, profiles, themes, algorithms, and sharing.
- House rules favor deterministic behavior, one source of truth, real-API
  testing, bounded relational data, revocable auth, and protected writes.
- The roadmap treats invitations, sharing, and composed apps as consent and
  capability problems rather than pure acquisition mechanics.
- CI has concrete build, API, CodeQL, and security contexts that can become
  release gates for growth experiments.

### Gaps that block trustworthy scale

1. **No shared outcome definition.** Feature completion is documented, but the
   repository does not define activation, repeat usefulness, successful
   sharing, or healthy retention.
2. **No privacy-safe learning contract.** Existing docs warn against leaking
   tokens and private content, but there is no event registry specifying what
   product signals may be collected, why, for how long, or at what aggregation
   level.
3. **No portfolio sequencing.** Many open PRs compete for attention. There is
   no common gate that says which prerequisite must land before a sharing or
   community experiment begins.
4. **Accessibility and internationalization are local requirements.** They are
   not yet treated as adoption infrastructure with release-wide checks.
5. **Sustainability remains proposed rather than proven.** The resource-conscious
   baseline now defines the missing journey, transfer, compute, local-footprint,
   cost, and environmental-evidence boundaries; the adoption roadmap defines an
   aligned business model. Neither supplies current measurements, an approved
   budget, or a public impact claim.
6. **Public content history is implicit.** A current author and creation time
   do not tell a recipient whether meaning changed, which source or parent was
   asserted, what the platform observed, or how a correction was resolved.

## Proposed outcome vocabulary

These are definitions to debate before instrumentation, not measured claims.

| Outcome             | Candidate definition                                                                                                                     | Privacy constraint                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| First value         | A person creates or imports a Thing and successfully opens it again in a later interaction.                                              | Record the transition, never the Thing content, title, path, query, or identifier.                                       |
| Repeat usefulness   | A first-value participant returns in a later time window and completes another create, find, edit, compose, or safe run outcome.         | Report cohorts only above a minimum group size; avoid person-level dashboards.                                           |
| Consentful share    | A recipient opens a deliberately shared public artifact or invite and takes an explicit next action.                                     | Never infer contacts, scrape address books, or expose the recipient to the sender without consent.                       |
| Durable creation    | A Thing remains readable, editable, exportable, and attributable after a defined period.                                                 | Deletion and retention controls remain authoritative; deleted content never survives as analytics payload.               |
| Trustworthy session | The useful outcome completes without security denial, crash, severe accessibility blocker, or unexplained data loss.                     | Operational telemetry must be bounded, redacted, access-controlled, and separate from customer content.                  |
| Recoverable journey | A critical create, find, edit, share, or safe-run journey survives an approved dependency failure or reaches a clear, recoverable state. | Never count a health endpoint or successful deployment as recovery proof; exercise the journey and verify durable state. |

Raw signups, page views, time-on-site, notification opens, and content volume are
diagnostics at best. They are not north-star outcomes and must never reward
dark patterns, compulsive use, or unnecessary data collection.

## Privacy and safety boundary

Any later measurement design should fail closed unless all of these are true:

- Each signal has one named product question and one owner.
- The allowlist excludes Thing content, search text, URLs containing private
  identifiers, invite tokens, auth material, message text, profile fields, and
  third-party endpoint details.
- Collection is aggregate by default. Any short-lived pseudonymous layer needs
  a written necessity argument, bounded retention, deletion semantics, and an
  explicit decision before implementation.
- Product analytics cannot become an alternate data plane. New writes still go
  through the API and protected utilities, use current capability-manifest
  registration, and follow the storage/control-plane rules in
  [`FUNDAMENTALS.md`](../FUNDAMENTALS.md).
- A user can understand the behavior and disable optional measurement without
  losing core product functionality.
- Abuse metrics cannot become public leaderboards or tools for targeting
  vulnerable people.

## Open questions

1. Which single journey best represents first value: create-and-return,
   search-and-save, or compose-and-run?
2. Can the first two milestones be evaluated with local-only counters and
   structured usability sessions before any server analytics exists?
3. What minimum cohort size and retention window make aggregate reporting useful
   without making individuals re-identifiable?
4. Should public sharing launch first with posts, themes, algorithms,
   components, or folder-backed composed apps?
5. What accessibility and language set defines the first honest "widely usable"
   milestone?
6. Which paid value is aligned with user success: hosted storage, team controls,
   app quotas, creator tooling, or support?
7. Who owns the go/no-go decision when adoption improves but trust, abuse, cost,
   accessibility, or reliability guardrails regress?
8. What minimum community-safety capacity and accountable report/appeal path
   must exist before consentful sharing or public-community growth scales?
9. What publisher, release, review, consent-update, incident, and data-control
   gates must be proven before apps or reusable artifacts enter public
   discovery?
10. Which critical journeys need service objectives, degraded-mode contracts,
    recovery targets, restore drills, and incident ownership before Thingtime
    can responsibly widen adoption?
11. Which public artifact family should first make material edits, source and
    derivation assertions, corrections, disputes, and evidence limits legible?

## Refresh checklist

- Re-run the marked open-PR and CI queries.
- Verify merged behavior in a live browser before changing a repository claim
  from planned/open to shipped.
- Re-read `FUNDAMENTALS.md`, `DECISIONS.md`, and the capability manifest before
  choosing a measurement storage contract.
- Update this note when a roadmap milestone is accepted, rejected, or completed.
