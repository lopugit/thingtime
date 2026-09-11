# Remix agency and responsible reuse baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-11, Australia/Melbourne

**Repository scope:** `origin/develop@056018962` plus the merged PR evidence and
external design references linked below. This is not a production assessment,
legal advice, rights determination, licence interpretation, or compliance claim.

**Plan:**
[Remix agency and responsible reuse roadmap](../PLAN/remix-agency-and-responsible-reuse-roadmap.md)

**Execution epic:**
[TODO 40 — Remix agency and responsible reuse](../TODO/claude-todo/40-remix-agency-and-responsible-reuse.md)

## Why preserve this note

Thingtime can resolve a shared composition, copy supported Things and stored
media into a signed-in person's private account, rewrite executable and media
references, and keep the source unchanged. Recent browser acceptance shows a
copied page still rendering after the source is made private and its stored
file is deleted. That is a substantial independence boundary.

It is not yet a complete reuse contract. “Copy” currently describes a storage
operation, not whether adaptation is permitted, which source version was used,
who should be credited, what changed, whether a source correction should be
surfaced, or how rights and safety disputes affect future copying. A private,
independently editable result can still contain another creator's expression,
personal information, unsafe material, or incompatible terms.

The smallest useful experiment should therefore use one synthetic app owned by
one adult test account and one second adult test account. The source contains
purpose-made text, a tiny generated image, and a deliberately visible reuse
notice. The recipient previews an exact copy plan, creates one private copy,
changes one labelled field, compares source and derivative, exports a bounded
lineage receipt, and deletes the test family. No public publishing, payments,
real creator work, sensitive data, AI generation, or automated update is
needed to learn whether the boundary is understandable.

## Vocabulary that must stay separate

| Term            | Meaning here                                                                                                | Must not silently mean                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Read access     | Permission to view one source in one audience context.                                                      | Permission to copy, adapt, redistribute, sell, train on, or endorse.                       |
| Copy            | A new stored artifact created from a fixed source version.                                                  | A legally permitted use, a backup, a live mirror, or proof of independence.                |
| Fork            | A copy with recorded derivation intended for further change.                                                | Shared ownership, collaboration authority, automatic updates, or source endorsement.       |
| Remix           | A derivative that intentionally changes or combines source material.                                        | A trivial save, quotation, revision of the original, or transfer of rights.                |
| Source version  | The exact content and dependency set used by one copy operation.                                            | The creator's latest version or an immutable public release unless proven.                 |
| Copy plan       | The bounded Things, files, external references, terms, and known effects proposed for copying.              | Authority to fetch arbitrary URLs or include inaccessible/private dependencies.            |
| Lineage receipt | Minimal evidence linking source version, copy event, derivative, declared terms, and changes.               | Proof of authorship, truth, ownership, licence validity, or legal compliance.              |
| Attribution     | A contextual credit assertion attached to a use.                                                            | Identity proof, endorsement, ownership, ranking advantage, or waiver of privacy.           |
| Independence    | The copy no longer requires authorized source Things or stored first-party files for its supported journey. | Freedom from external URLs, fonts, services, terms, vulnerabilities, or later obligations. |
| Upstream change | A later source correction, withdrawal, safety action, or new release.                                       | Permission to mutate the derivative or proof the derivative is wrong.                      |
| Withdrawal      | Stopping future reuse or changing availability under an approved contract.                                  | Retroactive erasure of already lawful copies or silent remote deletion.                    |
| Dispute         | A claim about rights, attribution, safety, privacy, or lineage.                                             | A proven violation or authority for an automated permanent sanction.                       |

## Repository evidence ledger

