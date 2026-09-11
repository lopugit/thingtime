import { randomUUID } from 'node:crypto';
import { createThing, deleteThing, fail, isFail, type Viewer, type Fail } from '../things/things';
import { resolveSharedComposition, type SharedComposition } from './sharedComposition';
import { rewriteComposition } from './forkCompositionCore';
import { rewriteCopiedAttachmentReferences, bindCopiedTemplateMedia } from './forkMediaCore';
import { compositionAttachmentIds } from './compositionMediaCore';
import { copySharedAttachment, deleteAttachment, createReadyAttachmentPostInsertHook } from '../attachments/attachments';
import { MAX_ATTACHMENTS_PER_TARGET } from '../attachments/attachmentStore';
import { listForkBoundMedia } from './forkBoundMedia';

type ForkDependencies = {
	create: typeof createThing;
	remove: typeof deleteThing;
	copyFile: typeof copySharedAttachment;
	removeFile: typeof deleteAttachment;
	bind: typeof createReadyAttachmentPostInsertHook;
	listBoundFiles: typeof listForkBoundMedia;
	revalidate: (viewer: Viewer, id: string) => Promise<SharedComposition | Fail>;
	uuid: () => string;
};
const production: ForkDependencies = { create: createThing, remove: deleteThing, copyFile: copySharedAttachment,
	removeFile: deleteAttachment, bind: createReadyAttachmentPostInsertHook, listBoundFiles: listForkBoundMedia, uuid: randomUUID,
	revalidate: (viewer, id) => resolveSharedComposition(viewer, id, { contentRoot: true }) };

