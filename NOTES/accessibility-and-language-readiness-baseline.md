# Accessibility and language-readiness baseline

**Status:** Evidence note · grounded 2026-09-02 (Australia/Melbourne)

**Scope:** The public web shell, shared interaction foundations, settings,
repository-owned test/CI contracts, and the path to multilingual UI. Native
macOS Accessibility permission handling is a separate security boundary, not
evidence that the Thingtime product UI is accessible.

**Not a conformance claim:** This note records repository and public-preview
evidence. It is not a completed assistive-technology audit, a WCAG conformance
statement, legal advice, or proof that any production journey works for every
person.

**Upstream:**
[Ethical adoption baseline](./ethical-adoption-baseline.md) and
[trustworthy adoption roadmap](../PLAN/trustworthy-adoption-roadmap.md)

**Proposed plan:**
[Accessibility and language-readiness roadmap](../PLAN/accessibility-and-language-readiness-roadmap.md)

**Execution epic:**
[TODO 25 — Accessibility and language readiness](../TODO/claude-todo/25-accessibility-and-language-readiness.md)

## Why this belongs in the garden

Thingtime cannot be extraordinarily useful or widely adopted if core work is
blocked by input method, vision, hearing, motion sensitivity, cognition,
language, writing direction, device width, or connection quality. Accessibility
and internationalization are also architecture concerns: copy ownership,
document semantics, focus, status announcements, layout, validation, formatting,
and test fixtures become harder to retrofit after every surface invents its own
contract.

The current repository contains thoughtful local affordances, but no shared
release-level definition of “accessible” or “language ready.” The next step is
to preserve those strengths, measure the gaps honestly, and approve a narrow
foundation before promising broad access.

## Evidence ledger

| Observation | Evidence captured 2026-09-02 | Confidence and refresh trigger |
| --- | --- | --- |
| The web document currently declares English statically. | [`remix/index.html`](../remix/index.html) sets `<html lang="en">`. A focused search found no runtime owner for document `lang` or `dir`, locale provider, translation hook, `Content-Language`, or `Accept-Language` handling. The exact-head PR preview returned HTTP 200 with the same English declaration. | High for this repository/head. Re-run the source search and fetch the selected deployment after shell, routing, or locale work. |
| There is no repository-owned accessibility or internationalization command. | `remix/package.json` has no direct dependency or script matching axe, pa11y, Lighthouse, accessibility, i18n, locale, or translation. `axe-core` exists only under the transitive `eslint-plugin-jsx-a11y` lock entry; no repository script invokes it as a rendered-page audit. | High for package and script ownership. Recheck manifests and workflows before selecting tooling. |
| Useful accessibility work already exists in individual surfaces. | [`ConfettiCanvas.tsx`](../remix/app/components/Landing/ConfettiCanvas.tsx) checks `prefers-reduced-motion` and the theme motion switch. [`SettingsPage.tsx`](../remix/app/components/Settings/SettingsPage.tsx) exposes a Motion setting. [`useLopu.tsx`](../remix/app/components/Lopu/useLopu.tsx), attachment/editor controls, Messenger, and sensitive reveal contain status regions, announcements, or focus management. | High for code presence, not live correctness. Re-test the exact journeys with assistive technology after relevant component changes. |
| Accessibility checks are distributed rather than release-wide. | [`TESTING.md`](../TESTING.md) includes keyboard, focus, touch-target, announcement, reduced-motion, and mobile checks for several features. A focused search found no cross-product journey matrix, severity policy, WCAG mapping, or blocking rendered-page audit in the package scripts or workflows. | High for the current test corpus. Refresh when the CI or manual checklist structure changes. |
| Motion preference coverage is not demonstrably universal. | Celebration code explicitly honors the OS preference and theme setting, while the focused search surfaced no shared motion policy proving every transition, loading animation, drawer, toast, and third-party component obeys both. | Medium. Inventory computed styles and representative interactions before calling this a gap in any specific surface. |
| Language readiness is more than translating visible strings. | The shell language is fixed; UI copy is embedded across components; and no owned locale layer was found. Dates, numbers, plurals, sorting, search, user content, generated content, emails, API errors, metadata, and right-to-left layout therefore lack one documented product contract. | Medium-high. A source-string and formatting inventory is required before estimating migration size. |
| Current planning names accessibility and i18n as adoption gates but does not yet make them executable. | The [trustworthy adoption roadmap](../PLAN/trustworthy-adoption-roadmap.md) requires keyboard, screen-reader, reduced-motion, narrow-screen, and target-locale success. Existing feature TODOs repeat local checks. Before this note, there was no dedicated evidence → plan → implementation epic for the shared foundation. | High. This note and its downstream artifacts close the planning gap, not the implementation gap. |
| There was no open issue inventory to rely on. | `gh issue list --state open` returned zero open issues. The automation-owned PR remains planning-only. Absence of issues is not absence of barriers. | High for the query time. Refresh before triage or resourcing. |

