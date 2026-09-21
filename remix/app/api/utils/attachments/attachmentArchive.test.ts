import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';

import { ARCHIVE_ATTACHMENT_PROJECTION, ARCHIVE_CHILD_PROJECTION, ARCHIVE_SHARED_ROOT_PROJECTION, createAttachmentArchiveService, type ArchiveAttachmentDoc } from './attachmentArchive';
import { ARCHIVE_MAX_BOUND_ROWS, ARCHIVE_MAX_SCANNED_THINGS, ARCHIVE_MAX_THINGS } from './attachmentArchiveCore';
import type { ThingDoc, Viewer } from '../things/things';

const viewer: Viewer = { id: 'viewer-1' };
const owner = 'owner-1';

const thing = (shareId: string, thingtime: string[], crystal: Record<string, unknown> = {}, extra: Partial<ThingDoc> = {}): ThingDoc =>
	({ shareId, ownerId: owner, thingtime, crystal, acl: ['tt:all'], createdAt: new Date('2026-01-01T00:00:00Z'), ...extra }) as ThingDoc;

const attachment = (shareId: string, targetId: string, name: string, extra: Partial<ArchiveAttachmentDoc> = {}): ArchiveAttachmentDoc => ({
	shareId,
	ownerId: owner,
	targetId,
	crystal: { name, size: 3, contentType: 'image/png', mediaKind: 'image' },
	attachmentPurpose: 'post',
	attachmentState: 'ready',
	...extra
});

type Fixture = {
	things: Record<string, ThingDoc>;
	children: Record<string, ThingDoc[]>;
	bound: ArchiveAttachmentDoc[];
	unreadable?: Set<string>;
	hidden?: Set<string>;
	sizes?: Record<string, number>;
	// media ids readable only through the named composition root (`<id>@<root>`)
	sharedVisible?: Set<string>;
};

const service = (fixture: Fixture, overrides: Record<string, unknown> = {}) => {
	const calls: { download: Array<{ viewer: unknown; id: string }>; inspect: Array<{ viewer: unknown; id: string }>; fetched: string[] } = { download: [], inspect: [], fetched: [] };
	const created = createAttachmentArchiveService({
		findViewable: async (id) => (fixture.hidden?.has(id) ? null : fixture.things[id] || null),
		findAttachmentRoot: async (id) => fixture.things[id] || null,
		canViewShared: async (_viewer, doc, rootId) => fixture.sharedVisible?.has(`${doc.shareId}@${rootId}`) === true,
		canView: async (doc) => !fixture.hidden?.has(doc.shareId),
		listChildren: async (ownerId, folderId) => (fixture.children[folderId] || []).filter((child) => child.ownerId === ownerId),
		listBound: async (targets) => fixture.bound.filter((doc) => targets.some((target) => target.shareId === doc.targetId)),
		loadAttachment: async (id) => fixture.bound.find((doc) => doc.shareId === id) || null,
		download: async (downloadViewer, id, forceDownload) => {
			calls.download.push({ viewer: downloadViewer, id: String(id) });
			assert.equal(forceDownload, true);
			if (fixture.unreadable?.has(String(id))) return { ok: false, status: 404, error: 'Attachment not found' };
			const size = fixture.sizes?.[String(id)] ?? 3;
			return {
				ok: true,
				url: `https://bucket.test/${id}`,
				expiresAt: '2026-01-01T00:10:00Z',
				cacheKey: 'k',
				size,
				contentType: 'application/octet-stream',
				disposition: 'attachment',
				image: false
			};
		},
		inspect: async (downloadViewer, id) => {
			calls.inspect.push({ viewer: downloadViewer, id: String(id) });
			if (fixture.unreadable?.has(String(id))) return { ok: false, status: 404, error: 'Attachment not found' };
			return { ok: true, size: fixture.sizes?.[String(id)] ?? 3, contentType: 'application/octet-stream' };
		},
		customMongoActive: () => false,
		fetch: (async (input: string | URL | Request) => {
			const url = String(input);
			calls.fetched.push(url);
			const id = url.split('/').pop()!;
			const size = fixture.sizes?.[id] ?? 3;
			return new Response(new Uint8Array(size).fill(id.charCodeAt(0)), { status: 200 });
		}) as typeof fetch,
		now: () => 1_000,
		...overrides
	});
	return { ...created, calls };
};

const read = async (stream: ReadableStream<Uint8Array>) => {
	const parts: Uint8Array[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
	}
	const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		joined.set(part, offset);
		offset += part.byteLength;
	}
	return unzipSync(joined);
};

