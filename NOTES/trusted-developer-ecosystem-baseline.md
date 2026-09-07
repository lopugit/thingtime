# Trusted developer ecosystem baseline

**Evidence snapshot:** 2026-09-03, Australia/Melbourne

**Repository baseline:** automation PR #557 after merging `origin/develop` at
`af9a0b220`

**Scope:** registered apps, OAuth grants, app namespaces, capability manifests,
developer documentation, reusable components/actions/pages, and the existing
ChatGPT plugin handoff. This is a repository review, not a production security
assessment, marketplace launch decision, or endorsement of any integration.

## Why preserve this note

Thingtime already has unusually strong ingredients for an open app ecosystem:
origin-bound OAuth, explicit scopes, revocable sessions, user-owned app data,
storage budgets, a sandbox, self-documenting APIs, semantic capability
negotiation, and capability-bounded actions. What is missing is one lifecycle
contract that helps a person answer five ordinary questions:

1. who is responsible for this app or reusable artifact;
2. what it can do and why it needs that access;
3. what changed since the last trusted release;
4. what happens when it is vulnerable, abandoned, suspended, or sold; and
5. how to leave without losing control of personal data.

The related
[trusted developer ecosystem roadmap](../PLAN/trusted-developer-ecosystem-roadmap.md)
sequences that work. The proposed execution backlog is
[TODO 27](../TODO/claude-todo/27-trusted-developer-ecosystem.md).

## Evidence ledger

