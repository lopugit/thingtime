import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteCopiedAttachmentReferences, bindCopiedTemplateMedia } from './forkMediaCore';
import { compositionAttachmentIds } from './compositionMediaCore';
import { mapAuthoredHtmlMedia, visitAuthoredHtmlMedia } from './authoredHtmlMedia';
import { resolveTemplate } from '../../../components/ComponentsLibrary/componentTemplate';
import { copiedMediaRefs, mapResolvedCopiedMedia } from '../../../components/Sharing/copiedMediaRefs';

const old = '/api/v1/attachments/content?id=att_source';
const copied = '/api/v1/attachments/content?id=att_copy';
const copies = new Map([['att_source', 'att_copy']]);

test('media bindings reject malformed IDs, bound work and charge generated text', () => {
	assert.equal(copiedMediaRefs([['att_source', '//outside.test'], ['att_source', '{runtime}'], ['att_source', 'att_copy']]).get('att_source'), 'att_copy');
	assert.equal(copiedMediaRefs(Array.from({ length: 600 }, (_, index) => [`a${index}`, `b${index}`])).size, 512);
	const refs = new Map([['a', 'longer-copy-id']]);
	const input = { tag: 'img', props: { src: '/api/v1/attachments/content?id=a' } };
	assert.equal((mapResolvedCopiedMedia(input, refs, { chars: 0 }) as any).props.src, undefined);
	const budget = { chars: 100 };
	assert.equal((mapResolvedCopiedMedia(input, refs, budget) as any).props.src, '/api/v1/attachments/content?id=longer-copy-id');
	assert.equal(budget.chars, 87);
	// Bounded, but never destructive: past the pass's own depth/visit caps the
	// already resolved tree is handed back whole with its URL simply unmapped.
	let nested: any = input;
	for (let index = 0; index < 60; index++) nested = { tag: 'div', children: [nested] };
	assert.deepEqual(mapResolvedCopiedMedia(nested, refs, { chars: 100 }), nested);
	let shallow: any = input;
	for (let index = 0; index < 20; index++) shallow = { tag: 'div', children: [shallow] };
	assert.ok(JSON.stringify(mapResolvedCopiedMedia(shallow, refs, { chars: 100 })).includes('longer-copy-id'));
});

test('a copied component deeper than the binding pass keeps rendering its authored tree', () => {
	const leaf = { tag: 'img', props: { src: '/api/v1/attachments/content?id=att_source' } };
	const nest = (levels: number) => { let node: any = leaf; for (let index = 0; index < levels; index++) node = { tag: 'div', children: [node] }; return node; };
	const nodes = (tree: unknown) => JSON.stringify(tree).match(/"tag"/g)?.length ?? 0;
	for (const levels of [24, 25, 40]) {
		const plain = resolveTemplate(nest(levels), {});
		const bound = resolveTemplate({ ...nest(levels), ttMediaRefs: [['att_source', 'att_copy']] }, {});
		// Deep enough to outrun the binding pass, the media stays unmapped — but
		// none of the author's resolved nodes may silently disappear.
		assert.equal(nodes(bound), nodes(plain), `levels=${levels}`);
		assert.match(JSON.stringify(bound), /att_(source|copy)/);
	}
});

test('late media bindings preserve split-fragment loops, inactive branches and unrelated input data', () => {
	const source = { savedArgs: { prefix: 'att_', images: ['source'], show: false }, render: { tag: 'div', children: [
		{ ttEach: { arg: 'images', node: { tag: 'img', props: { src: '/api/v1/attachments/content?id={prefix}{item}', title: '{prefix}{item}',
			_hover: { backgroundImage: 'url(/api/v1/attachments/content?id={prefix}{item})' } } } } },
		{ ttIf: { arg: 'show', then: { tag: 'img', props: { src: old } } } },
		{ tag: 'input', props: { value: old }, ttAction: 'unchanged', ttActionInputs: { url: old } }
	] } };
	const result = bindCopiedTemplateMedia(source, copies, ['att_source']);
	const resolved: any = resolveTemplate(result.render, result.savedArgs);
	assert.equal(resolved.children[0].props.src, copied);
	assert.equal(resolved.children[0].props.title, 'att_source');
	assert.ok(resolved.children[0].props._hover.backgroundImage.includes('att_copy'));
	assert.equal(resolved.children[1].props.value, old);
	assert.equal(JSON.parse(resolved.children[1].props['data-tt-action-inputs']).url, old);
	assert.equal(resolved.ttMediaRefs, undefined);
	assert.deepEqual([...compositionAttachmentIds(['component'], result)], ['att_copy']);
	assert.equal((resolveTemplate(result.render, { ...result.savedArgs, show: true }) as any).children[1].props.src, copied);
	assert.equal((source.render as any).ttMediaRefs, undefined);
	const again = bindCopiedTemplateMedia(result, new Map([['att_copy', 'att_again']]), ['att_copy']);
	assert.equal((resolveTemplate(again.render, again.savedArgs) as any).children[0].props.src, '/api/v1/attachments/content?id=att_again');
	assert.deepEqual([...compositionAttachmentIds(['component'], again)], ['att_again']);
});

