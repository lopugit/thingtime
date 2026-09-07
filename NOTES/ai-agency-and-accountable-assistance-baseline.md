# AI agency and accountable-assistance baseline

**Evidence snapshot:** 2026-09-06, Australia/Melbourne

**Scope:** the documentation branch after integrating
origin/develop@9a04aac51, current repository evidence, and the external design
references linked below. This is not a production safety assessment, legal
review, compliance certification, or proof that model output is correct.

**Roadmap:**
[AI agency and accountable assistance](../PLAN/ai-agency-and-accountable-assistance-roadmap.md)

**Execution epic:**
[TODO 33](../TODO/claude-todo/33-ai-agency-and-accountable-assistance.md)

## Why preserve this note

Thingtime now contains a real streamed assistant: Lopu can use selectable
models and providers, retain owner-private conversations in Messenger, inspect
Things, and use tools that create or change pages, components, actions, schemas,
and data. It also has signed confirmation tokens for a narrow set of destructive
operations. These are meaningful foundations, but they are not yet a complete
contract for human agency or accountable assistance.

A useful assistant must make its context and authority understandable, keep
suggestion separate from execution, ask again when risk changes, leave usable
receipts, support correction and remedy, and let the person continue without
AI. Conversation history is not consent to durable memory. A provider or model
label is not a correctness or privacy guarantee. A confirmation is not blanket
delegation.

This note defines the gap and a deliberately small first experiment: one adult
chooses one private draft outcome, sees and adjusts the context offered to the
assistant, previews any change, and receives an action receipt with review,
undo, delete, and export paths. It does not authorize background autonomy,
public auto-publishing, cross-account memory, high-impact decisions, or use
with minors.

## Terms that must remain separate

| Term                 | Meaning here                                                              | Not evidence of                                                                         |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Assistant identity   | A clearly disclosed AI service and interaction surface.                   | A human, person, author, expert, authority, or sentient agent.                          |
| Conversation history | Prior eligible turns supplied to support this response.                   | Durable memory, a user profile, future consent, or permission to train.                 |
| Context receipt      | A user-legible summary of the categories and scope offered for one turn.  | Disclosure of secrets, hidden instructions, private content, or raw internal traces.    |
| Tool request         | A model proposal to invoke a capability.                                  | User authority, successful execution, or a valid outcome.                               |
| Confirmation         | Time-bounded approval for an exact described action.                      | Approval for related, repeated, escalated, or future actions.                           |
| Tool result          | Structured evidence returned by a capability.                             | Correctness, completeness, legality, safety, or user satisfaction.                      |
| Undo                 | A defined inverse operation where one exists.                             | Deletion, recall, compensation, dispute resolution, or recovery from every side effect. |
| Action receipt       | A bounded record of intent, context class, authority, action, and result. | Surveillance, storage of all private content, or proof that the outcome was good.       |

## Repository evidence ledger

