import assert from 'node:assert/strict';
import test from 'node:test';
import { createDraftSession } from './draftSession';
import { draftConflict, validateDraftContent, type AccountDraft, type DraftContent } from './draftCore';
const content = (text: string): DraftContent => ({
	name: text,
	context: 'post:new:',
	surface: 'post',
	snapshot: JSON.stringify({ text }),
	attachmentIds: []
});
const saved = (input: any): AccountDraft => ({
	...input.content,
	id: input.id,
	revision: input.revision + 1,
	mode: 'draft',
	createdAt: '',
	updatedAt: ''
});
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { resolve, promise };
};
function setup(save: (input: any) => Promise<AccountDraft>) {
	let n = 0;
	const local: any[] = [];
	const session = createDraftSession({ uuid: () => `id-${++n}`, save, persist: (value) => local.push(structuredClone(value)), changed: () => {} });
	return { session, local };
}
test('captures the final keystroke synchronously, serializes writes, and drains the newest edit', async () => {
	const first = deferred(),
		calls: any[] = [];
	const { session, local } = setup(async (input) => {
		calls.push(input);
		if (calls.length === 1) await first.promise;
		return saved(input);
	});
	session.capture(content('first'));
	assert.equal(local.at(-1).content.name, 'first');
	const flush = session.flush();
	await Promise.resolve();
	await Promise.resolve();
	session.capture(content('second'));
	session.capture(content('newest'));
	first.resolve();
	await flush;
	assert.deepEqual(
		calls.map((c) => [c.content.name, c.revision]),
		[
			['first', 0],
			['newest', 1]
		]
	);
	assert.equal(session.current()?.content.name, 'newest');
	session.dispose();
});
test('lost-response retry replays the identical write before sending newer content', async () => {
	const calls: any[] = [];
	let lost = true;
	const { session } = setup(async (input) => {
		calls.push(structuredClone(input));
		if (lost) {
			lost = false;
			throw new Error('response lost');
		}
		return saved(input);
	});
	session.capture(content('old'));
	await assert.rejects(session.flush());
	session.capture(content('new'));
	await session.flush();
	assert.deepEqual(calls[0], calls[1]);
	assert.equal(calls[2].revision, 1);
	assert.equal(calls[2].content.name, 'new');
	session.dispose();
});
test('reload retains uncertain operation identity and latest text', async () => {
	const { session } = setup(async () => {
		throw new Error('offline');
	});
	session.capture(content('kept'));
	await assert.rejects(session.flush());
	const seed = structuredClone(session.current());
	const calls: any[] = [];
	const recovered = createDraftSession({
		seed,
		uuid: () => 'recovery-write',
		save: async (input) => {
			calls.push(input);
			return saved(input);
		},
		persist: () => {},
		changed: () => {}
	});
	await recovered.retry();
	assert.equal(calls[0].writeId, seed?.pending?.writeId);
	assert.equal(recovered.current()?.content.name, 'kept');
	recovered.dispose();
	session.suspend();
	session.dispose();
});
test('typing the next post during cleanup gets a fresh draft identity', async () => {
	const remove = deferred();
	const { session } = setup(async (input) => saved(input));
	session.capture(content('publish'));
	await session.flush();
	const clearing = session.clear(async () => {
		await remove.promise;
	});
	const previousId = session.current()!.id;
	session.capture(content('next post'));
	remove.resolve();
	await clearing;
	assert.notEqual(session.current()!.id, previousId);
	await session.flush();
	assert.equal(session.current()?.revision, 1);
	session.dispose();
});
test('loading a stale snapshot of the current draft retains newer edits', async () => {
	const { session } = setup(async (input) => saved(input));
	session.capture(content('old'));
	await session.flush();
	const stale = {
		...session.current()!.content,
		id: session.current()!.id,
		revision: 1,
		mode: 'draft',
		createdAt: '',
		updatedAt: ''
	} as AccountDraft;
	session.capture(content('new'));
	await session.load(stale);
	assert.equal(session.current()?.content.name, 'new');
	session.dispose();
});
test('conflict recovery makes a new identity without overwriting the other device', async () => {
	const { session } = setup(async (input) => saved(input));
	session.capture(content('private'));
	await session.flush();
	const id = session.current()!.id;
	await session.saveCopy();
	assert.notEqual(session.current()!.id, id);
	assert.equal(session.current()!.revision, 1);
	session.dispose();
});
test('draft validation bounds JSON, unsafe fields, files and compare-and-swap revisions', () => {
	assert.deepEqual(validateDraftContent(content('unfinished')), content('unfinished'));
	assert.throws(() => validateDraftContent({ ...content('x'), snapshot: '{"__proto__":{}}' }));
	assert.throws(() => validateDraftContent({ ...content('x'), snapshot: '[' }));
	assert.throws(() => validateDraftContent({ ...content('x'), attachmentIds: ['file', 'file'] }));
	assert.throws(() => validateDraftContent(content('x'.repeat(512 * 1024))));
	assert.equal(draftConflict(2, 1, 'write2', 'write1'), 'conflict');
	assert.equal(draftConflict(2, 1, 'write2', 'write2'), 'retry');
	assert.equal(draftConflict(2, 2, 'write2', 'write3'), 'write');
});

