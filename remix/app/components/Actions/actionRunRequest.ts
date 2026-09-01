// The POST body for /api/v1/actions/run. Pure and shared so the one
// security-relevant field on this request cannot be dropped in transit, and
// so a unit test can hold it in place.
//
// `source: 'component'` is what narrows server-side resolution to actions the
// viewer OWNS (execute.ts resolveActionProgram, `ownedOnly`). It is
// load-bearing because a component render tree is attacker-shaped: the
// /components catalog saves a FOREIGN template verbatim into a thing YOU own
// (ComponentsBrowsePage handleSaveVersion copies `render` as-is), so the
// ttAction control you then click in the /things preview can name any action
// id. Without the marker the executor resolves any action the viewer can
// merely READ, and the run still executes AS the viewer — precisely the
// authority hand-off the flag exists to refuse.
//
// useApi previously rebuilt this body from a partial key list and silently
// dropped `source`, so the delegated path was never narrowed in a browser.
// verify-actions.mjs POSTs to the endpoint directly, which is why every
// server-side check passed while the real client sent nothing.

export type ActionRunArgs = {
	action?: unknown;
	inputs?: unknown;
	// 'component' = a delegated ttAction click. Any other non-empty string is
	// forwarded verbatim rather than filtered against a value allowlist, so a
	// later source cannot vanish the same way this one did.
	source?: unknown;
};

export const buildActionRunBody = (args?: ActionRunArgs | null): Record<string, unknown> => {
	const body: Record<string, unknown> = { action: args?.action, inputs: args?.inputs };
	if (typeof args?.source === 'string' && args.source) body.source = args.source;
	return body;
};