test('late bindings only map rendered first-party URLs, one hop, not unused references or external/keyed URLs', () => {
	const source = { render: { tag: 'div', ttMediaRefs: [['att_source', 'att_copy'], ['att_copy', 'att_next'], ['unused', 'private']], children: [
		{ tag: 'img', props: { src: old } }, { tag: 'img', props: { src: `https://outside.test${old}` } },
		{ tag: 'img', props: { src: `${old}&key=secret` } }, { tag: 'img', props: { src: '/api/v1/attachments/content?id={runtime}' } }
	] } };
	assert.deepEqual([...compositionAttachmentIds(['component'], source)], ['att_copy']);
	const resolved: any = resolveTemplate(source.render, { runtime: 'unknown' });
	assert.equal(resolved.children[0].props.src, copied);
	assert.equal(resolved.children[1].props.src, `https://outside.test${old}`);
	assert.equal(resolved.children[2].props.src, `${old}&key=secret`);
	assert.equal(resolved.children[3].props.src, '/api/v1/attachments/content?id=unknown');
});

test('fork maps exact attachment IDs in persisted arguments, defaults, nested lists and explicit instance contexts', () => {
	const render = { ttEach: { arg: 'images', node: { tag: 'img', props: { src: '/api/v1/attachments/content?id={item.id}' } } } };
	const source = { title: 'att_source', args: [{ name: 'image', label: 'att_source', default: 'att_source' }],
		savedArgs: { image: 'att_source', images: [{ id: 'att_source', caption: 'Look at att_source' }] }, render,
		blocks: [{ type: 'component', component: 'component', args: { image: 'att_source' } }] };
	const output = rewriteCopiedAttachmentReferences(source, copies);
	assert.equal(output.title, 'att_source');
	assert.equal(output.args[0].label, 'att_source');
	assert.equal(output.args[0].default, 'att_copy');
	assert.equal(output.savedArgs.image, 'att_copy');
	assert.equal(output.savedArgs.images[0].caption, 'Look at att_source');
	assert.equal(output.blocks[0].args.image, 'att_copy');
	assert.deepEqual(output.render, render);
	assert.deepEqual(resolveTemplate(output.render, output.savedArgs), [{ tag: 'img', props: { src: copied } }]);
	assert.deepEqual([...compositionAttachmentIds(['component'], output)], ['att_copy']);
	assert.deepEqual(rewriteCopiedAttachmentReferences({ image: 'att_source' }, copies, { attachmentIds: true }), { image: 'att_copy' });
	assert.equal(source.savedArgs.images[0].id, 'att_source');
});

test('copied attachment-ID arguments still select their authored map and equality branches', () => {
	const source = { savedArgs: { image: 'att_source' }, render: { tag: 'div', children: [
		{ ttMap: { arg: 'image', values: { att_source: { tag: 'img', props: { src: '/api/v1/attachments/content?id={image}' } } }, default: { tag: 'p', children: ['wrong map branch'] } } },
		{ ttIf: { arg: 'image', equals: 'att_source', then: { tag: 'p', children: ['selected image'] }, else: { tag: 'p', children: ['wrong equality branch'] } } },
		{ ttIf: { arg: 'image', op: 'in', value: ['att_source'], then: { tag: 'p', children: ['in image list'] } } }
	] } };
	const output = rewriteCopiedAttachmentReferences(source, copies);
	assert.deepEqual(resolveTemplate(output.render, output.savedArgs), { tag: 'div', children: [
		{ tag: 'img', props: { src: copied } }, { tag: 'p', children: ['selected image'] }, { tag: 'p', children: ['in image list'] }
	] });
	assert.equal(source.render.children[0].ttMap?.values.att_source.props.src, '/api/v1/attachments/content?id={image}');
});

