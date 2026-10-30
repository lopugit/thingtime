# AI Advice: Agents And Councils

This note describes a practical way to use Codex, Claude Desktop, and future
agent-capable tools as a coordinated development system for Thingtime.

It is intentionally tool-agnostic where app UIs change over time. Treat
`AI_ALL.md` as the shared operating contract (`AGENTS.md` and `CLAUDE.md` are
compatibility symlinks to it), then use this file to decide which agents should
exist, how they should communicate, and what they should produce.

## Core idea

Use one lead agent plus small councils of specialist agents.

- The lead agent owns the task, branch, final decisions, and user communication.
- Specialist agents investigate, implement, test, review, or summarize.
- Councils are temporary groups of specialists with a shared objective.
- Every agent works from the same repo instructions and reports back through a
  concise handoff packet.

The lead agent should not blindly accept council output. It integrates the
useful parts, verifies the result, and keeps the final branch coherent.

## Shared setup

Use the same repo-level instruction stack in every agent app:

1. Read `AI_ALL.md` (or either root compatibility symlink).
2. Read `FUNDAMENTALS.md` before feature work.
3. Read `DECISIONS.md` when product direction or architecture tradeoffs matter.
4. Use Graphify first when `graphify-out/graph.json` exists and the task touches
   repo structure, relationships, or implementation discovery.

Useful baseline rules:

- Use `.test-branches/` for PR review/fix work.
- Copy parent `.env*` files into `.test-branches/` clones before install,
  build, dev, or smoke checks.
- Use `npm run web-pms` for the current checkout's PM2-managed Remix dev stack.
  Do not restart it after every source edit; rely on hot reload unless
  env/dependency/process state changed.
- Verify layout and alignment changes in a live browser.
- Keep secrets out of docs, prompts, screenshots, logs, and PR bodies.

## Agent roles

### Lead Engineer

Owns the current branch and final mergeable output.

Responsibilities:

- Clarify the goal only when necessary.
- Read the relevant instructions and code.
- Decide which council, if any, is useful.
- Integrate patches.
- Run verification.
- Write the final summary.

### Implementer

Builds the feature or fix.

Good for:

- Scoped components
- API endpoints
- Data model helpers
- Focused refactors

Output:

- Files changed
- Behavior implemented
- Known risks
- Suggested verification commands

### Test Engineer

Finds the cheapest reliable validation path.

Good for:

- Unit and integration test planning
- API smoke checks
- Browser layout verification
- Regression reproduction

Output:

- Test matrix
- Commands run
- Pass/fail summary
- Any untested risk

### Security Reviewer

Reviews auth, secrets, SSR, data exposure, rate limits, and trust boundaries.

Good for:

- JWT/session work
- MongoDB access paths
- Public API endpoints
- Webhook handlers
- Third-party tokens

Output:

- Findings by severity
- Exploit sketch where relevant
- Minimal fix recommendation
- Residual risk

### Product Reviewer

Checks whether the implementation fits Thingtime's vibe and user workflows.

Good for:

- UX text
- Lopu messages
- Tool pages
- Onboarding
- Feature scope cuts

Output:

- What feels aligned
- What feels confusing
- Tiny polish list
- Larger product follow-ups

### PR Reviewer

Runs a review stance against a diff.

Priority order:

1. Security issues
2. Crashes and data loss
3. Behavioral regressions
4. Performance problems
5. Missing tests or weak validation
6. Maintainability concerns

Output:

- Findings first, with file/line references
- Open questions
- Short summary only after findings

### Customer Support Agent

Turns user pain into reproducible tickets.

Good for:

- Support inbox triage
- Bug report cleanup
- Reproduction steps
- Docs gaps

Output:

- User-facing answer draft
- Internal issue summary
- Reproduction steps
- Suggested priority

### Regression Sentinel

Keeps old bugs from returning.

Good for:

- Hydration regressions
- Auth/session regressions
- Vercel status regressions
- MongoDB status regressions
- Lopu musing quota regressions

Output:

- Regression checklist
- Smoke commands
- Browser checks
- "Known previous failures" notes

## Council patterns

### Feature Implementation Council

Use when building a feature with UI, API, and data/security implications.

Agents:

- Lead Engineer
- Implementer
- Test Engineer
- Product Reviewer
- Security Reviewer, if auth/data/external APIs are involved