export const forkComposition = async (viewer: Viewer, composition: SharedComposition, deps: ForkDependencies = production): Promise<Fail | { ok: true; id: string; copied: number; ids: string[]; filesCopied: number }> => {
	if (!viewer?.id) return fail(401, 'Sign in to copy this app');
	const docs = [...composition.docs.values()];
	// A copy must be independently usable, never a quietly incomplete shell.
	for (const ref of composition.requiredReferences) {
		if (!composition.references.has(ref)) return fail(403, 'A referenced dependency is unavailable. Ask the owner to repair its sharing before copying.');
	}
	const ids = new Map(docs.map((doc) => [doc.shareId, deps.uuid()]));
	const suffix = deps.uuid().slice(0, 8);
	const created: string[] = [];
	const files = new Map<string, string>();
	const targets = new Map<string, string>();
	const abort = new AbortController();
	const timeout = setTimeout(() => abort.abort(), 120_000);
	timeout.unref?.();
	const revalidate = async () => {
		if (abort.signal.aborted) throw new Error('The copy timed out');
		const fresh = await deps.revalidate(viewer, composition.root.shareId);
		if (isFail(fresh) || docs.some((doc) => !fresh.docs.has(doc.shareId)) ||
			[...fresh.requiredReferences].some((ref) => !fresh.references.has(ref))) throw new Error('The original sharing changed while copying');
	};
	try {
		await revalidate();
		// Data provenance validates against existing schema docs at create time.
		// All other references can use their preallocated ids immediately.
		docs.sort((a, b) => Number(b.thingtime.includes('schema')) - Number(a.thingtime.includes('schema')));
		// Discover render positions, including every persisted component instance.
		// This is only a copy plan: copyFile freshly authorizes each source against
		// the real shared root and pins its exact stored version before S3 writes.
		const mediaFor = (doc: typeof docs[number], crystal = doc.crystal || {}, copied?: Map<string, Record<string, any>>, replacements = files): Set<string> => {
			const found = new Set<string>();
			for (const context of composition.contexts.get(doc.shareId) || [undefined]) {
				for (const id of compositionAttachmentIds(doc.thingtime, crystal, {
					args: context && rewriteCopiedAttachmentReferences(context, replacements, { attachmentIds: true }),
					component: (ref) => {
						const source = composition.references.get(`${doc.shareId}:component:${ref}`)
							|| docs.find((candidate) => ids.get(candidate.shareId) === ref || candidate.shareId === ref);
						return source && (copied?.get(source.shareId) || source.crystal);
					}
				})) found.add(id);
			}
			return found;
		};
		// Preserve each contained Thing's gallery before assigning unbound render
		// dependencies. A file also embedded elsewhere still gets copied once.
		for (const file of await deps.listBoundFiles(docs)) {
			if (!ids.has(file.targetId)) throw new Error('An attached file has an unavailable target');
			targets.set(file.id, file.targetId);
		}
		for (const doc of docs) for (const id of mediaFor(doc)) if (!targets.has(id)) targets.set(id, doc.shareId);
		const perTarget = new Map<string, number>();
		for (const target of targets.values()) perTarget.set(target, (perTarget.get(target) || 0) + 1);
		if ([...perTarget.values()].some((count) => count > MAX_ATTACHMENTS_PER_TARGET)) return fail(422, 'A copied Thing has too many files');
		const rewriteMedia = (replacements: Map<string, string>) => {
			const rewritten = new Map(docs.map((doc) => [doc.shareId, rewriteCopiedAttachmentReferences(doc.crystal || {}, replacements)]));
			for (const doc of docs) if (doc.thingtime.includes('component')) {
				const crystal = rewritten.get(doc.shareId)!;
				rewritten.set(doc.shareId, bindCopiedTemplateMedia(crystal, replacements, mediaFor(doc, crystal, rewritten, replacements)));
			}
			return rewritten;
		};
		// Prove retargetability before reserving quota. Runtime-assembled URLs that
		// cannot be rewritten must not produce a copy still tied to the source.
		const plannedIds = new Map([...targets.keys()].map((id, index) => [id, `fork-file-${index}-${suffix}`]));
		const planned = rewriteMedia(plannedIds);
		for (const doc of docs) for (const id of mediaFor(doc, planned.get(doc.shareId), planned, plannedIds)) {
			if (targets.has(id)) return fail(422, 'A templated file reference cannot yet be copied independently');
		}
		for (const id of targets.keys()) {
			if (abort.signal.aborted) throw new Error('The copy timed out');
			const result = await deps.copyFile({ ...viewer, sharedRoot: composition.root.shareId }, id, abort.signal);
			if (isFail(result)) throw new Error(result.error);
			files.set(id, result.id);
		}
		const crystals = rewriteMedia(files);
		await revalidate();
		for (const doc of docs) {
			if (abort.signal.aborted) throw new Error('The copy timed out');
			const crystal = rewriteComposition(doc.thingtime, crystals.get(doc.shareId)!, (kind, ref) => {
				const target = composition.references.get(`${doc.shareId}:${kind}:${ref}`);
				return (target && ids.get(target.shareId)) || ids.get(ref) || ref;
			}, composition.contexts.get(doc.shareId));
			for (const field of ['componentKey', 'actionKey', 'pageKey']) {
				if (typeof crystal[field] === 'string') crystal[field] = `${crystal[field].slice(0, 48)}-${suffix}`;
			}
			if (doc.thingtime.includes('schema') && typeof crystal.name === 'string') crystal.name = `${crystal.name.slice(0, 48)}-${suffix}`;
			if (doc.thingtime.includes('webpage')) {
				delete crystal.siteRoute;
				crystal.forkOf = doc.shareId;
			}
			const boundFiles = [...files].filter(([source]) => targets.get(source) === doc.shareId).map(([, copied]) => copied);
			const result = await deps.create(viewer.id, { shareId: ids.get(doc.shareId), thingtime: doc.thingtime, crystal, extended: doc.extended, acl: ['tt:user'], tags: doc.tags }, viewer, null,
				boundFiles.length ? { afterInsert: deps.bind(boundFiles) } : {});
			if (isFail(result)) throw new Error(result.error);
			created.push(result.doc.shareId);
		}
		await revalidate();
		return { ok: true, id: ids.get(composition.root.shareId)!, copied: created.length, ids: created, filesCopied: files.size };
	} catch (error) {
		abort.abort();
		let cleanupFailed = false;
		for (const id of created.reverse()) {
			try { if (isFail(await deps.remove(viewer, id))) cleanupFailed = true; } catch { cleanupFailed = true; }
		}
		for (const [source, id] of files) {
			try {
				const result = await deps.removeFile(viewer.id, { id, targetId: ids.get(targets.get(source)!) });
				if (isFail(result) || result.deferred) cleanupFailed = true;
			} catch { cleanupFailed = true; }
		}
		return fail(422, `${error instanceof Error ? error.message : 'Copy failed'}${cleanupFailed ? ' Some private partial-copy cleanup is pending.' : ''}`);
	} finally { clearTimeout(timeout); }
};
