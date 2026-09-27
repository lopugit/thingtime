import type { PublicPost } from '~/components/Feed/feedTypes';
import { postThingDraft, postThingReferences } from '~/components/Feed/postThingReferences';
const textToBlocks = (text: string) =>
	text.split('\n').map((line) => ({ type: 'paragraph', data: { text: line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') } }));

// A draft stores raw editing values, including partial prices, empty poll options
// and inactive sections. Publishing remains the existing validated operation.
export function postDraftFromPost(post: PublicPost) {
	return {
		photosOn: !!(post.images?.length || post.attachments?.length),
		marketOn: !!post.listing,
		thingOn: post.type === 'thingtime',
		pickedThings: postThingReferences(post.thing),
		thing: postThingDraft(post.thing),
		pollOn: false,
		pollOptions: ['', ''],
		postEditorValue: post.richText || { kind: 'rich-text', blocks: textToBlocks(post.text || '') },
		title: post.listing?.title || '',
		price: post.listing ? String(post.listing.price) : '',
		currency: post.listing?.currency || 'AUD',
		category: post.listing?.category || 'other',
		condition: post.listing?.condition || '',
		listingLocation: post.listing?.location || '',
		tagsInput: post.tags?.join(', ') || '',
		visibility: post.visibility || 'public',
		customAcl: post.visibility === 'custom' ? post.acl : null,
		postTitle: post.title || '',
		subspaceId: post.subspace?.id || null,
		flairId: post.flair?.id || null,
		layoutMode: post.mediaLayout?.mode || 'auto',
		layoutPattern: post.mediaLayout?.pattern || [1, 2],
		layoutColumns: post.mediaLayout?.columns || 3,
		layoutSpans: post.mediaLayout?.spans || {},
		attachments: post.attachments || [],
		legacyImages: post.images || []
	};
}
export function remapPostDraftAttachments(snapshot: string, mapping: Map<string, string>) {
	if (!mapping.size) return snapshot;
	const value = JSON.parse(snapshot);
	value.attachments = (value.attachments || []).map((entry: any) => ({ ...entry, id: mapping.get(entry.id) || entry.id }));
	value.layoutSpans = Object.fromEntries(Object.entries(value.layoutSpans || {}).map(([id, span]) => [mapping.get(id) || id, span]));
	return JSON.stringify(value);
}
