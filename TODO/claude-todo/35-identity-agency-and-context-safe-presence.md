# 35 — Identity agency and context-safe presence

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Identity agency and context-safe presence baseline](../../NOTES/identity-agency-and-context-safe-presence-baseline.md)

**Plan:**
[Identity agency and context-safe presence roadmap](../../PLAN/identity-agency-and-context-safe-presence-roadmap.md)

## Objective

Make Thingtime's account, authenticator, username, presentation, context
presence, claim, proofing, role, authorization, recovery, and remedy boundaries
understandable and enforceable. Start only with an owner-facing comparison of
the exact current “Only you” and “Anyone” profile projections. Do not implement
new aliases, credentials, identity proofing, badges, or high-impact decisions.

## Required owner decisions before implementation

- [ ] Approve the identity vocabulary and reject any label that collapses
      authentication, verification, presentation, trust, truth, and authority.
- [ ] Approve the adult/synthetic public-presence preview cohort, purpose,
      duration, environments, task rubric, support, cleanup, and stop authority.
- [ ] Approve the exact owner/anonymous audiences, canonical projectors, field
      labels, correction routes, stale/error states, and residual-disclosure copy.
- [ ] Approve a no-collection contract for profile values, identifiers,
      screenshots, relationship graphs, preview views, and free text.
- [ ] Name product, privacy, security, accessibility/language, safety, legal,
      reliability, recovery, operations, support, and incident owners.
- [ ] Explicitly exclude mutable usernames, new pseudonyms, proofing, credentials,
      public badges/scores, minors, and sensitive or high-impact uses.

No unchecked item above is permission to start engineering or recruit people.

## Dependencies and boundaries

- [ ] [`FUNDAMENTALS.md` §3](../../FUNDAMENTALS.md) remains authoritative for
      protected data, relational children, versioned collection getters, bounded
      aggregation, and public projections.
- [ ] [TODO 18](./18-account-invite-links.md) owns account invitation and
      recipient-controlled prefill; an invite grants no identity claim or role.
- [ ] [TODO 19](./19-anonymous-group-chats.md) owns chat-local anonymity. This
      epic must not silently broaden or weaken that proposed boundary.
- [ ] [TODO 23](./23-data-portability-and-exit.md) owns export, deletion,
      closure, and verified exit.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared
      accessibility and locale foundations.
- [ ] [TODO 26](./26-community-safety-and-accountable-moderation.md) owns
      block, report, investigation, appeal, remedies, and accountable access.
- [ ] [TODO 27](./27-trusted-developer-ecosystem.md) owns app identity, scopes,
      consent, review, incident containment, and publisher claims.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns truthful state,
      restore proof, degraded operation, and incidents.
- [ ] [TODO 29](./29-content-provenance-and-correction-integrity.md) owns
      content assertions and corrections; identity evidence is not content truth.
- [ ] [TODO 34](./34-collaboration-agency-and-shared-stewardship.md) owns
      artifact roles and contribution authority; identity grants neither.

## Phase A — Characterize the current boundary

- [ ] Inventory registration, login, email verification, passkeys, sessions,
      profile edit/read, account switch, custom endpoints, cross-deployment
      hints, recovery, blocking, closure, export, and restore.
- [ ] Trace username and account identifiers through URLs, ACLs, search, apps,
      invites, chats, subspaces, notifications, caches, moderation, support,
      analytics, logs, backups, and deep links.
- [ ] Enumerate every owner, anonymous, signed-in, custom-audience, OAuth-app,
      collaborator, moderator, operator, support, and export projection.
- [ ] Add characterization tests for `toPublicProfile()`, profile routes,
      userinfo scopes, owner-only email display, blocked/deleted accounts, and
      cross-account/cache isolation before changing behavior.
- [ ] Prove current passwords, passkeys, sessions, and verified email make no
      real-world identity, role, truth, or authorization claim.

## Phase B — Register the preview contract

- [ ] Define semantic capability IDs and versions for owner disclosure review
      and anonymous-profile preview if new remote operations are required.
- [ ] Reuse the canonical owner/public profile projectors. Do not copy visibility
      rules into UI state or a parallel preview schema.
- [ ] Define labels for platform handle, self-presentation, protected account
      data, authenticator, owner preference, and not-collected/non-disclosed data.
- [ ] Specify safe stale, unavailable, logged-out, wrong-account, switched-
      endpoint, blocked, deleted, and partial-media states.
- [ ] Register every new `/api/v1/...` route in its route file, Nitro import map,
      API docs/route registry, capability manifest, and client requirements.

## Phase C — Build the bounded public-presence preview

- [ ] Add an owner-only “Public presence preview” entry at the relevant profile
      or privacy surface, clearly marked as current state rather than assurance.
- [ ] Render server-generated “Only you” and “Anyone” views side-by-side or in
      an accessible equivalent at narrow widths.
- [ ] Explain that username is an address, profile fields are self-presented,
      email verification proves address control, and passkeys authenticate an
      account; none proves real-world identity or general trust.
- [ ] Link each editable field to existing controls and make non-editable or
      protected state clear without revealing secret values or internal keys.
- [ ] Validate the anonymous view through the real projection without sending
      owner-only state into public caches, URLs, logs, errors, or analytics.