test('a post archives its stored gallery in stored order, lists linked media and skips unreadable files', async () => {
	const fixture: Fixture = {
		things: { 'post-1': thing('post-1', ['post'], { text: 'Beach day\nmore' }) },
		children: {},
		bound: [
			attachment('att-2', 'post-1', 'second.png', { attachmentSortIndex: 1 }),
			attachment('att-1', 'post-1', 'first.png', { attachmentSortIndex: 0 }),
			attachment('att-dup', 'post-1', 'first.png', { attachmentSortIndex: 2 }),
			attachment('att-link', 'post-1', 'cover.png', { attachmentLinked: true, crystal: { name: 'cover.png', url: 'https://cdn.test/cover.png', size: 0, contentType: 'image/png', mediaKind: 'image' } }),
			attachment('att-pending', 'post-1', 'hidden.png'),
			attachment('att-comment', 'post-1', 'comment.png', { attachmentPurpose: 'comment' }),
			attachment('att-other', 'post-1', 'other.png', { ownerId: 'someone-else' })
		],
		unreadable: new Set(['att-pending'])
	};
	const { plan, manifest, stream, calls } = service(fixture);
	const result = await plan(viewer, 'post-1', { isAdmin: false });
	assert.equal(result.ok, true);
	if (result.ok !== true) return;
	assert.equal(result.kind, 'post');
	assert.equal(result.name, 'Beach day');
	assert.equal(result.fileName, 'Beach day.zip');
	// listBound returns already stored-sorted docs; the plan keeps that order
	assert.deepEqual(result.entries.map((entry) => entry.path), ['second.png', 'first.png', 'first (2).png']);
	assert.equal(result.skipped, 1);
	assert.deepEqual(result.links, [{ name: 'cover.png', url: 'https://cdn.test/cover.png', from: '' }]);
	assert.equal(result.linksPath, 'links.txt');
	assert.equal(result.totalBytes, 9);
	// every stored candidate is authorized individually through the download gate
	assert.deepEqual(calls.download.map((call) => call.id), ['att-2', 'att-1', 'att-dup', 'att-pending']);
	assert.deepEqual(calls.download[0].viewer, { id: 'viewer-1' });
	const summary = manifest(result, { revealSkipped: true });
	assert.equal(summary.fileCount, 3);
	assert.equal(summary.linkCount, 1);
	assert.equal(summary.skipped, 1);
	assert.equal(manifest(result).skipped, 0, 'withheld counts are owner/admin only');
	assert.deepEqual(summary.files[0], { id: 'att-2', path: 'second.png', name: 'second.png', size: 3 });
	assert.equal('url' in summary.files[0], false);
	const entries = await read(stream(result));
	assert.deepEqual(Object.keys(entries).sort(), ['first (2).png', 'first.png', 'links.txt', 'second.png']);
	assert.match(new TextDecoder().decode(entries['links.txt']), /cover\.png\thttps:\/\/cdn\.test\/cover\.png/);
	assert.deepEqual(calls.fetched, ['https://bucket.test/att-2', 'https://bucket.test/att-1', 'https://bucket.test/att-dup']);
});

test('a folder walks nested folders and post galleries, re-judging every child on its own audience', async () => {
	const fixture: Fixture = {
		things: { 'folder-1': thing('folder-1', ['folder'], { name: 'Recipes' }, { acl: ['tt:user'] }) },
		children: {
			'folder-1': [
				thing('post-a', ['post'], { text: 'Dinner' }),
				thing('post-private', ['post'], { text: 'Secret' }),
				thing('folder-2', ['folder'], { name: 'Dinner' }),
				thing('rec-1', ['attachment'], { name: 'note.m4a' }),
				thing('data-1', ['data'], { name: 'ignored' }),
				thing('session-1', ['session'], {}),
				thing('foreign', ['post'], { text: 'Not mine' }, { ownerId: 'someone-else' })
			],
			'folder-2': [thing('post-b', ['post'], { text: 'Dinner' })]
		},
		bound: [
			attachment('att-a1', 'post-a', 'a.png'),
			attachment('att-p', 'post-private', 'p.png'),
			attachment('att-b1', 'post-b', 'b.png'),
			attachment('rec-1', 'folder-1', 'note.m4a', { attachmentPurpose: 'recording', targetId: undefined }),
			attachment('att-foreign', 'foreign', 'f.png', { ownerId: 'someone-else' })
		],
		hidden: new Set(['post-private'])
	};
	const { plan, calls } = service(fixture);
	const result = await plan(viewer, 'folder-1');
	assert.equal(result.ok, true);
	if (result.ok !== true) return;
	assert.equal(result.kind, 'folder');
	assert.equal(result.fileName, 'Recipes.zip');
	// the nested "Dinner" folder claimed its name first, so the "Dinner" post's
	// gallery takes the next unique directory; the filed recording sits at the root
	assert.deepEqual(result.entries.map((entry) => entry.path).sort(), ['Dinner (2)/a.png', 'Dinner/Dinner/b.png', 'note.m4a']);
	assert.equal(result.skipped, 0);
	assert.equal(calls.download.some((call) => call.id === 'att-p' || call.id === 'att-foreign'), false);
});

