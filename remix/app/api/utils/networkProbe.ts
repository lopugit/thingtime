import { json } from '../http';

// The public network-probe endpoints are deliberately finite. Commander uses
// this exact ladder for its opt-in speed check; callers cannot choose an
// arbitrary transfer size or turn Thingtime into an open bandwidth reflector.
export const NETWORK_PROBE_PACKET_BYTES = [56 * 1024, 500 * 1024, 2 * 1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024] as const;

export type NetworkProbePacketBytes = (typeof NETWORK_PROBE_PACKET_BYTES)[number];

// Upload v2 keeps every individual request below Vercel's 4.5 MB body limit.
// Commander assembles the larger logical samples from these bounded chunks.
export const NETWORK_PROBE_UPLOAD_BYTES = [56 * 1024, 500 * 1024, 1024 * 1024, 2 * 1024 * 1024] as const;
export type NetworkProbeUploadBytes = (typeof NETWORK_PROBE_UPLOAD_BYTES)[number];
export const NETWORK_PROBE_UPLOAD_REQUESTS = 11;

export function parseNetworkProbeUploadBytes(value: unknown): NetworkProbeUploadBytes | undefined {
	const bytes = typeof value === 'string' ? Number(value) : value;
	return NETWORK_PROBE_UPLOAD_BYTES.includes(bytes as NetworkProbeUploadBytes) ? (bytes as NetworkProbeUploadBytes) : undefined;
}

const COMMON_HEADERS = {
	'cache-control': 'no-store',
	'content-encoding': 'identity',
	'x-content-type-options': 'nosniff'
};

export function parseNetworkProbePacketBytes(value: unknown): NetworkProbePacketBytes | undefined {
	const bytes = typeof value === 'string' ? Number(value) : value;
	return NETWORK_PROBE_PACKET_BYTES.includes(bytes as NetworkProbePacketBytes) ? (bytes as NetworkProbePacketBytes) : undefined;
}

export function networkProbePingResponse(): Response {
	return new Response(new Uint8Array(256), {
		headers: {
			...COMMON_HEADERS,
			'content-type': 'application/octet-stream',
			'content-length': '256'
		}
	});
}

export function networkProbeDownloadResponse(bytes: NetworkProbePacketBytes): Response {
	// This fixed-size allocation is capped at 10 MiB by the allowlist above.
	// A deterministic payload is enough for a transfer measurement and never
	// reflects caller-controlled data back to the network.
	const payload = new Uint8Array(bytes);
	for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
	return new Response(payload, {
		headers: {
			...COMMON_HEADERS,
			'content-type': 'application/octet-stream',
			'content-length': String(bytes)
		}
	});
}

export async function readExactNetworkProbeUpload(request: Request, bytes: NetworkProbeUploadBytes): Promise<void> {
	const declaredLength = request.headers.get('content-length');
	// Proxies may forward a valid body as a stream without Content-Length.
	// A supplied length must still be correct; the actual byte count below is
	// authoritative and stops oversized streams without buffering their data.
	if (declaredLength !== null && declaredLength !== String(bytes)) {
		throw json({ ok: false, error: `content-length must be exactly ${bytes} bytes` }, { status: 400 });
	}
	const reader = request.body?.getReader();
	if (!reader) throw json({ ok: false, error: 'A binary request body is required' }, { status: 400 });

	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		received += value.byteLength;
		if (received > bytes) {
			await reader.cancel().catch(() => undefined);
			throw json({ ok: false, error: 'Upload body is too large' }, { status: 413 });
		}
	}
	if (received !== bytes) {
		throw json({ ok: false, error: `Upload body must be exactly ${bytes} bytes` }, { status: 400 });
	}
}
