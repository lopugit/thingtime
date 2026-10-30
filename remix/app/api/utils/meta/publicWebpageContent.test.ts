import assert from 'node:assert/strict';
import test from 'node:test';
import { inferPublicWebpageContent, type PublicWebpageContentInput } from './publicWebpageContent';

const page = (blocks: unknown[], extra: Record<string, unknown> = {}): PublicWebpageContentInput => ({
	ok: true,
	page: { crystal: { name: 'Untitled page', blocks, ...extra } },
	refs: {},
	components: []
});
const content = '/api/v1/attachments/content?id=public-photo';

test('nested public Components use default, saved and block arguments only in visible render positions', () => {
	const input = page([{ type: 'container', children: [{ type: 'component', component: 'hero', args: { title: 'Final heading' } }] }], {
		description: 'Explicit description'
	});
	input.refs = { hero: 'component-hero' };
	input.components = [
		{
			shareId: 'component-hero',
			crystal: {
				args: [
					{ name: 'title', type: 'string', default: 'Default heading' },
					{ name: 'body', type: 'string', default: 'Default body' }
				],
				savedArgs: { title: 'Saved heading', body: 'Saved body', privateNote: 'Never displayed' },
				render: {
					tag: 'section',
					children: [
						{ tag: 'h1', children: ['{title}'] },
						{ tag: 'p', children: ['{body}'] },
						{ tag: 'h2', children: ['Later heading'] }
					]
				}
			}
		}
	];
	const result = inferPublicWebpageContent(input);
	assert.equal(result.title, 'Final heading');
	assert.equal(result.description, 'Saved body');
	assert.deepEqual(result.overrides, { description: 'Explicit description' });
	assert.doesNotMatch(JSON.stringify(result), /Never displayed|Saved heading|Default heading|Later heading/);
	input.components[0].crystal = { args: [{ name: 'body', type: 'string', default: 'Default body' }], render: { tag: 'p', children: '{body}' } };
	assert.equal(inferPublicWebpageContent(input).description, 'Default body');
});

test('missing component references never fall back to another available or private component', () => {
	const input = page([{ type: 'component', component: 'missing' }]);
	input.refs = { missing: null };
	input.components = [{ shareId: 'other', crystal: { render: { tag: 'h1', children: 'Unrelated private copy' } } }];
	assert.equal(inferPublicWebpageContent(input).title, '');
	assert.equal(inferPublicWebpageContent({ ...input, ok: false }).description, '');
	assert.equal(inferPublicWebpageContent({ ok: true, page: null }).title, '');
});

test('stored conditional branches follow canonical argument semantics and skip unresolved runtime scopes', () => {
	const input = page([
		{
			type: 'container',
			args: { show: true },
			children: [
				{ type: 'condition', condition: { arg: 'show' }, children: [{ type: 'text', text: 'Visible block' }] },
				{ type: 'condition', condition: { arg: 'show', negate: true }, children: [{ type: 'text', text: 'Inactive block' }] },
				{ type: 'condition', condition: { arg: 'viewer.signedIn' }, children: [{ type: 'text', text: 'Viewer-only block' }] },
				{ type: 'component', component: 'conditional' }
			]
		}
	]);
	input.refs = { conditional: 'conditional' };
	input.components = [
		{
			shareId: 'conditional',
			crystal: {
				savedArgs: { show: true, error: 'Private stored error' },
				render: {
					tag: 'section',
					children: [
						{ ttIf: { arg: 'show', then: { tag: 'p', children: 'Visible template' }, else: { tag: 'p', children: 'Inactive template' } } },
						{ ttIf: { arg: 'viewer.signedIn', then: { tag: 'p', children: 'Private branch' }, else: { tag: 'p', children: 'Unknown branch' } } },
						{ tag: 'p', children: '{result.secret}' },
						{ tag: 'p', children: '{error}' },
						{ tag: 'p', children: '{query.token}' }
					]
				}
			}
		}
	];
	const result = inferPublicWebpageContent(input);
	assert.equal(result.description, 'Visible block Visible template');
	assert.doesNotMatch(JSON.stringify(result), /Inactive|Private|Unknown|secret|token|Viewer-only/);
});