| Claim                                                                                                                       | Evidence                                                                                                                                                                                                                  | Confidence and refresh trigger                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lopu is a shipped repository surface with streamed chat, model and provider selection, tools, and persistent conversations. | PR note [Lopu AI assistant](../PRs/592-claude-lopu-ai-chatbot-358029--lopu-ai-assistant.md), LopuChatView, LopuModelPicker, and the Lopu chat API utilities.                                                              | High for current repository behavior. Recheck after assistant routing, storage, or model-catalog changes.                                                          |
| Conversations are owner-private Messenger chats with bounded model history.                                                 | remix/app/api/utils/messenger/lopuChats.ts enforces owner access and currently selects at most 40 recent turns within a 60,000-character history budget.                                                                  | High for code behavior, not a guarantee about every downstream provider, cache, log, backup, export, or deletion path.                                             |
| People can choose available providers, models, reasoning effort, and speed.                                                 | LopuModelPicker and the model catalog expose explicit choices, including eligible user-vault providers.                                                                                                                   | High for the interface contract. A label does not prove fitness, accuracy, privacy, availability, or equivalence.                                                  |
| User provider credentials have strong storage and projection boundaries.                                                    | userVault and vaultProviders encrypt secrets, restrict provider endpoints, and expose public projections without tokens or full endpoints.                                                                                | High for the inspected code. Recheck provider additions, endpoint policy, SSRF defenses, logs, and support flows.                                                  |
| The model can request broad read and mutation tools.                                                                        | chatTools includes Thing search/read, component and page creation or patching, action creation/execution, schema/data creation, update/delete, suite install, and navigation.                                             | High for the current registry. Every capability and side-effect class must be inventoried before changing the approval boundary.                                   |
| Confirmation is cryptographically narrow but applies only to selected destructive patterns.                                 | confirmations.ts binds signed, single-use, 15-minute approval to the user, chat, purpose, and exact action. chatTools currently requires it for delete_thing, replaceCrystal updates, and deleting run_action operations. | High for inspected paths. It is not yet a product-wide risk taxonomy for public, external, bulk, repeated, monetized, identity, safety, or background actions.     |
| Prompt-injection and outcome-claim boundaries exist in the system prompt.                                                   | chatPrompt treats tool results and page blocks as untrusted data, says only user messages are requests, and requires tool evidence before claiming a change.                                                              | High for prompt text, but prompts are defense in depth rather than an enforceable authorization layer.                                                             |
| Tool cards provide useful but incomplete receipts.                                                                          | LopuToolCard shows status, summary, links, details, confirm/cancel controls, and an undo hook; persisted rows retain a summary rather than every live detail.                                                             | High for current UI. There is no complete portable receipt contract tying context, authority, target, before/after state, capability version, and remedy together. |
| A private Watch-to-assistance flow is active work, not shipped evidence.                                                    | Open PR #665 proposes consentful private Watch recordings, transcript, comments, TODOs, and reminders, with important acceptance items still unverified.                                                                  | Medium and time-sensitive. Treat it only as a design signal until merged and validated.                                                                            |

## External design inputs

These sources supply questions and governance patterns; they do not certify
Thingtime or turn a documentation proposal into compliance.

