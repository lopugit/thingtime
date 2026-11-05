import test from 'node:test';
import assert from 'node:assert/strict';
import { readManagedContentMetadata, readManagedContentFolder } from './managedPlacement';
import { createTransferTheme, readTransferTheme, validateTransferTheme } from './themeTransfer';
import { importTransfer } from './importTransfer';
import { exportTransferPlan } from './exportTransfer';
import { TRANSFER_FORMAT, type ThingTransfer, type TransferThing } from '../../../utils/thingTransfer/format';

const theme = (): TransferThing => ({ id: 'source', thingtime: ['theme'], crystal: { name: 'My palette', theme: { colors: { ink: '#123456' } } } });
const manifest = (): ThingTransfer => ({ format: TRANSFER_FORMAT, version: 1, roots: ['source'], things: [theme()], files: [] });

test('theme projection uses owned/public readers and excludes identity, publication and extra state', async () => {
  const calls: string[] = [];
  const deps: any = {
    owned: async (owner: string) => { calls.push(owner); return null; },
    shared: async () => { calls.push('public'); return { id: 'source', name: 'My palette', theme: theme().crystal.theme, ownerId: 'secret', visibility: 'public', active: true }; }
  };
  assert.deepEqual(await readTransferTheme('viewer', 'source', deps), theme());
  assert.deepEqual(calls, ['viewer', 'public']);
  deps.folder = async (owner: string, id: string) => { assert.equal(owner, 'viewer'); assert.equal(id, 'source'); return 'owned-parent'; };
  assert.equal((await readTransferTheme('viewer', 'source', deps))?.folderId, 'owned-parent');
  deps.shared = async () => null;
  assert.equal(await readTransferTheme(undefined, 'private', deps), null);
});

test('theme importer invokes canonical writer without source ID and always private', async () => {
  let input: unknown;
  const result = await createTransferTheme('recipient', theme(), { save: async (owner: string, value: unknown) => {
    assert.equal(owner, 'recipient'); input = value; return { ok: true, theme: { id: 'fresh' } };
  } } as any);
  assert.equal(result.ok, true);
  assert.deepEqual(input, { ...theme().crystal, visibility: 'private' });
  assert.doesNotThrow(() => validateTransferTheme({ ...theme(), folderId: 'folder' }));
  for (const bad of [{ ...theme(), thingtime: ['theme', 'user'] },
    { ...theme(), extended: { secret: true } }, { ...theme(), crystal: { ...theme().crystal, active: true } }]) {
    assert.throws(() => validateTransferTheme(bad));
  }
});

test('generic transfer resolves theme IDs via dedicated writer and rolls back with dedicated delete', async () => {
  const removed: string[] = [];
  const deps: any = {
    moveContent: async () => { throw new Error('Destination unavailable'); },
    createTheme: async () => ({ ok: true, theme: { id: 'minted-theme' } }),
    removeTheme: async (owner: string, id: string) => { assert.equal(owner, 'recipient'); removed.push(id); return { ok: true }; },
    create: async () => ({ ok: false, status: 409, error: 'quota' }),
    remove: async () => { throw new Error('Theme must not use generic delete'); }
  };
  const success = await importTransfer({ id: 'recipient' }, { manifest: manifest() }, undefined, deps);
  assert.ok(success.ok); if (success.ok) assert.deepEqual(success.roots, ['minted-theme']);
  const mixed = manifest(); mixed.things.push({ id: 'note', thingtime: ['data'], crystal: { name: 'Note' } });
  const failure = await importTransfer({ id: 'recipient' }, { manifest: mixed }, undefined, deps);
  assert.equal(failure.ok, false); assert.deepEqual(removed, ['minted-theme']);
  const folder = await importTransfer({ id: 'recipient' }, { manifest: manifest(), folderId: 'folder' }, undefined, deps);
  assert.equal(folder.ok, false);
});

test('theme exports support legacy dedicated reads and have no attachment discovery', async () => {
  const result = await exportTransferPlan({ id: 'viewer' }, { ids: ['source'] }, undefined, {
    read: async () => null, readTheme: async () => theme(),
    bound: async (docs) => { assert.deepEqual(docs, []); return []; }
  });
  assert.ok(result.ok); if (result.ok) assert.deepEqual(result.plan.things, [theme()]);
});


test('owned display titles survive portable export/import without changing source names or publishing', async () => {
 const original=theme(); original.crystal.title='Library label'; let boundary:unknown;
 const deps:any={owned:async()=>({id:original.id,name:original.crystal.name,theme:original.crystal.theme}),shared:async()=>null,
 metadata:async(owner:string,id:string)=>{assert.equal(owner,'owner');assert.equal(id,'source');return {title:'Library label'};},
 save:async(_owner:string,input:any,options:unknown)=>{assert.equal(input.name,'My palette');assert.equal(input.visibility,'private');assert.equal('id' in input,false);boundary=options;return {ok:true,theme:{id:'independent'}};}};
 assert.deepEqual(await readTransferTheme('owner','source',deps),original);
 await createTransferTheme('owner',original,deps);assert.deepEqual(boundary,{title:'Library label'});
 for(const title of [42,{},'x'.repeat(121)])await assert.rejects(createTransferTheme('owner',{...original,crystal:{...original.crystal,title}} as any,deps));
});


test('managed title reads retain owner/home boundaries and do not change folder-only readers',async()=>{
 const queries:any[]=[]; let custom=false; let row:any={folderId:'folder',crystal:{title:'Owned label'},ownerId:'private-owner',hidden:'secret'};
 const deps:any={customEndpoint:()=>custom,collection:async()=>({findOne:async(filter:any,options:any)=>{queries.push({filter,options});return row;}})};
 assert.deepEqual(await readManagedContentMetadata('owner','theme',deps),{folderId:'folder',title:'Owned label'});
 assert.equal(queries[0].filter.ownerId,'owner');assert.equal(queries[0].filter.shareId,'theme');assert.deepEqual(queries[0].filter.$or,[{thingtime:['theme']},{thingtime:['feed-algorithm']}]);
 assert.equal(await readManagedContentMetadata(undefined,'theme',deps),undefined);custom=true;assert.equal(await readManagedContentMetadata('owner','theme',deps),undefined);assert.equal(queries.length,1);
 custom=false;row.crystal.title={not:'text'};await assert.rejects(readManagedContentMetadata('owner','theme',deps),/title/);
 assert.equal(await readManagedContentFolder('owner','theme',deps),'folder');assert.deepEqual(queries.at(-1).options.projection,{folderId:1});
});
