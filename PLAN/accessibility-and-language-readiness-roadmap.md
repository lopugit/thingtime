# Accessibility and language-readiness roadmap

**Status:** Proposed · owner decision required

**Evidence:**
[Accessibility and language-readiness baseline](../NOTES/accessibility-and-language-readiness-baseline.md)

**Execution backlog:**
[TODO 25 — Accessibility and language readiness](../TODO/claude-todo/25-accessibility-and-language-readiness.md)

**Related:**
[Trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md),
[attention agency and calm use](./attention-agency-roadmap.md), and
[data portability and graceful exit](./data-portability-and-exit-roadmap.md)

## Outcome

People can complete Thingtime's approved core journeys regardless of supported
input method, assistive technology, motion preference, zoom, viewport, or UI
language. Accessibility and language quality become versioned release evidence,
not aspirations or one-time audits.

## Non-goals

- Claiming universal accessibility or legal compliance from automated scores.
- Translating every historical string before the shared foundation is sound.
- Auto-translating private user content or sending it to a third party.
- Treating a language picker, ARIA quantity, or passing lint as outcome proof.
- Making accessibility, reduced motion, language choice, export, or support a
  premium entitlement.
- Blocking all delivery on low-impact enhancements outside the approved scope.

## Principles

1. **Complete processes over isolated widgets.** Test what a person needs to
   finish, including errors and recovery.
2. **Native semantics first.** Use ARIA to complete a pattern, not disguise an
   unsuitable custom control.
3. **One locale contract.** Message lookup, formatting, fallback, document
   language, direction, and persistence have one owner.
4. **Automation plus humans.** Machines provide fast regression signal;
   keyboard, screen-reader, cognitive, language, and lived-experience review
   decide whether the journey works.
5. **No accessibility surveillance.** Never infer disability or optimize from
   person-level assistive-technology behavior.
6. **Optimistic and resilient.** Locale and access preferences paint from safe
   last-known state and reconcile without losing work or context.
7. **No false claims.** A support matrix and known limitations travel with any
   accessibility or locale statement.

## Dependencies

- [`FUNDAMENTALS.md`](../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../DECISIONS.md) remain authoritative.
- [TODO 22](../TODO/claude-todo/22-trustworthy-adoption-loop.md) owns the shared
  outcome and signal contract.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) must make export,
  deletion, and closure usable through the same access modes and supported
  locales.
- [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md) owns feed,
  motion-adjacent, notification, and stopping-point choices.
- The theme system owns contrast and motion tokens; shared navigation, Lopu,
  forms, editors, overlays, attachments, and rendered Thing primitives are
  leverage points, not separate accessibility programs.
- Any new server-stored locale setting must use the canonical API and settings
  model, with a deliberate privacy, migration, cache, and capability contract.

## Measures and release policy

Approve the definitions and environments before collecting results.

| Measure | Gate candidate |
| --- | --- |
| Core journey matrix | Every approved journey passes its required keyboard, screen-reader, touch, zoom/reflow, reduced-motion, contrast, narrow-screen, and failure-recovery paths. |
| Severe blockers | Zero unresolved blockers for the surface being promoted; a temporary waiver names owner, impact, workaround, expiry, and rollback. |
| Automated fixture regression | Zero new serious/critical findings on stable owned fixtures; suppressions are specific, reviewed, expiring, and linked to evidence. |
| Locale coverage | Every in-scope product message, error, notification, email, metadata string, date, number, and plural uses the canonical layer or has a named exception. |
| Pilot-language parity | The same core tasks succeed with reviewed copy and no approved regression in comprehension, completion, clipping, focus, or support burden. |
| RTL and expansion resilience | Pseudo-locales and the chosen direction fixture preserve reading order, focus order, content, controls, and layout. |
| Barrier response | Every confirmed blocker receives acknowledgement, owner, mitigation, and target time under the approved policy. |

## Milestones

### M0 — Approve scope, target, and ownership

**Outcome:** the team knows what “ready” means before choosing tools.