1. The [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
   frames voluntary risk management across design, development, deployment,
   use, and evaluation. Its
   [Playbook](https://airc.nist.gov/airmf-resources/playbook/) organizes optional
   actions as Govern, Map, Measure, and Manage rather than a checklist.
2. UNESCO's
   [Recommendation on the Ethics of Artificial Intelligence](https://www.unesco.org/en/articles/recommendation-ethics-artificial-intelligence?hub=66929)
   emphasizes human rights, dignity, transparency, fairness, and human
   oversight. These are design inputs, not a claim of conformity.
3. The OECD principles distinguish
   [human-centred values](https://oecd.ai/en/dashboards/ai-principles/P6),
   [transparency and explainability](https://oecd.ai/en/dashboards/ai-principles/P7),
   and [accountability](https://oecd.ai/en/dashboards/ai-principles/P9).
   Thingtime should likewise separate disclosure, understandable outcomes,
   challenge paths, traceability, and accountable ownership.
4. The Australian Government's
   [AI Technical Standard statement 10](https://www.digital.gov.au/policy/ai/AI-technical-standard/ai-technical-standard-statement-10)
   recommends disclosure, limitations, alternate channels, feedback, and human
   control. Its
   [agentic AI background](https://www.digital.gov.au/policy/ai/agentic-ai-addendum-background)
   distinguishes human-in-, on-, and out-of-the-loop oversight by risk. This is
   government guidance used as a design prompt, not a Thingtime obligation.

## Gaps that block an honest pilot

1. **No per-turn context contract.** The product can assemble recent chat and
   page context, but does not yet present an adjustable receipt or a clear
   no-history turn before the model call.
2. **No approved capability-risk map.** The current narrow destructive checks
   do not define when public visibility, external side effects, bulk or
   repeated changes, money, identity, safety, model changes, or background work
   need preview, confirmation, stronger review, or prohibition.
3. **No complete action receipt.** Tool summaries do not yet connect the user's
   intent, context categories, provider/model, capability version, target,
   before/after state, confirmation, result, and remedy in one bounded record.
4. **No proven memory and lifecycle boundary.** Chat deletion exists, but
   complete export, retention, selective context exclusion, cache behavior,
   provider handling, and deletion verification remain dependencies of
   [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md).
5. **No outcome and change protocol.** There is no approved way to evaluate
   correction, reversal, comprehension, accessibility, or regressions when a
   model, provider, prompt, or tool changes.
6. **No assistance recourse contract.** Reporting suspicious retrieved content,
   disputing a harmful action, restoring state, escalating to a human, and
   communicating incidents are not unified.
7. **No approved high-impact boundary.** Health, legal, finance, education,
   employment, eligibility, crisis, safety, moderation, payment, identity, and
   child-facing use require separate qualified review and must not inherit the
   low-risk pilot's authority.

## Recommended first experiment

Test one **context-visible private draft** journey with consenting adults:

1. The person chooses one Lopu chat, one explicit source scope, and one private
   draft outcome.
2. Before the model call, show a concise context receipt: eligible conversation
   slice, current page or selected Things, provider/model, and available tool
   classes. Offer no-history and selective exclusion.
3. Lopu may read and propose. Mutations remain private, previewed, bounded, and
   reversible. Public sharing, external side effects, bulk actions, secrets,
   high-risk domains, irreversible changes, and background execution remain
   blocked or separately gated.
4. After completion, show what was read by category, what changed, which
   provider/model and capability version acted, what is uncertain, and how to
   review, undo, report, delete, or export.
5. Evaluate task success, correction rate, reversal success, understanding,
   accessibility, privacy, and remedy completion. Do not optimize messages,
   minutes, tokens, or acceptance alone.

Exclude minors, impersonation, cross-account memory, training on private data,
public auto-publishing, unattended work, and high-impact advice or decisions.

## Privacy, safety, and fairness boundary

- Minimize receipts to categories, identifiers, decisions, and bounded evidence;
  do not log hidden prompts, secrets, credentials, or complete private content.
- The person can use Thingtime without Lopu and can switch provider/model or use
  a no-history turn without losing unrelated access.
- Retrieved content and tool output remain untrusted. Model prose never expands
  user, app, role, ACL, billing, or moderation authority.
- Sensitive-trait inference, emotional dependency, manipulative urgency,
  anthropomorphic deception, and optimization for compliance are prohibited.
- A denied or cancelled action must fail closed without covert retries, degraded
  substitutes, or pressure copy.
- Undo must state its limits. Irreversible, external, public, or multi-party
  consequences need prevention and remedy beyond a button.
- Accessibility, language, constrained-device, safety, portability, and support
  paths are part of the complete journey, not post-pilot polish.

## Questions requiring owner decisions

1. Which private draft outcome and adult cohort define the first pilot?
2. What context categories may be offered, and which default to excluded?
3. What exact risk tiers map to allow, preview, confirm, stronger review, and
   prohibit?
4. Which mutations have reliable inverse operations, and what remedy applies
   when no inverse exists?
5. What receipt is useful without becoming surveillance or exposing private
   content?
6. What retention, export, deletion, provider, cache, and support boundaries
   apply to chats, context receipts, and action receipts?
7. Which outcome and guardrail measures can be collected without person-level
   behavioral profiling?
8. Who may pause the pilot, investigate incidents, restore state, contact
   affected people, and approve any broader scope?

## Refresh checklist

- Re-inventory Lopu models, provider routing, history construction, tools,
  confirmation predicates, receipts, undo paths, vault boundaries, and tests.
- Recheck the status and validated behavior of PR #665 before citing any Watch
  assistance flow as shipped.
- Verify current AI, privacy, accessibility, consumer, child-safety, and
  high-impact rules for the actual jurisdiction and pilot with qualified owners.
- Record a durable decision only after the owner approves the assistance
  charter, risk map, first pilot, owners, evidence boundary, and stop authority.
