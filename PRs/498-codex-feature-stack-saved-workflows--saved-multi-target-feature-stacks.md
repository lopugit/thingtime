# PR #498 — Saved multi-target Feature Stacks

## Goal

Let a Thingtime admin save an ordered set of feature pull requests, select one
or more target branches, and ask Lopu to resolve and publish the whole compatible
batch without repeating the merge-conflict cycle for every feature.

## Delivered surface

- Saved, editable, archiveable Feature Stacks stored as protected relational
  Things, with one or more ordered source PRs and one or more targets.
- Default-on automatic routing: `develop` sources may flow to `develop` and
  `main`, while `main` and `github-actions` sources remain isolated to their own
  compatible selected targets.
- Per-target progress derived from Lopu's integration PRs, plus later-run and
  Save & merge controls.
- A Vercel-style multi-select pull-request status filter.
- Inline editing for AI workflow model, reasoning effort, and speed entries.
- A platform-agnostic named credential waterfall in Thingtime's encrypted
  vault. The GitHub controller asks for Anthropic-compatible credentials while
  GitHub retains one stable vault-router secret instead of one secret per token.

## Safety and compatibility

- The API re-reads every selected pull request before dispatch and binds the
  immutable plan to its repository, base, head, and SHA.
- The v2 plan records each source's compatible targets. The protected
  `github-actions` controller filters that plan to a single target before the
  agent, verifier, and publisher run.
- Existing encrypted Anthropic rows remain compatible; stored credentials are
  write-only in the browser and are never copied into GitHub plan payloads.
- New stack and credential contracts are origin-scoped in the API capability
  manifest and the server-owned stack schemas are protected from generic CRUD.

## Validation evidence

- Focused ESLint passed with no warnings.
- 70 focused Node tests passed, covering plan routing, credential normalization,
  capability negotiation, and protected schema projection.
- The full production build passed, including Nitro generation and Vercel
  output verification.
- Controller plan self-tests, workflow YAML parsing, and Lopu routing-contract
  tests passed on the companion `github-actions` PR #497.
- Graphify was refreshed after the implementation and committed separately.

## Live preview evidence

The authenticated desktop/mobile interaction and overflow checks will be added
after Vercel finishes deploying this branch.
