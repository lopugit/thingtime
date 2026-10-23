import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';
import { LocalThings } from './things';
import { LocalThemes } from './themes';
import { LocalTimeline } from './timeline';
import { LocalTimelineVersions } from './timelineVersions';
import { AccountTimelineVersions } from './accountTimelineVersions';
import { AccountThemeSync } from './accountThemes';
import { AccountThingSync } from './accountSync';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { themeVersionWriter } from './themeVersions';
import { themeContentSnapshot, themeContentValue } from '../timeline/themeContent';
import { parsePublishedVersionPreview, type VersionRequest } from '../timeline/publishedVersion';

async function fixture(account = false) {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory),
		backend = new IndexedDbTimelineBackend(factory);
	let active = true;
	const lease: WorkspaceLease = {
		assertCurrent: () => {
			if (!active) throw Error('Retired workspace');
		},
		onInvalidate: () => () => {}
	};
	const scope: WorkspaceScope = account
		? { kind: 'account', ownerId: 'theme-owner', origin: 'https://theme.test', dataPlane: 'home' }
		: { kind: 'anonymous' };
	const themes = scope.kind === 'account' ? new AccountThemeSync(db, scope, lease) : new LocalThemes(db, lease);
	const things =
		scope.kind === 'account'
			? new AccountThingSync(db, scope, lease, undefined, undefined, undefined, themes as AccountThemeSync).things
			: new LocalThings(db, scope, lease);
	const history = scope.kind === 'account' ? new AccountTimeline(db, scope, lease) : new LocalTimeline(db, lease, 'https://theme.test');
	const writer = themeVersionWriter(
		themes instanceof AccountThemeSync ? themes.themes : themes,
		themes instanceof AccountThemeSync ? themes : undefined
	);
	const versions =
		scope.kind === 'account'
			? new AccountTimelineVersions(
					db,
					scope,
					lease,
					things,
					new AccountTimelineStore(accountTimelineScope(scope), backend, history as AccountTimeline),
					[writer]
			  )
			: new LocalTimelineVersions(db, lease, things, undefined, [writer]);
	const saved = (await themes.save({ name: 'Peach', theme: { colors: { accent: '#b86f50', ink: '#451e10' } } })).theme;
	const rows = async () =>
		history instanceof AccountTimeline
			? history.rows({ thingId: saved.id })
			: (await history.page({ thingId: saved.id, before: null, after: null, limit: 40 })).entries;
	const head = async () => (await db.transaction(scope, 'readonly', lease, (tx) => tx.get<string>('timeline-meta', `head:${saved.id}`)))!;
	const current = () => db.transaction(scope, 'readonly', lease, (tx) => tx.get<any>('things', saved.id));
	const preview = async (eventId: string, mode: VersionRequest['mode'] = 'restore', choices = {}) => {
		const query: VersionRequest = { command: 'preview-version', eventId, mode, choices, componentMode: 'recorded', componentChoices: {} };
		const response = await versions.request(query);
		assert.ok('preview' in response);
		const checked = parsePublishedVersionPreview(response.preview, eventId, saved.id, query);
		return {
			preview: checked,
			apply: {
				...query,
				command: 'apply-version',
				operationId: randomUUID(),
				expectedHeadId: checked.expectedHeadId,
				expectedComponents: checked.components!.fingerprint
			} as VersionRequest
		};
	};
	return {
		db,
		scope,
		lease,
		themes,
		things,
		history,
		versions,
		saved,
		writer,
		rows,
		head,
		current,
		preview,
		base: await head(),
		retire: () => {
			active = false;
		},
		close: async () => {
			await db.close();
			await backend.close();
		}
	};
}

