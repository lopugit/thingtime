# Core Thing Loops

The main product loop should make a thing easy to create, inspect, transform,
share, and automate.

## Thing editor loop

1. Create a thing from text, JSON, form fields, or import.
2. Inspect it as structured data and as a friendly view.
3. Attach permissions, provenance, and links.
4. Share it by URL/API/JWT-scoped access.
5. Let agents and apps act on it through the same API path.

Useful first examples:

- Personal profile thing.
- Project plan thing.
- Public promise thing.
- Product listing thing.
- Vote/proposal thing.
- Evidence bundle thing.

## Thing templates

Templates can be ordinary things:

- A template has schema, example data, UI hints, validation, and actions.
- A template can be forked.
- A template can publish migration notes.
- A template can declare required permissions and API capabilities.

Early template library:

- Person
- Organisation
- Project
- Proposal
- Vote
- Product
- Receipt
- Source/evidence
- Public official
- Claim
- Audit note

## Thing actions

Every thing should eventually expose actions:

- Validate
- Sign
- Share
- Fork
- Vote
- Sell
- Buy
- Subscribe
- Report
- Archive
- Export

The design challenge is to keep this from becoming noisy. Action discovery
should depend on context, permissions, and current user intent.
