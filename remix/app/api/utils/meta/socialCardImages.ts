import sharp from 'sharp';

export type CardImage = { uri: string; pixels: number };
type AuthorizedImage = { ok: true; url: string; cacheKey: string; version: string; size: number; image: boolean };
export type SocialCardImageDependencies = {
 authorize: (attachmentId: string) => Promise<AuthorizedImage | { ok: false }>;
 thumbnail: (source: AuthorizedImage, width: number) => Promise<Response>;
};

// These are transient rendering budgets, not upload or attachment-size limits.
// Match the canonical variant service's source/decoder bounds, then shrink the
// result again to a square-bounded PNG that resvg supports consistently.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_VARIANT_BYTES = 8 * 1024 * 1024;
const MAX_PNG_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_EDGE = 640;

export const readBodyWithin = async (response: Response, limit: number): Promise<Uint8Array | null> => {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > limit) {
			// Cancelling closes the connection rather than draining bytes we have
			// already decided to throw away.
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
};

const canonicalDependencies = async (): Promise<SocialCardImageDependencies> => {
 const { getAttachmentDownload } = await import('../attachments/attachments');
 const { attachmentImageResponse } = await import('../attachments/imageVariants');
 return { authorize: (id) => getAttachmentDownload(null, id, false), thumbnail: attachmentImageResponse };
};

/** IDs come from the anonymous public preview projection. Never fetch caller
 * URLs: the canonical service signs an exact stored version after current ACL,
 * moderation, upload-readiness and audience checks. Its thumbnail cache is
 * gated by that fresh authorization on every call, including cache hits. */
export const loadSocialCardAttachmentImage = async (attachmentId: string, dependencies?: SocialCardImageDependencies): Promise<CardImage | null> => {
 try {
  const { authorize, thumbnail } = dependencies ?? await canonicalDependencies();
  const source = await authorize(attachmentId);
  if (!source.ok || !source.image || !Number.isFinite(source.size) || source.size <= 0 || source.size > MAX_SOURCE_BYTES) return null;
  const response = await thumbnail(source, THUMBNAIL_EDGE);
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].toLowerCase() !== 'image/webp') return null;
  const bytes = await readBodyWithin(response, MAX_VARIANT_BYTES);
  if (!bytes?.byteLength) return null;
  const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
  const metadata = await image.metadata();
  if (metadata.format !== 'webp' || (metadata.pages || 1) > 1) return null;
  const normalized = await image.timeout({ seconds: 8 }).rotate()
   .resize({ width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE, fit: 'inside', withoutEnlargement: true })
   .png().toBuffer({ resolveWithObject: true });
  if (normalized.data.length > MAX_PNG_BYTES) return null;
  // Async decoding/cache work is not an authorization receipt. Recheck the
  // exact version just before allowing bytes into a publicly returned card.
  const current = await authorize(attachmentId);
  if (!current.ok || !current.image || current.version !== source.version || current.cacheKey !== source.cacheKey) return null;
  return { uri: `data:image/png;base64,${normalized.data.toString('base64')}`, pixels: normalized.info.width * normalized.info.height };
 } catch { return null; }
};