- Select the initial complete journeys and supported browser, device, keyboard,
  screen-reader, zoom, contrast, motion, and viewport matrix.
- Decide whether WCAG 2.2 AA is the engineering target and define severity,
  promotion gates, waiver authority, expiry, and public-claim rules.
- Select the source locale, pilot locale, pseudo-locales, and a right-to-left
  direction fixture. Name human language reviewers.
- Decide locale precedence across explicit account choice, device cache, URL,
  browser suggestion, and fallback.
- Separate UI locale, content language, and translation in the data model.
- Assign accountable product, accessibility, design-system, localization,
  privacy/security, QA, and support owners.
- Record durable decisions in [`DECISIONS.md`](../DECISIONS.md).

**Gate:** no broad remediation or translation starts until the owner approves
the target, journeys, locale contract, owners, and stop conditions.

### M1 — Build a reproducible baseline

**Outcome:** the highest-impact barriers and copy/formatting surface are known.

- Inventory interactive primitives, overlays, focus transitions, live regions,
  headings/landmarks, images/media, forms/errors, animation, timeouts, auth, and
  generated/untrusted render surfaces.
- Inventory UI strings, API errors shown to people, notifications, emails,
  metadata, dates, numbers, plurals, sorting, search assumptions, content
  language, and direction-sensitive layout.
- Add stable rendered fixtures and one deterministic accessibility smoke command
  for fast regression signal. Pin tool/browser versions and store concise,
  privacy-safe artifacts.
- Run the manual matrix on each core journey and verify automated findings
  rather than bulk-fixing by selector.
- Create an impact-led backlog with owner, affected journey, reproduction,
  workaround, severity, evidence, and retest trigger.
- Publish no conformance percentage; describe tested scope and limitations.

**Gate:** the baseline is repeatable, the highest-severity findings are owned,
and no result includes private content or person-level access behavior.

### M2 — Repair shared interaction foundations

**Outcome:** fixing one primitive improves every consuming surface.

- Establish landmarks, skip navigation, useful page titles, visible focus,
  predictable focus return, and no-obscured-focus behavior.
- Standardize native control choice, names/roles/values, labels, descriptions,
  errors, status announcements, busy/disabled semantics, and destructive-action
  confirmation.
- Make drawers, modals, menus, grids, editors, drag/reorder controls, uploads,
  toasts, and Commander fully operable without pointer gestures.
- Make theme contrast, non-text contrast, zoom/reflow, text spacing, target size,
  orientation, and color-independent meaning testable across supported themes.
- Make every decorative and functional animation honor OS and explicit Thingtime
  preferences; keep equivalent non-motion feedback.
- Verify accessible authentication and recovery without memory/puzzle or copy/
  paste barriers unless a security necessity is documented.

**Gate:** shared foundations pass the matrix and no core journey retains a
release blocker before localization increases the test surface.

### M3 — Install one localization foundation

**Outcome:** product chrome can change locale without component-owned behavior.

- Choose one message/formatting system and stable key convention; keep source
  strings reviewable and ban silent component-local fallbacks.
- Move one vertical core journey end to end: visible copy, validation, errors,
  Lopu messages, notifications/email where used, metadata, dates, numbers,
  plurals, and tests.
- Set root `lang` and `dir` from the canonical locale before first meaningful
  paint; mark language-of-part changes where content differs.
- Persist explicit language choice optimistically through the canonical
  settings/API path and safe local cache without crossing accounts or endpoints.
- Define deterministic fallback, missing-key, stale-catalog, offline, and
  rollback behavior. Non-production must expose missing keys loudly; production
  must remain usable and observable without showing raw internals.
- Keep user-authored content unchanged and visibly attributable to its original
  language; translation remains out of scope.

**Gate:** the migrated journey passes source, pseudo-expanded, and direction
fixtures with identical functionality and no new severe accessibility blocker.

### M4 — Validate one human-reviewed pilot locale

**Outcome:** Thingtime learns how to support a language responsibly before
claiming a multilingual product.

