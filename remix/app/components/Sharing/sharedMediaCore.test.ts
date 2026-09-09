import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedAttachmentUrl } from './sharedMediaCore';
import { literalAttachmentId, mapCssMediaUrls, mapRenderMediaProps } from './renderMediaCore';

const fixtureUrl = '/api/v1/attachments/content?id=css-image';
const withContext = (url: string) => sharedAttachmentUrl(url, 'read-key', 'shared-page');

test('CSS backgrounds, image-set and escaped relative URLs carry context without changing persisted values', () => {
	for (const value of [`url(${fixtureUrl})`, `URL('${fixtureUrl}')`, `url("\\/api/v1/attachments/content?id=css-image")`, `url("\\2f api/v1/attachments/content?id=css-image")`, `image-set("${fixtureUrl}" 1x, url(${fixtureUrl}) 2x)`, `-webkit-image-set('${fixtureUrl}' 1x)`]) {
		const mapped = mapCssMediaUrls(value, withContext);
		assert.ok(mapped.includes('key=read-key&sharedRoot=shared-page'), value);
		assert.equal(mapCssMediaUrls(mapped, withContext), mapped, 'Re-rendering does not append another context');
	}
	const props = { bg: [null, `url(${fixtureUrl})`], _hover: { sx: { '& > div': { backgroundImage: `url(${fixtureUrl})` } } }, title: `url(${fixtureUrl})` };
	const mapped = mapRenderMediaProps(props, withContext);
	assert.notEqual(mapped.bg[1], props.bg[1]);
	assert.notEqual(mapped._hover.sx['& > div'].backgroundImage, props._hover.sx['& > div'].backgroundImage);
	assert.equal(mapped.title, props.title);
	assert.equal(props.bg[1], `url(${fixtureUrl})`);
});

test('CSS parsing never sends the root key into external URLs, quoted text, comments or malformed values', () => {
	for (const value of [
		`url('https://external.test/?text=url("${fixtureUrl}")')`,
		`url('//external.test/${fixtureUrl}')`,
		`url('\\2f \\2f external.test/${fixtureUrl}')`,
		`'url("${fixtureUrl}")'`,
		`/* url(${fixtureUrl}) */`,
		`url('${fixtureUrl}&key=independent')`,
		`url('${fixtureUrl}&sharedRoot=independent')`,
		`url("${fixtureUrl}"`,
		`image-set("${fixtureUrl}" 1x`,
		`${'x('.repeat(33)}url(${fixtureUrl})${')'.repeat(33)}`,
		`url(${fixtureUrl})${' '.repeat(65536)}`
	]) assert.equal(mapCssMediaUrls(value, withContext), value, value.slice(0, 100));
	assert.equal(literalAttachmentId(`${fixtureUrl}&key=independent`), null);
	assert.equal(literalAttachmentId(`${fixtureUrl}&sharedRoot=independent`), null);
	assert.equal(literalAttachmentId('https://external.test' + fixtureUrl), null);
});

test('escaped CSS function names share the same bounded URL grammar as literal url', () => {
	const names = [String.raw`u\72l`, String.raw`u\72 l`, String.raw`\75 \72 \6c `, 'u\\72\r\nl'];
	for (const name of names) {
		for (const argument of [fixtureUrl, `"${fixtureUrl}"`, String.raw`\2f api/v1/attachments/content?id=css-image`]) {
			const value = `${name}(${argument})`;
			const mapped = mapCssMediaUrls(value, withContext);
			assert.ok(mapped.includes('key=read-key&sharedRoot=shared-page'), value);
			assert.equal(mapCssMediaUrls(mapped, withContext), mapped);
			const ids: string[] = [];
			mapCssMediaUrls(value, (url) => { const id = literalAttachmentId(url); if (id) ids.push(id); return url; });
			assert.deepEqual(ids, ['css-image'], value);
		}
		for (const argument of [`'https://external.test/?text=url("${fixtureUrl}")'`, `//external.test${fixtureUrl}`, `${fixtureUrl} invalid`, `${fixtureUrl}\\`, `url(${fixtureUrl})`]) {
			const value = `${name}(${argument})`;
			assert.equal(mapCssMediaUrls(value, withContext), value);
		}
	}
	for (const name of [String.raw`u\72  l`, String.raw`u\\72 l`, String.raw`u\72 /* comment */l`]) {
		const value = `${name}("${fixtureUrl}")`;
		assert.equal(mapCssMediaUrls(value, withContext), value);
	}
	const imageSet = String.raw`image\2d set` + `("${fixtureUrl}" 1x)`;
	assert.ok(mapCssMediaUrls(imageSet, withContext).includes('key=read-key&sharedRoot=shared-page'));
});