## External reference points

These are proposed engineering references, not a conclusion about which laws or
procurement rules apply to Thingtime.

- W3C's [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
  provides testable success criteria across perceivable, operable,
  understandable, and robust content. It includes keyboard access, reflow,
  focus visibility/not-obscured, target size, language, error assistance,
  accessible authentication, and status messages.
- W3C's [ARIA Authoring Practices keyboard guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
  is a useful implementation reference for predictable focus and composite
  widgets. ARIA must not substitute for native semantics or real user testing.
- W3C Internationalization's
  [language declaration guidance](https://www.w3.org/International/questions/qa-html-language-declarations)
  explains why the content language belongs on the root `html` element and why
  language changes within a page need explicit markup.

## Proposed product contract

### 1. Core journeys before page counts

Approve a short set of complete processes rather than claiming that isolated
components are accessible:

1. understand the landing page and create an account;
2. sign in, recover an account, and switch accounts;
3. create, edit, find, reopen, share, export, and delete a Thing;
4. navigate the drawer, Commander, settings, feed, and profile;
5. compose and read posts, comments, messages, and attachments;
6. understand errors, pending work, success, and permission changes; and
7. complete the chosen first-value and graceful-exit journeys.

Each journey needs keyboard-only, screen-reader, touch, zoom/reflow,
reduced-motion, high-contrast/color-independence, slow/error-path, and narrow
viewport coverage appropriate to the surface. Automated checks may catch a
subset; they never replace the manual and assistive-technology paths.

### 2. A bounded conformance target

Recommended starting decision: target WCAG 2.2 Level AA for the approved core
web journeys, without publishing a conformance statement until an evidence
pack covers the complete processes, supported environments, known exceptions,
third-party content, and a dated review.

Severity should be impact-led:

- **Release blocker:** a person cannot complete a core journey, escapes or
  enters a focus trap, cannot perceive required state, loses work, or cannot
  authenticate because of the interaction.
- **Time-bounded remediation:** the journey completes but with substantial
  extra effort, ambiguity, pain, or loss of equivalent information.
- **Tracked improvement:** a valid enhancement outside the approved journey
  and severity threshold.

No aggregate score may average away a release blocker.

### 3. One language and formatting owner

The UI locale, authored-content language, and optional translation are three
different concepts:

- **UI locale** controls product chrome, help, errors, notifications, dates,
  numbers, plurals, collation, document `lang`, and default direction.
- **Content language** belongs to the author or imported artifact and may differ
  within one page. It must not silently change when the UI locale changes.
- **Translation** is an explicit derived view with provenance and a path back
  to the original. It is not required for the first localization foundation.

Use one versioned message-key and formatting layer. Do not let components pick
their own locale source, fallback chain, plural rules, date libraries, or
right-to-left behavior.

### 4. Choice without surveillance

- Let a person choose UI language explicitly and change it without losing
  work, focus, account, endpoint, or navigation context.
- A browser language can seed the first suggestion, but should not become a
  covert location, ethnicity, or identity signal.
- Keep the minimal preference in the existing account/settings model and a
  safe local first-paint cache; do not create person-level “language
  engagement” histories.
- Never infer sensitive traits from writing, assistive-technology behavior,
  input speed, zoom, motion settings, or accessibility preferences.
- Never send private Thing content to a translation provider without a
  separately approved purpose, consent, data-flow review, retention contract,
  and clear original/translated labeling.

### 5. Accessible content is part of authoring

Thingtime stores user-created Things, components, actions, images, files, and
embeds. Platform chrome can pass its own tests while authored content remains
inaccessible. The product needs proportionate authoring support: alternative
text and decorative-image intent, headings/structure, link purpose, captions or
transcripts where media support matures, language-of-part metadata, safe color
use, and preview checks that teach rather than punish.

Generated components and themes must not be labeled “accessible” merely because
their host page is. Published libraries need explicit semantics, keyboard,
contrast, motion, zoom, and locale/RTL evidence for the states they expose.

## Measures worth approving

| Measure | Candidate definition | Guardrail |
| --- | --- | --- |
| Core-journey completion | Approved participants completing each journey in each required interaction mode | Report blockers separately; never average screen-reader failure into mouse success. |
| Severe blocker count | Open release-blocking barriers in approved journeys | Must be zero to broaden rollout for that journey. |
| Automated detectable violations | New serious/critical findings on stable rendered fixtures | Tool output is triage evidence, not a conformance score. |
| Focus and announcement integrity | Expected focus target and status announcement at each tested transition | No stolen focus, duplicate announcement storm, hidden focus, or keyboard trap. |
| Reflow and text resilience | Journey success at approved zoom, spacing, and viewport fixtures | No loss of information, action, or required horizontal page scroll. |
| Locale readiness | Approved UI messages and formatting paths using the canonical layer | Missing keys, clipped text, wrong plural/date/number behavior, and mixed fallback are visible defects. |
| Pilot-locale task parity | Pilot-locale journey success relative to the source locale | Do not ship machine-translated or untranslated critical copy as “supported.” |
| Accessibility debt age | Time from confirmed barrier to owner, mitigation, and resolution | Public workarounds and known limitations stay current and non-defensive. |

Do not collect raw screen-reader speech, typed content, zoom histories, input
timing, assistive-technology identifiers, disability labels, or person-level
failure trails to compute these measures.

## Open questions

1. Which web journeys and supported browser/assistive-technology combinations
   form the first honest release contract?
2. Is WCAG 2.2 AA the approved engineering target, and who can waive a gate?
3. Which severe barriers must stop preview promotion versus production release?
4. Which UI locale should be the first pilot after source-string extraction,
   and who owns human review?
5. Should locale follow account preference, per-device preference, URL, browser
   suggestion, or a documented precedence order?
6. Which authored Thing fields need language-of-part metadata first?
7. How should third-party components, embeds, imported content, and translations
   disclose known accessibility limits without laundering trust?
8. Which contributor and community-translation model provides attribution,
   review, rollback, safety, and sustainable maintenance?
9. What public accessibility/help channel can accept barrier reports without
   requiring the inaccessible journey itself?
10. Which existing local affordances fail live testing despite looking correct
    in source?

## Refresh checklist

Before converting any claim into shipped status:

1. fetch the current integration branch and selected deployment;
2. inventory message sources, locale/formatting code, and document semantics;
3. run the approved automated fixtures and preserve tool/version receipts;
4. complete the manual keyboard, zoom/reflow, motion, contrast, error, and
   screen-reader matrix;
5. verify core journeys with people who use the relevant access methods and
   languages;
6. reconcile findings with open PRs, incidents, support reports, and known
   limitations; and
7. date the evidence pack and remove any claim its evidence no longer supports.
