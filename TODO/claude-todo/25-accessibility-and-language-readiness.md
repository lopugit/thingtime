# 25 — Accessibility and language readiness 🌍

**Status:** 🟣 Proposed · planning only · added 2026-09-02

**Owner:** Unassigned; product owner coordinates accessibility, design-system,
localization, privacy/security, QA, and support decisions

**Plan:**
[`PLAN/accessibility-and-language-readiness-roadmap.md`](../../PLAN/accessibility-and-language-readiness-roadmap.md)

**Evidence:**
[`NOTES/accessibility-and-language-readiness-baseline.md`](../../NOTES/accessibility-and-language-readiness-baseline.md)

## Goal

Make Thingtime's approved core journeys complete and understandable across
supported input methods, assistive technologies, motion/contrast/zoom needs,
viewports, and UI locales, with evidence that remains true release after
release.

## Problem

Thingtime has several strong local affordances and feature-level manual checks,
but the public shell is statically English, there is no owned locale layer or
accessibility test command, and no release-wide journey/severity contract exists.
Adding more surfaces and translations before establishing shared semantics,
focus, announcements, layout, message formatting, and gates would multiply the
unknown states.

This epic turns the approved roadmap into implementable work. It does not claim
conformance, authorize private-content translation, or approve a locale/tool by
itself.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns shared outcome measurement;
  this epic creates no parallel analytics store.
- [TODO 23](./23-data-portability-and-exit.md) and
  [TODO 24](./24-attention-agency-and-calm-use.md) must pass the same access and
  language gates for exit, feed, and notification journeys.
- UI locale, authored-content language, and optional translation remain separate.
- Accessibility and language choice are available to every account tier.
- All preference/data writes go through the canonical Thingtime API and preserve
  account, custom-endpoint, cache, and optimistic-render boundaries.

## Phase 0 — Approve the contract

- [ ] Select initial complete journeys and the supported browser/device,
      keyboard, screen-reader, touch, zoom/reflow, contrast, motion, and viewport
      matrix.
- [ ] Decide the WCAG 2.2 target, severity definitions, release blockers,
      waiver authority/expiry, and public-claim policy.
- [ ] Choose source locale, pilot locale, pseudo-expanded and RTL fixtures, and
      human language reviewers.
- [ ] Decide locale precedence and persistence across explicit account choice,
      safe local cache, URL, browser suggestion, signed-out state, account
      switching, and custom endpoints.
- [ ] Approve privacy-safe test artifacts and forbid private/user content in
      automated accessibility or translation tooling.
- [ ] Assign product, accessibility, design-system, localization,
      privacy/security, QA, and support owners.
- [ ] Record durable choices in [`DECISIONS.md`](../../DECISIONS.md).

**Gate:** no broad remediation, locale migration, or translation until the
owner approves this packet.

## Phase 1 — Establish repeatable evidence

- [ ] Inventory shared primitives and every state in the selected journeys:
      loading/cached, empty, success, validation, network failure, permission
      change, destructive confirmation, timeout, and recovery.
- [ ] Inventory UI copy, errors, Lopu messages, notifications, emails, metadata,
      dates, numbers, plurals, sorting, content-language, and direction behavior.
- [ ] Add deterministic rendered fixtures and one pinned accessibility smoke
      command. Use stable owned data; never crawl private accounts.
- [ ] Define finding severity, false-positive disposition, narrow expiring
      suppressions, artifact retention, and exact tool/browser version receipts.
- [ ] Add one cross-product manual matrix to [`TESTING.md`](../../TESTING.md)
      mapping each core journey to keyboard, screen-reader, touch, zoom/reflow,
      reduced-motion, contrast, narrow-screen, and error recovery.
- [ ] Create an impact-led barrier ledger with journey, reproduction, owner,
      workaround, severity, target date, evidence, and retest trigger.

## Phase 2 — Repair shared foundations first

- [ ] Add landmarks and a visible-on-focus skip path to the primary content.
- [ ] Standardize page titles, heading structure, visible focus, focus order,
      focus return, overlay behavior, and no-obscured-focus tests.
- [ ] Standardize native controls, accessible names, labels/descriptions,
      error association, status announcements, busy/disabled state, and
      destructive-action confirmation.
- [ ] Cover drawer, Commander, menus, dialogs, editors, drag/reorder, uploads,
      toasts, media, and rendered Things without pointer-only behavior.
- [ ] Audit every supported theme for text/non-text contrast, color-independent
      meaning, target size, text spacing, zoom/reflow, orientation, and high
      contrast/forced-colors behavior.
- [ ] Make all decorative/interaction animation honor OS reduced motion and the
      explicit Thingtime Motion setting, with equivalent non-motion feedback.
- [ ] Verify registration, login, recovery, verification, 2FA, and switching
      against the approved accessible-authentication contract.

## Phase 3 — Build one locale path end to end

- [ ] Choose one message/formatting library and stable key convention; document
      extraction, review, fallback, missing-key, versioning, and rollback rules.
