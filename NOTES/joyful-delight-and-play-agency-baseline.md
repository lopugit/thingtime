# Joyful delight and play agency baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-12, Australia/Melbourne

**Repository scope:** the automation branch after integrating
`origin/develop@be7423134`. Repository evidence describes this snapshot only;
it is not a usability result, accessibility conformance claim, safety
certification, or legal advice.

**Plan:**
[Joyful delight and play agency roadmap](../PLAN/joyful-delight-and-play-agency-roadmap.md)

**Execution epic:**
[TODO 42 — Joyful delight and play agency](../TODO/claude-todo/42-joyful-delight-and-play-agency.md)

## Why preserve this note

Thingtime already has a recognizable language of delight: Lopu messages,
rainbows, a root confetti canvas, a user-controlled motion setting, secret
Commander words, a Konami sequence, a galloping nav unicorn, a footer wizard,
and a deliberately whimsical idea bank in TODO 10. The current code also has
good constraints worth preserving: one celebration event bus, one sanctioned
notification surface, a particle cap, reduced-motion checks, and deterministic
minute-based copy for several easter eggs.

Those ingredients do not yet form an owner-facing delight contract. The idea
bank mixes hidden jokes, feedback, rewards, social growth ideas, developer
tools, and milestone celebrations. It labels several items as shipped without
one exact-head interaction suite, while current tests and design-system prose
do not prove that every trigger is predictable, localized, sensory-safe,
non-coercive, or harmless across account and accessibility states.

The smallest useful next step is not more spectacle. It is a local-only,
explicit celebration preview that lets a person compare the same meaningful
message with full motion, reduced motion, and motion disabled, then leave with
no server event, streak, score, scarcity, notification, or profile inference.

## Vocabulary that must stay separate

| Term                | Meaning here                                                                                                | Must not silently mean                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Functional feedback | A clear response needed to understand the outcome of an action.                                             | Decoration, praise, persuasion, or proof the intended outcome completed.                        |
| Decoration          | Non-essential visual or textual character that can disappear without changing meaning.                      | Required status, inaccessible-only information, or permission to ignore user preferences.       |
| Celebration         | Optional acknowledgement of a person-chosen or truthfully completed moment.                                 | A reward schedule, ranking signal, endorsement, or pressure to continue.                        |
| Easter egg          | A hidden, harmless interaction whose absence changes no core capability.                                    | Security boundary, undocumented privileged command, tracking mechanism, or required navigation. |
| Play                | Voluntary exploration with an obvious exit and no penalty for stopping.                                     | Gambling, chance-based entitlement, purchase pressure, or behavioral optimization.              |
| Milestone           | A versioned condition whose completion can be demonstrated from canonical state.                            | Minutes, clicks, streaks, volume, popularity, or an inferred life achievement.                  |
| Surprise            | A bounded presentation variation that does not change authority or cost.                                    | Unexpected navigation, disclosure, notification, payment, data write, or loss.                  |
| Delight recipe      | A proposed declarative description of trigger, meaning, channels, preference behavior, limits, and cleanup. | A second event system or permission for any caller to emit effects.                             |

## Repository evidence ledger

