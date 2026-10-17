import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalThemes } from './themes';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { normalizeSavedTheme, MAX_SAVED_THEMES } from '../theme/savedTheme';
import { validateTransfer } from '../utils/thingTransfer/format';

const fixture = () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
	return { db, themes: new LocalThemes(db, lease), things: new LocalThings(db, { kind: 'anonymous' }, lease) };
};
test('saved local themes reuse canonical sanitization, update with conflicts and round-trip privately', async () => {
	const { db, themes, things } = fixture();
	try {
		const input = { name: '  Peach  ', theme: { colors: { accent: '#cc8866', pageBg: 'url(https://bad.example)' }, fonts: { body: 'bad; color:red' }, arbitrary: 'drop' } };
		const saved = (await themes.save(input)).theme;
		const expected = normalizeSavedTheme(input); assert.ok(expected.ok);
		assert.deepEqual(saved.theme, expected.theme); assert.equal(saved.name, 'Peach');
		assert.equal(saved.visibility, 'private'); assert.equal(saved.localOnly, true);
		await themes.setActive(saved.id);
		const update = (await themes.save({ ...input, id: saved.id, name: 'Apricot', expectedUpdatedAt: saved.updatedAt })).theme;
		assert.notEqual(update.updatedAt, saved.updatedAt);
		await assert.rejects(themes.save({ ...input, id: saved.id, expectedUpdatedAt: saved.updatedAt }), /changed in another editor/);
		await assert.rejects(things.update({ id: saved.id, crystal: { name: 'Bypass' } }), /dedicated/);
		const bundle = await things.export([saved.id]); validateTransfer(bundle.manifest);
		assert.equal(JSON.stringify(bundle.manifest).includes('visibility'), false);
		const imported = await things.import(bundle.manifest);
		assert.notEqual(imported.roots[0], saved.id);
		assert.deepEqual((await themes.get(imported.roots[0])).theme.theme, update.theme);
		assert.equal((await themes.list()).activeThemeId, saved.id, 'import does not change the active selection');
		await themes.remove(saved.id);
		assert.equal((await themes.list()).activeThemeId, null);
		assert.equal((await themes.list()).themes.length, 1);
	} finally { await db.close(); }
});

test('publication, wrong kinds and malformed theme imports cannot mutate local records', async () => {
	const { db, themes, things } = fixture();
	try {
		await assert.rejects(themes.save({ name: 'Public', theme: {}, visibility: 'public' }), /stay on this device/);
		await assert.rejects(themes.save({ name: 'Missing' }), /tokens are required/);
		const data = await things.create({ thingtime: ['data'], crystal: {} });
		await assert.rejects(themes.save({ id: data.id, name: 'Wrong kind', theme: {} }), /not in this workspace/);
		await assert.rejects(themes.setActive(data.id), /not in this workspace/);
		const manifest = { format: 'thingtime.transfer', version: 1, roots: ['theme'], files: [], things: [{ id: 'theme', thingtime: ['theme'], crystal: { name: 'Injected', theme: {}, ownerId: 'other' } }] };
		await assert.rejects(things.import(manifest), /only a name/);
		assert.equal((await themes.list()).themes.length, 0);
	} finally { await db.close(); }
});

test('theme quota covers bulk imports atomically and deletion releases capacity', async () => {
	const { db, themes, things } = fixture();
	const docs = Array.from({ length: MAX_SAVED_THEMES + 1 }, (_, i) => ({ id: `theme-${i}`, thingtime: ['theme'], crystal: { name: `Theme ${i}`, theme: {} } }));
	const manifest = (rows: typeof docs) => ({ format: 'thingtime.transfer', version: 1, roots: rows.map(row => row.id), files: [], things: rows });
	try {
		await assert.rejects(things.import(manifest(docs)), /saved-theme limit/);
		assert.equal((await themes.list()).themes.length, 0);
		const imported = await things.import(manifest(docs.slice(1)));
		await assert.rejects(themes.save({ name: 'Too many', theme: {} }), /saved-theme limit/);
		await themes.remove(imported.roots[0]); await themes.save({ name: 'Room again', theme: {} });
		assert.equal((await themes.list()).themes.length, MAX_SAVED_THEMES);
	} finally { await db.close(); }
});
