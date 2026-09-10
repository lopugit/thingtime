import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionAttachmentIds } from '../actions/compositionMediaCore';
import { compositionMediaIds, createCanViewSharedCompositionAttachment, type SharedComposition } from '../actions/sharedComposition';
import { canView, fail, type ThingDoc } from '../things/things';
import { HTML_MAX_DEPTH, HTML_MAX_NODES } from '../../../components/Kinds/htmlRenderPolicy';
import { MAX_WEBPAGE_HTML_CHARS } from '../../../schemas/registry';

const url = (id: string) => `/api/v1/attachments/content?id=${id}`;

test('conditional media properties include stored alternatives, not condition metadata', () => {
	const crystal = {
		savedArgs: { image: url('stored') },
		render: { tag: 'div', children: [
			{ tag: 'img', props: { src: { ttIf: { arg: 'last.result', value: url('condition-only'), then: '{image}', else: url('initial') } } } },
			{ tag: 'video', props: { poster: { ttMap: { arg: 'state.mode', values: { first: url('first'), second: url('second') }, default: url('fallback') } } } },
			{ tag: 'a', props: { ttIf: { arg: 'state.ready', then: { href: url('download') }, else: { title: url('metadata') } } } },
			{ tag: 'div', props: { style: { backgroundImage: { ttIf: { arg: 'state.ready', equals: `url(${url('css-condition')})`, then: `url(${url('css-then')})`, else: `url(${url('css-else')})` } } } } },
			{ tag: 'img', props: { src: { ttMap: { arg: 'state.mode', values: { one: `${url('unknown')}{query.suffix}`, two: `${url('separate')}&key=other` } } } } },
			{ tag: 'div', props: { title: { ttIf: { then: url('title') } } }, ttActionInputs: { src: url('input') } }
		] }
	};
	assert.deepEqual([...compositionAttachmentIds(['component'], crystal)].sort(),
		['css-else', 'css-then', 'download', 'fallback', 'first', 'initial', 'second', 'stored']);
});

test('page-block media overrides follow resolved same-author components and refresh with the root', async () => {
	const component = { shareId: 'component', ownerId: 'author', thingtime: ['component'], crystal: {
		args: [{ name: 'image', type: 'string', default: url('default') }], savedArgs: { image: url('saved') },
		render: { tag: 'img', props: { src: { ttIf: { arg: 'last.result', then: '{image}' } } } }
	} } as ThingDoc;
	const block = { type: 'component', component: 'alias', args: { image: url('page-image'), unused: url('unused') } };
	const root = { shareId: 'root', ownerId: 'author', thingtime: ['webpage'], acl: ['tt:hidden', 'tt:user'], linkKey: 'fixture-key', crystal: {
		blocks: [{ type: 'container', children: [block, { ...block, args: { image: url('second') } }] }]
	} } as ThingDoc;
	const composition = { root, docs: new Map([[root.shareId, root], [component.shareId, component]]),
		references: new Map([['root:component:alias', component]]) } as SharedComposition;
	assert.deepEqual([...compositionMediaIds(composition)].sort(), ['page-image', 'saved', 'second']);
	const read = createCanViewSharedCompositionAttachment(async (viewer) => canView(root, viewer) ? composition : fail(404, 'Not found'), async () => false);
	const viewer = { id: '', linkKeys: new Set(['fixture-key']) };
	const attachment = { shareId: 'page-image', ownerId: 'author', targetId: 'unrelated-post', thingtime: ['attachment'], attachmentPurpose: 'post' as const };
	assert.equal(await read(viewer, attachment, root.shareId), true);
	assert.equal(await read(null, attachment, root.shareId), false);
	block.args.image = url('replacement');
	assert.equal(await read(viewer, attachment, root.shareId), false, 'Removing the page override revokes its old media');
	block.args.image = url('page-image');
	composition.references.clear();
	assert.equal(await read(viewer, attachment, root.shareId), false, 'Unresolved aliases cannot introduce media');
	composition.references.set('root:component:alias', component);
	component.ownerId = 'foreign';
	assert.equal(await read(viewer, attachment, root.shareId), false, 'Foreign templates keep independent media authority');
});

test('property discovery respects wrapper precedence, output types and traversal limits', () => {
	const ids = (props: unknown) => [...compositionAttachmentIds(['component'], { savedArgs: { image: url('arg') }, render: { tag: 'img', props } })];
	assert.deepEqual(ids({ src: { ttArg: 'image', ttIf: { then: url('ignored') } } }), ['arg']);
	assert.deepEqual(ids({ src: { ttMerge: [url('not-an-object')] } }), []);
	assert.deepEqual(ids({ src: [url('not-a-url')] }), []);
	assert.deepEqual(ids({ ttMerge: [{ src: { ttIf: { then: '{image}' } } }, { title: url('metadata') }] }), ['arg']);
	const values = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [i, url(`image-${i}`)]));
	const found = ids({ src: { ttMap: { arg: 'state.mode', values } } });
	assert.ok(found.length > 0 && found.length < 4000);
	assert.ok(!found.includes('image-4999'));
	const cyclic: any = { ttIf: {} };
	cyclic.ttIf.then = cyclic;
	assert.deepEqual(ids({ src: cyclic }), []);
});