test('only displayed managed images are candidates, never remote, keyed, hidden or arbitrary args', () => {
	const input = page([
		{ type: 'media', media: 'image', src: content, alt: 'Public photo' },
		{ type: 'media', media: 'image', src: `${content}&key=private`, alt: 'Keyed' },
		{ type: 'media', media: 'image', src: 'https://remote.invalid/image.png', alt: 'Remote' },
		{ type: 'media', media: 'image', src: '/api/v1/attachments/content?id=hidden', css: { display: 'none' } },
		{ type: 'component', component: 'picture' }
	]);
	input.refs = { picture: 'picture' };
	input.components = [
		{
			shareId: 'picture',
			crystal: {
				savedArgs: { picture: '/api/v1/attachments/content?id=second-photo', other: '/api/v1/attachments/content?id=not-rendered' },
				render: { tag: 'img', props: { src: '{picture}', alt: 'Second photo', 'data-private': 'Never display' } }
			}
		}
	];
	assert.deepEqual(inferPublicWebpageContent(input).images, [
		{ attachmentId: 'public-photo', label: 'Public photo' },
		{ attachmentId: 'second-photo', label: 'Second photo' }
	]);
});

test('HTML scripts, form data, source inputs and dynamic bindings do not become public copy', () => {
	const source = Object.defineProperty({}, 'action', {
		get() {
			throw new Error('must not inspect source configuration');
		}
	});
	const input = page([
		{ type: 'text', style: 'heading', text: 'Public title' },
		{ type: 'html', html: '<p>Public &amp; readable</p><script>privateCode()</script><script>privateUnclosed' },
		{ type: 'text', text: '{viewer.email}' },
		{ type: 'native', native: 'private-screen', children: [{ type: 'text', text: 'private native configuration' }] },
		{ type: 'text', text: 'private dynamic visibility', css: { display: '{viewer.display}' } },
		{ type: 'html', html: '<p hidden>private hidden HTML</p>' },
		{ type: 'element', tag: 'input', props: { value: 'private form draft' } },
		{ type: 'component', component: 'source', source, args: { unused: 'private unused argument' } }
	]);
	input.refs = { source: 'source' };
	input.components = [{ shareId: 'source', crystal: { render: { tag: 'p', children: 'Static source heading' } } }];
	const result = inferPublicWebpageContent(input);
	assert.equal(result.title, 'Public title');
	assert.equal(result.description, 'Public & readable Static source heading');
	assert.doesNotMatch(JSON.stringify(result), /private|email|privateCode/);
});

test('cycles and very large trees stop at a bounded preview budget', () => {
	const cyclic: any = { type: 'container', children: [] };
	cyclic.children.push(cyclic);
	assert.equal(inferPublicWebpageContent(page([cyclic])).truncated, true);
	const result = inferPublicWebpageContent(page(Array.from({ length: 10000 }, () => ({ type: 'text', text: 'Public text' }))));
	assert.equal(result.truncated, true);
	assert.ok(result.description.length < 40000);
});

test('runtime-dependent visibility and unresolved overrides never select a fallback branch or saved default', () => {
	const input = page([{ type: 'component', component: 'dynamic', args: { heading: '{viewer.name}' } }]);
	input.refs = { dynamic: 'dynamic' };
	input.components = [
		{
			shareId: 'dynamic',
			crystal: {
				args: [{ name: 'heading', type: 'string', default: 'Default must not reappear' }],
				render: {
					tag: 'section',
					children: [
						{ tag: 'h1', children: '{heading}' },
						{ tag: 'p', props: { hidden: '{viewer.hidden}' }, children: 'Unknown visibility' },
						{
							tag: 'p',
							props: { style: { display: { ttIf: { arg: 'viewer.signedIn', then: 'none', else: 'block' } } } },
							children: 'Unknown display branch'
						},
						{ tag: 'p', props: { style: { display: 'none' } }, children: 'Hidden static copy' },
						{ tag: 'p', children: 'Public fallback copy' }
					]
				}
			}
		}
	];
	const result = inferPublicWebpageContent(input);
	assert.equal(result.title, '');
	assert.equal(result.description, 'Public fallback copy');
});