test('conflict copy remaps files and retains edits typed while copying', async () => {
	const wait = deferred(),
		calls: any[] = [],
		restored: any[] = [];
	let n = 0;
	const withFile = (text: string) => ({
		...content(text),
		attachmentIds: ['original'],
		snapshot: JSON.stringify({ text, attachments: [{ id: 'original' }] })
	});
	const session = createDraftSession({
		uuid: () => `copy-${++n}`,
		persist: () => {},
		changed: () => {},
		save: async (input) => {
			calls.push(structuredClone(input));
			return saved(input);
		},
		copy: async (input) => {
			await wait.promise;
			return { ...saved({ ...input, revision: 0 }), attachmentIds: ['independent'] };
		},
		recovered: (value) => restored.push(structuredClone(value))
	});
	session.capture(withFile('first'));
	await session.flush();
	const operation = session.saveCopy();
	await Promise.resolve();
	await Promise.resolve();
	session.capture(withFile('typed during copy'));
	wait.resolve();
	await operation;
	assert.equal(session.current()?.content.name, 'typed during copy');
	assert.deepEqual(calls.at(-1).content.attachmentIds, ['independent']);
	assert.equal(JSON.parse(calls.at(-1).content.snapshot).attachments[0].id, 'independent');
	assert.equal(restored.at(-1).content.name, 'typed during copy');
	session.capture(withFile('late editor callback'));
	await session.flush();
	assert.deepEqual(calls.at(-1).content.attachmentIds, ['independent']);
	session.dispose();
});

test('retiring a posted draft never waits for a hung save and isolates the next post', async () => {
	const blocked = deferred();
	const calls: any[] = [], removed: any[] = [], retired: any[] = [];
	const { session, local } = setup(async input => {
		calls.push(input);
		if (calls.length === 1) await blocked.promise;
		return saved(input);
	});
	session.capture(content('posted'));
	const saving = session.flush();
	await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
	const firstId = session.current()!.id;
	const cleanup = session.retire(async (id, revision) => { removed.push({ id, revision }); }, value => retired.push(structuredClone(value)));
	assert.equal(session.current(), null);
	assert.equal(local.at(-1), null);
	assert.equal(retired[0].id, firstId);
	session.capture(content('next post'));
	await session.flush();
	const next = structuredClone(session.current());
	assert.notEqual(next!.id, firstId);
	assert.equal(next!.revision, 1);
	blocked.resolve();
	await saving; await cleanup;
	assert.deepEqual(session.current(), next);
	assert.deepEqual(local.at(-1), next);
	assert.deepEqual(removed, [{ id: firstId, revision: 1 }]);
	session.dispose();
});

test('failed draft saving and failed cleanup do not prevent local retirement or new editing', async () => {
	let failSave = true;
	const { session, local } = setup(async input => {
		if (failSave) throw new Error('draft service unavailable');
		return saved(input);
	});
	session.capture(content('post succeeded while draft saving failed'));
	await assert.rejects(session.flush());
	await session.retire(async () => { throw new Error('should not delete an unconfirmed revision'); }, () => {});
	assert.equal(session.current(), null);
	assert.equal(local.at(-1), null);
	failSave = false;
	session.capture(content('second post'));
	await session.flush();
	const cleanup = session.retire(async () => { throw new Error('cleanup unavailable'); }, () => {});
	assert.equal(session.current(), null);
	session.capture(content('third post'));
	await assert.rejects(cleanup, /cleanup unavailable/);
	await session.flush();
	assert.equal(session.current()!.content.name, 'third post');
	session.dispose();
});

test('retirement cancels an unsent draft rather than saving it before cleanup', async () => {
	let saves = 0, removals = 0;
	const { session } = setup(async input => { saves++; return saved(input); });
	session.capture(content('already posted'));
	await session.retire(async () => { removals++; }, () => {});
	assert.equal(saves, 0);
	assert.equal(removals, 0);
	assert.equal(session.current(), null);
	session.dispose();
});
