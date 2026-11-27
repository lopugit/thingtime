import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cssLinesToRecord, cssRecordToLines } from '../ElementInspector/cssDeclarations';
import { cssPropertyDefinition, cssValueOptions, htmlAttributeDefinition, htmlAttributeNames, loadElementStandards } from '../ElementInspector/elementStandards';
import { allowsAuthoredHtmlAttribute, authoredHtmlPropName } from '../Kinds/htmlRenderPolicy';
import { EXPANDED_WEBPAGE_AUTHORING_REQUIREMENTS, isCssPropertyName, usesExpandedWebpageAuthoring } from '~/schemas/cssDeclarationNames';
import { sanitizeWebpageBlocks } from '~/schemas/registry';

test('standards suggestions include property grammar, local variables and element-specific values', async () => {
 const catalog = await loadElementStandards();
 const display = cssValueOptions(catalog, 'display', { '--Accent': 'red' });
 for (const token of ['flex', 'grid', 'inline', 'revert-layer', 'var(--Accent)']) assert.ok(display.includes(token), token);
 const width = cssValueOptions(catalog, 'width');
 for (const token of ['1rem', 'auto', '50%', 'anchor-size()']) assert.ok(width.includes(token), token);
 assert.equal(cssPropertyDefinition(catalog, 'width').initial, 'auto');
 assert.ok(htmlAttributeNames(catalog, 'img').includes('aria-describedby'));
 assert.ok(htmlAttributeNames(catalog, 'img').includes('alt'));
 assert.ok(!htmlAttributeNames(catalog, 'span').includes('alt'));
 assert.deepEqual(htmlAttributeDefinition(catalog, 'img', 'loading')?.values, ['lazy', 'eager']);
 assert.ok(htmlAttributeDefinition(catalog, 'input', 'type')?.values.includes('checkbox'));
 assert.deepEqual(htmlAttributeDefinition(catalog, 'button', 'type')?.values, ['submit', 'reset', 'button']);
 assert.equal(htmlAttributeDefinition(catalog, 'button', 'disabled')?.boolean, true);
});

test('suggestions cannot grant runtime event, source-set or reserved data attributes', () => {
 assert.equal(allowsAuthoredHtmlAttribute(authoredHtmlPropName('fetchpriority'), 'img'), true);
 assert.equal(allowsAuthoredHtmlAttribute(authoredHtmlPropName('fetchpriority'), 'span'), false);
 assert.equal(allowsAuthoredHtmlAttribute('aria-describedby', 'img'), true);
 assert.equal(allowsAuthoredHtmlAttribute('data-user-description', 'img'), true);
 for (const key of ['tabindex', 'spellcheck', 'translate', 'draggable']) assert.equal(allowsAuthoredHtmlAttribute(authoredHtmlPropName(key), 'span'), true);
 for (const key of ['minlength', 'multiple']) {
  assert.equal(allowsAuthoredHtmlAttribute(authoredHtmlPropName(key), 'input'), true);
  assert.equal(allowsAuthoredHtmlAttribute(authoredHtmlPropName(key), 'img'), false);
 }
 for (const key of ['srcset', 'ping', 'formAction', 'srcDoc', 'pattern', 'onclick', 'data-block-id', 'data-tt-native-menu']) {
  assert.equal(allowsAuthoredHtmlAttribute(key, 'img'), false, key);
 }
});

test('long CSS and HTML authoring keeps literal custom properties and the existing value safety gate', () => {
 const value = 'x'.repeat(300);
 const css = { ...Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`--test-${i}`, String(i)])), '--色Accent': value, '-webkit-line-clamp': '3' };
 const html = '<p>' + 'y'.repeat(22_000) + '</p>';
 const blocks = [{ id: 'outer', type: 'container', children: [{ id: 'article', type: 'html', css, html }] }];
 assert.equal(usesExpandedWebpageAuthoring(blocks), true);
 assert.equal(usesExpandedWebpageAuthoring([{ id: 'article', type: 'html', css: { '--test': 'blue' }, html: '<p>Hi</p>' }]), false);
 assert.deepEqual({ ...cssLinesToRecord(cssRecordToLines(css)) }, css);
 assert.equal(isCssPropertyName('this is not a property'), false);
 const verified = sanitizeWebpageBlocks(blocks);
 assert.equal(verified.ok, true);
 if (!verified.ok) return;
 const article = (verified.blocks[0].children as typeof blocks[0]['children'])[0];
 assert.deepEqual({ ...article.css }, css);
 assert.equal(article.html, html);
 assert.equal(sanitizeWebpageBlocks([{ id: 'attack', type: 'html', html, css: { '--payload': 'url(javascript:alert(1))' } }]).ok, false);
 assert.equal(EXPANDED_WEBPAGE_AUTHORING_REQUIREMENTS['api.things-update'], '1.26.0');
});
