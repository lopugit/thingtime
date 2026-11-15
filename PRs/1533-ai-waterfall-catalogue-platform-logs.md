# PR 1533 — AI waterfall selection and private scheduled run logs

The waterfall dialog failed to associate the current configuration with its saved
waterfall, and newly discovered Opus 5.5 had no curated reasoning capabilities.
The shared selector now matches ordered endpoint/model/effort/speed entries at
open, reconciles a late saved library only before editing, and preserves drafts.
Opus 5.5 exposes the five documented effort choices and standard pricing.

The Vercel model refresh is scheduled at 03:23 UTC daily. Independent public
catalogue reads observed both providers advance to 2026-11-15T03:23:44.329Z
without a manual refresh. Discovery persists IDs, lifecycle and timestamps. Authenticated Anthropic model
metadata now updates stored effort choices for existing and new models. Missing
or malformed metadata retains the last verified options. Production currently
uses the public-document fallback for Anthropic, which keeps curated capability
defaults; an API catalogue key is required for authenticated effort discovery.
Speed and pricing changes remain reviewed mappings. Published effort choices flow
through the legacy workflow editor, strict saved-order validation and request-local
runtime snapshots. Removed tiers retain the selected model with provider-default
effort; opening the chooser before its outer catalogue loads cannot silently save
the default sentinel instead of the selected model.

Private platform reporting is configured through an administrator-only, home
account settings surface. It selects an owned account, active Character and
private audience group. No specific account or group is hardcoded. Optional
Character handles use immutable transaction-bound creation receipts, so retries
cannot create another identity or repurpose a creation ID. Audience reads include
implicit group owners and reject orphaned memberships.

The scheduled reporter admits only the nine configured cron GET routes with the
exact scheduler credential. Posts contain safe lifecycle metadata and allowlisted
numeric summaries, never provider bodies, secrets or raw errors. Manual admin
requests do not masquerade as automatic runs. Durable continuation outcomes are
correlated separately from the HTTP dispatcher. Email queue completion is not
proof of downstream email delivery. Posts use the normal Thing creation,
accounting and private ACL paths and an explicit editable renderer.

Verification recorded during implementation:

- Original AI regression suite: 165 pass, one unrelated opt-in skip; keychain five
  and runtime seven checks passed. Targeted lint and TypeScript passed.
- Waterfall component Chrome fixture: fourteen scenarios across desktop/mobile,
  including late library data, saved identity, edits, cancel/reopen, cold editor
  catalogue arrival, discovered effort roundtrips and removed-tier fallback.
- Admin settings Chrome fixture: desktop/mobile save/readback, dirty refresh,
  revision conflicts, uncertain group creation, nested Builder selection,
  scrolling/overflow, identity cancellation and custom-plane refusal passed.
- Built Node HTTP fixture on a disposable replica set: chosen Character handle,
  concurrent retry identity, owned-account link, private readback, implicit group
  owner, anonymous/stranger refusal, disable and group-deletion revocation passed.
- Private reporting suites: 46 checks passed, including transaction-bound
  authorization fences and durable workflow outcomes. Capability suite: 214 pass.
  Final Node build and the built HTTP fixture passed after the workflow-boundary fix.
  Release checks remain separate from this local evidence.

The first preview was protected by Vercel login; its controller also reported a
preview failure. The final preview and production acceptance must be checked at
the final source revision. Graphify semantic extraction hit local-proxy HTTP500;
structural snapshots remain usable, with unindexed changed prose noted explicitly.
