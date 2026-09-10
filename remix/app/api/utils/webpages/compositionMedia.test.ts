import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionAttachmentIds } from '../actions/compositionMediaCore';
import { createCanViewSharedCompositionAttachment, type SharedComposition } from '../actions/sharedComposition';
import { canView, fail, type ThingDoc } from '../things/things';

const url = (id: string) => `/api/v1/attachments/content?id=${id}`;

test('shared CSS media follows literal render styles, including nested Chakra styles and page backgrounds', () => {
	const render = { tag: 'div', props: {
		style: { backgroundImage: `url("${url('inline')}")` },
		bg: { base: `url(${url('responsive')})` },
		_hover: { background: `image-set("${url('hover')}" 1x)` },
		title: `url(${url('metadata')})`
	} };
	assert.deepEqual([...compositionAttachmentIds(['component'], { render })].sort(), ['hover', 'inline', 'responsive']);
	assert.deepEqual([...compositionAttachmentIds(['webpage'], { previewBg: `url(${url('page')})`, blocks: [
		{ type: 'container', css: { background: `url(${url('container')})` }, children: [
			{ type: 'text', css: { 'background-image': `url(${url('text')})` } }
		] }
	] })].sort(), ['container', 'page', 'text']);
});

test('CSS strings and external URLs cannot smuggle media dependency grants', () => {
	const style = {
		background: `url('https://external.test/?text=url("${url('external')}")')`,
		content: `'url("${url('quoted')}")'`,
		borderImageSource: `url('${url('independent')}&key=other')`,
		maskImage: `url('${url('dynamic-{input}')}' )`
	};
	assert.deepEqual([...compositionAttachmentIds(['schema'], { render: { tag: 'div', props: { style } } })], []);
});

test('composition media grants only literal first-party URLs in stored rendering positions', () => {
	const render = { tag: 'div', props: { 'data-note': url('metadata') }, children: [
		{ tag: 'img', props: { src: url('image') } },
		{ tag: 'video', props: { poster: url('poster') } },
		{ tag: 'a', props: { href: url('download') } },
		{ ttIf: { then: { tag: 'img', props: { src: url('conditional') } } } },
		{ ttEach: { node: { tag: 'img', props: { src: url('repeated') } } } },
		{ tag: 'img', props: { src: `${url('separate')}&key=own-key` } },
		{ tag: 'img', props: { src: `${url('separate-root')}&sharedRoot=own-root` } },
		{ tag: 'img', props: { src: 'https://external.test/api/v1/attachments/content?id=external' } },
		{ tag: 'img', props: { src: url('{input.id}') } },
		{ ttActionInputs: { attachment: url('input') } }
	] };
	assert.deepEqual([...compositionAttachmentIds(['component'], { render, description: url('description') })].sort(), ['conditional', 'download', 'image', 'poster', 'repeated']);
	assert.deepEqual([...compositionAttachmentIds(['schema'], { render: { tag: 'img', props: { src: url('schema-image') } } })], ['schema-image']);
	assert.deepEqual([...compositionAttachmentIds(['webpage'], { blocks: [{ type: 'container', children: [{ type: 'media', src: url('block-image') }, { type: 'text', href: url('block-download') }] }] })].sort(), ['block-download', 'block-image']);
	assert.equal(compositionAttachmentIds(['data'], { value: url('not-a-render-node') }).size, 0);
});

test('shared media reauthorizes the root, inherits only same-author references and preserves independent foreign ACLs', async () => {
	const root = { shareId: 'root', ownerId: 'author', thingtime: ['webpage'], acl: ['tt:hidden', 'tt:user'], linkKey: 'fixture-key', crystal: {} } as ThingDoc;
	const component: ThingDoc = { ...root, shareId: 'component', acl: ['tt:user'], thingtime: ['component'], crystal: { render: { tag: 'img', props: { src: url('media') } } } };
	const composition = { root, docs: new Map([[root.shareId, root], [component.shareId, component]]), actions: new Map(), children: new Map(), data: new Map(), references: new Map() } as SharedComposition;
	let independentlyAllowed = false;
	const read = createCanViewSharedCompositionAttachment(async (viewer) => canView(root, viewer) ? composition : fail(404, 'Not found'), async () => independentlyAllowed);
	const viewer = { id: '', linkKeys: new Set(['fixture-key']) };
	const media = { shareId: 'media', ownerId: 'author', thingtime: ['attachment'], acl: ['tt:inherit'], targetId: 'private-post', attachmentPurpose: 'post' as const };
	assert.equal(await read(viewer, media, root.shareId), true);
	component.crystal = { render: { tag: 'div', props: { style: { backgroundImage: `url(${url('media')})` } } } };
	assert.equal(await read(viewer, media, root.shareId), true, 'Stored CSS media inherits the same root audience as image elements');
	assert.equal(await read(null, media, root.shareId), false);
	assert.equal(await read({ id: '', linkKeys: new Set(['wrong']) }, media, root.shareId), false);
	assert.equal(await read(viewer, { ...media, shareId: 'unrelated' }, root.shareId), false);
	assert.equal(await read(viewer, { ...media, targetId: undefined }, root.shareId), false);
	assert.equal(await read(viewer, { ...media, attachmentPurpose: 'message' }, root.shareId), false);
	assert.equal(await read(viewer, { ...media, ownerId: 'foreign' }, root.shareId), false);
	independentlyAllowed = true;
	assert.equal(await read(viewer, { ...media, ownerId: 'foreign' }, root.shareId), true);
	assert.equal(await read(viewer, { ...media, attachmentPurpose: 'profile' }, root.shareId), true, 'Independently public managed media keeps its normal access');
	independentlyAllowed = false;
	component.ownerId = 'foreign';
	assert.equal(await read(viewer, media, root.shareId), false, 'A foreign component cannot delegate private root-author media');
	component.ownerId = 'author';
	root.acl = ['tt:user'];
	assert.equal(await read(viewer, media, root.shareId), false, 'Root revocation removes embedded media access');
	root.acl = ['tt:custom', 'tt:group/readers'];
	assert.equal(await read({ id: 'reader', groupIds: new Set(['readers']) }, media, root.shareId), true);
	assert.equal(await read({ id: 'reader', groupIds: new Set() }, media, root.shareId), false, 'Removed group membership removes media access');
});
