// Browser action flows may span requests. Pin them to the account that prepared
// the flow, including when another tab changes the active httpOnly session.
export const EXPECTED_ACTOR_HEADER = 'X-Thingtime-Expected-Actor';
export async function enforceExpectedActor(request: Request, currentUser: (request: Request) => Promise<{ id: string } | null>): Promise<Response | null> {
	const expected = request.headers.get(EXPECTED_ACTOR_HEADER);
	if (expected === null) return null;
	if (!expected || expected.length > 128 || (await currentUser(request))?.id !== expected) {
		return Response.json({ ok: false, error: 'The active account changed. Run the action again.' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
	}
	return null;
}
