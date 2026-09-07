# Learning agency and knowledge-stewardship baseline

**Evidence snapshot:** 2026-09-06, Australia/Melbourne

**Scope:** the current documentation branch after integrating
`origin/develop@29c31f2e6`, public repository evidence, and the external design
references linked below. This is not a production learning-outcome study,
school deployment assessment, accessibility conformance claim, or legal review.

**Roadmap:**
[learning agency and knowledge stewardship](../PLAN/learning-agency-and-knowledge-stewardship-roadmap.md)

**Execution epic:**
[TODO 32](../TODO/claude-todo/32-learning-agency-and-knowledge-stewardship.md)

## Why preserve this note

Thingtime describes itself as a place to create, store, share, and reuse data
and knowledge. It already has knowledge-oriented Things, private saves,
anniversary memories, search, provenance planning, and a proposed way to
restore historical experiences. Those are useful ingredients, but they do not
yet make an honest learning product.

Learning requires different promises from storage or engagement. A person must
be able to choose what they want to revisit, see the source and version they
are reflecting on, answer in their own words without being publicly scored,
correct their understanding, and stop without penalty. A reminder delivered or
a card reopened is not evidence that knowledge was retained, understood, or
applied.

This note defines the gap and a deliberately small first experiment: one
private, user-requested revisit of an owned or saved Thing, followed by an
optional private reflection. It does not authorize grading, mastery scores,
streaks, adaptive profiling, school use, child accounts, institutional
dashboards, credentials, generative-AI tutoring, or learning analytics.

## Terms that must remain separate

| Term | Meaning here | Not evidence of |
| --- | --- | --- |
| Saved Thing | A private relationship saying the viewer wants to find an eligible artifact again. | Understanding, endorsement, permission permanence, or learning intent. |
| Experience snapshot | The historical UI/result state owned by [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md). | A knowledge revision, study record, or assessment. |
| Revisit intention | A user-authored request to return to one Thing at a chosen time or context. | Consent to recurring reminders, analytics, or algorithmic scheduling. |
| Reflection | A private response, question, summary, connection, or correction authored by the learner. | A grade, diagnosis, credential, or platform-verified fact. |
| Source version | The exact accessible artifact revision shown when a reflection was made. | Truth, originality, or continued access to removed/private material. |
| Learning evidence | Evidence from a specifically approved evaluation design. | Delivery, opens, dwell time, streaks, self-confidence, or completion alone. |
| Open educational resource | Material whose copyright holder applied an open licence permitting access and reuse under its terms. | Accuracy, accessibility, pedagogical quality, or permission for unrelated private source material. |

## Repository evidence ledger

| Claim | Evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Knowledge is part of Thingtime's stated purpose. | [`README.md`](../README.md) describes creating, storing, sharing, and using data and knowledge. | High for repository wording. Recheck before making a public product claim. |
| The product has knowledge-oriented presentation primitives, not a learning contract. | `remix/app/components/Kinds/kindRenderersKnowledge.tsx` registers course, certificate, definition, changelog, plant, and other renderers; sample schemas include course and certificate shapes. | High for repository presence. These renderers do not prove authored content quality, completion, assessment, or credential authority. |
| Saved posts are private relational children with batched reads and authorization rechecks. | `remix/app/api/utils/things/saved.ts` reads owner-private `save` Things, batch-fetches targets, rechecks inherited visibility, and silently drops targets that no longer resolve. | High for the current implementation. The endpoint is post-shaped and must not be described as a general study library. |
| “On this day” provides a calm, dismissible resurfacing pattern. | `remix/app/components/Feed/MemoriesCard.tsx` shows up to six of the viewer's own anniversary posts, keeps same-day dismissal locally, avoids an empty/loading shell, and refreshes at the viewer's local day boundary. | High for repository behavior and tests. It is calendar nostalgia, not semantic review or learning evidence. |
| Durable experience restoration is designed but not implemented. | [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md) is marked not started and separates historical replay, rerun, and continuation. | High for planning status. Re-ground before reusing its snapshot contract. |
| Trustworthy adoption already rejects attention as the outcome. | [TODO 22](../TODO/claude-todo/22-trustworthy-adoption-loop.md) prefers completed useful outcomes and forbids private-content analytics; [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md) owns continuation, learning controls, and calm notification defaults. | High for the documented boundary. Learning work may not redefine opens, minutes, or streaks as success. |
| Authorship and timestamps are weaker than source and correction evidence. | [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md) owns material revisions, source/derivation assertions, corrections, disputes, and evidence limits. | High for planning scope. A reflection must point to that evidence rather than copy it into a competing history. |
| Existing AI musings are not an educational assistant. | The Lopu musing endpoint and UI stream short generated or fallback musings with rate limits and source labels. | High for repository presence. There is no approved curriculum, learner model, assessment authority, age boundary, or pedagogical validation. |