for (const account of [false, true])
	test(`${account ? 'account' : 'anonymous'} theme restore preserves current organization/sharing and replays one exact operation`, async () => {
		const f = await fixture(account);
		try {
			await f.themes.save({
				id: f.saved.id,
				name: 'Terracotta',
				theme: { colors: { accent: '#c08060' } },
				...(account ? { visibility: 'public' } : {})
			});
			const folder = await f.things.create({ thingtime: ['folder'], crystal: { name: 'Looks' } });
			await f.things.move([f.saved.id], folder.id);
			await f.things.renameLibrary({ id: f.saved.id, displayTitle: 'Keep library title' });
			const { preview, apply } = await f.preview(f.base);
			assert.equal(themeContentValue(preview.result).visibility, account ? 'public' : 'private');
			assert.equal(themeContentValue(preview.result).folderId, folder.id);
			assert.equal(themeContentValue(preview.result).crystal.title, 'Keep library title');
			const results = await Promise.all([f.versions.request(apply), f.versions.request(apply)]);
			assert.deepEqual(results[0], results[1]);
			const row = await f.current();
			assert.equal(row.crystal.name, 'Peach');
			assert.equal(row.crystal.title, 'Keep library title');
			assert.equal(row.folderId, folder.id);
			assert.equal((await f.rows()).filter((row) => row.event.id === `version-${apply.operationId}`).length, 1);
			if (account) {
				assert.equal((results[0] as any).entry.receipt, null);
				assert.equal((results[0] as any).entry.event.mode, 'draft');
			}
			await f.themes.save({ id: f.saved.id, name: 'Later', theme: {} });
			assert.deepEqual(await f.versions.request(apply), results[0]);
			assert.equal((await f.current()).crystal.name, 'Later');
			await assert.rejects(f.versions.request({ ...apply, mode: 'merge' }), /already used/);
		} finally {
			await f.close();
		}
	});

for (const account of [false, true])
	test(`${account ? 'account' : 'anonymous'} theme undo reviews overlapping edits and retains independent tokens`, async () => {
		const f = await fixture(account);
		try {
			await f.themes.save({ id: f.saved.id, name: 'Peach', theme: { colors: { accent: '#a06040', ink: '#451e10' } } });
			const edit = await f.head();
			await f.themes.save({ id: f.saved.id, name: 'Peach', theme: { colors: { accent: '#e09070', ink: '#241008' } } });
			const conflicted = await f.preview(edit, 'undo');
			assert.deepEqual(
				conflicted.preview.conflicts.map((conflict) => conflict.path),
				[['crystal', 'theme', 'colors', 'accent']]
			);
			await assert.rejects(f.versions.request(conflicted.apply), /overlapping/);
			const reviewed = await f.preview(edit, 'undo', { '["crystal","theme","colors","accent"]': 'incoming' });
			await f.versions.request(reviewed.apply);
			assert.deepEqual((await f.current()).crystal.theme.colors, { ...(f.saved.theme as any).colors, accent: '#b86f50', ink: '#241008' });
			await assert.rejects(f.preview(edit, 'undo'), /already reverted/);
		} finally {
			await f.close();
		}
	});

test('theme merge shares the common-ancestor planner and retains both parents', async () => {
	const f = await fixture();
	try {
		const base = (await f.rows())[0].event;
		const branch = `theme-branch-${randomUUID()}`;
		await (f.history as LocalTimeline).push({
			...base,
			id: branch,
			operationId: randomUUID(),
			branchId: 'side',
			mode: 'draft',
			operation: 'update',
			parentIds: [f.base],
			before: base.after,
			after: themeContentSnapshot({ ...themeContentValue(base.after!), crystal: { name: 'Branch name', theme: f.saved.theme as any } })
		});
		await f.themes.save({ id: f.saved.id, name: 'Peach', theme: { colors: { accent: '#b86f50', ink: '#241008' } } });
		const compared = await f.preview(branch, 'merge');
		await f.versions.request(compared.apply);
		assert.equal((await f.current()).crystal.name, 'Branch name');
		assert.equal((await f.current()).crystal.theme.colors.ink, '#241008');
		assert.deepEqual((await f.rows()).find((row) => row.event.id === `version-${compared.apply.operationId}`)!.event.parentIds, [
			compared.apply.expectedHeadId,
			branch
		]);
	} finally {
		await f.close();
	}
});

