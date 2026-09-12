# Trusted developer ecosystem roadmap

**Status:** Proposed · owner decision required

**Prepared:** 2026-09-03, Australia/Melbourne

**Evidence:**
[Trusted developer ecosystem baseline](../NOTES/trusted-developer-ecosystem-baseline.md)

**Execution backlog:**
[TODO 27 — Trusted developer ecosystem](../TODO/claude-todo/27-trusted-developer-ecosystem.md)

**Related:** [Trustworthy adoption](./trustworthy-adoption-roadmap.md),
[community safety and accountable moderation](./community-safety-and-accountable-moderation-roadmap.md),
[accessibility and language readiness](./accessibility-and-language-readiness-roadmap.md),
[data portability and graceful exit](./data-portability-and-exit-roadmap.md),
[full-power app namespaces](../TODO/claude-todo/16-full-power-app-namespaces.md),
and [composed apps](../TODO/claude-todo/21-app-composition-surface.md)

## Outcome

Developers can move from a no-secrets sandbox to a supportable release with one
coherent declaration, conformance path, compatibility contract, review receipt,
and incident lifecycle. People can understand who maintains an app or reusable
artifact, what authority it requests, what changed, which evidence is current,
and how to revoke access or recover their data. Thingtime can grow discovery
and sustainable developer services without selling trust, attention, or
personal data.

## Non-goals

- Launching a public marketplace before review capacity, appeals, user data
  controls, and incident response are staffed and verified.
- Treating repository popularity, install count, payment, a scan score, or a
  platform badge as proof that an app is safe.
- Uploading private source, credentials, app payloads, personal Things, OAuth
  grants, or person-level install histories to an analytics or scanning vendor.
- Giving reviewed apps more runtime authority than their current user grant.
- Replacing Thingtime's server-enforced scopes, namespaces, budgets,
  capability negotiation, or revocation with a declaration or policy promise.
- Making baseline sandbox, documentation, security reporting, revocation,
  data browsing/export/deletion, or appeal a paid entitlement.
- Silently expiring legacy grants or forcing broad re-consent before the owner
  approves a migration and user-safety plan.

## Layered trust contract

| Layer | Question answered | Authority boundary |
| --- | --- | --- |
| Runtime enforcement | What can this credential do now? | Existing scopes, `appId`, ACLs, capability checks, quotas, token purpose, and revocation remain authoritative. |
| Publisher declaration | What does the maintainer claim and promise? | Validated structured claims; never treated as proof by itself. |
| Release provenance | What exact code/artifact set and compatibility range is this? | Immutable digest and dependency set; no mutable “latest” as review evidence. |
| Review receipt | What evidence was checked, when, by whom, and with what limits? | Exact release/policy binding, expiry, append-only supersession, and role-specific projection. |
| User decision | What did this person approve? | Plain-language scope/change view, explicit choice, and easy revoke/data control. |
| Operations | What happens when trust changes? | Narrow containment, reasoned state, developer/user communication, appeal, remediation, and safe restoration. |

## Architecture direction to approve

Names are provisional. Do not add kinds or endpoints until the owner records the
contract in [`DECISIONS.md`](../DECISIONS.md).

- Keep the protected `app` Thing as the stable client identity. Add declaration
  or release records relationally; do not turn the app root into an unbounded
  history array.
- Represent each immutable release with a server-minted id, publisher/app id,
  declaration version, artifact/source digest, dependency references,
  requested scope set, minimum API capability map, rollout channel, changelog,
  support status, and timestamps.
- Represent review attempts and ecosystem state changes as protected append-
  only child events. Current status is a bounded projection derived from those
  events, not rewritten history.
- Bind a review receipt to one exact release, policy/check version, evidence
  inventory, reviewer identity/role, result, limitations, expiry, and
  superseding receipt. Never expose private vulnerability material.
- Keep publisher identity separate from app names. Any domain or organization
  verification proves only its named relationship and expiry; it does not make
  every release safe.
- Derive permission diffs from the canonical scope catalog. Added or broadened
  authority must have an approved re-consent path; a declaration cannot widen
  a live token.
- Derive compatibility from the origin-scoped capability manifest and a small
  release requirement map. Git SHA, route presence, or a successful deployment
  is diagnostic evidence, not compatibility proof.
- Make quarantine narrowly targetable by release, capability, origin, or app.
  User-owned app data remains browseable/exportable/deletable while execution
  or token use is contained.
- Route safety, impersonation, malicious-report, and appeal concerns through
  the [community safety roadmap](./community-safety-and-accountable-moderation-roadmap.md);
  route vulnerability reports through a distinct private security process.

## Milestones

### M0 — Decide the ecosystem contract

**Outcome:** one approved scope, vocabulary, ownership model, and launch gate.

