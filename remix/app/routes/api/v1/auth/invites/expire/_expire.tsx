import { timingSafeEqual } from 'node:crypto';
import { json } from '~/api/http';
import { expireInvites } from '~/api/utils/invites/invites';
export const loader = async ({ request }: { request: Request }) => {
	const headers = { 'Cache-Control': 'no-store' };
	const secret = process.env.CRON_SECRET;
	if (!secret) return json({ ok: false, error: 'Invite expiry is not configured.' }, { status: 503, headers });
	const supplied = Buffer.from(request.headers.get('Authorization') || '');
	const expected = Buffer.from(`Bearer ${secret}`);
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
		return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
	await expireInvites();
	return json({ ok: true }, { headers });
};