test('theme previews fence concurrent changes, deletion and identity retirement', async () => {
	const f = await fixture(true);
	try {
		await f.themes.save({ id: f.saved.id, name: 'Edited', theme: {} });
		const compared = await f.preview(f.base);
		await f.themes.save({ id: f.saved.id, name: 'Newer', theme: {} });
		await assert.rejects(f.versions.request(compared.apply), /changed/);
		await f.themes.remove(f.saved.id);
		await assert.rejects(
			f.versions.request({ command: 'preview-version', mode: 'restore', eventId: f.base, recover: true }),
			/own editor|recorded deletion|recovery/i
		);
		f.retire();
		await assert.rejects(f.versions.request(compared.apply), /Retired workspace/);
	} finally {
		await f.close();
	}
});

test('failed account theme History commit rolls back design, queue and Timeline', async () => {
	const f = await fixture(true);
	try {
		await f.themes.save({ id: f.saved.id, name: 'Current', theme: {} });
		const compared = await f.preview(f.base),
			before = await f.current(),
			history = await f.rows(),
			status = await (f.themes as AccountThemeSync).status();
		const transaction = f.db.transaction.bind(f.db);
		f.db.transaction = ((scope, mode, lease, run) =>
			transaction(scope, mode, lease, (tx) =>
				run({
					...tx,
					put: async (collection, id, value) => {
						if (collection === 'timeline-events') throw Error('History quota failed');
						await tx.put(collection, id, value);
					}
				})
			)) as typeof f.db.transaction;
		await assert.rejects(f.versions.request(compared.apply), /History quota/);
		assert.deepEqual(await f.current(), before);
		assert.deepEqual(await f.rows(), history);
		assert.deepEqual(await (f.themes as AccountThemeSync).status(), status);
		f.db.transaction = transaction;
		await f.versions.request(compared.apply);
		assert.equal((await f.current()).crystal.name, 'Peach');
	} finally {
		await f.close();
	}
});

test('theme History cannot authorize generic protected writes or malformed snapshots', async () => {
	const f = await fixture();
	try {
		await assert.rejects(f.things.update({ id: f.saved.id, crystal: { name: 'Forbidden' } }), /protected|dedicated|kind/i);
		await assert.rejects(
			new LocalTimelineVersions(f.db, f.lease, f.things).request({ command: 'preview-version', mode: 'restore', eventId: f.base }),
			/not available/
		);
		const adapter = f.writer.content(await f.current());
		const forged: any = structuredClone(adapter.current);
		forged.value.crystal.secret = 'not allowed';
		assert.throws(() => adapter.read(forged), /Invalid theme/);
		assert.equal(f.writer.matches({ thingtime: ['theme', 'user'] } as any), false);
	} finally {
		await f.close();
	}
});

test('theme preview refuses unseen content refresh even when its recorded head is unchanged', async () => {
 const f = await fixture();
 try {
  await f.themes.save({ id: f.saved.id, name: 'Before refresh', theme: {} });
  const compared = await f.preview(f.base);
  // A retained catalogue refresh does not author a new device History event.
  // Simulate that read hydration without changing the recorded edit head.
  await f.db.transaction(f.scope, 'readwrite', f.lease, async tx => {
   const row = await tx.get<any>('things', f.saved.id);
   await tx.put('things', row.id, { ...row, crystal: { ...row.crystal, name: 'Refreshed' }, updatedAt: new Date(Date.parse(row.updatedAt) + 1).toISOString() });
  });
  assert.equal(await f.head(), compared.apply.expectedHeadId);
  await assert.rejects(f.versions.request(compared.apply), /changed after the preview/);
  assert.equal((await f.current()).crystal.name, 'Refreshed');
 } finally { await f.close(); }
});

test('a concurrent committed theme retry wins over an intermediate stale planning read', async () => {
 const f = await fixture();
 try {
  await f.themes.save({ id: f.saved.id, name: 'Edited', theme: {} });
  const compared = await f.preview(f.base), transaction = f.db.transaction.bind(f.db);
  let reads = 0, winner: unknown;
  f.db.transaction = (async (scope, mode, lease, run) => {
   if (mode === 'readonly' && ++reads === 2) winner = await f.versions.request(compared.apply);
   return transaction(scope, mode, lease, run);
  }) as typeof f.db.transaction;
  const result = await f.versions.request(compared.apply);
  assert.deepEqual(result, winner);
  assert.equal((await f.rows()).filter(row => row.event.id === `version-${compared.apply.operationId}`).length, 1);
 } finally { await f.close(); }
});
