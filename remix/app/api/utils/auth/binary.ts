import { Binary } from 'mongodb';

// Shared binary boundary for protected state. BinData is not encryption; its
// purpose here is to keep private strings out of the wildcard text index.
export const toBin = (value: string) => new Binary(Buffer.from(value, 'utf8'));
export const fromBin = (value: any): string => {
	if (Buffer.isBuffer(value)) return value.toString('utf8');
	if (value instanceof Binary) return Buffer.from(value.value()).toString('utf8');
	if (typeof value === 'string') return value;
	if (value?.buffer) return Buffer.from(value.buffer, value.byteOffset || 0, value.length ?? value.byteLength).toString('utf8');
	return '';
};

/** Strict counterpart for new protected envelopes; plaintext is never valid. */
export const binaryBytes = (value: unknown): number | null => {
	if (Buffer.isBuffer(value)) return value.byteLength;
	if (value instanceof Binary) return value.length();
	return null;
};