- Translate the approved journey with context, screenshots/fixtures, glossary,
  tone, variable/plural constraints, attribution, and human review.
- Test comprehension and task completion with relevant speakers, including
  assistive-technology and narrow-screen paths where feasible.
- Verify search, sorting, input, names, dates, numbers, links, line breaking,
  truncation, font fallback, metadata, notifications, and support entry points.
- Label untranslated or intentionally source-language areas honestly.
- Provide one-action return to the source locale and preserve unsaved work.
- Roll out behind a reversible, owner-controlled availability gate.

**Gate:** pilot task parity and copy review pass, known limitations are current,
and support can reproduce and route language/accessibility reports.

### M5 — Make quality continuous and community-safe

**Outcome:** new features cannot quietly regress access or language coverage.

- Add blocking CI for stable automated checks, pseudo-locales, missing keys,
  catalog consistency, and owned fixture regressions.
- Add the manual journey matrix to [`TESTING.md`](../TESTING.md) and require
  relevant evidence in PR and release templates.
- Version translation catalogs with source changes, reviewer attribution,
  rollback, stale-string detection, and no secret/private content.
- Publish a plain-language accessibility/help channel and dated tested-scope /
  known-limitations page only after owners and response policy exist.
- Define community translation contribution, conduct, review, dispute, safety,
  license, credit, and maintenance rules before accepting bulk submissions.
- Review third-party components, embeds, imports, and generated UI separately;
  never inherit trust from the host page.

**Gate:** two release cycles preserve the contract, blocker response stays
within policy, and pilot quality does not rely on heroic one-off review.

## Risks and contingency paths

| Risk | Early signal | Response |
| --- | --- | --- |
| Automated-score theater | Score rises while a core journey remains blocked | Stop score reporting; retest complete processes and remediate by impact. |
| Localization doubles inaccessible states | Pseudo-locale or pilot copy creates clipping, broken focus, or unreadable announcements | Hold M4; repair shared primitives and repeat M2/M3 gates. |
| Locale architecture fragments | Components introduce private keys, formatters, or fallbacks | Block the change; route through the one canonical layer. |
| Private content reaches a translator | Requests include Thing bodies, messages, attachments, or credentials | Disable the path, preserve minimal incident evidence, and conduct privacy/security response. |
| Language choice becomes profiling | Dashboards segment people by inferred writing or access behavior | Remove the signal and return to aggregate journey research. |
| Community translation becomes unsafe or stale | Unreviewed bulk edits, harassment, ideological capture, or abandoned locale | Pause contributions, retain reviewed source fallback, and use the documented moderation/rollback path. |
| Accessibility work becomes an endless launch veto | Scope grows without severity or journey boundaries | Return to approved blockers, time-box lower-impact work, and update scope deliberately. |
| Claims outrun evidence | Marketing says accessible/multilingual without dated support matrix | Retract the claim, publish exact tested scope, and restore the release gate. |

## Stop conditions

Pause rollout, promotion, or the affected experiment when:

- a core journey has an unmitigated release blocker;
- focus, content, actions, auth, save state, or error recovery is lost under an
  approved access mode or locale;
- private content is disclosed to accessibility or translation tooling;
- pseudo/RTL/pilot copy changes permissions, destructive meaning, or security
  instructions;
- a severe automated finding is suppressed without verified human disposition;
- language or accessibility metrics require person-level profiling; or
- the team cannot maintain the pilot locale, support channel, or evidence pack.

## First decision packet

The next owner review should decide only:

1. initial core journeys and supported environment matrix;
2. proposed WCAG 2.2 AA target, severity, blockers, and waiver expiry;
3. source locale, pilot locale, pseudo/RTL fixtures, and human reviewers;
4. locale precedence, persistence, and account/device behavior;
5. UI locale versus authored-content language boundaries;
6. one automated smoke tool and artifact/privacy policy;
7. named product, accessibility, localization, privacy/security, QA, and support
   owners; and
8. rollout gates, stop thresholds, and public-claim rules.

Everything remains proposed until that packet is approved.