## External evidence and design implications

These references inform questions and safeguards; none proves that a proposed
Thingtime feature will improve learning.

1. Roediger and Karpicke's controlled experiments found stronger delayed
   retention after retrieval practice than repeated study for the tested prose
   materials and conditions. The result supports testing an optional
   answer-before-reveal interaction, but not a universal algorithm or a claim
   that any prompt is effective. See the
   [PubMed record and abstract](https://pubmed.ncbi.nlm.nih.gov/16507066/).
2. Cepeda and colleagues' meta-analysis found that spacing effects vary jointly
   with the interval between study events and the intended retention interval.
   That argues against one opaque “optimal” schedule and for user choice,
   transparent assumptions, and evaluation by content/context. See the
   [PubMed record](https://pubmed.ncbi.nlm.nih.gov/16719566/).
3. The US Institute of Education Sciences practice guide labels its own
   recommendations with evidence strength and distinguishes spacing, retrieval,
   explanatory questions, and judgments of learning. Thingtime should preserve
   that humility rather than collapse multiple techniques into a “science
   backed” badge. See
   [Organizing Instruction and Study to Improve Student Learning](https://ies.ed.gov/ncee/wwc/PracticeGuide/1).
4. W3C's supplemental cognitive-accessibility pattern says reminders should be
   created only at the user's request and remain personalizable, while warning
   that unwanted reminders can themselves become a barrier. That is the minimum
   interaction posture for the proposed pilot. See
   [Provide Reminders](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o7p07-reminders/).
5. UNESCO's Open Educational Resources recommendation connects open licences
   with reuse/adaptation while separately emphasizing accessible formats,
   cultural and linguistic relevance, quality assurance, privacy, and data
   protection. Licence, quality, access, and learning effect must remain
   separate fields and claims. See the
   [2019 OER Recommendation](https://www.unesco.org/en/legal-affairs/recommendation-open-educational-resources-oer?hub=422).
6. UNESCO's generative-AI guidance calls for human-centred, privacy-protective,
   age-appropriate pedagogical validation. AI-generated prompts or feedback
   therefore remain a later, separately approved experiment, not a shortcut for
   the first pilot. See
   [Guidance for generative AI in education and research](https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research?hub=387).

## Gaps that block an honest pilot

1. **No user-owned learning intention.** Saving, revisiting, and reflecting are
   not represented as separate choices with separate deletion and delivery
   controls.
2. **No source-version binding.** A note made against an artifact can become
   misleading after a material edit unless it retains an authorized reference
   to the version and correction context the person actually saw.
3. **No reminder boundary.** There is no approved one-shot scheduling,
   postpone, quiet delivery, expiry, or “why now?” contract for knowledge
   revisits.
4. **No private reflection boundary.** Reflection content, confidence, errors,
   and questions are potentially sensitive. They need owner-private defaults,
   protected reads, bounded retention, export, and deletion before storage.
5. **No evidence vocabulary.** Opens, prompt completions, self-ratings, quizzes,
   durable recall, transfer, and externally assessed outcomes are different
   measures. No current metric authorizes a learning claim.
6. **No assessment authority.** Course and certificate shapes do not identify
   who can define criteria, assess work, issue a credential, correct it, or
   revoke it.
7. **No age or institutional boundary.** A personal adult knowledge tool does
   not automatically satisfy school, child-safety, education-record, teacher,
   parent, or institutional requirements.
8. **No AI pedagogical boundary.** A model can produce fluent prompts and wrong
   explanations. Provenance labels, private-data controls, human review,
   uncertainty, and age-appropriate validation are unresolved.

## Recommended first experiment

Test one **private revisit with reflection** journey for consenting adults using
an owned or currently visible saved Thing:

1. The person selects **Revisit this**, chooses a date or a simple interval,
   optionally writes their own question, and chooses in-app-only delivery.
2. At the chosen time, a quiet card explains “You asked to revisit this” and
   offers open, postpone, dismiss once, edit schedule, or delete.
3. If the source is still authorized, the person may write a private summary,
   question, connection, or correction before or after revealing the source.
4. The reflection records the source identity/version reference and whether it
   was available, changed, corrected, or no longer accessible. It never copies
   revoked private content into a bypass cache.
5. The pilot evaluates task completion, clarity, control, and accessibility
   through structured sessions and local-only evidence first. It makes no
   retention or learning-effect claim.

The first pilot excludes recurring schedules, push/email delivery, inferred
topics, auto-generated questions, quizzes, grades, streaks, leaderboards,
mastery, recommendations, public reflections, schools, minors, credentials,
and person-level analytics.

## Privacy, safety, and fairness boundary

- Reflection text, questions, uncertainty, confidence, source choices, and
  revisit history are private content, not product telemetry.
- Never infer intelligence, disability, diagnosis, literacy, language,
  education level, employability, ideology, or vulnerability from learning
  behavior.
- Never expose a person's errors, pace, inactivity, scores, or schedule to a
  creator, employer, teacher, parent, advertiser, community, or other user
  without a later explicit authority model and qualified review.
- A missed or postponed revisit has no penalty. No streak breaks, shame copy,
  urgency countdown, loss framing, or pay-to-restore.
- Deletion, moderation, block, revoked sharing, and narrowed visibility override
  cached source content. The reflection may retain the person's own words while
  clearly marking the source unavailable, subject to the approved deletion
  contract.
- Search text, reflection text, full source URLs, private titles, schedules, and
  content identifiers never enter logs, notification payloads, or unapproved
  analytics.
- Baseline creation, revisit, reflection, export, and deletion stay tier-neutral;
  payment cannot improve grades, evidence, trust, reminders, or discovery.

## Questions requiring owner decisions

1. Is the first candidate an owned private Thing, a saved public post, or both?
2. Is in-app-only delivery sufficient for the first pilot?
3. May a person write before revealing the source, and should that distinction
   be preserved without grading the response?
4. What source-version evidence is available before TODO 29 and TODO 20 land?
5. How long do completed intentions and private reflections persist by default?
6. Can the first evaluation remain local and qualitative with no server product
   analytics?
7. Which adult cohort, content family, languages, accessibility profiles, and
   stop conditions define the pilot?
8. What qualified review is required before any school, minor, credential,
   assessment, or AI-assisted learning use?

## Refresh checklist

- Recheck saved-library target semantics, MemoriesCard behavior, course and
  certificate shapes, and the status of TODOs 20, 22, 24, 25, 29, and 30.
- Revisit the research references before making a pedagogical or efficacy
  claim; preserve their populations, materials, conditions, and evidence
  strength.
- Verify current privacy, child-safety, education, accessibility, and AI rules
  for the actual pilot jurisdiction and participants with qualified owners.
- Record an architectural or product decision in `DECISIONS.md` only after the
  owner approves the first decision packet.
