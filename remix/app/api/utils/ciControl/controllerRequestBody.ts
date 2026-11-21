import { json } from '~/api/http';

export async function readControllerRequestBody(request: Request) {
	if (Number(request.headers.get('content-length')) > 4096) return json({ ok: false, error: 'Request too large' }, { status: 413 });
	// A missing or false Content-Length must not allow an unsigned caller to
	// buffer an unbounded stream before authentication.
	const reader = request.body?.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	if (reader)
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > 4096) {
				await reader.cancel().catch(() => {});
				return json({ ok: false, error: 'Request too large' }, { status: 413 });
			}
			chunks.push(value);
		}
	return Buffer.concat(chunks, received).toString('utf8');
}
