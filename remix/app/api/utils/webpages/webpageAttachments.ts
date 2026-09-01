import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { bindReadyAttachmentsToTarget, MAX_ATTACHMENTS_PER_TARGET } from '../attachments/attachmentStore';

// Webpage media blocks reference builder uploads by their same-origin content
// URL. Nothing bound those attachments to anything, so the draft reaper
// eventually deleted them and saved pages sprouted broken images. Saving a
// webpage now BINDS the owner's referenced uploads to the webpage thing —
// the same lifecycle posts use: binding clears the draft expiry, flips the
// attachment to inherit the page's acl (a public /p/ page serves its media
// publicly), and the existing delete cascade reclaims them with the page.
//
// Binding is TOLERANT by design: a page may legitimately reference another
// owner's public media, an https URL, or a long-gone attachment — those are
// simply not ours to bind. Only the owner's own ready, unbound (or already
// bound-to-this-page) post-purpose drafts are claimed.

// Real attachment ids are 68 chars ("att_" + sha256 hex) — the upper bound
// must clear that or the capture silently truncates the id and every lookup
// misses (the round-8 preview E2E caught exactly that with a {8,64} cap).
const CONTENT_URL_PATTERN = /\/api\/v1\/attachments\/content\?id=([A-Za-z0-9_-]{8,128})/g;

const collectFromString = (value: unknown, into: Set<string>) => {
	if (typeof value !== 'string' || !value) return;
	for (const match of value.matchAll(CONTENT_URL_PATTERN)) into.add(match[1]);
};

// Scalar bags on a block (component `args`, the Figma-style `css` record) hold
// author-typed strings, and the inspector is exactly where someone pastes the
// content URL the builder just minted for them — an `imageUrl` arg or a
// `background-image: url(/api/v1/attachments/content?id=…)` reaps identically
// to an unbound media src if it is not claimed too.
const collectFromRecord = (value: unknown, into: Set<string>) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return;
	for (const entry of Object.values(value as Record<string, unknown>)) collectFromString(entry, into);
};

// Pure: every attachment id referenced by a webpage crystal's blocks — media
// srcs, content URLs embedded in rich/raw html, component arg values, and
// per-block custom css.
export const extractWebpageAttachmentIds = (crystal: unknown): string[] => {
	const ids = new Set<string>();
	const walk = (blocks: unknown) => {
		if (!Array.isArray(blocks)) return;
		for (const block of blocks) {
			if (!block || typeof block !== 'object') continue;
			const record = block as Record<string, unknown>;
			collectFromString(record.src, ids);
			collectFromString(record.html, ids);
			collectFromRecord(record.args, ids);
			collectFromRecord(record.css, ids);
			walk(record.children);
		}
	};
	walk((crystal as Record<string, unknown> | null)?.blocks);
	return [...ids].slice(0, MAX_ATTACHMENTS_PER_TARGET);
};

export type WebpageAttachmentBindResult = { bound: number; skipped: number };

// Best-effort claim of the owner's bindable referenced uploads. Never throws
// for unbindable references; a concurrent-bind race just converges on the
// next save.
export const bindOwnedWebpageAttachments = async (
	ownerId: string,
	crystal: unknown,
	targetShareId: string
): Promise<WebpageAttachmentBindResult> => {
	const ids = extractWebpageAttachmentIds(crystal);
	if (!ids.length || !targetShareId) return { bound: 0, skipped: ids.length };
	const things = await getHomeThingsCollection();
	const now = new Date();
	const candidates = (await things
		.find(
			{
				shareId: { $in: ids },
				ownerId,
				thingtime: 'attachment',
				attachmentState: 'ready',
				$and: [
					{ $or: [{ attachmentPurpose: 'post' }, { attachmentPurpose: { $exists: false } }] },
					{ attachmentProfileSlot: { $exists: false } },
					{ targetId: { $exists: false }, attachmentExpiresAt: { $gt: now } }
				]
			} as any,
			{ projection: { shareId: 1 } }
		)
		.toArray()) as Array<{ shareId: string }>;
	const unbound = candidates.map((doc) => String(doc.shareId));
	if (!unbound.length) return { bound: 0, skipped: ids.length };
	try {
		await withHomeMongoTransaction(async (session) => {
			await bindReadyAttachmentsToTarget(ownerId, unbound, targetShareId, session);
		});
	} catch (error) {
		// a candidate was claimed between the filter and the bind — the page
		// still saved; the next save converges. Keep the failure audible.
		console.warn('[attachments] webpage bind skipped:', (error as Error)?.message || error);
		return { bound: 0, skipped: ids.length };
	}
	return { bound: unbound.length, skipped: ids.length - unbound.length };
};
