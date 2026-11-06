import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createVaultDataKey } from '../api/utils/auth/vaultEnvelope';
import { sealPasswordIcon } from '../api/utils/passwords/icons';
const key = createVaultDataKey(), maxBytes = 16 * 1024 * 1024;
let docs: any[] = [], queries = 0, keyLoads = 0, projection: any, filter: any, pageLimit = 0;
mock.module(new URL('../api/utils/passwords/files.ts', import.meta.url).href, { namedExports: { deletePasswordFiles: async () => {} } });
mock.module(new URL('../api/utils/mongodb/collections.ts', import.meta.url).href, { namedExports: {
  ensureIndexes: async () => {}, withHomeMongoTransaction: async (work: any) => work({}),
  getHomeThingsCollection: async () => ({ find: (where: any, options: any) => {
    queries++; filter = where; projection = options?.projection;
    const cursor = { sort: () => cursor, limit: (size: number) => { pageLimit = size; return cursor; }, toArray: async () => docs };
    return cursor;
  } })
} });
mock.module(new URL('../api/utils/storage/accountedThings.ts', import.meta.url).href, { namedExports: { insertAccountedThing: async () => {}, updateAccountedThing: async () => {}, HOME_ACCOUNTED_STORAGE_OPTIONS: {} } });
mock.module(new URL('../api/utils/auth/vaultKeys.ts', import.meta.url).href, { namedExports: { withUserVaultKey: async (owner: string, work: any) => { assert.equal(owner, 'owner'); keyLoads++; return work(key); } } });

test('paged icon projection uses one owner-scoped bounded query and one key load without reading secret fields', async () => {
  const { listPasswords } = await import('../api/utils/passwords/passwords');
  docs = Array.from({ length: 51 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const crystal = { title: `Entry ${index}`, passwordType: 'login', encryptedIcon: sealPasswordIcon('owner', key, id, { kind: 'url', url: `https://example.test/${index}.png` }, maxBytes) };
    Object.defineProperty(crystal, 'encryptedValue', { get() { throw new Error('Secret fields must not be accessed by listing'); } });
    return { shareId: id, crystal, passwordRevision: 1, createdAt: new Date('2026-10-26T00:00:00Z'), updatedAt: new Date('2026-10-26T00:00:00Z') };
  });
  const result = await listPasswords('owner');
  assert.equal(queries, 1); assert.equal(keyLoads, 1); assert.equal(pageLimit, 51);
  assert.equal(filter.ownerId, 'owner'); assert.equal(filter.thingtime, 'password-manager-entry');
  assert.equal(projection['crystal.encryptedValue'], undefined); assert.equal(projection['crystal.encryptedIcon'], 1);
  assert.equal(result.entries.length, 50); assert.ok(result.nextCursor);
  assert.deepEqual(result.entries[0].icon, { kind: 'url', url: 'https://example.test/0.png' });
  assert.equal(JSON.stringify(result).includes('encryptedIcon'), false);
  docs = [{ ...docs[0], crystal: { title: 'Old entry', passwordType: 'login' } }, { ...docs[1], crystal: { title: 'Corrupt icon', passwordType: 'login', encryptedIcon: { invalid: true } } }];
  const legacy = await listPasswords('owner');
  assert.equal(legacy.entries.every(entry => entry.icon === undefined), true);
});

test('explicit legacy previews and native catalog never expose secret-typed username/email fields', async()=>{
 const {sealVaultValue}=await import('../api/utils/auth/vaultEnvelope');
 const {listPasswords,passwordCatalog}=await import('../api/utils/passwords/passwords');
 for(const type of ['password','totp','ssh-key','structured'] as const){
  const id='00000000-0000-4000-8000-000000000001';
  const entry={title:'Legacy record',passwordType:'login',fields:[{id:'username',label:'Username',type,value:type==='structured'?'{}':'synthetic-secret'},{id:'email',label:'Email',type,value:type==='structured'?'{}':'synthetic-secret'}]};
  docs=[{shareId:id,crystal:{title:entry.title,passwordType:entry.passwordType,encryptedValue:sealVaultValue('owner',key,id,'secret',JSON.stringify(entry),maxBytes)},passwordRevision:1,createdAt:new Date(),updatedAt:new Date()}];
  const preview=await listPasswords('owner',undefined,'',true);assert.equal(preview.entries[0].username,undefined,type);
  assert.equal(projection['crystal.encryptedValue'],1);
  const catalog=await passwordCatalog('owner');assert.equal(catalog.catalog[0].username,'',type);assert.equal(catalog.catalog[0].fillEligible,false);
 }
 const id='00000000-0000-4000-8000-000000000002';
 const entry={title:'Legacy safe user',passwordType:'login',fields:[{id:'username',label:'Username',type:'text',value:'legacy@example.invalid'},{id:'website',label:'Website',type:'url',value:'https://legacy-site.example/private?token=synthetic'}]};
 docs=[{shareId:id,crystal:{title:entry.title,passwordType:entry.passwordType,encryptedValue:sealVaultValue('owner',key,id,'secret',JSON.stringify(entry),maxBytes)},passwordRevision:1,createdAt:new Date(),updatedAt:new Date()}];
 const legacy=await listPasswords('owner',undefined,'',true);assert.equal(legacy.entries[0].username,'legacy@example.invalid','Old rows require no edit or resave');assert.equal(legacy.entries[0].websiteIcon,true);assert.equal(JSON.stringify(legacy).includes('legacy-site.example'),false);assert.equal(JSON.stringify(legacy).includes('synthetic'),false);
 const catalog=await passwordCatalog('owner');
 assert.deepEqual(catalog.catalog[0].origins,['https://legacy-site.example']);
 assert.deepEqual(catalog.catalog[0].domains,['legacy-site.example']);
 assert.equal(JSON.stringify(catalog).includes('private?token'),false,'Exact-origin discovery must not publish URL paths or queries');
});