- Choose the first artifact family. Recommended start: registered OAuth apps,
  with reusable schemas/components/actions/pages referenced but not bundled
  into one trust result.
- Approve declaration fields, visibility, validation, size limits, edit rules,
  and which changes mint a new immutable release.
- Approve publisher identity tiers and explicitly state what each tier does not
  prove.
- Define patch/minor/major release changes, permission expansion, compatibility
  breaks, re-review, re-consent, deprecation, transfer, and abandonment.
- Assign product, developer experience, security, privacy, accessibility,
  trust/safety, operations, review, and support owners.
- Set review capacity, service targets, appeals, minimum evidence, rollout
  limits, and stop conditions before public discovery.

**Gate:** no new kinds, review badges, or public catalog until the decision
packet is accepted and durable forks are recorded.

### M1 — One declaration and conformance kit

**Outcome:** a developer can understand and test the contract without support
or production credentials.

- Generate a versioned declaration schema and examples from one registry.
- Extend the existing API docs and OAuth sandbox into a guided conformance kit:
  register-like validation, scope denial, private write/read, compatibility
  negotiation, quota failure, revocation, and cleanup.
- Produce machine-readable, human-readable, and CLI output from the same cases.
- Require explicit app purpose, support/security contacts, privacy/data-
  lifecycle statements, scopes, capability requirements, supported locales/
  access modes, and end-of-support behavior.
- Keep secrets and reviewer credentials out of declarations, receipts, logs,
  screenshots, CI artifacts, and examples.
- Measure first sandbox success through aggregate or local-only evidence before
  adding person-level developer analytics.

**Gate:** a new developer completes the approved sandbox journey, every
negative case fails closed, and no declaration can alter runtime authority.

### M2 — Immutable releases and reproducible review

**Outcome:** Thingtime can say exactly what was assessed without promising more.

- Mint immutable release records bound to an artifact/source digest,
  declaration, dependency set, scopes, capability requirements, and changelog.
- Run deterministic checks first: schema validation, origin/callback rules,
  capability compatibility, permission diff, dependency/provenance inventory,
  secret checks, and the approved sandbox suite.
- Add risk-led manual review for public writes, external/network effects,
  executable or action-bearing artifacts, sensitive fields, broad sharing, and
  high-impact automation.
- Store append-only receipts with inputs, outputs, reviewer role, limitations,
  policy/check versions, expiry, and supersession.
- Make a second authorized reviewer able to reproduce a sampled receipt from
  its non-secret immutable inputs.
- Present `not reviewed`, `checks passed`, `reviewed with limitations`,
  `changes require review`, `quarantined`, and `retired` as distinct states.

**Gate:** receipts are reproducible, cannot be replayed onto another release,
and never confer runtime permission.

### M3 — Honest install, update, and consent lifecycle

**Outcome:** people can make and revisit an informed choice.

- Show publisher, purpose, support, data lifecycle, exact requested scopes,
  selected Things, compatibility, review freshness, limitations, and current
  ecosystem state before authorization.
- Compare updates with the currently trusted release: scopes, origins,
  external effects, artifacts/dependencies, support, privacy terms, and
  compatibility.
- Require explicit re-consent for approved authority expansion; allow safe
  compatible updates without training people to accept a full consent screen
  every time.
- Preserve cancel, later review, revoke, per-entry deletion, namespace wipe,
  export, and app-deleted/orphaned-data paths.
- Make accessibility, keyboard/touch, reduced-motion, language, low-bandwidth,
  stale/offline, and error recovery part of the complete journey.
- Plan legacy scope migration separately, with notification, compatibility,
  staged measurement, rollback, and no surprise data loss.

**Gate:** permission-change comprehension and all revoke/data-control tests pass
without a severe privacy, accessibility, compatibility, or recovery failure.

### M4 — Containment, response, appeal, and recovery

**Outcome:** trust can change safely after release.

- Accept private vulnerability reports through a bounded, authenticated or
  safely anonymous channel distinct from product/safety complaints.
- Support narrow containment by release, capability, origin, or app; preserve
  owner data controls and avoid unrelated app/user impact.
- Notify the maintainer and affected users with allowlisted facts, honest
  uncertainty, current effect, safe next step, and support path.
- Record assignment, evidence access, reason, action, communication, appeal,
  remediation, re-review, and restoration as relational events.
- Define ownership transfer, compromised maintainer recovery, inactivity,
  deprecation, and end-of-support without letting one actor silently inherit
  credentials, reviews, or publisher identity.
- Exercise leaked token, malicious release, compromised publisher, dependency
  incident, false report, abandoned app, platform outage, and failed restore.

**Gate:** containment is prompt and narrow, appeals/remediation preserve
history, and restoration never resurrects old tokens or grants.

