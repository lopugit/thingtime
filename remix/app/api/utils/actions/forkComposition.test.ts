import assert from 'node:assert/strict';
import test from 'node:test';
import { forkComposition } from './forkComposition';
import type { SharedComposition } from './sharedComposition';
import { resolveTemplate } from '../../../components/ComponentsLibrary/componentTemplate';
import { compositionAttachmentIds } from './compositionMediaCore';

const url = (id: string) => `/api/v1/attachments/content?id=${id}`;
const fixture = () => {
	const component: any = { shareId: 'component', ownerId: 'author', thingtime: ['component'], acl: ['tt:user'], crystal: {
		savedArgs: { image: url('att_source') }, render: { tag: 'img', props: { src: '{image}' } }
	} };
	const root: any = { shareId: 'page', ownerId: 'author', thingtime: ['webpage'], acl: ['tt:hidden'], crystal: {
		blocks: [{ type: 'component', component: 'component' }, { type: 'media', src: url('att_other') }]
	} };
	const composition: SharedComposition = { root, docs: new Map([['page', root], ['component', component]]),
		actions: new Map(), children: new Map(), data: new Map(), references: new Map([['page:component:component', component]]),
		requiredReferences: new Set(['page:component:component']), contexts: new Map(), boundaries: new Map() };
	const created: any[] = [], bound: any[] = [], removed: string[] = [], copied: any[] = [], removedFiles: any[] = [];
	let serial = 0;
	const deps: Parameters<typeof forkComposition>[2] = {
		uuid: () => `new-${++serial}`, revalidate: async () => composition,
		listBoundFiles: async () => [],
		copyFile: async (viewer, id, signal) => { copied.push({ viewer, id, signal }); return { ok: true, id: `copy-${id}`, attachment: {} }; },
		removeFile: async (owner, input) => { removedFiles.push({ owner, input }); return { ok: true, deferred: false }; },
		bind: (ids) => async (doc, session) => { bound.push({ ids, doc, session }); },
		create: async (owner, input, viewer, app, hooks) => {
			const doc: any = { ...input, ownerId: owner };
			await hooks?.afterInsert?.(doc, 'transaction'); created.push(doc);
			return { ok: true, doc } as any;
		},
		remove: async (_viewer, id) => { removed.push(id as string); return { ok: true } as any; }
	};
	return { composition, deps, created, bound, removed, copied, removedFiles };
};
const viewer = { id: 'copier', linkKeys: new Set(['shared-key']) };

test('fork creates independently owned media once, binds it transactionally and retargets every instance', async () => {
	const f = fixture(); const before = JSON.stringify([...f.composition.docs]);
	const result = await forkComposition(viewer, f.composition, f.deps);
	assert.equal(result.ok, true); if (!result.ok) return;
	assert.equal(result.filesCopied, 2);
	assert.equal(f.copied.length, 2);
	assert.equal(f.copied[0].viewer.id, viewer.id);
	assert.equal(f.copied[0].viewer.sharedRoot, 'page');
	assert.equal(f.copied[0].viewer.linkKeys, viewer.linkKeys);
	assert.ok(f.copied.every((call) => call.signal instanceof AbortSignal));
	assert.deepEqual(f.bound[0].ids, ['copy-att_source', 'copy-att_other']);
	assert.equal(f.bound[0].session, 'transaction');
	assert.equal(f.bound[0].doc.ownerId, viewer.id);
	assert.ok(f.created.every((doc) => doc.acl.join() === 'tt:user'));
	assert.equal(f.created[0].crystal.blocks[0].component, f.created[1].shareId);
	assert.equal(f.created[1].crystal.savedArgs.image, url('copy-att_source'));
	assert.equal(JSON.stringify([...f.composition.docs]), before);
});

test('fork refuses unavailable files and cleans only its new partial uploads', async () => {
	const f = fixture(); const copy = f.deps.copyFile;
	f.deps.copyFile = async (...args) => args[1] === 'att_other' ? { ok: false, status: 404, error: 'Attachment not found' } : copy(...args);
	assert.equal((await forkComposition(viewer, f.composition, f.deps)).ok, false);
	assert.equal(f.created.length, 0);
	assert.deepEqual(f.removedFiles, [{ owner: 'copier', input: { id: 'copy-att_source', targetId: 'new-1' } }]);
});

test('fork copies relational galleries and preserves their binding when also embedded in a page', async () => {
	const f = fixture();
	const data: any = { shareId: 'data', ownerId: 'author', thingtime: ['data'], crystal: { title: 'Gallery' } };
	f.composition.docs.set('data', data);
	f.deps.listBoundFiles = async (docs) => {
		assert.ok(docs.some((doc) => doc.shareId === 'data'));
		return [{ id: 'att_source', targetId: 'component' }, { id: 'att_gallery', targetId: 'data' }];
	};
	const result = await forkComposition(viewer, f.composition, f.deps);
	assert.equal(result.ok, true); if (!result.ok) return;
	assert.equal(result.filesCopied, 3);
	assert.equal(f.copied.filter((call) => call.id === 'att_source').length, 1);
	assert.deepEqual(f.bound.map(({ ids, doc }) => [doc.shareId, ids]), [
		['new-1', ['copy-att_other']], ['new-2', ['copy-att_source']], ['new-3', ['copy-att_gallery']]
	]);
});

