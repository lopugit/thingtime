import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TT_CUSTOM_TARGETS, buildCustomCss, sanitizeCustomClasses, sanitizeCustomCss } from './customise';

const themeStudioSource = () => readFile(new URL('../components/ThemeSettings/ThemeStudio.tsx', import.meta.url), 'utf8');

/**
 * The Theme Studio renders a Customise toggle for every Row that carries a
 * `customKey`, but CustomisePanel resolves that key through TT_CUSTOM_TARGETS
 * and renders nothing when it misses. An unregistered key is therefore a
 * silently dead control rather than a crash or a type error, which is exactly
 * the kind of drift a test has to catch.
 */
test('every Theme Studio customKey resolves to a registered target', async () => {
	const source = await themeStudioSource();
	const keys = [...source.matchAll(/customKey="([^"]+)"/gu)].map((match) => match[1]);

	// guard the scan itself: a refactor that renames the prop must fail here
	// rather than quietly asserting over an empty list
	assert.ok(keys.length >= 10, `expected the static customKey rows, found ${keys.length}`);

	for (const key of keys) {
		assert.ok(TT_CUSTOM_TARGETS[key], `Theme Studio offers "${key}" but TT_CUSTOM_TARGETS has no entry, so its panel opens empty`);
	}
});

test('the interpolated colour and window rows resolve too', async () => {
	const source = await themeStudioSource();
	// `customKey={`color.${field.key}`}` / `windows.${button.key}` — the scan
	// above only sees string literals, so pin the prefixes it cannot reach
	assert.match(source, /customKey=\{`color\.\$\{field\.key\}`\}/u);
	assert.match(source, /customKey=\{`windows\.\$\{button\.key\}`\}/u);

	const registered = Object.keys(TT_CUSTOM_TARGETS);
	assert.ok(registered.some((key) => key.startsWith('color.')));
	assert.ok(registered.filter((key) => key.startsWith('windows.')).length === 3);
});

test('the pet is customised on its own element, not on :root', () => {
	const pet = TT_CUSTOM_TARGETS['general.pet'];

	assert.ok(pet, 'the Pet row is offered in Settings and Theme Studio');
	// :root would leak declarations like `opacity: 0.4` onto the whole page —
	// element options exist precisely so an ornament stays scoped to itself
	assert.equal(pet.selector, '.tt-pet');
	assert.equal(pet.classable, true);
});

test('the pet component renders the class its target scopes to', async () => {
	const source = await readFile(new URL('../components/Pets/LopuuuPet.tsx', import.meta.url), 'utf8');
	const selector = TT_CUSTOM_TARGETS['general.pet'].selector.replace(/^\./u, '');

	// the class and the selector are declared in two files; drift in either
	// direction turns every pet customisation into a no-op
	assert.match(source, new RegExp(`\`${selector} \\$\\{customClasses\\}\``, 'u'), 'the pet keeps its stable class alongside any custom ones');
	assert.match(source, new RegExp(`'${selector}'`, 'u'), 'and still carries it when there are no custom classes');
	// custom classes are user input, so they must go through the sanitiser
	assert.match(source, /useTtCustomClasses\('general\.pet'\)/u);
});

test('pet custom CSS is emitted scoped to the pet, and unknown keys stay skipped', () => {
	const css = buildCustomCss({ 'general.pet': { css: 'opacity: 0.4;' } });

	assert.equal(css, '.tt-pet {\nopacity: 0.4;\n}');
	assert.equal(buildCustomCss({ 'general.nope': { css: 'opacity: 0.4;' } }), '');
});

test('pet customisation cannot escape its rule', () => {
	// same stance as every other target — braces and at-rules are stripped, so
	// custom CSS can never break out of `.tt-pet { … }` into global styles
	assert.equal(sanitizeCustomCss('} body { display: none; } .x {'), 'body  display: none;  .x');
	assert.equal(sanitizeCustomCss('background: url(https://evil.test/x.png)'), 'background: (https://evil.test/x.png)');
	assert.equal(sanitizeCustomClasses('good-class <script> bad.class'), 'good-class');
});
