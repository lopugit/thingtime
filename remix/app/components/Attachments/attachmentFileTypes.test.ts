import assert from 'node:assert/strict';
import test from 'node:test';
import { IMAGE_UPLOAD_CONTENT_TYPES, uploadFileTypes } from './attachmentFileTypes';
import { HEIC_IMAGE_ACCEPT } from './heicImage';
import { PROFILE_MEDIA_CONTENT_TYPES, profileImageFileError } from '../Profile/profileMediaCore';
import { PROFILE_THUMBNAIL_CONTENT_TYPES } from '../Profile/profileThumbnail';

// HEIC_IMAGE_ACCEPT is itself a comma list of MIME types and extensions, so it is
// split off as one unit before enumerating the types a caller's list contributes.
const acceptParts = (accept?: string) => {
	const heic = typeof accept === 'string' && accept.endsWith(HEIC_IMAGE_ACCEPT);
	const rest = heic ? (accept as string).slice(0, -HEIC_IMAGE_ACCEPT.length) : accept || '';
	return { mimes: rest.split(',').filter(Boolean), heic };
};

// Parenthesised extension hints ('JPEG (.jpg, .jpeg)') carry their own separator,
// so they are removed before the format names are counted.
const labelFormats = (label: string) =>
	label
		.replace(/\s*\([^)]*\)/g, '')
		.split(', ')
		.filter((part) => part !== 'HEIC' && part !== 'HEIF');

test('unrestricted fields keep the native picker open and say so', () => {
	const unrestricted = uploadFileTypes();
	// An undefined accept is what leaves the picker unfiltered; '' would also filter
	// nothing but is worth pinning so the attribute is omitted rather than emitted empty.
	assert.equal(unrestricted.accept, undefined);
	assert.equal(unrestricted.label, 'All file types');
	assert.deepEqual(uploadFileTypes([]), unrestricted);
});

test('the visible label describes exactly the formats the picker filters to', () => {
	const callerLists = [undefined, IMAGE_UPLOAD_CONTENT_TYPES, PROFILE_THUMBNAIL_CONTENT_TYPES, ['image/gif', 'image/jpeg', 'image/png', 'image/webp']];
	for (const types of callerLists) {
		const { accept, label } = uploadFileTypes(types, true);
		const { mimes, heic } = acceptParts(accept);
		// Every filtered MIME type is named in the guidance and nothing extra is named,
		// so the picker cannot drift from the text telling the user what to choose.
		assert.equal(labelFormats(label).length, mimes.length, `${label} should name ${mimes.length} formats`);
		for (const mime of mimes) {
			const format = mime.slice('image/'.length).toUpperCase();
			assert.ok(label.toUpperCase().includes(format), `${label} should name ${mime}`);
		}
		assert.equal(label.includes('HEIC, HEIF'), heic);
	}
});

test('HEIC input is offered only where its converted PNG output is accepted', () => {
	const withPng = acceptParts(uploadFileTypes(['image/png']).accept);
	assert.ok(withPng.heic);

	// No PNG target means a converted photo would be rejected on selection, so the
	// picker and the label must both stay silent about HEIC/HEIF.
	const withoutPng = uploadFileTypes(['image/jpeg', 'image/webp']);
	assert.equal(withoutPng.accept, 'image/jpeg,image/webp');
	assert.equal(withoutPng.label, 'JPEG (.jpg, .jpeg), WebP');
});

test('image-only fields offer every format the upload validator already accepts', () => {
	const { accept, label } = uploadFileTypes(undefined, true);
	const { mimes, heic } = acceptParts(accept);
	assert.deepEqual(mimes, [...IMAGE_UPLOAD_CONTENT_TYPES]);
	assert.ok(heic);
	assert.equal(label, 'AVIF, GIF, JPEG (.jpg, .jpeg), PNG, WebP, HEIC, HEIF');
	// AVIF is the format the old hardcoded accept string omitted even though the
	// selection validator already accepted it.
	assert.ok(mimes.includes('image/avif'));
});

test('profile and inline-thumbnail pickers match their own validators', () => {
	// Branding/profile slots: the offered set is the set profileImageFileError admits.
	assert.deepEqual([...PROFILE_MEDIA_CONTENT_TYPES], [...IMAGE_UPLOAD_CONTENT_TYPES]);
	for (const type of PROFILE_MEDIA_CONTENT_TYPES) assert.equal(profileImageFileError({ type, size: 5 } as File), null);

	// Invite/signup slots run prepareProfileThumbnail, which rejects AVIF and GIF.
	const inline = uploadFileTypes(PROFILE_THUMBNAIL_CONTENT_TYPES);
	const { mimes, heic } = acceptParts(inline.accept);
	assert.deepEqual(mimes, [...PROFILE_THUMBNAIL_CONTENT_TYPES]);
	assert.ok(heic);
	for (const rejected of ['image/avif', 'image/gif']) assert.ok(!mimes.includes(rejected), `${rejected} must not be offered`);
	assert.equal(inline.label, 'JPEG (.jpg, .jpeg), PNG, WebP, HEIC, HEIF');
});

test('caller lists are normalized without duplicating formats', () => {
	const { accept, label } = uploadFileTypes(['IMAGE/PNG', 'image/png', 'Image/WebP']);
	assert.equal(accept, `image/png,image/webp,${HEIC_IMAGE_ACCEPT}`);
	assert.equal(label, 'PNG, WebP, HEIC, HEIF');
});