| Claim | Repository evidence | Confidence and refresh trigger |
| --- | --- | --- |
| App registration already has a protected server-owned identity and bounded callback surface. | [`apps.ts`](../remix/app/api/utils/apps/apps.ts) creates protected `app` Things, mints `clientId`, normalizes exact HTTPS origins, supports exact native callback URIs, and exposes only name/client id to the anonymous authorization lookup. | High for this source snapshot. Re-read after app schema, origin matching, or registration changes. |
| Browser and native authorization use explicit, enforceable boundaries. | [`AuthorizePage.tsx`](../remix/app/components/OAuth/AuthorizePage.tsx) validates the app/origin, uses an exact `postMessage` target, frame-denies the flow, and routes native clients through one-time S256 PKCE codes. [`scopes.ts`](../remix/app/api/utils/apps/scopes.ts) distinguishes required, optional, baseline, picker, and exact privacy-expanding scopes. | High for repository behavior; the complete live flow was not exercised in this docs-only run. |
| A compatibility exception still needs an ecosystem migration policy. | `sessionScopes()` maps pre-scope app sessions to `profile` plus `app-data`. This is explicit backward compatibility, not evidence of a current exploit, but a distribution policy must say when legacy grants expire or require fresh consent. | High for this commit. Refresh if legacy-session handling changes. |
| Revocation exists at user, developer, and platform layers. | [`grants.ts`](../remix/app/api/utils/apps/grants.ts) revokes all of one user's live sessions for an app. `deleteApp()` transactionally removes the developer app while revoking its sessions and preserving user-owned namespace data. `setAppRevoked()` is the admin suspension switch and does not resurrect swept sessions on restore. | High for source behavior. Re-test transaction, token, and restore behavior before a shipped ecosystem claim. |
| People can inspect and remove app-owned storage independently of a live grant. | [`ConnectedAppsSection.tsx`](../remix/app/components/Apps/ConnectedAppsSection.tsx) joins grants with storage summaries, including disconnected or deleted apps. [`AppsDataPage.tsx`](../remix/app/components/Apps/AppsDataPage.tsx) exposes stored data, the app's current shared lens, per-entry deletion, and namespace-wide deletion. | High for source presence. Desktop/mobile, empty, stale, orphaned, and failure states need live re-verification. |
| App data is namespaced, user-owned, quota-bounded, and deliberately narrower than first-party social access. | [`16-full-power-app-namespaces.md`](../TODO/claude-todo/16-full-power-app-namespaces.md), [`FUNDAMENTALS.md`](../FUNDAMENTALS.md), and [`DECISIONS.md`](../DECISIONS.md) define server-stamped scalar `appId`, audience ACLs, overlapping byte ledgers, protected kinds, and closed feed/social routes. | High for the documented contract; current production migration readiness was not inspected here. |
| API compatibility has a single generated contract. | [`thingtimeCapabilities.ts`](../remix/app/api/utils/capabilities/thingtimeCapabilities.ts) generates an origin-scoped semantic feature/operation manifest from the canonical API docs. [`thingtimeCapabilities.test.ts`](../remix/app/api/utils/capabilities/thingtimeCapabilities.test.ts) checks route coverage and compatible-versus-breaking SemVer behavior. | High for this branch. Re-run the capability suite after any endpoint or feature-version change. |
| Developers have an explorable path before production registration. | API entries in [`apiDocs.ts`](../remix/app/docs/apiDocs.ts) generate machine-readable `-docs` routes and the browser reference. OAuth sandbox tokens exercise the same bounded app-data and Things surfaces without a production registration. | High for repository contracts; documentation comprehension and time-to-first-success are unmeasured. |
| Reusable artifacts already have different trust boundaries. | [`FUNDAMENTALS.md`](../FUNDAMENTALS.md) defines schemas, components, actions, and webpages as Things. Actions declare capabilities that only narrow the invoker's access; components and pages render through bounded vocabularies. | High for the model. A common publisher/release/review contract across these artifact families was not found. |
| The ChatGPT plugin has a concrete but one-off distribution handoff. | [`SUBMISSION.md`](../integrations/ChatGPT/plugin/thingtime-chatgpt/SUBMISSION.md) records fixed-origin deployment, publisher/legal/support materials, reviewer credentials, positive/negative cases, tool annotations, approval, and update limitations. | High for the handoff document. External platform requirements are time-sensitive and must be refreshed before submission. |
| No general Thingtime distribution/readiness contract was found. | A scoped review of the app schema, app/OAuth UI, API docs, planning tree, and plugin handoff found no canonical app declaration covering publisher accountability, support/security contacts, privacy terms, release version, capability requirements, scope-change history, artifact provenance, review receipts, vulnerability response, abandonment, transfer, or rollout channel. | High for this repository snapshot, not proof that no off-repository process exists. Repeat the scoped search and ask the owner before implementation. |
| GitHub issues are not the ecosystem backlog. | GitHub returned zero open issues during this run while the TODO tree and open PRs contain substantial app, action, component, and plugin work. | High only for the timestamp. Never interpret an empty issue list as absence of integration risk or developer need. |

## External design references

These are design inputs, not a compliance claim or a requirement to copy a
third-party trust badge.

