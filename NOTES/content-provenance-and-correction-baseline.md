# Content provenance and correction baseline

**Evidence snapshot:** 2026-09-04, Australia/Melbourne

**Scope:** public and shared Things, posts/comments, attachments, reuse, edits,
imports, and platform-assisted creation visible from `origin/develop` and the
public GitHub repository. This is a documentation baseline, not a claim about
production content, user conduct, legal compliance, or off-repository process.
It contains no private user data.

## Why preserve this note

Thingtime can identify a current owner, show a creation timestamp, link a share
to one source post, and retain exact private object versions for safe attachment
lifecycle operations. Those are valuable primitives, but they do not yet form a
reader-facing answer to four different questions:

1. Who or what made this claim?
2. What changed, was imported, or was derived?
3. Which parts are platform-observed, signed, or merely asserted?
4. Has the author corrected or materially updated it?

Conflating those questions would create false confidence. Provenance can help a
person judge context; it does not prove that content is true, safe, lawful, or
endorsed. The related
[content provenance and correction roadmap](../PLAN/content-provenance-and-correction-roadmap.md)
turns this evidence into gates. The proposed execution epic is
[TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md).

## Evidence ledger

| Claim | Evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Every current Thing has stable platform identity and time fields, but these are storage facts rather than a public provenance contract. | `ThingDoc` in `remix/app/api/utils/things/things.ts` carries `shareId`, `ownerId`, `createdAt`, and `updatedAt`. [`FUNDAMENTALS.md` §3](../FUNDAMENTALS.md) defines the current Thing kinds and protected-write boundaries. | High for this commit. Re-read after the Thing envelope or public projection changes. |
| A public post exposes its current author and creation time, not its last edit, revision, sources, or assistance history. | `PublicPost` in `remix/app/components/Feed/feedTypes.ts` has `author` and `createdAt` but no `updatedAt` or provenance object. `toPublicPosts()` in `things.ts` projects `createdAt`; `TimestampLink` in `PostCard.tsx` displays that creation time. | High for the current code. Re-run the scoped projection/UI search before implementation. |
| Updating a Thing replaces the current payload and advances `updatedAt`; it does not preserve the previous content as a revision. | `updateThing()` in `remix/app/api/utils/things/things.ts` performs a guarded update of the current document, re-notifies newly added mentions, and re-screens changed moderated text. No relational content-revision writer appears in that path. | High for the inspected path. Recheck after edit-history or audit work lands. |
| Shares preserve one current source relation, not a general derivation graph. | `toPublicPosts()` resolves a share's `targetId` into `shareOf` one level deep and hides an original the viewer may no longer access. This is good authorization behavior, but it does not express quotations, multiple ingredients, imports, transformations, or source assertions. | High for the current post projection. Recheck after share or remix changes. |
| Attachment integrity controls protect storage operations without making a content-origin claim. | [`FUNDAMENTALS.md` §3](../FUNDAMENTALS.md) records server-owned object keys/versions, purpose binding, moderation, and deletion ordering for protected attachments. Those fields prove which stored object Thingtime operates on; no C2PA or equivalent reader-facing manifest contract was found. | High for repository evidence; no production media was inspected. Refresh after attachment metadata or media-verification work. |
| Experience history is adjacent but distinct. | [`20-versioned-experience-history.md`](../TODO/claude-todo/20-versioned-experience-history.md) proposes exact replay of search/feed state and enough algorithm provenance to explain rerun differences. It does not preserve the authorship and derivation history of each content Thing. | High for the plan. Keep the two histories separate during design. |
| Developer release provenance is adjacent but distinct. | The [trusted developer ecosystem baseline](./trusted-developer-ecosystem-baseline.md) covers publisher declarations, immutable releases, dependencies, review receipts, and permission diffs for executable artifacts. It does not define provenance for user-authored posts, media, corrections, or sources. | High for the current planning split. Share vocabulary where useful; do not merge authority models. |
| Rich Lopu generation is active work, not merged behavior in this baseline. | PR [#592](https://github.com/lopugit/thingtime/pull/592) remained open against `develop` when checked on 2026-09-04. Its proposal includes streamed tool use and stored conversations, but open status is not evidence that AI-assistance disclosure ships on `develop`. | Time-sensitive. Refresh the PR, exact head, and merged code before defining an implementation migration. |
| Rich social cards are also active work, not provenance. | PR [#607](https://github.com/lopugit/thingtime/pull/607) remained open when checked. A route-aware preview can accurately summarize the current public projection while still saying nothing about source history or later correction. | Time-sensitive. Refresh status and base before relying on its behavior. |
| The public issue tracker has no open issues, which is not evidence that readers understand content history. | `gh issue list --repo lopugit/thingtime --state open` returned an empty list on 2026-09-04. | High for the timestamp only. User research and support evidence remain necessary. |

## External design references

These are design inputs, not a claim that Thingtime implements, conforms to, or
is legally required to adopt any of them.

- The [W3C PROV-O Recommendation](https://www.w3.org/TR/prov-o/) provides a
  general vocabulary around entities, activities, agents, derivation, and
  attribution. Thingtime can borrow the distinctions without adopting RDF or
  exposing an unrestricted provenance graph.
- The [C2PA 2.4 specifications](https://spec.c2pa.org/specifications/specifications/2.4/index.html)
  define signed assertions and source/history information for media. The
  accompanying
  [security considerations](https://spec.c2pa.org/specifications/specifications/2.4/security/Security_Considerations.html)
  and
  [harms modelling](https://spec.c2pa.org/specifications/specifications/2.4/security/Harms_Modelling.html)
  make threat, privacy, access, and disproportionate-harm analysis part of the
  implementation problem.
- The
  [C2PA user-experience guidance](https://spec.c2pa.org/specifications/specifications/2.2/ux/UX_Recommendations.html)
  recommends progressive disclosure and explicitly warns interfaces against
  definitive authenticity claims. It also distinguishes platform/device
  observations from gathered or user-declared assertions.
- NIST's
  [Generative AI Profile, NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
  treats information integrity as a risk-management and evaluation concern.
  It is useful input for an AI-assisted creation policy, not a certification.

## Terms that must remain separate

| Term | Proposed meaning | Must not imply |
| --- | --- | --- |
| Platform identity | The current Thing, account, app, or service actor known to Thingtime. | A real-world identity, rights ownership, or truthful statement. |
| Attribution | A statement connecting an actor to a role such as author, editor, uploader, translator, or publisher. | That the actor created every ingredient or endorses every later edit. |
| Provenance | Bounded history of observations, assertions, sources, derivations, and transformations. | Truth, safety, quality, popularity, or permission to reuse. |
| Integrity verification | Evidence that selected bytes or fields match a signed/digested claim. | That an unsigned item is false or a signed claim is accurate. |
| Moderation status | A policy decision or automated/admin review state. | Authorship, factual verification, or a permanent public guilt label. |
| Rights statement | A creator or licensor assertion about reuse terms. | Legal adjudication or proof that the claimant owns those rights. |
| Correction | An attributable statement that amends or contextualizes an earlier public claim. | Silent deletion of the prior relationship or forced publication of private drafts. |

## Current strengths to preserve

- Stable `shareId` relationships and owner-bound writes provide a deterministic
  base for current objects.
- `createdAt` and `updatedAt` already distinguish creation from last mutation in
  storage, even though public post UI does not yet expose that difference.
- Share targets, relational comments/reactions/attachments, and exact
  authorization checks already favor bounded links over copied truth.
- Private attachment object versions, moderation fingerprints, and guarded
  updates show that Thingtime can bind an operation to exact current state.
- Export, accessibility/language, community safety, developer trust, and
  continuity plans already provide privacy, comprehension, dispute, artifact,
  and durability dependencies rather than requiring a new silo.

## Gaps that block an honest integrity claim

1. **No shared vocabulary.** Owner, author, uploader, publisher, signer,
   translator, model, and source are not defined as separate roles.
2. **No visible edit state.** Readers see creation time even after substantive
   replacement of the current payload.
3. **No content revision trail.** The current update path overwrites; there is
   no bounded, relational sequence of prior digests or public correction notes.
4. **No general source graph.** A one-level share relation cannot express quote,
   import, remix, translation, multi-source composition, or off-platform source.
5. **No assertion confidence model.** User-entered, platform-observed,
   cryptographically verified, and imported-unverified facts could be rendered
   as if they had equal evidence.
6. **No AI-assistance contract.** Thingtime has no approved rule for recording
   platform-generated versus user-declared external AI involvement without
   storing prompts or guessing from content.
7. **No correction/dispute loop.** Provenance errors need amendment, privacy
   redaction, appeal, and reader-visible status without rewriting history.
8. **No portable proof bundle.** Export and embeds do not yet define which
   provenance survives, how it is verified offline, or how missing evidence is
   represented.

## Candidate evidence model

This is vocabulary for an owner decision, not an approved schema.

- A **current artifact** remains the ordinary Thing and current public
  projection.
- A protected, relational **revision event** can link to the artifact by
  `targetId`, record a versioned event type, prior/current digest, actor role,
  timestamp, and safe summary, and remain pageable rather than embedded.
- A **source assertion** can express `quotes`, `imports`, `translates`,
  `remixes`, `generates`, or `derives-from` with explicit assertion strength
  and visibility.
- A **verification receipt** can record the verifier, method/version, exact
  input digest, time, and result. It must be re-verifiable and cannot become a
  timeless badge.
- A **correction note** can attach an attributable public explanation to a
  revision without forcing the superseded content itself to remain public.
- A **dispute event** can reuse the accountable case/appeal machinery in the
  community-safety plan rather than adding a verdict field anyone can forge.

Every accumulating record remains its own bounded relational Thing. Digests and
receipts are evidence aids, not substitutes for authorization, deletion,
moderation, or current content.

## Failure and abuse map

| Failure or abuse | Required posture |
| --- | --- |
| A signed or verified item makes a false claim | Describe exactly what was verified; never display a generic “true” badge. Preserve correction/report paths. |
| Credentials are stripped during export, screenshotting, transcoding, or reposting | Show provenance as unavailable/unknown, not failed or deceptive. Preserve safe source links when deliberately carried forward. |
| A creator enters false authorship, source, rights, or AI-use metadata | Label it user-declared. Rate-limit and report deliberate impersonation through the safety system. |
| Provenance exposes location, device, legal name, collaborators, or a vulnerable source | Minimize fields, preview disclosure, allow safe redaction, and never recover remote/fingerprinted data without an approved privacy flow. |
| An editor attaches authentic media to a misleading caption | Keep media-byte verification separate from the post's claims, caption, and current context. |
| A model guesses whether external content is AI-generated | Do not store or display a detector guess as provenance. Accept only observed platform activity or an explicitly labeled assertion. |
| A correction becomes a harassment vector or coerced confession | Separate author corrections, moderator remedies, and third-party disputes; scope visibility and appeals. |
| Deleted or newly private content survives in public history | Current authorization and deletion override historical display; retain only the minimum safe receipt required by an approved policy. |
| A verification key, algorithm, or trust list expires or is revoked | Timestamp and version the receipt; re-evaluate status and show historical versus current validation clearly. |
| Provenance density overwhelms readers or assistive technology | Use plain-language progressive disclosure with equivalent keyboard, touch, text, and screen-reader access. |

## Candidate measures

| Measure | What it could show | Privacy and interpretation guardrail |
| --- | --- | --- |
| Provenance comprehension | In structured testing, readers correctly distinguish author, source, edit, assertion, and verification states. | Use task-level aggregate results; do not log which sensitive source a person inspected. |
| Material-edit coverage | Eligible public artifacts whose material updates produce the required revision state. | Coverage is a correctness measure, not an incentive to retain content forever. |
| Source-link integrity | Declared internal sources that resolve to the exact authorized target or an honest unavailable state. | Do not probe private targets or leak why access changed. |
| Verification freshness | Receipts re-evaluated under the approved method/trust version before expiry. | A current receipt still proves only the scoped assertion. |
| Correction completion | Accepted correction requests that reach an attributable reader-visible outcome within an approved policy. | Report aggregates only; do not publish reporters or disputed private evidence. |
| Disclosure regressions | Tests where optional/private fields, raw prompts, keys, or hidden source metadata escape. | Any confirmed sensitive disclosure is a release stop, not a score to average. |

## Open questions

1. Which first artifact family needs provenance most: public posts, media,
   reusable components/actions, or Lopu-built pages?
2. Which edits are material enough to show “edited” and create a revision
   event? Can the rule be deterministic and content-type-specific?
3. Should previous public content remain viewable, retain only a digest and
   safe change summary, or vary by author choice and artifact class?
4. Which roles are platform-observed, and which may only be user-declared?
5. How should anonymous/pseudonymous work retain continuity without revealing a
   real-world identity or linkable private account history?
6. What AI-assistance states are useful and knowable: generated, materially
   transformed, translated, suggested, or unknown?
7. Which external media formats should receive a C2PA validation pilot, and
   what must happen when manifests are absent, stripped, invalid, or private?
8. Which correction disputes belong to the author, a community moderator, the
   platform, or an external rights/legal process?
9. Which provenance fields belong in account export, public embed, Atom feed,
   social card, and offline verifier outputs?
10. Who owns vocabulary, privacy, trust-store maintenance, accessibility,
    incident response, and the decision to retire a misleading indicator?

## Refresh checklist

- Re-run the scoped Graphify and repository searches for public projections,
  edit history, sources, correction, AI assistance, and credential handling.
- Re-query PRs #592 and #607 and verify merged behavior before treating either
  as a shipped dependency.
- Re-read the C2PA version index, security/harms guidance, W3C PROV, and NIST
  profile before choosing a compatibility or policy claim.
- Verify the current `FUNDAMENTALS.md`, capability manifest, export contract,
  and moderation/appeal design before approving a data model.
- Update this note when an owner decision, implementation milestone, or
  production behavior changes the evidence.