| Current evidence                                                                                                                                              | Repository anchor                                                                                  | Confidence and refresh trigger                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Confetti uses one app-wide `tt:confetti` event bus and one root canvas; callers do not mount independent particle systems.                                    | `remix/app/components/Landing/confetti.ts`, `ConfettiCanvas.tsx`, `remix/app/root.tsx`             | High for this head. Recheck root composition and celebration callers after visual-system changes.                                           |
| The canvas caps a burst at 200 particles and refuses to animate when the mounted OS reduced-motion preference or current `--tt-motion` value disables motion. | `ConfettiCanvas.tsx`                                                                               | High for implementation, not complete preference QA. The OS preference is captured at mount, so dynamic changes need explicit verification. |
| Imperative eggs reuse `motionOK()`, while the theme maps `general.motion` to CSS and JS-readable motion tokens.                                               | `remix/app/eggs/eggs.ts`, `remix/app/theme/tokens.ts`, `ThemeStudio.tsx`                           | High for the shared path. Audit older decorative animations and native surfaces before claiming universal coverage.                         |
| Lopu is the one user-facing notification language, and existing eggs leave toast presentation to callers.                                                     | `FUNDAMENTALS.md` section 7, `EasterEggs.tsx`, `Footer.tsx`, `Nav.tsx`, `CommanderV2.tsx`          | High for intended architecture. A toast does not by itself prove screen-reader timing, comprehension, or cultural fit.                      |
| Konami, secret Commander words, the nav gallop, footer spells, and hidden icon names are present in the repository.                                           | `remix/app/eggs/eggs.ts`, `EasterEggs.tsx`, `Nav.tsx`, `Footer.tsx`, `CommanderV2.tsx`, `Icon.tsx` | High for code presence; no live browser acceptance was run for this note.                                                                   |
| Incantations and sparkle copy rotate deterministically by minute, while confetti physics and the rare Thingtime icon still use runtime randomness.            | `eggs.ts`, `ConfettiCanvas.tsx`, `Icon.tsx`                                                        | High for this head. Decide where variability is merely visual and where deterministic replay is required.                                   |
| The design-system docs describe one motion switch and celebration bus, but also say some older decorative loops still need migration.                         | `remix/app/routes/docs/design-system/entries/identity.tsx`, `RainbowMotionStories.tsx`             | High as repository-authored status, not a complete inventory.                                                                               |
| TODO 10 is a broad idea bank that combines delight, growth, social features, design, and developer tools.                                                     | `TODO/claude-todo/10-delight-and-growth-ideas.md`                                                  | High. TODO 42 should add guardrails without replacing the idea bank.                                                                        |
| A focused test search found no dedicated unit file for the confetti canvas or easter-egg trigger module.                                                      | `rg` over `remix/` on 2026-09-12                                                                   | Medium-high and time-sensitive. Re-run before implementation.                                                                               |
| A live open issue/PR search found one pet PR but no open item explicitly owning a cross-surface delight contract.                                             | GitHub search on 2026-09-12                                                                        | Medium and time-sensitive. Refresh before creating implementation work.                                                                     |

## External design inputs

- W3C's [Understanding animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
  explains that non-essential motion triggered by interaction should be
  disableable and that user-agent or operating-system reduced-motion
  preferences are a useful mechanism. This is accessibility input, not a claim
  that Thingtime conforms to WCAG 2.2 AAA.
- W3C's [Pause, Stop, Hide guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
  distinguishes automatically moving, blinking, scrolling, and updating
  content that needs user control. Delight must not interfere with core work.
