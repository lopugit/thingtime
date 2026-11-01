/** Native pulls carry a one-use nonce. Only the correlated, sequential range can supply bytes. */
export function mobileRangeFrame(
	value: unknown,
	expected: { requestId: string; ownerId: string; origin: string },
	bytes: Uint8Array<ArrayBuffer>,
	offset: number
): { frame: ArrayBuffer; nextOffset: number } | null {
	const message = value as any,
		payload = message?.payload;
	if (message?.type !== 'mobile-files-range-pull' || !payload || Object.entries(expected).some(([key, value]) => payload[key] !== value)) return null;
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.byteLength < 1 ||
		bytes.byteLength > 32 * 1024 * 1024 ||
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		payload.offset !== offset ||
		!Number.isSafeInteger(payload.length) ||
		payload.length < 1 ||
		payload.length > 65536 ||
		offset + payload.length > bytes.byteLength ||
		typeof payload.token !== 'string' ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.token)
	)
		throw Error('Invalid native download frame request.');
	const frame = new Uint8Array(36 + payload.length);
	frame.set(new TextEncoder().encode(payload.token));
	frame.set(bytes.subarray(offset, offset + payload.length), 36);
	return { frame: frame.buffer, nextOffset: offset + payload.length };
}

/** Receive one correlated native upload frame; acknowledge only after copying it. */
export function receiveMobileReadFrame(
	value: unknown,
	requestId: string,
	bytes: Uint8Array<ArrayBuffer>,
	offset: number
): { acknowledgement: ArrayBuffer; nextOffset: number } | null {
	const message = value as any,
		frame = message?.payload?.frame;
	if (message?.type !== 'mobile-files-read-frame' || !(frame instanceof ArrayBuffer) || frame.byteLength < 36) return null;
	const data = new Uint8Array(frame),
		decode = new TextDecoder();
	if (decode.decode(data.subarray(0, 36)) !== requestId) return null;
	if (
		frame.byteLength <= 76 ||
		frame.byteLength > 76 + 65536 ||
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		!(bytes instanceof Uint8Array) ||
		bytes.byteLength > 32 * 1024 * 1024 ||
		new DataView(frame).getUint32(72) !== offset ||
		offset + frame.byteLength - 76 > bytes.byteLength ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(decode.decode(data.subarray(36, 72)))
	)
		throw Error('Invalid native upload frame.');
	bytes.set(data.subarray(76), offset);
	return { acknowledgement: frame.slice(36, 72), nextOffset: offset + frame.byteLength - 76 };
}
