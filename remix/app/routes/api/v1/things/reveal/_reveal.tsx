import { json, readJsonBody } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { confirmCurrentPassword } from '~/api/utils/auth/passwordConfirmation';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceFixedRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { revealSensitiveThingValue } from '~/api/utils/things/sensitiveReveal';

const MAX_BODY_BYTES = 8 * 1024;
const REVEAL_LIMIT = { limit: 5, windowMs: 15 * 60_000 } as const;
const BODY_FIELDS = new Set(['thingId', 'reference', 'password']);

type SensitiveRevealDependencies = {
	requireAdmin: typeof requireAdmin;
	enforceRateLimit: typeof enforceFixedRateLimit;
	confirmPassword: typeof confirmCurrentPassword;
	revealValue: typeof revealSensitiveThingValue;
	readBody: typeof readJsonBody;
};

const defaultDependencies: SensitiveRevealDependencies = {
	requireAdmin,
	enforceRateLimit: enforceFixedRateLimit,
	confirmPassword: confirmCurrentPassword,
	revealValue: revealSensitiveThingValue,
	readBody: readJsonBody
};

const isSameOriginRequest = (request: Request): boolean => {
	const origin = request.headers.get('Origin');
	if (!origin) return true;
	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
};

// POST /api/v1/things/reveal — one password-confirmed lookup from a closed set
// of protected Thing codecs. There is intentionally no generic secure-field or
// JSON-path decoder, and every request repeats current-password verification.
export const createSensitiveRevealAction = (
	overrides: Partial<SensitiveRevealDependencies> = {}
) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAdminPrivateResponse(async () => {
		try {
			if (request.method.toUpperCase() !== 'POST') {
				return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
			}
			if (!isSameOriginRequest(request)) {
				return json({ ok: false, error: 'Cross-origin reveal requests are not allowed' }, { status: 403 });
			}
			const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
			if (mediaType !== 'application/json') {
				return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
			}

			const gate = await dependencies.requireAdmin(request);
			if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
			const { user } = gate;

			const body = await dependencies.readBody(request, MAX_BODY_BYTES);
			if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !BODY_FIELDS.has(key))) {
				return json({ ok: false, error: 'Invalid reveal request' }, { status: 400 });
			}
			const thingId = typeof body.thingId === 'string' ? body.thingId : '';
			const reference = typeof body.reference === 'string' ? body.reference : '';
			if (!thingId || thingId.length > 256 || !reference || reference.length > 64) {
				return json({ ok: false, error: 'Invalid reveal request' }, { status: 400 });
			}

			const limit = await dependencies.enforceRateLimit(
				request,
				'auth.sensitiveReveal',
				`user:${user.id}`,
				REVEAL_LIMIT
			);
			if (!limit.allowed) {
				if (limit.unavailable) {
					return json({ ok: false, error: 'Sensitive reveal is temporarily unavailable' }, { status: 503 });
				}
				return json({ ok: false, error: 'Too many reveal confirmation attempts' }, rateLimitedResponseInit(limit));
			}

			const confirmation = await dependencies.confirmPassword(user.id, body.password);
			if (confirmation === 'unavailable') {
				return json({ ok: false, error: 'Password confirmation is temporarily unavailable' }, { status: 503 });
			}
			if (confirmation !== 'confirmed') {
				return json({ ok: false, error: 'Password confirmation failed' }, { status: 401 });
			}

			const reveal = await dependencies.revealValue(user, thingId, reference);
			if (!reveal) return json({ ok: false, error: 'Sensitive value not found' }, { status: 404 });
			return json({ ok: true, reveal: { reference: reveal.reference, kind: reveal.kind, value: reveal.value } });
		} catch (error) {
			if (error instanceof Response) throw error;
			return json({ ok: false, error: 'Sensitive reveal is temporarily unavailable' }, { status: 503 });
		}
		});
};

export const action = createSensitiveRevealAction();

// Nitro dispatches GET/HEAD to loader before action, so stamp the same private
// cache boundary on unsupported methods too.
export const loader = async () =>
	withAdminPrivateResponse(async () =>
		json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
	);
