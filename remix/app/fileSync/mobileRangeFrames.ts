/** Native pulls carry a one-use nonce. Only the correlated, sequential range can supply bytes. */
export function mobileRangeFrame(
 value: unknown,
 expected: { requestId: string; ownerId: string; origin: string },
 bytes: Uint8Array<ArrayBuffer>,
 offset: number
): { frame: ArrayBuffer; nextOffset: number } | null {
 const message = value as any, payload = message?.payload;
 if (message?.type !== 'mobile-files-range-pull' || !payload ||
  Object.entries(expected).some(([key, value]) => payload[key] !== value)) return null;
 if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 32 * 1024 * 1024 ||
  !Number.isSafeInteger(offset) || offset < 0 || payload.offset !== offset ||
  !Number.isSafeInteger(payload.length) || payload.length < 1 || payload.length > 65536 ||
  offset + payload.length > bytes.byteLength || typeof payload.token !== 'string' ||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.token))
  throw Error('Invalid native download frame request.');
 const frame = new Uint8Array(36 + payload.length);
 frame.set(new TextEncoder().encode(payload.token));
 frame.set(bytes.subarray(offset, offset + payload.length), 36);
 return { frame: frame.buffer, nextOffset: offset + payload.length };
}