test('a single media Thing archives itself and comment roots keep comment-purpose media', async () => {
	const fixture: Fixture = {
		things: {
			'att-1': thing('att-1', ['attachment'], { name: 'clip.mov' }, { acl: ['tt:inherit'], targetId: 'post-1' }),
			'comment-1': thing('comment-1', ['post', 'comment'], { text: 'nice' }, { targetId: 'post-1' })
		},
		children: {},
		bound: [attachment('att-1', 'post-1', 'clip.mov'), attachment('att-c', 'comment-1', 'reply.png', { attachmentPurpose: 'comment' }), attachment('att-wrong', 'comment-1', 'wrong.png')]
	};
	const { plan } = service(fixture);
	const media = await plan(viewer, 'att-1');
	assert.equal(media.ok, true);
	if (media.ok !== true) return;
	assert.deepEqual(media.entries.map((entry) => entry.path), ['clip.mov']);
	assert.equal(media.fileName, 'clip.zip');
	const comment = await plan(viewer, 'comment-1');
	assert.equal(comment.ok, true);
	if (comment.ok !== true) return;
	assert.deepEqual(comment.entries.map((entry) => entry.path), ['reply.png']);
});

test('missing, unauthorized, non-archivable and empty roots fail uniformly; custom data planes fail closed', async () => {
	const fixture: Fixture = {
		things: { 'data-1': thing('data-1', ['data']), 'post-empty': thing('post-empty', ['post']), 'post-locked': thing('post-locked', ['post']) },
		children: {},
		bound: [attachment('att-locked', 'post-locked', 'x.png')],
		unreadable: new Set(['att-locked'])
	};
	const { plan } = service(fixture);
	assert.deepEqual(await plan(viewer, ''), { ok: false, status: 400, error: 'Invalid archive id' });
	assert.deepEqual(await plan(viewer, 'nope'), { ok: false, status: 404, error: 'Thing not found' });
	assert.deepEqual(await plan(viewer, 'data-1'), { ok: false, status: 404, error: 'Thing not found' });
	assert.equal((await plan(viewer, 'post-empty')).ok, false);
	assert.equal(((await plan(viewer, 'post-empty')) as { status: number }).status, 404);
	assert.equal(((await plan(viewer, 'post-locked')) as { status: number }).status, 404);
	const custom = service(fixture, { customMongoActive: () => true });
	assert.deepEqual(await custom.plan(viewer, 'post-locked'), { ok: false, status: 404, error: 'Thing not found' });
});

test('shared roots and admin review ride along on the per-file authorization exactly like the content endpoint', async () => {
	const fixture: Fixture = {
		things: { 'page-1': thing('page-1', ['webpage'], { title: 'Landing' }) },
		children: {},
		bound: [attachment('att-1', 'page-1', 'hero.png')]
	};
	const { plan, calls } = service(fixture);
	const anonymous = await plan(null, 'page-1', { sharedRoot: 'page-1' });
	assert.equal(anonymous.ok, true);
	assert.deepEqual(calls.download[0].viewer, { id: '', sharedRoot: 'page-1' });
	await plan(viewer, 'page-1', { isAdmin: true });
	assert.deepEqual(calls.download[1].viewer, { id: 'viewer-1', isAdmin: true });
	await plan(null, 'page-1');
	assert.equal(calls.download[2].viewer, null);
});

