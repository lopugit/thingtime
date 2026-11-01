import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import { SUPPORT_CAMPAIGN_URL, SUPPORT_EMAIL, SUPPORT_INQUIRIES, SUPPORT_PATH, supportMailto } from './supportContent.ts';

// The support page's destinations and copy are a public commitment: the landing
// section, the shared footer, README, FUNDING.yml and TESTING.md all assert the
// same contract. These lock the parts a later edit could silently break.

test('supportMailto encodes the draft so a visitor cannot inject extra mail headers', () => {
	const url = supportMailto('Quote & scope: cc=someone@example.com', 'line one\nline two');

	assert.ok(url.startsWith(`mailto:${SUPPORT_EMAIL}?`));
	// & and = inside the subject must survive as data, not become new parameters.
	assert.match(url, /subject=Quote%20%26%20scope%3A%20cc%3Dsomeone%40example\.com/u);
	assert.match(url, /body=line%20one%0Aline%20two/u);

	const params = new URLSearchParams(new URL(url).search);
	assert.deepEqual([...params.keys()], ['subject', 'body']);
	assert.equal(params.get('subject'), 'Quote & scope: cc=someone@example.com');
	assert.equal(params.get('body'), 'line one\nline two');
});

test('every inquiry ships a default draft that fits the form limits and the mailto budget', () => {
	const kinds = Object.keys(SUPPORT_INQUIRIES);
	assert.deepEqual(kinds, ['setup', 'sponsorship']);

	for (const kind of kinds) {
		const inquiry = SUPPORT_INQUIRIES[kind as keyof typeof SUPPORT_INQUIRIES];
		assert.ok(inquiry.label.length > 0, `${kind} needs a button label`);
		// SupportPage caps the subject at maxLength 100 and the message at 1200;
		// a default longer than its own field would be uneditable-but-sendable.
		assert.ok(inquiry.subject.length > 0 && inquiry.subject.length <= 100, `${kind} subject must fit maxLength 100`);
		assert.ok(inquiry.body.length > 0 && inquiry.body.length <= 1200, `${kind} body must fit maxLength 1200`);
		// Mail handlers commonly truncate a mailto near 2048 characters.
		assert.ok(supportMailto(inquiry.subject, inquiry.body).length < 2048, `${kind} default mailto must stay under 2048`);
	}
});

test('the funding section keeps its saved-page key while the retired campaign claims stay gone', async () => {
	const landing = await readFile(new URL('../Landing/landingSections.tsx', import.meta.url), 'utf8');
	const native = await readFile(new URL('../Builder/nativeSections.tsx', import.meta.url), 'utf8');
	const seed = await readFile(new URL('../../api/utils/webpages/seed.ts', import.meta.url), 'utf8');

	// Saved builder pages reference sections by key, so 'home-back' and the
	// '#back' anchor must outlive any rename of the section's visible title.
	for (const source of [landing, native, seed]) assert.match(source, /'home-back'/u);
	assert.match(landing, /id="back"/u);
	assert.match(landing, /href: '#back'/u);

	// Retired with the Indiegogo prelaunch page: hard-coded totals, backer and
	// deadline counters, and merch/lifetime reward tiers. See TESTING.md and
	// docs/design/DESIGN_LANGUAGE.md — none of these may return. Scoped to the
	// funding section so the car-maintenance demo's prices stay allowed.
	assert.doesNotMatch(landing, /indiegogo/iu);
	const sectionStart = landing.indexOf('const BackSection');
	const sectionEnd = landing.indexOf('const FAQS');
	assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, 'funding section source not found — update this slice');
	const fundingSection = landing.slice(sectionStart, sectionEnd);
	assert.doesNotMatch(fundingSection, /\$\d/u);
	assert.doesNotMatch(fundingSection, /backers|days left|Sticker pack|Unicorn tier/iu);
});

test('the homepage and footer route supporters to the one support page and campaign', async () => {
	const landing = await readFile(new URL('../Landing/landingSections.tsx', import.meta.url), 'utf8');
	const footer = await readFile(new URL('../Nav/Footer.tsx', import.meta.url), 'utf8');
	const routes = await readFile(new URL('../../routes.tsx', import.meta.url), 'utf8');

	assert.equal(SUPPORT_PATH, '/support');
	assert.match(routes, /path: 'support'/u);
	// Both entry points use the shared constants rather than re-typing a URL.
	assert.match(landing, /from '~\/components\/Support\/supportContent'/u);
	assert.match(footer, /from '\.\.\/Support\/supportContent'/u);
	assert.match(footer, /to=\{SUPPORT_PATH\}/u);
	// Outbound campaign links must not hand the opener to the destination.
	assert.match(landing, /href=\{SUPPORT_CAMPAIGN_URL\}[\s\S]{0,200}?rel="noopener noreferrer"/u);
	assert.ok(SUPPORT_CAMPAIGN_URL.startsWith('https://'));
});