### M5 — Discoverability and sustainable stewardship

**Outcome:** useful integrations can grow without turning popularity or payment
into trust.

- Open discovery only to releases meeting the approved identity, support,
  review freshness, accessibility, compatibility, safety, and data-control
  gates.
- Rank primarily by task fit, quality, support health, compatibility, and
  successful safe outcomes; keep installs, usage, and revenue as bounded
  context rather than authority.
- Label sponsorship and keep it independent from review, incident priority,
  moderation, and organic ranking.
- Publish contributor guidance, policy versions, review limitations, aggregate
  ecosystem health, removals, appeals, and correction paths with privacy-safe
  minimum cohorts.
- Evaluate aligned revenue: hosted quotas, managed testing, team controls,
  priority support, and publisher services. Reject pay-to-rank, pay-to-trust,
  personal-data resale, or charging people to revoke/export/delete.
- Expand artifact families only after the first family sustains two review and
  incident-response cycles within capacity.

**Gate:** discovery quality and developer success improve while security,
privacy, accessibility, safety, support load, and cost stay within approved
bounds.

## Measures and release policy

| Measure | Candidate definition | Guardrail |
| --- | --- | --- |
| Sandbox completion | Eligible developers who complete the approved no-secrets journey. | Local/aggregate only; no payload or private source collection. |
| Review reproducibility | Sampled receipts reproduced from exact immutable inputs. | Disagreement and limitations remain visible. |
| Permission understanding | Updating users who correctly identify authority changes before choosing. | No coerced acceptance or preselected expansion. |
| Revocation integrity | Affected credentials denied after user/developer/platform action. | User data controls remain available; no unrelated revocation. |
| Containment precision | Valid incidents contained at the narrowest approved scope. | Severe exposure is never prolonged just to optimize precision. |
| Supported release rate | Active eligible releases with current support, compatibility, and review evidence. | Small/new developers are not hidden solely for low volume. |
| Developer recovery | Valid appeals/remediations reaching a reasoned result within the staffed target. | No public accusation, retaliation, or pay-for-priority. |

## Risks and contingency paths

| Risk | Early signal | Response |
| --- | --- | --- |
| Declaration becomes security theater | Claims diverge from runtime scopes or receipts | Hide the trust claim, fail review, and keep enforcement authoritative. |
| Review queue outruns capacity | Oldest receipt age or urgent report backlog crosses threshold | Pause discovery/new submissions and keep sandbox/private use available. |
| Automated checks dominate judgment | One score hides missing evidence or high-impact effects | Show checks separately, require risk-led review, and prohibit threshold-only approval. |
| Scope migration surprises users | Legacy or updated grants expose authority users did not expect | Freeze expansion, revoke/narrow safely, notify, and rerun consent research. |
| Quarantine causes data loss | Suspended users cannot browse/export/delete namespace data | Restore owner data controls without restoring app tokens; fix before resuming discovery. |
| Publisher verification is overclaimed | Badge wording implies release safety or identity facts not proved | Narrow the label to the exact verified relationship and publish a correction. |
| Fees distort ranking or review | Paid apps receive visibility or favorable decisions | Separate ledgers/roles, label sponsorship, audit outcomes, and stop the program. |
| Incident disclosure creates harm | Exploit detail or private reporter evidence appears publicly | Remove/redact, narrow access, coordinate disclosure, and run incident review. |

## Stop conditions

Pause the affected release, capability, discovery surface, or experiment when:

- a declaration, receipt, or badge can widen runtime authority;
- an immutable receipt can be attached to different bytes, scopes, origin, or
  app;
- scope expansion occurs without the approved explicit consent path;
- revocation, quarantine, or restore resurrects a credential or crosses app/
  user boundaries;
- owner browse/export/delete becomes unavailable during containment;
- private source, credentials, app payloads, Things, grants, or person-level
  install history enters ordinary telemetry or logs;
- review/support/incident backlog exceeds staffed capacity;
- a public trust claim outruns current evidence or an appeal/correction path;
- paid status changes review, ranking, incident priority, or safety outcomes; or
- the journey fails the approved accessibility/language matrix.

## First decision packet

The next owner review should decide only:

1. first artifact family and explicitly deferred families;
2. declaration fields, visibility, editability, and size/validation contract;
3. publisher identity tiers and exact claim wording;
4. release identity, dependency binding, SemVer, compatibility, and scope-delta
   rules;
5. automated/manual review triggers, receipt schema, expiry, and limitations;
6. install/update/re-consent and legacy-grant migration behavior;
7. quarantine, incident, appeal, transfer, abandonment, and restoration states;
8. launch capacity, measures, sustainable funding boundaries, and stop
   conditions.

Everything remains proposed until that packet is approved.