- The W3C [Ethical Web Principles](https://www.w3.org/TR/ethical-web-principles/)
  prioritize people over ecosystem incentives and call for technology that
  enhances individual control rather than manipulation.
- Australia's eSafety Commissioner places
  [user empowerment and autonomy](https://www.esafety.gov.au/industry/safety-by-design/foundations)
  alongside provider responsibility and transparency. It is a design input,
  not a safety certification.
- The ACCC has identified online interface designs that exploit behavioral
  biases and distort choice as a digital-market concern in its
  [digital revolution speech](https://www.accc.gov.au/about-us/news/speeches/opportunities-and-challenges-in-the-digital-revolution).
  Qualified review must determine the relevance of consumer law to any real
  commercial experience.

## Gaps this theme owns

1. **No delight charter.** There is no shared rule separating functional
   feedback, decoration, celebration, surprise, play, reward, and growth.
2. **No trigger-to-meaning contract.** Callers can fire shared effects, but no
   registry states what canonical outcome, user action, audience, cooldown, or
   fallback justifies each celebration.
3. **No complete preference matrix.** Motion is centralized well, but sound,
   intensity, repeat behavior, dynamic OS-preference changes, native shells,
   and reduced-motion alternatives are not one tested contract.
4. **No non-coercion gate.** The backlog warns against annoyance, yet it does
   not forbid streaks, fake urgency, loss framing, variable rewards, purchase
   pressure, or engagement-linked celebration as enforceable acceptance rules.
5. **No semantic completion fence.** A visual success effect can be emitted by
   a caller without proving that the durable action, delivery, or downstream
   outcome actually completed.
6. **No cultural and language review.** Emoji, idiom, color, magic language,
   praise, and surprise can be joyful, confusing, childish, religiously loaded,
   or unwelcome depending on person and context.
7. **No focused regression suite.** Existing code presence and design stories
   do not cover duplicate listeners, rapid triggers, route changes, reduced
   motion, theme changes, keyboard sequences in editors, cleanup, or failures.
8. **No lifecycle owner.** Old eggs, seasonal behavior, copy, and temporary
   experiments need discoverability, versioning, review dates, and deletion.

## Risks and abuse cases

- A celebration fires before a write is durable, masking failure or creating a
  false success claim.
- Confetti, flashes, sound, vibration, emoji, or repeated toasts distract,
  trigger symptoms, obscure assistive output, or ignore a changed preference.
- A hidden keyboard sequence captures text while a person is editing,
  composing, using assistive technology, or entering sensitive data.
- Streaks, countdowns, rarity, social comparison, or loss framing turn play
  into pressure, especially for children or vulnerable people.
- Random presentation changes snapshots, tests, support evidence, or perceived
  outcome even when canonical state is identical.
- Delight appears only after sharing, inviting, buying, granting data, enabling
  notifications, or staying longer, making a nominally optional choice coercive.
- A public celebration reveals private creation, relationship, identity,
  health, money, safety, or account activity.
- Cultural shorthand or praise misgenders, patronizes, excludes, or trivializes
  serious failure, moderation, recovery, payment, or safety contexts.

## Bounded first experiment

Use a local design-system preview with synthetic text and no account data. One
button explicitly asks to preview a celebration for a fictional completed
private Thing. The same factual Lopu message appears in every condition; the
decorative layer is then shown with full motion, OS reduced motion, and the
Thingtime motion switch off. The participant can replay once, disable the
decoration, return to the neutral state, and leave.

The preview records no server event. A structured facilitator sheet may retain
only approved environment/profile labels, contract version, whether the person
correctly identified the factual outcome and controls, observed preference
fidelity, accessibility failures, and cleanup status. Do not retain typed
content, disability or health inference, reactions, dwell, cursor movement,
emotion, purchase intent, or a person-level delight score.

Success means the factual outcome remains equally understandable, preferences
are obeyed, the decoration never blocks or changes the action, and stopping is
easy. Liking the animation, replaying it, smiling, sharing, or staying longer
is not required and is not a product metric.

## Stop conditions

Stop the preview or later rollout if any path:

- changes data, authority, navigation, audience, payment, or notification state
  without a separate explicit action;
- reports success before canonical completion or hides partial, failed,
  pending, reverted, or uncertain state;
- animates or plays sound against current user or operating-system preference;
- blocks interaction, focus, reading, assistive output, escape, or recovery;
- depends on a streak, scarcity cue, variable entitlement, social comparison,
  invitation, purchase, notification opt-in, data grant, or continued use;
- exposes private activity or creates analytics, profiling, advertising,
  training, ranking, or child-directed signals;
- cannot be disabled, removed, localized, tested deterministically, or cleaned
  up without affecting the underlying capability; or
- fails an approved accessibility, safety, privacy, security, reliability,
  cultural review, incident, remedy, or deletion gate.

## Questions for owners and qualified reviewers

1. Which contexts may celebrate, and which serious or sensitive contexts must
   always use neutral functional feedback?
2. Which outcomes are canonical enough to trigger a celebration, and how does
   the caller prove durable completion before presentation?
3. Is one global decorative-effects switch enough, or are separate motion,
   sound, intensity, surprise, and seasonal controls needed?
4. Should easter eggs ever run inside editors, forms, assistive modes, native
   shells, or reduced-motion environments?
5. Which variability may be nondeterministic without changing meaning, test
   evidence, accessibility, support, or fairness?
6. How are copy, emoji, color, metaphor, sound, and gesture reviewed across
   languages, cultures, ages, and accessibility profiles?
7. What is the smallest regression matrix that covers triggers, preferences,
   cleanup, routes, duplicate mounts, failures, and account switching?
8. Who owns product meaning, accessibility, cultural review, privacy, safety,
   reliability, incident response, removal, and manual stop authority?
