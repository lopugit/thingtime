import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { isSafeUrl } from './safeUrl.ts';

test('accepts web, contact, and relative URLs', () => {
	for (const value of [
		'https://example.com',
		'http://example.com',
		'mailto:hello@example.com',
		'tel:+61400000000',
		'/image.png',
		'./image.png',
		'#section',
		'//cdn.example.com/image.png'
	]) {
		assert.equal(isSafeUrl(value), true, value);
	}
});

test('rejects executable and local URL schemes', () => {
	const javascriptUrl = ['java', 'script:alert(1)'].join('');
	const mixedCaseJavascriptUrl = ['JaVa', 'ScRiPt:alert(1)'].join('');
	// Browsers strip ASCII control characters and leading whitespace before
	// reading a scheme, so these still execute — a `startsWith('javascript:')`
	// style prefix check misses every one of them. The URL parser normalises
	// them the same way the browser does, so the allowlist still says no.
	const obfuscatedJavascriptUrls = ['java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0000javascript:alert(1)', '  javascript:alert(1)'];
	for (const value of [
		javascriptUrl,
		mixedCaseJavascriptUrl,
		...obfuscatedJavascriptUrls,
		'vbscript:msgbox(1)',
		'data:text/html,<script>1</script>',
		'data:image/svg+xml,<svg/>',
		'file:///etc/passwd',
		'blob:https://example.com/id'
	]) {
		assert.equal(isSafeUrl(value), false, JSON.stringify(value));
	}
});

test('rejects empty and malformed URLs', () => {
	assert.equal(isSafeUrl(''), false);
	assert.equal(isSafeUrl('http://['), false);
});