test('default placeholder names permit heading inference while explicit names remain overrides', () => {
	for (const name of ['Untitled page', '  untitled PAGE ', 'Untitled']) {
		const result = inferPublicWebpageContent(page([{ type: 'text', style: 'heading', text: 'Inferred public heading' }], { name }));
		assert.equal(result.overrides.title, undefined);
		assert.equal(result.title, 'Inferred public heading');
	}
	assert.equal(inferPublicWebpageContent(page([], { name: 'Explicit page title' })).overrides.title, 'Explicit page title');
});

test('Component css visibility and canonical false defaults exclude hidden branches and their photos', () => {
	const input = page([{ type: 'component', component: 'css' }]);
	input.refs = { css: 'css' };
	input.components = [
		{
			shareId: 'css',
			crystal: {
				args: [{ name: 'show', type: 'boolean', default: false }],
				render: {
					tag: 'section',
					children: [
						{ tag: 'h1', css: { display: 'none' }, children: 'Hidden heading' },
						{
							tag: 'div',
							css: { visibility: 'hidden' },
							children: [
								{ tag: 'p', children: 'Hidden body' },
								{ tag: 'img', props: { src: content } }
							]
						},
						{ tag: 'p', css: { display: '{viewer.visibility}' }, children: 'Unknown css visibility' },
						{ tag: 'p', props: { visibility: 'hidden' }, children: 'Hidden Chakra body' },
						{
							ttIf: {
								arg: 'show',
								then: { tag: 'p', children: 'Inactive default branch' },
								else: { tag: 'p', children: 'Visible false-default branch' }
							}
						}
					]
				}
			}
		}
	];
	const result = inferPublicWebpageContent(input);
	assert.equal(result.title, '');
	assert.equal(result.description, 'Visible false-default branch');
	assert.deepEqual(result.images, []);
});

test('nested block args replace inherited source scope and Components isolate their own argument defaults', () => {
	const input = page([
		{
			type: 'container',
			args: { show: true, label: 'Outer scope' },
			children: [
				{ type: 'condition', condition: { arg: 'show' }, children: [{ type: 'element', tag: 'p', text: '{label}' }] },
				{
					type: 'container',
					args: { label: 'Inner scope' },
					children: [
						{ type: 'condition', condition: { arg: 'show' }, children: [{ type: 'element', tag: 'p', text: 'Must not inherit show' }] },
						{ type: 'element', tag: 'p', text: '{label}' }
					]
				},
				{ type: 'component', component: 'isolated' }
			]
		}
	]);
	input.refs = { isolated: 'isolated' };
	input.components = [
		{
			shareId: 'isolated',
			crystal: { args: [{ name: 'label', type: 'string', default: 'Component scope' }], render: { tag: 'p', children: '{label}' } }
		}
	];
	assert.equal(inferPublicWebpageContent(input).description, 'Outer scope Inner scope Component scope');
});

test('per-block literal Component text edits use the same override keys as the live renderer', async () => {
	const { componentTextOverrides } = await import('../../../components/Builder/componentTextOverrides');
	const render = { tag: 'h1', children: 'Original authored heading' };
	const key = componentTextOverrides(render).labels[0].key;
	const input = page([{ type: 'component', component: 'edited', args: { [key]: 'Edited heading' } }]);
	input.refs = { edited: 'edited' };
	input.components = [{ shareId: 'edited', crystal: { render } }];
	assert.equal(inferPublicWebpageContent(input).title, 'Edited heading');
});
