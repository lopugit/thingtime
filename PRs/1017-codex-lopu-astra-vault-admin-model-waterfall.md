# PR 1017: GitHub Lopu admin model waterfall

The protected controller now compiles native pinned provider actions from the live admin waterfall and capability manifest. Each configured model keeps its reasoning effort and runs against enabled vault credentials in administrator priority order. Missing accounts and classified account/authentication failures advance the order; ordinary task failures stop.

The production setting observed on 2026-10-18 is `gpt-6-astra:medium` followed by `claude-opus-5:high`. That is runtime data, not a source fallback. OpenAI credentials must be saved under platform `OpenAI`, type `openai-api-key`; moderation credentials are never substituted.

Validation: 196 script tests and both controller contract self-tests pass. Actionlint syntax diagnostics match the base branch. Live production manifest and settings reads passed. GitHub execution is not verified until this controller is deployed and the OpenAI credential is imported in production.

Security: masks and private files protect credential delivery; generated helpers and plan are hash checked before later attempts; publication scans include both provider caches. Claude continuation uses the selected account. Post-agent semantic Graphify refreshes inherit the successful model and vault OpenAI key; they do not require a duplicate GitHub key or substitute a hardcoded model. Task/tool text quoting authentication or quota errors cannot cause failover.

Graphify: code outputs refreshed. Semantic documentation extraction was interrupted after the local proxy health request timed out; retained semantic material may be stale.

Rollout: review and merge the controller into `github-actions`; deploy the separate product import change and use its same-origin admin import to add `OPENAI_THINGTIME_API_KEY`. Verify a real bounded workflow run afterward. No production credential or remote primary branch was changed by this PR preparation.