test('fork media rewrites exact URL scalars, saved arguments, CSS and parsed HTML without mutating the source', () => {
	const source = { savedArgs: { image: old }, args: [{ name: 'image', default: old }], blocks: [
		{ type: 'media', src: old }, { type: 'container', css: { backgroundImage: `url("${old}")`, _hover: { maskImage: `url(${old})` } }, children: [
			{ type: 'html', html: `<img src="${old}"><p style='background: url("${old}")'>Hello</p>` }
		] }
	] };
	const output = rewriteCopiedAttachmentReferences(source, copies);
	assert.equal(output.savedArgs.image, copied);
	assert.equal(output.args[0].default, copied);
	assert.deepEqual([...compositionAttachmentIds(['webpage'], output)], ['att_copy']);
	assert.equal(JSON.stringify(source).includes('att_copy'), false);
});

test('fork media preserves unrelated URLs, keyed URLs, unresolved templates and prose', () => {
	const source = { external: `https://example.test${old}`, keyed: `${old}&key=secret`, shared: `${old}&sharedRoot=root`,
		unresolved: '/api/v1/attachments/content?id={image}', other: '/api/v1/attachments/content?id=att_other',
		prose: `The picture is ${old}`, label: `A url(${old}) example` };
	assert.deepEqual(rewriteCopiedAttachmentReferences(source, copies), source);
	assert.equal(rewriteCopiedAttachmentReferences({ src: `${old}&download=1#image` }, copies).src, `${copied}&download=1#image`);
});

test('HTML retargeting uses browser attribute parsing and preserves non-rendering source bytes', () => {
	const html = `<!doctype html><html><head><title>${old}</title></head><body><!-- ${old} --><script>"${old}"</script><p data-url="${old}">${old}</p><IMG SRC='${old.replace('?', '?unused=1&amp;')}'></body></html>`;
	const mapped = mapAuthoredHtmlMedia(html, (value) => rewriteCopiedAttachmentReferences({ value }, copies).value);
	assert.equal(mapped, html.replace(`SRC='${old.replace('?', '?unused=1&amp;')}'`, 'src="/api/v1/attachments/content?unused=1&amp;id=att_copy"'));
	const urls: string[] = [];
	visitAuthoredHtmlMedia(mapped, (value) => urls.push(value));
	assert.deepEqual(urls, ['/api/v1/attachments/content?unused=1&id=att_copy']);
});

test('HTML CSS rewriting preserves rejected declarations and only maps safe declaration URLs', () => {
	const source = `<div style='color: red; background-image: url("${old}"); --bad: expression(alert(1))'>ok</div>`;
	const mapped = mapAuthoredHtmlMedia(source, (value) => value === old ? copied : value);
	assert.ok(mapped.includes('att_copy'));
	assert.ok(mapped.includes('expression(alert(1))'));
	assert.equal(mapAuthoredHtmlMedia(source, (value) => value), source);
});

test('fork media refuses unbounded nesting instead of silently leaving a partial rewrite', () => {
	let source: any = { src: old };
	for (let i = 0; i < 100; i++) source = { child: source };
	assert.throws(() => rewriteCopiedAttachmentReferences(source, copies), /too complex/);
});

test('HTML copies retarget the browser-selected attribute when duplicate names exist', () => {
	const source = `<img src="${old}" SRC="/ignored.png">`;
	const mapped = mapAuthoredHtmlMedia(source, (value) => value === old ? copied : value);
	const urls: string[] = [];
	visitAuthoredHtmlMedia(mapped, (value) => urls.push(value));
	assert.deepEqual(urls, [copied]);
	assert.ok(mapped.includes('SRC="/ignored.png"'));
});
