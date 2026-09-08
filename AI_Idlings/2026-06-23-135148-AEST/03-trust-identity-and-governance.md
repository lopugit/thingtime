# Trust, Identity, And Governance

Thingtime already has the beginning of portable identity via ES256 JWTs and a
JWKS endpoint. The next layer is trust: who said what, when, under which rules,
and can anyone verify it later?

## Identity

- Keep Thingtime-issued JWTs externally verifiable.
- Add token introspection for live revocation checks.
- Add signed public profile documents.
- Let users rotate keys and keep a public key history.
- Support organisation identities separately from personal identities.

## Claims and attestations

A claim is a thing someone signs:

- "I own this account."
- "This product was shipped."
- "This official voted yes."
- "This payment was received."
- "This document is authentic."

Attestations can form a trust graph:

- User attests to user.
- Organisation attests to member.
- Customer attests to merchant.
- Citizen attests to public record.
- Auditor attests to evidence bundle.

## Governance and voting

Start simple:

- Proposal thing.
- Eligibility rule.
- Vote thing.
- Result thing.
- Audit trail thing.

Then grow:

- Delegated voting.
- Quadratic voting.
- Time-boxed deliberation.
- Public comment periods.
- Amendment graphs.
- Revocation/correction records.

Hard requirement:

Voting should be boringly auditable before it becomes clever.

## Current planning boundary

The dated [identity agency and context-safe presence baseline](../../NOTES/identity-agency-and-context-safe-presence-baseline.md)
and [roadmap](../../PLAN/identity-agency-and-context-safe-presence-roadmap.md)
now govern further product planning. These ideas remain exploratory: a JWT or
credential signature can establish integrity and issuer control, but not the
truth, relevance, authority, or fairness of a claim. Signed profiles,
attestations, organization identities, voting, and public trust signals require
separate owner decisions, threat models, privacy and accessibility review,
correction/revocation/remedy paths, and evidence before implementation.
