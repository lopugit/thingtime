import sharp from 'sharp';

export const IMAGE_WIDTHS = [64, 320, 640, 1280, 1920] as const;
export const parseImageWidth = (value: string | null): number | undefined | null =>
	value === null ? undefined : IMAGE_WIDTHS.some((width) => String(width) === value) ? Number(value) : null;

const MAX_INPUT = 20 * 1024 * 1024;
const MAX_CACHE = 32 * 1024 * 1024;
const variants = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
let cacheBytes = 0;

export const resizeAttachmentImage = async (bytes: Uint8Array, width: number): Promise<Buffer> => {
	if (!IMAGE_WIDTHS.includes(width as any) || bytes.byteLength > MAX_INPUT) throw new Error('Unsupported image');
	const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
	const metadata = await image.metadata();
	if ((metadata.pages || 1) > 1 || metadata.format === 'gif') throw new Error('Keep animated originals');
	return image
		.timeout({ seconds: 8 })
		.rotate()
		.resize({ width, withoutEnlargement: true })
		.webp({ quality: width === 64 ? 35 : 80 })
		.toBuffer();
};

// Called only AFTER the canonical attachment service authorizes the current viewer.
// Source URLs are server-generated, version-pinned S3 URLs, never caller URLs.
export const attachmentImageResponse = async (source: { url: string; cacheKey: string; size: number }, width: number): Promise<Response> => {
	const key = `${source.cacheKey}:${width}`;
	try {
		let bytes = variants.get(key);
		if (!bytes) {
			let work = pending.get(key);
			if (!work) {
				if (pending.size >= 4) return new Response(null, { status: 503, headers: { 'Retry-After': '2' } });
				work = (async () => {
					const response = await fetch(source.url, { redirect: 'error', signal: AbortSignal.timeout(12_000) });
					if (!response.ok || !response.body) throw new Error('Image unavailable');
					const reader = response.body.getReader();
					const chunks: Uint8Array[] = [];
					let size = 0;
					try {
						while (true) {
							const chunk = await reader.read();
							if (chunk.done) break;
							size += chunk.value.byteLength;
							if (size > MAX_INPUT) throw new Error('Image too large');
							chunks.push(chunk.value);
						}
					} finally {
						await reader.cancel().catch(() => {});
					}
					if (size !== source.size) throw new Error('Incomplete image');
					const transformed = await resizeAttachmentImage(Buffer.concat(chunks), width);
					while (cacheBytes + transformed.length > MAX_CACHE && variants.size) {
						const oldest = variants.keys().next().value!;
						cacheBytes -= variants.get(oldest)!.length;
						variants.delete(oldest);
					}
					if (transformed.length <= MAX_CACHE) {
						variants.set(key, transformed);
						cacheBytes += transformed.length;
					}
					return transformed;
				})().finally(() => pending.delete(key));
				pending.set(key, work);
			}
			bytes = await work;
		}
		return new Response(new Uint8Array(bytes), {
			headers: {
				'Content-Type': 'image/webp',
				'Content-Length': String(bytes.length),
				'Cache-Control': 'private, no-cache',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch {
		return new Response(null, { status: 415 });
	}
};