| Claim                                                                           | Current evidence                                                                                                                                                                                                                                                                                                             | Confidence and refresh trigger                                                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported shared content can be copied into private caller-owned Things.        | `/api/v1/things/fork` resolves supported roots, allocates new IDs, rewrites executable references, creates caller-owned `tt:user` Things, and returns the copied IDs. The client requires `api.things-fork` 1.4.0 and describes the result as private and independently editable.                                            | High for inspected code. Recheck supported kinds, ACLs, account switching, capability version, and public projection together.                                    |
| The copy path is bounded and reauthorizes during work.                          | `forkComposition.ts` caps graph size through the resolver, file count per target, mapping size, structural walk depth, and a 120-second operation deadline. It revalidates source composition before and after writes and cleans newly created Things/files on failure.                                                      | High for current controls. Test quota, timeout, source change, partial cleanup, and retry on the built server.                                                    |
| Stored first-party media can become independently owned copies.                 | PR #755 documents and tests quota-accounted copy through the normal attachment lifecycle, exact stored-version checks, moderation preservation, transaction-bound target links, and targeted HTML/CSS/argument rewriting. Deployed browser acceptance kept generated and linked gallery copies usable after source deletion. | High for the accepted fixtures, not every media or runtime dependency. Recheck route version, storage provider, moderation, and browser acceptance after changes. |
| The source is not mutated by the copy operation.                                | The implementation writes new IDs and files, rewrites only the derivative, and cleanup targets only newly created records. The endpoint documentation explicitly says original Things, ACLs, and files are unchanged.                                                                                                        | High for inspected paths. Preserve source immutability in every future copy/fork family.                                                                          |
| A narrow lineage hint exists, but no complete lineage contract does.            | Copied webpages receive `crystal.forkOf = source shareId`. No inspected contract binds the exact source content/dependency version, copy event, declared terms, attribution, creator role, material changes, or correction/dispute state.                                                                                    | High for the current field; medium for repository-wide absence. Re-query before implementation because parallel provenance work may add a canonical model.        |
| Access and executable authority are deliberately separated.                     | The resolver treats a root owner as a lookup namespace, never an execution identity; it rebuilds authorization per invocation, rejects unavailable required references, and does not let discovery grant media access.                                                                                                       | High for current resolver/fork paths. Re-test foreign templates, actions, nested data, keyed links, groups, and stale authorization.                              |
| Copy independence is scoped rather than universal.                              | First-party stored files are copied, while arbitrary external URLs are unchanged and linked-file records copy metadata without fetching external bytes. Unsupported/unretargetable dependencies fail rather than silently producing a partial app.                                                                           | High for documented behavior. The UI does not yet present an independently reviewable dependency/egress plan.                                                     |
| Copy permission, terms, and attribution are not yet represented by the copy UX. | `ForkSharedThingButton.tsx` checks sign-in and capability compatibility, calls the endpoint, and navigates to the private copy. The inspected UI does not show a source version, reuse grant, licence/terms, attribution requirement, dependency manifest, or downstream obligations before copying.                         | High for current UI. This is a product gap, not a conclusion that a particular use is unlawful.                                                                   |
| Existing garden themes own adjacent evidence and authority.                     | TODO 29 owns provenance/correction assertions; TODO 31 owns creator terms, value, fulfilment, and remedies; TODO 34 owns shared editing authority; TODO 23 owns export/restore/exit; TODO 26 owns safety enforcement and appeals; TODO 33 owns AI authority.                                                                 | High for current plans. TODO 40 must integrate those contracts instead of creating parallel truth, payment, ACL, moderation, or AI systems.                       |

## External design inputs

These sources provide vocabulary and design constraints. They do not establish
that a licence applies, that a person owns the source, or that Thingtime meets
any legal or standards obligation.