- [RFC 9700, OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
  covers current redirect-flow, PKCE, token replay, privilege restriction,
  metadata, and browser communication threats. Thingtime's exact origins,
  audience binding, PKCE, and revocation are foundations to preserve.
- [NIST Secure Software Development Framework 1.1](https://csrc.nist.gov/pubs/sp/800/218/final)
  provides a common vocabulary for secure development and supplier
  communication. Use it to shape evidence questions, not as a binary badge or
  substitute for app-specific review.
- [OpenSSF Scorecard](https://openssf.org/projects/scorecard/) demonstrates how
  automated repository checks can inform risk decisions. Scores are signals,
  not permission to install, execute, rank, or publicly accuse a maintainer.
- The [OpenID Shared Signals and Events Framework](https://openid.net/specs/openid-sse-framework-1_0.html)
  is a useful pattern for bounded security-state notifications such as session
  revocation. The linked document is a draft and does not establish that
  Thingtime should implement this protocol.

## Current strengths to preserve

- One server-owned app identity and one explicit owner/co-manager model.
- Exact origin and callback validation instead of caller-provided redirect
  flexibility.
- Required and optional permissions are visible before authorization; privacy-
  expanding leaves require exact consent.
- App capabilities narrow existing user authority and never silently grant a
  foreign app first-party feed, social graph, protected-kind, or public-write
  access.
- Revocation has separate user, developer, and platform controls.
- User data survives app deletion and remains browseable/deletable by its owner.
- Byte ledgers bound storage without turning document count into a misleading
  safety proxy.
- Sandbox, API docs, and generated capability manifests can become one
  conformance kit rather than separate examples.
- High-impact MCP writes already use explicit confirmation, signed previews,
  optimistic concurrency, bounded receipts, and negative reviewer tests.

## Gaps that block trustworthy ecosystem scale

1. **No canonical app declaration.** Registration captures name, origins,
   native callbacks, owner, and storage policy, but not purpose, publisher,
   support/security contact, privacy/terms URLs, data lifecycle, release,
   capability requirements, accessibility/language support, or incident route.
2. **Identity is not accountability.** A random `clientId` proves namespace
   uniqueness, not who maintains the app, whether a domain is controlled, or
   who can respond to a vulnerability.
3. **No release or scope-delta contract.** There is no immutable versioned app
   release, reviewed declaration, changelog, permission diff, compatibility
   range, rollout channel, or rule for when an update needs renewed consent.
4. **No reusable review receipt.** The ChatGPT handoff has thoughtful cases,
   but Thingtime cannot yet represent what was reviewed, against which source,
   by whom, with which automated/manual evidence, expiry, limitations, or
   superseding result.
5. **Artifact families are disconnected.** Apps, schemas, components, actions,
   webpages, and MCP capabilities need provenance and dependency graphs without
   pretending one review makes every embedded artifact safe.
6. **No abandonment or transfer path.** App deletion and suspension are clear;
   maintainer inactivity, ownership transfer, compromised publisher access,
   deprecated capability ranges, and end-of-support are not.
7. **No staged ecosystem incident contract.** The admin kill switch is useful,
   but quarantine, narrow capability disablement, affected-version targeting,
   developer notification, user explanation, remediation, appeal, and safe
   restoration are not one state machine.
8. **Discovery can outrun trust.** Ranking by installs, usage, revenue, or
   popularity before provenance, review freshness, support, accessibility, and
   safety are understandable would reward risky growth.

## Candidate trust objects

Names are deliberately provisional. They become architecture only after an
owner decision recorded in [`DECISIONS.md`](../DECISIONS.md).

| Object | Purpose | Boundary |
| --- | --- | --- |
| App declaration | Publisher-controlled purpose, contacts, URLs, data lifecycle, requested scopes, capability ranges, and support promises. | Structured claims, not platform endorsement; validated and size-bounded. |
| Release | Immutable content/source digest, declaration version, dependency/artifact set, changelog, compatibility range, and rollout channel. | A release never inherits authority from popularity or prior versions. |
| Review receipt | Exact release plus automated/manual evidence, reviewer, policy version, limitations, expiry, and result. | Append-only and supersedable; does not expose private reviewer evidence. |
| User grant | Exact approved scopes, selected Things, app/release context, time, and consent version. | Existing server-side enforcement remains authoritative; scope expansion requires an explicit path. |
| Ecosystem event | Ownership, deprecation, vulnerability, quarantine, restoration, or end-of-support transition. | Relational, auditable, projected by role, and safe against rumor/defamation abuse. |

## Abuse and failure map

| Risk | Design implication |
| --- | --- |
| Typosquatting or lookalike publishers | Verify control of exact domains and display stable publisher identity separately from app name; never rank names as proof. |
| Scope bait-and-switch | Compare immutable release declarations and require renewed consent before any permission expansion. |
| Safe wrapper around unsafe dependencies | Review the complete declared artifact/dependency set and show which parts were not assessed. |
| Compromised maintainer account | Require strong maintainer authentication, scoped co-manager roles, recovery/transfer rules, and an emergency freeze that cannot silently publish. |
| Review badge goes stale | Time-bound receipts, show exact release and policy version, and withdraw the visible claim when evidence expires. |
| Automated scan false confidence | Present individual checks and limitations; automated scores never authorize execution or suppress manual risk review. |
| Malicious reports against developers | Evidence, bounded reporter access, reasoned decisions, appeal, and no public accusation before verification. |
| Vulnerability response leaks exploit detail | Use a private, least-privilege security channel and publish coordinated user guidance only when safe. |
| App suspension strands users | Preserve owner data access/export/delete, explain current state, and allow a least-authority recovery path without restoring compromised tokens. |
| Abandoned integration keeps broad access | Define inactivity/support signals, notify maintainers and users, narrow or expire grants under an approved policy, and never infer abandonment from one missed ping. |
| Popularity becomes pay-to-trust | Keep ranking, sponsorship, and security review independent; paid placement must be labeled and cannot override safety gates. |

## Candidate measures

Definitions, owners, minimum cohorts, and privacy rules must be approved before
collection.

| Measure | Candidate definition | Guardrail |
| --- | --- | --- |
| First sandbox success | Eligible developers completing one documented read and one reversible private write through the sandbox. | No credential, payload, URL query, or private Thing content in analytics. |
| Review reproducibility | Sampled release reviews another authorized reviewer can reproduce from the immutable receipt inputs. | Differences remain visible; no averaging into a trust score. |
| Permission-change clarity | Eligible updating users who correctly identify added/removed scopes before deciding. | No preselected new scope or blocked data export. |
| Revocation completion | User/developer/platform revocations that invalidate every affected token and keep owner data controls available. | Zero resurrection after restore and zero cross-app impact. |
| Supported-release health | Active installs on supported, compatible, non-quarantined releases with current support and review evidence. | Never publish person-level install histories or penalize small developers solely for volume. |
| Vulnerability response | Time from validated private report to containment, safe developer contact, user guidance, and verified remediation. | Do not reward premature disclosure or silent indefinite quarantine. |

## Open questions

1. Is the first ecosystem about registered OAuth apps, reusable schemas/
   components/actions/pages, MCP plugins, or one small cross-family contract?
2. What proves publisher identity: account history, domain control, organization
   verification, signed releases, or a layered combination?
3. Which declaration fields are public, user-only, reviewer-only, or platform-
   only, and who may change each one?
4. What release change is patch/minor/major, and which changes require review,
   renewed consent, or a new `clientId`?
5. Can initial conformance be entirely self-serve and sandbox-based? Which
   capabilities always require human review?
6. How do app releases bind schemas, components, actions, webpages, and external
   dependencies without letting a reviewed shell bless unreviewed children?
7. What is the narrowest useful quarantine: release, capability, origin,
   publisher, or entire app?
8. Who may report security, privacy, safety, IP, impersonation, or quality
   problems, and which existing safety workflows own each class?
9. What evidence and response target can Thingtime honestly staff before public
   discovery opens?
10. Which developer and user measures answer real questions without recording
    source code, app payloads, private Things, or person-level install graphs?
11. How can sustainable fees fund review/support without becoming pay-to-rank,
    pay-to-trust, or a privacy/security tax?

## Refresh checklist

Before changing a milestone or release to shipped:

1. fetch the current integration branch and inspect exact app, OAuth, grant,
   scope, namespace, capability, action, component, webpage, docs, and test
   contracts;
2. verify sandbox, registration, authorization, scope denial, update,
   revocation, suspension, restore, orphaned-data, export/delete, and account-
   switching paths through the real API and live desktop/mobile UI;
3. verify every app-facing endpoint against the origin-scoped capability
   manifest and explicit client requirement maps;
4. inspect review capacity, incidents, support paths, open PRs/issues, CI,
   deployment receipts, and external platform policies without copying
   credentials or private user/developer data;
5. refresh the external standards and specialist security/legal/accessibility
   review; and
6. date the evidence pack and preserve every limitation.