Flow:

1. Lead defines the feature contract.
2. Implementer proposes or builds the smallest coherent slice.
3. Product Reviewer checks user flow and naming.
4. Security Reviewer checks trust boundaries.
5. Test Engineer defines and runs focused checks.
6. Lead integrates and decides whether to broaden scope.

Good handoff prompt:

```text
You are the Test Engineer for this Thingtime feature. Read AI_ALL.md,
FUNDAMENTALS.md, and the changed files. Return a focused validation plan with
commands and browser checks. Do not modify files.
```

### PR Review Council

Use for high-risk or large PRs.

Agents:

- PR Reviewer
- Security Reviewer
- Test Engineer
- Product Reviewer, if UX changed

Flow:

1. PR Reviewer gives findings by severity.
2. Security Reviewer separately checks secrets/auth/data exposure.
3. Test Engineer checks whether the PR can be safely validated.
4. Lead turns accepted findings into fixes.

Rule:

Do not let style comments bury security or correctness findings.

### Regression Testing Council

Use after touching shared systems.

Agents:

- Regression Sentinel
- Test Engineer

Core checklist:

- Auth login/register/logout/session revocation
- MongoDB status and data routes
- Lopu toast and musing fallback/rate limit
- Vercel footer and `/vercel`
- `/crypto` key generation/verification
- Hydration/browser console
- Mobile and desktop layout for changed pages

### Customer Support Council

Use when messages from users need diagnosis and response.

Agents:

- Customer Support Agent
- Test Engineer
- Product Reviewer

Flow:

1. Support agent extracts the actual user problem.
2. Test Engineer tries to reproduce with the least invasive path.
3. Product Reviewer suggests copy/docs/product fix.
4. Lead decides whether to patch, document, or reply.

### Governance And Public Systems Council

Use for future civic/accountability features.

Agents:

- Product Reviewer
- Security Reviewer
- Data Model Reviewer
- Abuse/Risk Reviewer
- Legal/Policy Researcher, if available

Core questions:

- Is every public claim tied to evidence?
- Is allegation separated from finding?
- Is there a correction/right-of-reply path?
- Can provenance be audited?
- What abuse does this enable?
- What should be append-only?

## Handoff packet template

Every specialist should report back in this shape:

```md
## Objective

One sentence.

## What I Checked

- Files
- Commands
- Browser states
- Docs

## Findings

- P1/P2/P3 or "none"

## Recommendation

The smallest next action.

## Residual Risk

What remains unverified or uncertain.
```

## Branch strategy

Recommended default:

- Lead works on one branch.
- Specialists can inspect or create notes, but should not push competing
  branches unless the lead asks.
- For risky experiments, use `.test-branches/`.
- For durable advice or planning, add timestamped notes under `AI_Idlings/`.

## Prompt snippets

### Implementer

```text
You are an Implementer agent in the Thingtime repo. Read AI_ALL.md,
FUNDAMENTALS.md, and relevant files. Implement only the scoped feature. Keep
changes minimal, use existing patterns, and report verification commands. Do
not commit unless asked.
```

### Security Reviewer

```text
You are a Security Reviewer for Thingtime. Prioritize secrets, auth/session
integrity, SSR/client data exposure, MongoDB access, rate limits, external API
tokens, webhook trust, and permission boundaries. Return findings first with
file/line references and concrete fixes.
```

### Regression Sentinel

```text
You are a Regression Sentinel for Thingtime. Build a checklist from recent
known issues and the changed files. Prefer focused checks over broad noisy
commands. Include browser checks for UI/layout changes.
```

### Product Reviewer

```text
You are a Product Reviewer for Thingtime. Check whether the flow feels aligned
with an open, playful, powerful structured-data platform. Prefer tiny UX
improvements that reduce confusion without adding scope.
```

## What to automate later

- A script that creates a council folder with prompts and handoff files.
- A PR checklist generator based on changed files.
- A regression matrix that maps files to smoke checks.
- A support-ticket summarizer that converts user reports into reproducible
  issues.
- A "council minutes" artifact that records which agents reviewed a PR and what
  was accepted or rejected.

## Operating principle

Councils should increase clarity, not ceremony. Use them when multiple kinds of
judgment are needed. Skip them when one focused engineer can make and verify the
change faster.
