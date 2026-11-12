import assert from 'node:assert/strict';
import test from 'node:test';
import { legalDocuments, legalDocumentPath, legalDocumentText, resolveLegalDocument } from './documents';

test('current policies have distinct versioned identities and resolvable permanent links', () => {
	const keys = legalDocuments.map((doc) => `${doc.slug}/${doc.version}`);
	assert.equal(new Set(keys).size, keys.length);
	for (const slug of ['privacy-policy', 'apple-tv-privacy-policy', 'terms-of-service']) {
		assert.equal(legalDocuments.filter((doc) => doc.slug === slug && doc.status === 'current').length, 1);
	}
	for (const doc of legalDocuments) {
		assert.equal(resolveLegalDocument(doc.slug, doc.version), doc);
		assert.equal(legalDocumentPath(doc, true), `/pages/${doc.slug}/${doc.version}`);
		assert.match(doc.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
	}
	assert.equal(resolveLegalDocument('privacy-policy', 'missing'), undefined);
	assert.equal(resolveLegalDocument('unknown'), undefined);
	assert.equal(resolveLegalDocument('merchandise-terms'), undefined);
});

test('exports contain every section and explicitly distinguish historical claims', () => {
	for (const doc of legalDocuments) {
		const text = legalDocumentText(doc);
		assert.ok(text.includes(doc.version) && text.includes(doc.effectiveDate));
		for (const section of doc.sections) for (const paragraph of section.paragraphs) assert.ok(text.includes(paragraph));
		assert.equal(text.includes('ARCHIVED —'), doc.status === 'archived');
	}
	const current = legalDocumentText(resolveLegalDocument('privacy-policy')!);
	assert.ok(!current.includes('We do not collect, store, or share any personal information.'));
	const tv = legalDocumentText(resolveLegalDocument('apple-tv-privacy-policy')!);
	assert.ok(tv.includes('Shared') || tv.includes('shared television'));
	assert.ok(tv.includes('contact@thingtime.com'));
	assert.ok(tv.includes('Retention and security'));
});