test('archives stay inside the file and byte budgets', async () => {
	const many = Array.from({ length: 501 }, (_, index) => attachment(`att-${index}`, 'post-1', `${index}.png`));
	const fixture: Fixture = { things: { 'post-1': thing('post-1', ['post']) }, children: {}, bound: many };
	const tooMany = await service(fixture).plan(viewer, 'post-1');
	assert.equal(tooMany.ok, false);
	assert.equal((tooMany as { status: number }).status, 413);
	const huge: Fixture = {
		things: { 'post-1': thing('post-1', ['post']) },
		children: {},
		bound: [attachment('att-big', 'post-1', 'big.bin'), attachment('att-more', 'post-1', 'more.bin')],
		sizes: { 'att-big': 2 * 1024 * 1024 * 1024 - 1, 'att-more': 2 }
	};
	const tooLarge = await service(huge).plan(viewer, 'post-1');
	assert.equal(tooLarge.ok, false);
	assert.equal((tooLarge as { status: number }).status, 413);
});

test('a folder that only reaches unreadable files reports that nothing is downloadable for this viewer', async () => {
	const fixture: Fixture = {
		things: { 'folder-1': thing('folder-1', ['folder'], { name: 'Mine' }) },
		children: { 'folder-1': [thing('post-a', ['post'])] },
		bound: [attachment('att-a', 'post-a', 'a.png')],
		unreadable: new Set(['att-a'])
	};
	const result = await service(fixture).plan(viewer, 'folder-1');
	// one message for empty AND fully-withheld roots: the difference is what a stranger must not learn
	assert.deepEqual(result, { ok: false, status: 404, error: 'There are no files to download here' });
});

test('probes authorize without presigning, the skipped count is owner-only, and a probe plan cannot be streamed', async () => {
	const fixture: Fixture = {
		things: { 'post-1': thing('post-1', ['post'], { text: 'Gallery' }) },
		children: {},
		bound: [attachment('att-1', 'post-1', 'a.png'), attachment('att-2', 'post-1', 'b.png'), attachment('att-3', 'post-1', 'c.png')],
		unreadable: new Set(['att-3'])
	};
	const { plan, manifest, stream, calls } = service(fixture);
	const probe = await plan(viewer, 'post-1', { presign: false });
	assert.equal(probe.ok, true);
	if (probe.ok !== true) return;
	assert.deepEqual(calls.download, [], 'a probe never mints signed URLs');
	assert.deepEqual(calls.inspect.map((call) => call.id), ['att-1', 'att-2', 'att-3']);
	assert.deepEqual(probe.entries.map((entry) => entry.url), ['', '']);
	assert.equal(probe.ownerId, owner);
	assert.equal(probe.skipped, 1);
	assert.equal(manifest(probe).skipped, 0, 'strangers never learn how many files were withheld');
	assert.equal(manifest(probe, { revealSkipped: true }).skipped, 1);
	assert.throws(() => stream(probe), /without signed URLs/);
	const real = await plan(viewer, 'post-1');
	assert.equal(real.ok, true);
	if (real.ok === true) assert.deepEqual(real.entries.map((entry) => entry.url), ['https://bucket.test/att-1', 'https://bucket.test/att-2']);
});

test('linked media follows the projection moderation rule: blocked hidden for everyone, pending only for its owner', async () => {
	const fixture: Fixture = {
		things: { 'post-1': thing('post-1', ['post'], { text: 'Links' }) },
		children: {},
		bound: [
			attachment('link-ok', 'post-1', 'ok.png', { attachmentLinked: true, crystal: { name: 'ok.png', url: 'https://cdn.example/ok.png' } }),
			attachment('link-blocked', 'post-1', 'blocked.png', { attachmentLinked: true, moderation: { status: 'blocked' }, crystal: { name: 'blocked.png', url: 'https://cdn.example/blocked.png' } }),
			attachment('link-pending', 'post-1', 'pending.png', { attachmentLinked: true, moderation: { status: 'pending' }, crystal: { name: 'pending.png', url: 'https://cdn.example/pending.png' } })
		]
	};
	const { plan } = service(fixture);
	const stranger = await plan(viewer, 'post-1');
	assert.equal(stranger.ok, true);
	if (stranger.ok === true) {
		assert.deepEqual(stranger.links.map((link) => link.url), ['https://cdn.example/ok.png']);
		assert.equal(stranger.skipped, 2);
	}
	const asOwner = await plan({ id: owner }, 'post-1');
	assert.equal(asOwner.ok, true);
	if (asOwner.ok === true) {
		assert.deepEqual(asOwner.links.map((link) => link.url), ['https://cdn.example/ok.png', 'https://cdn.example/pending.png']);
		assert.equal(asOwner.skipped, 1);
	}
});