test('stored component defaults and saved arguments grant only resolved rendering media', () => {
	const crystal = {
		args: [{ name: 'image', type: 'string', default: url('default-image') }, { name: 'unused', type: 'string', default: url('unused') }],
		savedArgs: { image: url('saved-image'), background: url('saved-background'), title: url('title-only') },
		render: { tag: 'div', props: { title: '{title}', style: { backgroundImage: 'url("{background}")' } }, children: [
			{ tag: 'img', props: { src: '{image}' } },
			{ ttIf: { arg: 'last.result', then: { tag: 'img', props: { src: { ttArg: 'image' } } } } },
			{ tag: 'img', props: { src: `${url('never')}{query.suffix}` } },
			{ ttActionInputs: { src: '{unused}' } }
		] }
	};
	assert.deepEqual([...compositionAttachmentIds(['component'], crystal)].sort(), ['saved-background', 'saved-image']);
	assert.deepEqual([...compositionAttachmentIds(['component'], { ...crystal, savedArgs: {} })], ['default-image']);
	assert.equal(compositionAttachmentIds(['component'], { ...crystal, savedArgs: { image: `${url('independent')}&key=other`, background: 'https://outside.test/private.png' } }).size, 0);
});

test('stored media resolution stays bounded across sibling properties and template expansion', () => {
	const repeated = { ttRepeat: { count: 24, node: { ttRepeat: { count: 24, node: { tag: 'img', props: { src: '{image}' } } } } } };
	const crystal = { args: [{ name: 'image', type: 'string', default: url('bounded') }], render: { tag: 'div', children: [repeated, repeated] } };
	assert.deepEqual([...compositionAttachmentIds(['component'], crystal)], ['bounded']);
});

test('authored HTML discovery uses renderer bounds and screens CSS values independently', () => {
	const ids = (html: string) => [...compositionAttachmentIds(['webpage'], { blocks: [{ type: 'html', html }] })];
	assert.deepEqual(ids(`<div style='color: expression(unsafe); background-image: url("${url('safe')}"); content: "url(${url('text')})"'></div>`), ['safe']);
	assert.deepEqual(ids(`<div style='@media all { background: url("${url('nested-rule')}") }'></div>`), []);
	assert.deepEqual(ids(`<div style='background: url("${url('unclosed')})'></div>`), []);
	assert.deepEqual(ids('<span></span>'.repeat(HTML_MAX_NODES - 1) + `<img src='${url('over-node-limit')}'>`), []);
	assert.deepEqual(ids('<div>'.repeat(HTML_MAX_DEPTH) + `<img src='${url('over-depth-limit')}'>` + '</div>'.repeat(HTML_MAX_DEPTH)), []);
	assert.deepEqual(ids(' '.repeat(MAX_WEBPAGE_HTML_CHARS) + `<img src='${url('over-size-limit')}'>`), []);
	assert.deepEqual(ids(`<textarea><img src='${url('raw-text')}'></textarea><noscript><img src='${url('noscript')}'></noscript>`), []);
	assert.deepEqual(ids(`<head><noscript><img src='${url('repaired-body')}'></noscript></head>`), ['repaired-body'], 'Detached DOMParser repairs invalid head content with scripting disabled');
});

test('rich and raw HTML discover only authored media that survives the markup renderer', () => {
	const html = `<section style='background-image: url("${url('background')}")'>
		<img src='${url('image')}'><video poster='${url('poster')}'></video>
		<a href='${url('download')}&amp;width=40'>download</a>
		<unknown src='${url('unknown')}'><img src='${url('unknown-child')}'></unknown>
		<script><img src='${url('script')}'></script>
		<template><img src='${url('template')}'></template>
		<!-- <img src='${url('comment')}'> -->
		<span title='${url('metadata')}'>${url('text-only')}</span>
		<img src='${url('independent')}&amp;key=separate'>
		<img src='https://outside.test${url('external')}'>
	</section>`;
	for (const type of ['text', 'html']) {
		assert.deepEqual([...compositionAttachmentIds(['webpage'], { blocks: [{ type, html }] })].sort(),
			['background', 'download', 'image', 'poster', 'unknown-child']);
	}
	assert.equal(compositionAttachmentIds(['webpage'], { blocks: [{ type: 'component', html }] }).size, 0);
});

test('attachments bound to nested same-author children inherit the root, without opening foreign or managed media', async () => {
	const root = { shareId: 'root', ownerId: 'author', thingtime: ['webpage'], acl: ['tt:hidden', 'tt:user'], linkKey: 'fixture-key' } as ThingDoc;
	const child = { shareId: 'child', ownerId: 'author', thingtime: ['component'], acl: ['tt:user'], crystal: {} } as ThingDoc;
	const composition = { root, docs: new Map([[root.shareId, root], [child.shareId, child]]), references: new Map() } as SharedComposition;
	const read = createCanViewSharedCompositionAttachment(async (viewer) => canView(root, viewer) ? composition : fail(404, 'Not found'), async () => false);
	const viewer = { id: '', linkKeys: new Set(['fixture-key']) };
	const attachment = { shareId: 'nested-media', ownerId: 'author', targetId: child.shareId, thingtime: ['attachment'], attachmentPurpose: 'post' as const };
	assert.equal(await read(viewer, attachment, root.shareId), true);
	assert.equal(await read(null, attachment, root.shareId), false);
	assert.equal(await read(viewer, { ...attachment, attachmentPurpose: 'message' }, root.shareId), false);
	assert.equal(await read(viewer, { ...attachment, targetId: 'unrelated' }, root.shareId), false);
	child.ownerId = 'foreign';
	assert.equal(await read(viewer, attachment, root.shareId), false);
});

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
	component.crystal = { args: [{ name: 'image', type: 'string', default: url('media') }], render: { tag: 'img', props: { src: '{image}' } } };
	assert.equal(await read(viewer, media, root.shareId), true, 'A same-author stored argument used by a render node inherits the root');
	component.crystal.savedArgs = { image: url('replacement') };
	assert.equal(await read(viewer, media, root.shareId), false, 'Replacing the saved argument removes the earlier media grant');
	component.crystal.savedArgs = { image: url('media') };
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