- [ ] Migrate one complete journey including visible copy, validation/errors,
      Lopu output, metadata, relevant email/notification text, dates, numbers,
      plurals, and tests.
- [ ] Set root `lang` and `dir` from the canonical locale before meaningful
      paint; mark language-of-part changes without rewriting authored content.
- [ ] Add an accessible language setting with optimistic last-known first paint,
      API reconciliation, account isolation, offline behavior, and no content
      loss or navigation reset.
- [ ] Make missing/stale catalogs loud in non-production and safely observable
      in production without exposing internals or falling into mixed-language
      loops.
- [ ] Test source, expanded, missing-key, and RTL fixtures in CI and live
      desktop/mobile walkthroughs.

## Phase 4 — Pilot and operationalize

- [ ] Translate the approved journey for the selected pilot locale with
      contextual fixtures, glossary, tone, variable/plural guidance,
      attribution, and human review.
- [ ] Validate comprehension and task completion with relevant speakers and
      assistive-technology users; document recruitment, consent, compensation,
      and data minimization.
- [ ] Verify search, sorting, input, names, font fallback, wrapping, truncation,
      dates/numbers, metadata, notifications, and support in the pilot locale.
- [ ] Roll out reversibly; preserve one-action return to the source locale and
      unsaved work.
- [ ] Add CI/release evidence requirements, blocker response targets, a public
      help/report path, and dated tested-scope/known-limitations copy.
- [ ] Define community translation review, moderation, licensing, credit,
      dispute, rollback, and maintenance before accepting contributions.

## Security, privacy, accessibility, and abuse checklist

- [ ] Never infer or store disability, assistive-technology use, writing
      proficiency, ethnicity, location, or vulnerable status from interaction
      patterns or content.
- [ ] Never record raw screen-reader speech, typed text, zoom/motion histories,
      per-person failure trails, credentials, private Things, messages, or
      attachments in test artifacts.
- [ ] Never send authored content to a translation provider without a separate
      approved purpose, consent/data-flow review, minimization, retention,
      provenance, and deletion contract.
- [ ] Translation cannot alter permissions, identity, destructive meaning,
      security instructions, URLs, code, identifiers, or source data.
- [ ] Accessibility metadata and alternative text follow the Thing's existing
      ownership/ACL and do not reveal private media or hidden state.
- [ ] Language and access preferences use bounded canonical settings, survive
      migration, cannot cross accounts/endpoints, and are never marketing
      segmentation inputs.
- [ ] Third-party components, embeds, generated UI, themes, and imports keep
      separate evidence and cannot inherit an “accessible” label from the host.
- [ ] Barrier-report and translation-contribution channels defend against spam,
      harassment, unsafe links, impersonation, and reviewer overload.

## Acceptance criteria

- The owner-approved journeys, environment matrix, WCAG target, severity,
  waiver expiry, locales, precedence, privacy rules, and accountable owners are
  linked here and recorded where durable.
- Every approved core journey has deterministic fixtures and passes the required
  keyboard, screen-reader, touch, zoom/reflow, reduced-motion, contrast,
  narrow-screen, and error-recovery checks with zero release blockers.
- CI fails on new serious/critical owned-fixture findings, missing required
  evidence, catalog/key drift, pseudo-locale breakage, and approved layout/
  direction regressions; suppressions are narrow, justified, and expiring.
- The migrated journey has no pointer-only action, keyboard trap, hidden or
  obscured focus, inaccessible status/error, work loss, required page-level
  horizontal scroll, or motion-only information.
- Root `lang`/`dir`, language-of-part, visible copy, errors, Lopu messages,
  metadata, notifications/emails, dates, numbers, plurals, sorting, and fallback
  all derive from the approved contract.
- Explicit locale choice paints from safe last-known state, reconciles through
  the real API, and survives reload, offline recovery, account switching,
  custom endpoints, missing catalogs, and rollback without leaking state.
- Source, expanded, RTL, and human-reviewed pilot fixtures preserve equivalent
  meaning, permissions, actions, focus/reading order, and task completion.
- User-authored content remains original and attributable; no private content
  reaches translation or audit services without a separately approved contract.
- Accessibility/help and known-limitations copy states exact tested scope and
  dates; no release or marketing claim exceeds the evidence pack.
- API docs/capabilities, settings/help, `TESTING.md`, CI, preview, and live
  behavior agree before status moves to shipped.

## Concrete next action

Prepare the Phase 0 owner packet with:

1. complete journeys and environment matrix;
2. WCAG target, severity, release blockers, and waiver expiry;
3. source/pilot locales plus pseudo-expanded and RTL fixtures;
4. locale precedence, persistence, and content-language boundaries;
5. automated smoke recommendation and privacy-safe artifact policy;
6. human testing and language-review plan;
7. named owners and response targets; and
8. rollout, rollback, stop, and public-claim rules.

Do not install tooling, migrate copy, translate content, or publish an
accessibility/multilingual claim until the packet is approved.