test('bound-file discovery errors and excessive galleries fail before upload writes', async () => {
	for (const oversized of [false, true]) {
		const f = fixture();
		f.deps.listBoundFiles = async () => {
			if (!oversized) throw new Error('Gallery unavailable');
			return Array.from({ length: 26 }, (_, index) => ({ id: `gallery-${index}`, targetId: 'page' }));
		};
		assert.equal((await forkComposition(viewer, f.composition, f.deps)).ok, false);
		assert.equal(f.copied.length, 0);
		assert.equal(f.created.length, 0);
	}
});

test('fork cleans copied Things and files after a write failure, including deferred cleanup', async () => {
	const f = fixture(); const create = f.deps.create;
	f.deps.create = async (...args) => f.created.length ? { ok: false, status: 422, error: 'Write failed' } : create(...args);
	f.deps.removeFile = async (owner, input) => { f.removedFiles.push({ owner, input }); return { ok: true, deferred: true }; };
	const result = await forkComposition(viewer, f.composition, f.deps);
	assert.equal(result.ok, false); if (result.ok) return;
	assert.match(result.error, /cleanup is pending/);
	assert.deepEqual(f.removed, ['new-1']);
	assert.equal(f.removedFiles.length, 2);
	assert.ok(f.removedFiles.every((call) => call.input.id.startsWith('copy-')));
});

test('fork retargets stored attachment-ID templates without changing template behavior', async () => {
	const f = fixture(); const doc = f.composition.docs.get('component')!;
	doc.crystal = { savedArgs: { image: 'att_source' }, render: { tag: 'img', props: { src: '/api/v1/attachments/content?id={image}' } } };
	f.composition.contexts.set('component', [{ image: 'att_source' }]);
	f.composition.root.crystal.blocks[0].args = { image: 'att_source' };
	const result = await forkComposition(viewer, f.composition, f.deps);
	assert.equal(result.ok, true);
	assert.equal(f.created[0].crystal.blocks[0].args.image, 'copy-att_source');
	assert.equal(f.created[1].crystal.savedArgs.image, 'copy-att_source');
	assert.equal(f.created[1].crystal.render.props.src, '/api/v1/attachments/content?id={image}');
	assert.equal(doc.crystal.savedArgs.image, 'att_source');
});

test('fork binds split media fragments after interpolation without changing stored inputs', async () => {
	const f = fixture(); const doc = f.composition.docs.get('component')!;
	doc.crystal = { savedArgs: { prefix: 'att_', image: 'source' }, render: { tag: 'img', props: { src: '/api/v1/attachments/content?id={prefix}{image}' } } };
	assert.equal((await forkComposition(viewer, f.composition, f.deps)).ok, true);
	const copied = f.created.find((value) => value.thingtime.includes('component')).crystal;
	assert.deepEqual(copied.savedArgs, doc.crystal.savedArgs);
	assert.equal((resolveTemplate(copied.render, copied.savedArgs) as any).props.src, url('copy-att_source'));
	assert.deepEqual([...compositionAttachmentIds(['component'], copied)], ['copy-att_source']);
	assert.equal(doc.crystal.render.ttMediaRefs, undefined);
});

test('fork fails before writes for excessive per-Thing files', async () => {
	const f = fixture();
	f.composition.root.crystal = { blocks: Array.from({ length: 26 }, (_, index) => ({ type: 'media', src: url(`att_${index}`) })) };
	assert.equal((await forkComposition(viewer, f.composition, f.deps)).ok, false);
	assert.equal(f.copied.length, 0);
});

test('fork checks root revocation before writes and after creation, with cleanup on late revocation', async () => {
	for (const failAt of [1, 3]) {
		const f = fixture(); let checks = 0;
		f.deps.revalidate = async () => ++checks === failAt ? { ok: false, status: 404, error: 'Not found' } : f.composition;
		assert.equal((await forkComposition(viewer, f.composition, f.deps)).ok, false);
		assert.equal(f.copied.length, failAt === 1 ? 0 : 2);
		assert.equal(f.removed.length, failAt === 1 ? 0 : 2);
	}
});

test('anonymous copying and missing executable dependencies never start file copies', async () => {
	const f = fixture();
	assert.equal((await forkComposition(null, f.composition, f.deps)).ok, false);
	f.composition.requiredReferences.add('page:component:missing');
	assert.equal((await forkComposition(viewer, f.composition, f.deps)).ok, false);
	assert.equal(f.copied.length, 0);
});
