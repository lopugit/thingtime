# PR #1004 — Provider model availability and admission controls

Branch: `codex/provider-model-sync` · target: `main` · 2026-10-17

Lopu could continue offering a retired model after a provider upgrade. The shared catalogue now refreshes provider-native model IDs daily at 03:23 UTC, on an admin sync action, and after a model-not-available inference error. Claude discovery uses the existing admin OAuth credentials; OpenAI uses its existing project/org-aware credential. No inference replay or automatic model substitution is introduced.

## Storage and failure boundaries

- Reuses system-owned ai-model Things and the settings collection. No parallel catalogue or migration is needed.
- Complete bounded provider lists publish atomically with a database lease, token fencing and a five-minute retry cooldown. Missing IDs become unavailable; existing enable/disable choices remain intact.
- Empty, partial, malformed, oversized, denied and timed-out responses retain the previous snapshot. Every configured Claude credential must complete before absence is authoritative.
- New supported versions use conservative default effort/speed capabilities. Non-chat models are recorded but never offered through chat adapters. Unknown pricing remains explicitly unpriced.
- The public list and shared server waterfall selectors include available choices only. Admins retain retired records for inspection. Personal vault models do not alter global provider availability.
- Each provider has independent Allow all current models and Auto-allow new models controls. The first changes existing model toggles; the second governs future discovered models. Auto admission defaults off.

## Validation

- 223 focused catalogue, route, settings, chat-store and API capability tests passed.
- 71 streaming tests, 233 Lopu UI tests and 14 Vercel configuration tests passed.
- Production build and model-routing contract passed; changed-file lint has no errors and one existing chat-store warning.
- TypeScript ratchet reports 91 errors versus recorded baseline 89, in existing areas outside the changed implementation. This is not a clean repository-wide typecheck.
- Live local Mongo-backed admin API verification covered independent policy persistence, preservation of model toggles and safe cron authentication.
- Desktop and 390px browser verification covered checkbox interactions, save feedback, restoration of initial policy, and wrapping within the provider card.
- Code review covered transaction publication, identity collisions, auth, bounded discovery, credential scope, retry coalescing, fail-closed catalogue reads and delayed client responses across account changes.

README contains fork-safe credential and cron setup. TESTING and the feature map describe ongoing manual checks. Production deployment and provider results are verified separately after merge; local fixtures do not prove the production OAuth listing scope.
