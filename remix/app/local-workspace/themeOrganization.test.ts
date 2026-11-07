import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalThemes } from './themes';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
test('anonymous library folder deletion preserves selected themes and direct or recursive deletion clears selection', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		things = new LocalThings(db, { kind: 'anonymous' }, lease),
		themes = new LocalThemes(db, lease);
	try {
		const parent = await things.create({ thingtime: ['folder'], crystal: { name: 'Parent' } }),
			child = await things.create({ thingtime: ['folder'], crystal: { name: 'Child' }, folderId: parent.id });
		const { theme } = await themes.save({ name: 'Peach', theme: { colors: { accent: '#bf8068' } } });
		await themes.setActive(theme.id);
		await things.move([theme.id], child.id);
		await things.remove([child.id]);
		assert.equal((await things.get(theme.id)).folderId, parent.id);
		assert.equal((await themes.list()).activeThemeId, theme.id);
		await things.remove([parent.id]);
		assert.equal((await things.get(theme.id)).folderId, null);
		assert.equal((await themes.list()).activeThemeId, theme.id);
		await things.remove([theme.id]);
		assert.equal((await themes.list()).activeThemeId, null);
		assert.deepEqual((await themes.list()).themes, []);
		const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Recursive' } }),
			copy = await themes.save({ name: 'Another', theme: {} });
		await themes.setActive(copy.theme.id);
		await things.move([copy.theme.id], folder.id);
		await things.remove([folder.id], true);
		assert.equal((await themes.list()).activeThemeId, null);
		assert.deepEqual((await themes.list()).themes, []);
	} finally {
		await db.close();
	}
});
