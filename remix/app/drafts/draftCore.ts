/** Shared, bounded account-draft transport. Drafts never carry executable runtime state. */
export const DRAFT_MAX_BYTES = 512 * 1024;
export const DRAFT_SURFACES = ['post', 'comment', 'thing', 'definition', 'schema'] as const;
export type DraftSurface = (typeof DRAFT_SURFACES)[number];
export type DraftContent = {
	name: string;
	surface: DraftSurface;
	context: string;
	snapshot: string;
	attachmentIds: string[];
};
export type AccountDraft = DraftContent & {
	id: string;
	mode: 'draft' | 'template';
	revision: number;
	updatedAt: string;
	createdAt: string;
};
export type DraftSummary = Omit<AccountDraft, 'snapshot' | 'attachmentIds'>;
export const validDraftId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function validateDraftContent(value: unknown): DraftContent {
	const input = value as Partial<DraftContent> | null;
	if (
		!input ||
		typeof input !== 'object' ||
		!DRAFT_SURFACES.includes(input.surface as DraftSurface) ||
		typeof input.name !== 'string' ||
		input.name.length > 160 ||
		typeof input.context !== 'string' ||
		input.context.length > 300 ||
		typeof input.snapshot !== 'string' ||
		new TextEncoder().encode(input.snapshot).length > DRAFT_MAX_BYTES ||
		!Array.isArray(input.attachmentIds) ||
		input.attachmentIds.length > 4096 ||
		input.attachmentIds.some((id) => !validDraftId(id)) ||
		new Set(input.attachmentIds).size !== input.attachmentIds.length
	) {
		throw new Error('Invalid draft (maximum 512 KB and 4096 files)');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.snapshot);
	} catch {
		throw new Error('Draft snapshot must be valid JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Draft snapshot must be an object');
	const pending: { value: unknown; depth: number }[] = [{ value: parsed, depth: 0 }];
	let nodes = 0;
	while (pending.length) {
		const { value: entry, depth } = pending.pop()!;
		if (++nodes > 30000 || depth > 64) throw new Error('Draft is too deeply nested');
		if (entry && typeof entry === 'object')
			for (const [key, child] of Object.entries(entry)) {
				if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe draft field');
				pending.push({ value: child, depth: depth + 1 });
			}
	}
	return {
		name: input.name,
		surface: input.surface as DraftSurface,
		context: input.context,
		snapshot: input.snapshot,
		attachmentIds: [...input.attachmentIds]
	};
}
export function draftConflict(current: number, expected: unknown, lastWrite: unknown, writeId: string): 'retry' | 'write' | 'conflict' {
	if (lastWrite === writeId) return 'retry';
	return Number.isSafeInteger(expected) && expected === current ? 'write' : 'conflict';
}
