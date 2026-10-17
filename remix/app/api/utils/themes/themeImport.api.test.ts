import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_THEME_IMPORT_API_URL,
	artifacts = process.env.TT_THEME_IMPORT_API_ARTIFACTS,
	playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test(
	'theme saves commit home placement with content and immutable receipts, refusing invalid folders atomically',
	{ skip: !base || !artifacts || !playwrightPath, timeout: 120_000 },
	async () => {
		const origin = new URL(base!).origin;
		assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
		const { request } = await import(playwrightPath!),
			owner = await request.newContext({ baseURL: origin }),
			other = await request.newContext({ baseURL: origin }),
			guest = await request.newContext({ baseURL: origin });
		const headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' },
			themes = new Set<string>(),
			folders: string[] = [],
			foreignFolders: string[] = [],
			checks: string[] = [];
		let ownerId = '',
			completed = false;
		const read = async (response: any, label: string, status = 200) => {
			assert.equal(response.status(), status, label);
			checks.push(label);
			return response.json();
		};
		const command = (fields: any = {}) => ({
			action: 'save',
			id: randomUUID(),
			writeId: randomUUID(),
			expectedVersion: null,
			name: 'Imported private peach',
			theme: { colors: { accent: '#bf8068' } },
			visibility: 'private',
			...fields
		});
		const write = (value: any, extra = {}) =>
			owner.post('/api/v1/themes/sync', {
				headers: { ...headers, ...extra },
				data: { operation: 'write', expectedOwnerId: ownerId, command: value }
			});
		const snapshot = async () => {
			const result = await read(
				await owner.post('/api/v1/themes/sync', { headers, data: { operation: 'snapshot', expectedOwnerId: ownerId } }),
				'scoped snapshot'
			);
			return result.themes;
		};
		try {
			const health = await read(await owner.get('/api/v1/mongodb/status'), 'isolated fixture');
			assert.equal(health.host, '127.0.0.1:22463');
			assert.equal(health.replicaSet, 'draftPreview');
			assert.equal(health.custom, false);
			const capabilities = await read(await owner.get('/api/v1/capabilities'), 'placement contract active');
			assert.equal(capabilities.features['api.themes-sync'], '1.5.0');
			for (const context of [owner, other]) {
				const username = 'themeimport-' + randomUUID().slice(0, 8);
				const result = await read(
					await context.post('/api/v1/auth/register', {
						headers,
						data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() }
					}),
					'register disposable owner'
				);
				if (context === owner) ownerId = result.user.id;
			}
			for (const [context, ids] of [
				[owner, folders],
				[other, foreignFolders]
			] as const) {
				const result = await read(
					await context.post('/api/v1/things', {
						headers,
						data: { thingtime: ['folder'], crystal: { name: 'Theme import placement' }, visibility: 'private' }
					}),
					'create owned fixture folder'
				);
				ids.push(result.thing.id);
			}
			const create = command({ folderId: folders[0], title: 'Imported library title' });
			themes.add(create.id);
			const receipt = (await read(await write(create), 'create tokens and folder atomically')).acknowledgment;
			let theme = (await snapshot()).find((row: any) => row.id === create.id);
			assert.equal(theme.folderId, folders[0]);
			assert.equal(theme.title, 'Imported library title');
			assert.equal(theme.version, receipt.resultVersion);
			assert.deepEqual((await read(await write(create), 'exact placed create replay')).acknowledgment, receipt);
			await read(await write({ ...create, folderId: null }), 'same write ID cannot change placement', 409);
			const update = command({ id: create.id, expectedVersion: theme.version, name: 'Later tokens' });
			await read(await write(update), 'omitted placement preserves existing folder');
			theme = (await snapshot()).find((row: any) => row.id === create.id);
			assert.equal(theme.folderId, folders[0]);
			assert.equal(theme.title, 'Imported library title');
			assert.equal(theme.name, 'Later tokens');
			const before = theme;
			for (const folderId of [randomUUID(), foreignFolders[0]]) {
				const denied = command({ folderId });
				themes.add(denied.id);
				await read(await write(denied), 'missing or foreign folder refuses creation', 409);
				assert.equal(
					(await snapshot()).some((row: any) => row.id === denied.id),
					false
				);
				await read(
					await write(command({ id: create.id, expectedVersion: before.version, folderId, name: 'Must roll back' })),
					'invalid placement refuses token update',
					409
				);
				assert.deepEqual(
					(await snapshot()).find((row: any) => row.id === create.id),
					before
				);
			}
			const custom = { 'x-tt-mongo-url': 'mongodb://127.0.0.1:22463/theme_import_' + randomUUID().replace(/-/g, '') + '?replicaSet=draftPreview' };
			const root = await read(await owner.get('/api/root-data', { headers: { ...headers, ...custom } }), 'confirm selected fixture plane');
			const selected = { ...custom, 'X-Thingtime-Expected-Data-Plane': root.dataPlane };
			await read(
				await write(command({ id: create.id, expectedVersion: before.version, folderId: null }), selected),
				'custom plane cannot change home placement',
				409
			);
			const rootCreate = command({ folderId: null, title: 'Independent home copy' });
			themes.add(rootCreate.id);
			await read(await write(rootCreate, selected), 'custom plane may create standalone home theme');
			const cleared = (
				await read(await write(command({ id: create.id, expectedVersion: before.version, folderId: null })), 'clear placement with canonical tokens')
			).acknowledgment;
			theme = (await snapshot()).find((row: any) => row.id === create.id);
			assert.equal(theme.folderId, null);
			assert.equal(theme.version, cleared.resultVersion);
			const titleWrite = command({ id: create.id, expectedVersion: theme.version, title: 'New library title', name: theme.name, theme: theme.theme });
			const titleReceipt = (await read(await write(titleWrite), 'conditional title rename')).acknowledgment;
			assert.deepEqual((await read(await write(titleWrite), 'exact title replay')).acknowledgment, titleReceipt);
			await read(await write({ ...titleWrite, title: 'Changed replay' }), 'title replay cannot change command', 409);
			theme = (await snapshot()).find((row: any) => row.id === create.id);
			assert.equal(theme.title, 'New library title');
			assert.equal(theme.name, titleWrite.name);
			assert.deepEqual(theme.theme, titleWrite.theme);
			await read(
				await write(command({ id: create.id, expectedVersion: theme.version, title: 'Wrong plane' }), selected),
				'custom plane cannot rename existing home title',
				409
			);
			await read(
				await write(command({ id: create.id, expectedVersion: theme.version, title: 'x'.repeat(121) })),
				'invalid title refuses entire mutation',
				400
			);
			assert.deepEqual(
				(await snapshot()).find((row: any) => row.id === create.id),
				theme
			);
			const exported = await read(
				await owner.post('/api/v1/things/export', { headers, data: { ids: [create.id] } }),
				'normal export retains display title'
			);
			const portable = exported.plan.things.find((row: any) => row.id === create.id);
			assert.equal(portable.crystal.title, theme.title);
			assert.equal(portable.crystal.name, theme.name);
			const imported = await read(
				await owner.post('/api/v1/things/import', {
					headers,
					data: { manifest: { format: 'thingtime.transfer', version: 1, roots: [create.id], things: [portable], files: [] } }
				}),
				'normal import remaps titled private theme'
			);
			const copiedId = imported.roots[0];
			themes.add(copiedId);
			assert.notEqual(copiedId, create.id);
			const copied = (await snapshot()).find((row: any) => row.id === copiedId);
			assert.equal(copied.title, theme.title);
			assert.equal(copied.name, theme.name);
			assert.equal(copied.visibility, 'private');
			assert.deepEqual(copied.theme, theme.theme);
			await read(await guest.get('/api/v1/themes/shared', { params: { id: copiedId } }), 'remapped copy stays private', 404);
			await read(
				await write(command({ id: copiedId, expectedVersion: copied.version, name: copied.name, theme: copied.theme, title: null })),
				'explicit null clears display metadata'
			);
			const withoutTitle = (await snapshot()).find((row: any) => row.id === copiedId);
			assert.equal(withoutTitle.title, null);
			assert.equal(withoutTitle.name, copied.name);
			assert.deepEqual(withoutTitle.theme, copied.theme);
			await read(await guest.get('/api/v1/themes/shared', { params: { id: create.id } }), 'imported theme stays private', 404);

            const sendContext = (operation: string, value: unknown, receiptPlane: string, extra = {}) => owner.post('/api/v1/themes/sync', {
                headers: {...headers,...extra}, data: {operation,expectedOwnerId:ownerId,command:value,context:{storagePlane:'home',receiptPlane}}
            });
            const homeChange=command({id:create.id,expectedVersion:theme.version,folderId:folders[0],title:'Home title from custom selection',name:theme.name,theme:theme.theme});
            const homeReceipt=(await read(await sendContext('write',homeChange,'home',selected),'explicit home metadata from selected custom plane')).acknowledgment;
            assert.deepEqual((await read(await sendContext('write',homeChange,'home'),'home receipt replays after selected plane changes')).acknowledgment,homeReceipt);
            await read(await sendContext('write',homeChange,root.dataPlane),'altered receipt identity refused',409);
            const homeState=(await snapshot()).find((row:any)=>row.id===create.id);
            assert.equal(homeState.folderId,folders[0]);assert.equal(homeState.title,homeChange.title);
            for(const folderId of [foreignFolders[0],randomUUID()]) {
                await read(await sendContext('write',command({id:create.id,expectedVersion:homeState.version,folderId}),'home',selected),'explicit home destination still requires owned home folder',409);
            }
            assert.deepEqual((await snapshot()).find((row:any)=>row.id===create.id),homeState);
            const legacyReceipt=(await read(await write(rootCreate,selected),'legacy custom receipt unchanged')).acknowledgment;
            assert.deepEqual((await read(await sendContext('write',rootCreate,root.dataPlane),'legacy receipt replays through explicit original context')).acknowledgment,legacyReceipt);
            await read(await sendContext('write',rootCreate,'home'),'legacy receipt cannot be rebound to home',409);
            await read(await sendContext('write',{...rootCreate,name:'Changed legacy retry'},root.dataPlane),'legacy receipt cannot change payload',409);
            const getSelection=async()=> (await read(await owner.post('/api/v1/themes/sync',{headers,data:{operation:'selection',expectedOwnerId:ownerId}}),'read home selection')).selection;
            const initialSelection=await getSelection();
            const choose={themeId:create.id,expectedVersion:initialSelection.version,writeId:randomUUID()};
            const chosen=(await read(await sendContext('select',choose,'home',selected),'select home theme from custom plane')).acknowledgment;
            assert.deepEqual((await read(await sendContext('select',choose,'home'),'selection receipt replays across selected planes')).acknowledgment,chosen);
            const clear={themeId:null,expectedVersion:chosen.result.version,writeId:randomUUID()};
            const legacySelection=(await read(await owner.post('/api/v1/themes/sync',{headers:{...headers,...selected},data:{operation:'select',expectedOwnerId:ownerId,command:clear}}),'legacy selected-plane selection')).acknowledgment;
            assert.deepEqual((await read(await sendContext('select',clear,root.dataPlane),'legacy selection retains original receipt context')).acknowledgment,legacySelection);
            await read(await sendContext('select',clear,'home'),'selection receipt cannot be rebound',409);
            assert.deepEqual((await read(await sendContext('select',choose,'home'),'old context receipt does not reapply selection')).acknowledgment,chosen);
            assert.deepEqual(await getSelection(),legacySelection.result);
			completed = true;
		} finally {
			try {
				if (ownerId) {
					for (const id of themes) {
						const response = await owner.post('/api/v1/themes/delete', { headers, data: { id } });
						assert.ok([200, 404].includes(response.status()));
					}
					for (const id of folders) assert.equal((await owner.delete('/api/v1/things', { headers, data: { id } })).status(), 200);
					for (const id of foreignFolders) assert.equal((await other.delete('/api/v1/things', { headers, data: { id } })).status(), 200);
				}
				await mkdir(resolve(artifacts!), { recursive: true });
				await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ completed, checks, fixtureEntriesCleaned: true }, null, 2));
			} finally {
				await owner.dispose();
				await other.dispose();
				await guest.dispose();
			}
		}
	}
);
