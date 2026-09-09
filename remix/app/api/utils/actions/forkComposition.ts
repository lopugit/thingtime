import { randomUUID } from 'node:crypto';
import { createThing, deleteThing, fail, isFail, type Viewer, type Fail } from '../things/things';
import type { SharedComposition } from './sharedComposition';
import { compositionReferences } from './sharedCompositionCore';
import { rewriteComposition } from './forkCompositionCore';

export const forkComposition = async (viewer: Viewer, composition: SharedComposition): Promise<Fail | { ok: true; id: string; copied: number; ids: string[] }> => {
	if (!viewer?.id) return fail(401, 'Sign in to copy this app');
	const docs = [...composition.docs.values()];
	// A copy must be independently usable, never a quietly incomplete shell.
	for (const doc of docs) {
		for (const { kind, ref, optional } of compositionReferences(doc.thingtime, doc.crystal || {})) {
			if (!optional && !composition.references.has(`${doc.shareId}:${kind}:${ref}`)) return fail(403, 'A referenced dependency is unavailable. Ask the owner to repair its sharing before copying.');
		}
	}
	const ids = new Map(docs.map((doc) => [doc.shareId, randomUUID()]));
	const suffix = randomUUID().slice(0, 8);
	const created: string[] = [];
	try {
		// Data provenance validates against existing schema docs at create time.
		// All other references can use their preallocated ids immediately.
		docs.sort((a, b) => Number(b.thingtime.includes('schema')) - Number(a.thingtime.includes('schema')));
		for (const doc of docs) {
			const crystal = rewriteComposition(doc.thingtime, doc.crystal || {}, (kind, ref) => {
				const target = composition.references.get(`${doc.shareId}:${kind}:${ref}`);
				return (target && ids.get(target.shareId)) || ids.get(ref) || ref;
			});
			for (const field of ['componentKey', 'actionKey', 'pageKey']) {
				if (typeof crystal[field] === 'string') crystal[field] = `${crystal[field].slice(0, 48)}-${suffix}`;
			}
			if (doc.thingtime.includes('schema') && typeof crystal.name === 'string') crystal.name = `${crystal.name.slice(0, 48)}-${suffix}`;
			if (doc.thingtime.includes('webpage')) {
				delete crystal.siteRoute;
				crystal.forkOf = doc.shareId;
			}
			const result = await createThing(viewer.id, { shareId: ids.get(doc.shareId), thingtime: doc.thingtime, crystal, extended: doc.extended, acl: ['tt:user'], tags: doc.tags }, viewer);
			if (isFail(result)) throw new Error(result.error);
			created.push(result.doc.shareId);
		}
		return { ok: true, id: ids.get(composition.root.shareId)!, copied: created.length, ids: created };
	} catch (error) {
		let cleanupFailed = false;
		for (const id of created.reverse()) {
			try { if (isFail(await deleteThing(viewer, id))) cleanupFailed = true; } catch { cleanupFailed = true; }
		}
		return fail(422, `${error instanceof Error ? error.message : 'Copy failed'}${cleanupFailed ? ' Some private partial copies remain in your Things.' : ''}`);
	}
};