- [ ] Preserve last-known safe state while visibly distinguishing stale/error
      state from a successful current projection.

## Phase D — Make correction and recovery truthful

- [ ] Exercise profile correction, OAuth scope revoke, session stop, passkey/
      email change, account/endpoint switch, block, report, closure, restore,
      and support against exact current state.
- [ ] Re-authenticate sensitive changes and ensure stale sessions, tokens,
      caches, tabs, preview results, and queued notifications stop as approved.
- [ ] State what stops, remains, cannot be recalled, and can be remedied after
      profile change, block, revocation, account closure, deletion, or restore.
- [ ] Add accessible pre-action review and post-action receipts for significant
      identity/disclosure changes without copying protected values into receipts.
- [ ] Test enumeration, impersonation, recovery takeover, cross-account cache,
      custom endpoint, replay, and stale-write scenarios with synthetic accounts.

## Phase E — Validate the complete pilot

- [ ] Unit-test canonical projection equality, allowlists, capability/version
      negotiation, authorization, safe errors, cache headers, and no-secret rules.
- [ ] Integration-test owner/anonymous requests, signed-in leakage, account and
      endpoint switching, block/delete/change races, stale tabs, offline/retry,
      app scopes, revocation, recovery, and restore.
- [ ] Exercise the real owner preview, anonymous profile, edit/correct, revoke,
      session-stop, report, closure boundary, and support paths.
- [ ] Complete desktop/mobile browser journeys with keyboard, touch, screen
      reader, zoom/reflow, reduced motion, locale, slow network, offline
      transition, errors, retry, and recovery.
- [ ] Inspect responses, HTML, DOM attributes, URLs, headers, caches, logs,
      metrics, traces, errors, notifications, exports, backups, and support
      projections for unapproved identity or correlation data.
- [ ] Smoke any changed capability manifest and prove compatible additive
      versions work while missing/breaking requirements fail closed.

## Phase F — Run and report one bounded cohort

- [ ] Use adult participants with synthetic or participant-controlled,
      non-sensitive profiles; demonstrate withdrawal, correction, and support.
- [ ] Measure disclosure prediction, projection equivalence, correction/recovery,
      accessibility, privacy/security incidents, latency, failure, and support
      load separately.
- [ ] Retain only approved aggregate counts or redacted structured-session
      evidence; no profile values, identifiers, screenshots, free text, or graphs.
- [ ] Review every failure and affected-person remedy before aggregate claims.
- [ ] Publish a bounded report with task, cohort, contract version, conditions,
      exclusions, failures, incidents, remedies, deletions, limitations, owner,
      and refresh date.

## Acceptance criteria

- [ ] Account, authenticator, username, presentation, claim, proofing, role,
      authorization, traceability, recovery, and remedy remain distinct in copy,
      schema, UI, API, tests, and support guidance.
- [ ] The preview and live anonymous profile use the same canonical server
      allowlist and match exactly for the approved fields and states.
- [ ] Email, birthday, verification state, credentials, unique keys, quotas,
      preferences, admin state, recovery data, and internal mappings never reach
      an unauthorized audience or public cache.
- [ ] The owner can predict disclosure, correct presentation, revoke app access,
      stop stale sessions, and reach an accountable remedy.
- [ ] Account and endpoint switching never presents one identity's cached data
      as another's current state.
- [ ] No authentication factor, verified channel, signature, issuer claim,
      relationship, role, popularity signal, or payment is presented as truth,
      safety, endorsement, legal identity, or permission.
- [ ] Complete-journey accessibility, language, privacy, security, reliability,
      constrained-device/network, continuity, restore, and remedy tests pass.

## Stop conditions

Pause intake and disable the narrowest affected capability if:

- preview and actual disclosure disagree;
- protected data, a global identifier, recovery material, or context mapping
  reaches an unauthorized response, UI, cache, log, error, export, notification,
  backup, support view, or third party;
- account/endpoint switching, stale state, replay, or recovery grants access or
  presents the wrong identity;
- product language overstates authentication, verification, anonymity, issuer
  authority, claim truth, role, or permission;
- impersonation, enumeration, coercion, discrimination, or recovery takeover
  cannot be contained and remedied;
- correction, revoke, block, closure, deletion, restore, appeal, or support
  cannot reach the approved outcome;
- a critical accessibility, language, device, or network profile is blocked; or
- accountable owners cannot investigate, communicate, and remedy incidents.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, data cleanup, and owner approval.

## Explicit non-goals

- No username rename, multiple personas, context aliases, anonymous-chat build,
  externally verifiable profile, claim store, credential wallet, proofing vendor,
  public badge, reputation score, or real-name requirement.
- No biometric, government-ID, address-book, employment, education, health,
  financial, location, behavioural, social-graph, or inferred identity data.
- No ranking, recommendation, moderation, authorization, pricing, eligibility,
  or access decision based on identity claims.
- No minors, institutions, workplaces, schools, public-sector decisions, money,
  or sensitive/high-impact domains.
- No claim that a preview open, settings change, login, passkey, verified email,
  signature, credential, role, relationship, or account age proves identity,
  trust, safety, truth, authority, inclusion, or usefulness.
