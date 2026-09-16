import assert from 'node:assert/strict';
import test from 'node:test';
import { createHeicImagePreparer, HeicImageError, isHeicImage, MAX_HEIC_BYTES } from './heicImage';
import { localFileMediaKind, safeAttachmentMediaKind } from './attachmentUiCore';
import { profileImageFileError } from '../Profile/profileMediaCore';
import {
	INLINE_THUMBNAIL_ACCEPT,
	INLINE_THUMBNAIL_CONTENT_TYPES,
	MAX_INLINE_THUMBNAIL_BYTES,
	inlineThumbnailFileError
} from '../Profile/profileThumbnail';

// A pre-account field rejects a file only at its picker. A file the picker offers but the
// upload queue silently drops never becomes an upload, so the field stays blocking with
// nothing to preview, retry or remove and the invite/signup submit button never re-enables.
test('the inline-thumbnail picker, selection filter and preparer accept exactly the same files', () => {
	const sized = (file: File, size: number) => {
		Object.defineProperty(file, 'size', { value: size });
		return file;
	};
	// Every MIME the picker advertises must survive the picker's own validator...
	for (const accepted of INLINE_THUMBNAIL_ACCEPT.split(',')) {
		const file = accepted.startsWith('.')
			? new File(['x'], `photo${accepted}`)
			: new File(['x'], 'photo.bin', { type: accepted });
		assert.equal(inlineThumbnailFileError(file), null, `${accepted} must pass the inline picker`);
		// ...and the queue's allowed set, which judges a HEIC as the JPEG it is converted into.
		const queueType = isHeicImage(file) ? 'image/jpeg' : file.type.toLowerCase();
		assert.ok((INLINE_THUMBNAIL_CONTENT_TYPES as readonly string[]).includes(queueType), `${accepted} must pass the queue filter`);
		assert.ok(sized(file, MAX_INLINE_THUMBNAIL_BYTES).size <= MAX_INLINE_THUMBNAIL_BYTES);
	}
	// Formats the wider profile field allows are not offered here, so they cannot strand the form.
	for (const type of ['image/avif', 'image/gif']) {
		assert.ok(!INLINE_THUMBNAIL_ACCEPT.includes(type));
		assert.match(String(inlineThumbnailFileError({ type, size: 5 })), /PNG, JPEG, WebP, HEIC or HEIF/);
	}
	// The 10 MB rule is a rule about the chosen photo, and it is enforced before the queue sees it.
	assert.equal(inlineThumbnailFileError(sized(new File(['x'], 'big.heic'), MAX_INLINE_THUMBNAIL_BYTES + 1)), 'Choose a photo under 10 MB.');
	assert.equal(inlineThumbnailFileError(sized(new File(['x'], 'ok.heic'), MAX_INLINE_THUMBNAIL_BYTES)), null);
	assert.equal(inlineThumbnailFileError(new File([], 'empty.heic')), 'Choose an image that contains data.');
});

test('HEIC and HEIF pickers accept MIME aliases and uppercase filenames without a MIME', () => {
	for (const type of ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence', 'IMAGE/HEIC']) {
		assert.ok(isHeicImage({ type }));
		assert.equal(profileImageFileError({ type, size: 5 }), null);
	}
	for (const name of ['PHOTO.HEIC', 'photo.heif']) {
		const file = new File(['photo'], name);
		assert.ok(isHeicImage(file));
		assert.equal(localFileMediaKind(file), 'image');
		assert.equal(profileImageFileError(file), null);
	}
	assert.equal(isHeicImage({ type: 'image/jpeg', name: 'photo.jpg' }), false);
	assert.equal(isHeicImage({ type: '', name: 'photo.heic.exe' }), false);
	// Raw HEIC bytes must never be promoted to a browser-safe server image.
	assert.equal(safeAttachmentMediaKind('image/heic', 'image'), 'file');
});

test('conversion produces JPEG metadata and reuses identical bytes across simultaneous selections and retries', async () => {
	let calls = 0;
	const prepare = createHeicImagePreparer(async () => {
		calls++;
		return new Blob(['jpeg'], { type: 'image/jpeg' });
	});
	const file = new File(['heic'], 'Holiday.HEIC', { type: '', lastModified: 123 });
	const [first, second] = await Promise.all([prepare(file), prepare(file)]);
	assert.equal(calls, 1);
	assert.equal(first, second);
	assert.equal(await prepare(file), first);
	assert.equal(first.name, 'Holiday.jpg');
	assert.equal(first.type, 'image/jpeg');
	assert.equal(first.lastModified, 123);
	assert.equal(first.size, 4);
	assert.equal(await first.text(), 'jpeg');
});

test('other attachments stay byte-for-byte unchanged and do not load a decoder', async () => {
	const prepare = createHeicImagePreparer(async () => {
		throw new Error('must not decode');
	});
	for (const name of ['photo.jpg', 'animation.gif', 'clip.mp4', 'notes.pdf']) {
		const file = new File(['original'], name);
		assert.equal(await prepare(file), file);
	}
});

test('failed conversions are actionable and can be retried', async () => {
	let calls = 0;
	const prepare = createHeicImagePreparer(async () => {
		if (++calls === 1) throw new Error('decoder internal details');
		return new Blob(['jpeg'], { type: 'image/jpeg' });
	});
	const file = new File(['bad'], 'photo.heic');
	await assert.rejects(prepare(file), (error: Error) => error instanceof HeicImageError && !error.message.includes('internal'));
	assert.equal((await prepare(file)).type, 'image/jpeg');
	assert.equal(calls, 2);
});

test('empty, oversized, and invalid decoder output fail before upload', async () => {
	let calls = 0;
	const prepare = createHeicImagePreparer(async () => {
		calls++;
		return new Blob(['not an image']);
	});
	await assert.rejects(prepare(new File([], 'empty.heic')), HeicImageError);
	const huge = new File(['x'], 'huge.heic');
	Object.defineProperty(huge, 'size', { value: MAX_HEIC_BYTES + 1 });
	await assert.rejects(prepare(huge), HeicImageError);
	assert.equal(calls, 0);
	await assert.rejects(prepare(new File(['bad'], 'bad.heic')), HeicImageError);
	const oversizedOutput = createHeicImagePreparer(async () => {
		const blob = new Blob(['x'], { type: 'image/jpeg' });
		Object.defineProperty(blob, 'size', { value: MAX_HEIC_BYTES + 1 });
		return blob;
	});
	await assert.rejects(oversizedOutput(new File(['x'], 'big.heic')), /converted photo exceeds/);
});
