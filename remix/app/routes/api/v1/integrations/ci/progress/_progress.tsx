import { json } from '~/api/http';
import {
	FEATURE_STACK_PROGRESS_MAX_BYTES,
	parseFeatureStackProgressRequest,
	recordFeatureStackProgress
} from '~/api/utils/ciControl/featureStackProgress';
import { verifyCiProviderRouteSignature } from '~/api/utils/ciControl/providerRouter';

const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

export const action = async ({ request }: { request: Request }) => {
	const secret = process.env.THINGTIME_CI_ROUTER_SECRET?.trim() ?? '';
	if (!secret) return json({ ok: false, error: 'CI progress reporting is not configured.' }, { status: 503, headers: noStore });
	const declaredLength = Number(request.headers.get('content-length') ?? 0);
	if (declaredLength > FEATURE_STACK_PROGRESS_MAX_BYTES) return json({ ok: false, error: 'Progress payload is too large.' }, { status: 413, headers: noStore });
	const rawBody = await request.text();
	if (Buffer.byteLength(rawBody, 'utf8') > FEATURE_STACK_PROGRESS_MAX_BYTES) return json({ ok: false, error: 'Progress payload is too large.' }, { status: 413, headers: noStore });
	if (!verifyCiProviderRouteSignature(rawBody, request.headers.get('x-thingtime-ci-signature'), secret)) {
		return json({ ok: false, error: 'Invalid progress signature.' }, { status: 403, headers: noStore });
	}
	let body: unknown;
	try {
		body = JSON.parse(rawBody);
	} catch {
		return json({ ok: false, error: 'Invalid progress payload.' }, { status: 400, headers: noStore });
	}
	const progress = parseFeatureStackProgressRequest(body, {
		repository: (process.env.THINGTIME_GITHUB_REPOSITORY ?? 'lopugit/thingtime').trim() || 'lopugit/thingtime'
	});
	if (!progress) return json({ ok: false, error: 'Invalid or expired progress report.' }, { status: 400, headers: noStore });
	const recorded = await recordFeatureStackProgress(progress);
	if (!recorded) return json({ ok: false, error: 'Feature Stack run not found.' }, { status: 404, headers: noStore });
	return json({ ok: true, ...recorded }, { status: 202, headers: noStore });
};