test('the traversal budget counts only Things the viewer may see; scanning and bound rows have their own explicit bounds', async () => {
	const privateChildren = Array.from({ length: ARCHIVE_MAX_THINGS + 5 }, (_, index) => thing(`private-${index}`, ['post']));
	const visible = thing('post-ok', ['post']);
	const fixture: Fixture = {
		things: { 'folder-1': thing('folder-1', ['folder'], { name: 'Mixed' }) },
		children: { 'folder-1': [...privateChildren, visible] },
		bound: [attachment('att-ok', 'post-ok', 'ok.png')],
		hidden: new Set(privateChildren.map((child) => child.shareId))
	};
	// > ARCHIVE_MAX_THINGS private siblings do not trip 413 for the one visible post
	const result = await service(fixture).plan(viewer, 'folder-1');
	assert.equal(result.ok, true);
	if (result.ok === true) assert.deepEqual(result.entries.map((entry) => entry.name), ['ok.png']);

	const scanned = await service({ ...fixture, children: { 'folder-1': Array.from({ length: ARCHIVE_MAX_SCANNED_THINGS + 1 }, (_, index) => thing(`p-${index}`, ['post'])) }, hidden: undefined }).plan(viewer, 'folder-1');
	assert.equal(scanned.ok, false);
	assert.equal((scanned as { status: number }).status, 413);

	const rows = Array.from({ length: ARCHIVE_MAX_BOUND_ROWS + 1 }, (_, index) => attachment(`row-${index}`, 'post-1', `${index}.png`, { attachmentLinked: true, crystal: { name: `${index}.png`, url: `https://cdn.example/${index}.png` } }));
	const overCap = await service({ things: { 'post-1': thing('post-1', ['post']) }, children: {}, bound: rows }).plan(viewer, 'post-1');
	assert.deepEqual(overCap, { ok: false, status: 413, error: 'These files are too large to download as one ZIP — download the folders inside separately' });
});

test('a media root readable only through a page composition resolves with sharedRoot exactly as the content endpoint does', async () => {
	const media = thing('media-1', ['attachment'], { name: 'hero.png' });
	const fixture: Fixture = {
		things: { 'media-1': media },
		children: {},
		bound: [attachment('media-1', 'private-post', 'hero.png')],
		hidden: new Set(['media-1']),
		sharedVisible: new Set(['media-1@page-1'])
	};
	const { plan, calls } = service(fixture);
	assert.equal((await plan(null, 'media-1')).ok, false, 'not readable on its own');
	assert.equal((await plan(null, 'media-1', { sharedRoot: 'other-page' })).ok, false, 'the root grants nothing for another page');
	const shared = await plan(null, 'media-1', { sharedRoot: 'page-1' });
	assert.equal(shared.ok, true);
	if (shared.ok === true) assert.deepEqual(shared.entries.map((entry) => entry.path), ['hero.png']);
	assert.deepEqual(calls.download.at(-1)?.viewer, { id: '', sharedRoot: 'page-1' });
	assert.ok(Object.keys(ARCHIVE_SHARED_ROOT_PROJECTION).includes('thingtime'));
});

test('planning past the request deadline fails with 504 instead of running into the platform limit', async () => {
	let clock = 1_000;
	const fixture: Fixture = {
		things: { 'folder-1': thing('folder-1', ['folder'], { name: 'Slow' }) },
		children: { 'folder-1': [thing('post-a', ['post']), thing('post-b', ['post'])] },
		bound: [attachment('att-a', 'post-a', 'a.png'), attachment('att-b', 'post-b', 'b.png')]
	};
	const slow = service(fixture, {
		canView: async () => {
			clock += 3_000;
			return true;
		},
		now: () => clock
	});
	const result = await slow.plan(viewer, 'folder-1', { deadlineAt: 4_000 });
	assert.deepEqual(result, { ok: false, status: 504, error: 'Preparing this download took too long — try a smaller folder' });
});

// A projection naming both `crystal` and `crystal.<field>` makes Mongo reject
// the whole query with "Path collision" (a live 500 caught in browser checks).
test('archive projections never name a field and one of its own sub-paths', () => {
	for (const projection of [ARCHIVE_ATTACHMENT_PROJECTION, ARCHIVE_CHILD_PROJECTION]) {
		const keys = Object.keys(projection);
		for (const key of keys) {
			assert.equal(keys.some((other) => other !== key && other.startsWith(`${key}.`)), false, key);
		}
	}
	assert.ok('crystal' in ARCHIVE_CHILD_PROJECTION && 'subspacePrivate' in ARCHIVE_CHILD_PROJECTION && 'moderation' in ARCHIVE_CHILD_PROJECTION);
});