1. W3C [PROV-O](https://www.w3.org/TR/prov-o/) distinguishes entities,
   activities, agents, derivation, attribution, revision, primary source, and
   invalidation. It is useful interoperability vocabulary, not a required
   storage schema or a truth verdict.
2. Creative Commons' [licence overview](https://creativecommons.org/cc-licenses/)
   shows that permissions to share and adapt can carry different attribution,
   non-commercial, no-derivatives, and share-alike conditions. Thingtime must
   not reduce those differences to one generic “copyable” flag.
3. The [CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/deed.en)
   illustrates a human-readable obligation set that includes appropriate
   credit, a licence link, and indicating changes. Qualified review must choose
   what, if any, terms Thingtime supports and how their legal text is sourced.
4. W3C [Privacy Principles](https://www.w3.org/TR/privacy-principles/) supports
   purpose limitation, data minimisation, contextual transparency, easy
   withdrawal, group privacy, and remedies for data about a person supplied by
   somebody else.
5. The eSafety Commissioner's [Safety by Design foundations](https://www.esafety.gov.au/industry/safety-by-design/foundations)
   keeps user empowerment and autonomy central. Reuse must not bypass personal
   blocks, safety actions, reporting, or remedy merely because bytes were copied.
6. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) informs the complete preview,
   comparison, attribution, conflict, withdrawal, and remedy journey; a visual
   diff alone is not an accessible explanation.

## Strengths to preserve

- **Copies are private by default.** The first useful copy is not silently
  published, searchable, monetized, or granted a new audience.
- **Required dependencies fail closed.** A broken or inaccessible dependency
  does not become a quietly incomplete app.
- **Fresh authorization owns access.** Discovery and stored source IDs do not
  become durable capabilities.
- **First-party files are copied through normal controls.** Quota, moderation,
  checksums, purpose approval, binding, and cleanup are not bypassed.
- **Source and derivative are separate writes.** Copy failure and deletion do
  not mutate the original.
- **External bytes are not silently imported.** A copied external reference is
  not misreported as a locally owned or permanently available asset.
- **Capability negotiation is explicit.** The client requires a semantic API
  version rather than inferring support from route existence.

## Gaps that block an accountable pilot

1. **No reuse-permission model.** Readability and copy mechanics do not express
   whether adaptation, redistribution, commercial use, sublicensing, or AI use
   is permitted, prohibited, unknown, or source-specific.
2. **No exact lineage receipt.** `forkOf` does not bind source revision,
   dependency/material manifest, copy time, actor role, copy contract, or later
   derivative changes.
3. **No pre-copy bill of materials.** People cannot inspect which Things,
   first-party files, linked records, external URLs, services, fonts, secrets,
   permissions, or unsupported dependencies will remain.
4. **No attribution/change journey.** The copy flow does not preserve approved
   credit, explain creator pseudonym/privacy choices, or help a remixer mark
   material changes without implying endorsement.
5. **No upstream/downstream protocol.** A source correction, safety block,
   rights withdrawal, vulnerability, or new release has no bounded notice,
   compare, ignore, adopt, or remedy state for derivatives.
6. **No terms-conflict gate.** Combining several sources could create
   incompatible obligations; a successful byte copy must not be called an
   authorized remix.
7. **No dispute-specific remedy.** Rights, privacy, attribution, provenance,
   impersonation, malware, and community-safety disputes need scoped intake,
   evidence, interim action, appeal, and outcome authority.
8. **No complete independence proof.** The accepted fixture covers selected
   file families, not every external dependency, action, secret, endpoint,
   font, linked resource, update, export, or offline journey.

## Risks and abuse cases

- Copying public or keyed content whose audience grant never authorized reuse.
- Removing attribution, obscuring material changes, or implying source-creator
  endorsement of a derivative.
- Copying personal information, comments, credentials, tokens, analytics IDs,
  private endpoints, unsafe actions, or hidden dependencies into another account.
- Treating a successful fork response as proof of copyright ownership, licence
  compatibility, originality, safety, accessibility, or production readiness.
- Publishing or selling a private copy under terms inconsistent with its
  sources, or using platform ranking to pressure creators into permissive terms.
- Remotely mutating or deleting a derivative when the source changes, or never
  informing the remixer about a critical safety correction.
- Laundering blocked, disputed, impersonating, malicious, or non-consensual
  material through repeated forks.
- Building a public lineage graph that reveals pseudonyms, private sources,
  collaborator relationships, or sensitive interests.

## Bounded first experiment

Two approved adult test accounts use a fully synthetic source app containing
purpose-made text, one generated tiny image, one internal action that performs
no external side effect, and a plain-language test reuse notice. Before copying,
the recipient sees the exact source revision, declared test terms, attribution
preview, included Things/files, retained external references, unsupported
items, estimated quota, privacy of the result, and what independence does not
mean.

The recipient creates one private copy, confirms the original is unchanged,
changes one labelled text field, and views an accessible source-versus-copy
comparison. The receipt records only synthetic IDs, content hashes, versions,
declared terms, copied dependency classes, copy outcome, and the recipient's
explicit change note. The source owner then publishes a synthetic correction;
the recipient sees it as an optional notice, compares it, and explicitly
declines or adopts it. Finally both accounts export their own bounded receipts
and delete all fixtures.

Evaluation records no authored source content, private dependency values,
queries, dwell, cursor movement, copy-abandonment reason, relationship graph,
or free-form feedback. Success means both people can accurately predict the
copy's contents, authority, independence, attribution, update behavior, and
deletion effects—not that they copy, publish, or spend more time.

## Stop conditions

Stop intake and preserve only incident-minimum evidence if any test:

- copies an unlisted, inaccessible, unsupported, unsafe, or non-synthetic item;
- grants execution, ACL, app, tool, endpoint, or secret authority from source
  readability or lineage alone;
- changes the source, silently updates the derivative, or deletes either side
  because the other changed;
- loses required attribution or terms, fabricates rights/identity/endorsement,
  or exposes private creator or recipient information;
- publishes, monetizes, trains on, recommends, or externally shares the copy;
- misreports partial copy, cleanup, dependency, correction, withdrawal,
  dispute, export, or deletion state;
- bypasses personal block, moderation, account closure, or approved incident
  action; or
- fails an approved accessibility, privacy, security, capability, quota,
  constrained-network/device, restore, or remedy gate.

## Questions for owners and qualified reviewers

1. Is the first supported grant a narrow, platform-authored synthetic-test
   permission, or will Thingtime represent named external licences?
2. Which content families may be copied, adapted, quoted, or redistributed,
   and which remain readable-only until separately approved?
3. What exact source version and dependency evidence is required for a durable
   lineage receipt without preserving private content indefinitely?
4. How can creators choose attribution labels or pseudonyms and correct them
   without turning attribution into identity proof or mandatory public profile?
5. Which source changes deserve optional notice, urgent safety intervention,
   or no downstream signal—and who has that authority?
6. How are incompatible, absent, disputed, or changing terms represented
   without the platform pretending to give legal advice?
7. What can be exported or deleted by each party, and what minimal receipt may
   remain for safety, rights, billing, or dispute purposes?
8. Which product, creator-support, rights, privacy, security, accessibility,
   safety, operations, and incident owners can stop the pilot?