test('CSS wait-for-capability blanks media safely and parser discovery matches transport', () => {
	assert.equal(mapCssMediaUrls(`url(${fixtureUrl})`, () => ''), 'url("")');
	const value = `image-set("${fixtureUrl}" 1x, url('https://external.test/a.png') 2x)`;
	const ids: string[] = [];
	assert.equal(mapCssMediaUrls(value, (url) => { const id = literalAttachmentId(url); if (id) ids.push(id); return url; }), value);
	assert.deepEqual(ids, ['css-image']);
});

test('media key transport is restricted to the exact first-party content path', () => {
	const source = '/api/v1/attachments/content?id=fixture&width=320';
	assert.equal(sharedAttachmentUrl(source, 'read-key'), `${source}&key=read-key`);
	assert.equal(sharedAttachmentUrl(source), source);
	for (const value of ['https://external.test/image.png', '//external.test/api/v1/attachments/content?id=x', '/api/v1/attachments/content/other?id=x', '/api/v1/things?id=x', '/api/v1/attachments/content?next=https://external.test']) {
		assert.equal(sharedAttachmentUrl(value, 'read-key'), value);
	}
	assert.equal(sharedAttachmentUrl(`${source}&key=independent`, 'read-key'), `${source}&key=independent`);
	assert.equal(sharedAttachmentUrl(source, 'read-key', 'page'), `${source}&key=read-key&sharedRoot=page`);
	assert.equal(sharedAttachmentUrl(source, undefined, 'public-page'), `${source}&sharedRoot=public-page`);
	assert.equal(sharedAttachmentUrl(`${source}&sharedRoot=independent`, 'read-key', 'page'), `${source}&sharedRoot=independent`);
	assert.equal(sharedAttachmentUrl('https://external.test/image.png', 'read-key', 'page'), 'https://external.test/image.png');
});

test('unresolved template media is left for the runtime, in props and in CSS alike', () => {
	// Discovery refuses `[{}$]` values, so transport must refuse them too:
	// the key would ride a placeholder that never names a grantable id, and
	// percent-encoded braces would stop the runtime from filling it in.
	for (const template of ['/api/v1/attachments/content?id={input.id}', '/api/v1/attachments/content?id=${id}', '/api/v1/attachments/content?id=a&width={w}']) {
		assert.equal(literalAttachmentId(template), null, template);
		assert.equal(sharedAttachmentUrl(template, 'read-key', 'page'), template, template);
		assert.equal(sharedAttachmentUrl(template, 'read-key'), template, template);
		assert.equal(mapCssMediaUrls(`url("${template}")`, withContext), `url("${template}")`, template);
	}
	// Every candidate the parser surfaces is granted iff it is transported.
	for (const value of [`url(${fixtureUrl})`, `url("/api/v1/attachments/content?id={input.id}")`, `image-set("${fixtureUrl}" 1x, url('https://external.test/a.png') 2x)`, `url('//external.test${fixtureUrl}')`]) {
		const ids: string[] = [];
		mapCssMediaUrls(value, (url) => { const id = literalAttachmentId(url); if (id) ids.push(id); return url; });
		assert.equal(ids.length > 0, mapCssMediaUrls(value, withContext) !== value, value);
	}
});
