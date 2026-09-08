import assert from 'node:assert/strict';
import test from 'node:test';

import { thingDetailSections } from './thingDetailSectionsCore.ts';

test('a Thing honours both view switches independently', () => {
	assert.deepEqual(thingDetailSections({ hasThing: true, showPreview: true, showData: true }), {
		viewToggles: true,
		preview: true,
		detail: true
	});
	assert.deepEqual(thingDetailSections({ hasThing: true, showPreview: false, showData: true }), {
		viewToggles: true,
		preview: false,
		detail: true
	});
	assert.deepEqual(thingDetailSections({ hasThing: true, showPreview: true, showData: false }), {
		viewToggles: true,
		preview: true,
		detail: false
	});
});

test('a Thing may hide both sections, because the switches that restore them stay on screen', () => {
	assert.deepEqual(thingDetailSections({ hasThing: true, showPreview: false, showData: false }), {
		viewToggles: true,
		preview: false,
		detail: false
	});
});

test('a diagnostic always renders its redacted error, whatever switch state a Thing left behind', () => {
	// The route stays mounted across id changes, so `showData: false` set on a
	// Thing arrives here unchanged. A diagnostic renders no `Views` card, so
	// honouring that switch would blank the page with no way back.
	for (const showPreview of [true, false]) {
		for (const showData of [true, false]) {
			assert.deepEqual(
				thingDetailSections({ hasThing: false, showPreview, showData }),
				{ viewToggles: false, preview: false, detail: true },
				`diagnostic with showPreview=${showPreview} showData=${showData}`
			);
		}
	}
});

test('no section is gated by a switch the page does not render', () => {
	for (const hasThing of [true, false]) {
		for (const showPreview of [true, false]) {
			for (const showData of [true, false]) {
				const sections = thingDetailSections({ hasThing, showPreview, showData });
				if (sections.viewToggles) continue;
				// With no switches on screen, section visibility must depend only on
				// the payload, never on remembered switch state.
				assert.deepEqual(sections, thingDetailSections({ hasThing, showPreview: true, showData: true }));
			}
		}
	}
});
