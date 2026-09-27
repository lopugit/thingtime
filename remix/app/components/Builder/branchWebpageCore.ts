import { branchEditableSnapshot } from '../../timeline/branchCheckout';
import { parseTimelineBranchLookup } from '../../timeline/branches';
import type { TimelineSnapshot } from '../../timeline/contract';
import { isDataPlane } from '../../utils/dataPlane';
import { sanitizeWebpageBlocks } from '../../schemas/registry';
import type { WebpageBlock, WebpageCrystal } from './webpageBlocks';

export function branchWebpageCrystal(snapshot: TimelineSnapshot): WebpageCrystal {
	const value = branchEditableSnapshot(snapshot).value as Record<string, any>;
	const crystal = value.crystal;
	if (!crystal || typeof crystal !== 'object' || Array.isArray(crystal) || !Array.isArray(crystal.blocks))
		throw new Error('This branch does not contain a block-based page. Use Edit branch to edit its fields.');
	const checked = sanitizeWebpageBlocks(crystal.blocks);
	if (checked.ok === false) throw new Error(checked.error);
	return { ...crystal, blocks: checked.blocks } as WebpageCrystal;
}
export function updateBranchWebpage(snapshot: TimelineSnapshot, patch: { blocks?: WebpageBlock[]; name?: string; acl?: string[] }): TimelineSnapshot {
	const basis = branchEditableSnapshot(snapshot);
	const crystal = branchWebpageCrystal(basis);
	const next = branchEditableSnapshot({
		...basis,
		value: {
			...(basis.value as any),
			...(patch.acl === undefined ? {} : { acl: patch.acl }),
			crystal: {
				...crystal,
				...(patch.name === undefined ? {} : { name: patch.name }),
				...(patch.blocks === undefined ? {} : { blocks: patch.blocks })
			}
		}
	});
	branchWebpageCrystal(next);
	return next;
}
export function branchComponentRefs(blocks: WebpageBlock[]): string[] {
	const refs = new Set<string>();
	const visit = (items: WebpageBlock[]) => {
		for (const block of items) {
			if (block.type === 'component' && block.component) refs.add(block.component);
			if (block.type === 'container') visit(block.children || []);
		}
	};
	visit(blocks);
	return [...refs].sort();
}
export function branchBuilderHref(branchId: string, thingId: string, ownerId: string, dataPlane: string) {
	const lookup = parseTimelineBranchLookup({ branchId, thingId });
	if (!ownerId || !isDataPlane(dataPlane)) throw new Error('Branch account or database is unavailable.');
	return `/builder?${new URLSearchParams({ page: lookup.thingId, branchId: lookup.branchId, historyOwner: ownerId, dataPlane, mode: 'edit' })}`;
}
