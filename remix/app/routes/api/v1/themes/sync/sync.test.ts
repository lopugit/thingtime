import assert from 'node:assert/strict';
import test from 'node:test';
import { createThemeSyncResponse } from './_sync';
import { withInternalRequestActor } from '~/api/utils/auth/internalRequestActor';
const origin = 'https://theme-sync.example';
const account = { user: { id: 'owner', temporary: false, accountKind: 'full' }, claims: { jti: 'fixture-session' } };
const command = {
	action: 'save',
	id: '123e4567-e89b-42d3-a456-426614174000',
	writeId: 'fixture-write',
	expectedVersion: null,
	name: 'Peach',
	theme: {},
	visibility: 'private'
};
const body = { operation: 'write', expectedOwnerId: 'owner', command };
const receipt = {
	action: 'save',
	id: command.id,
	writeId: command.writeId,
	expectedVersion: null,
	resultVersion: 'theme-state-v1:' + 'a'.repeat(64)
};
const request = (payload: unknown = body, headers = {}) =>
	new Request(origin + '/api/v1/themes/sync', {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Thingtime-Expected-Data-Plane': 'home', ...headers },
		body: JSON.stringify(payload)
	});
function fixture(overrides: any = {}) {
	let writes = 0,
		reads = 0;
	const run = createThemeSyncResponse({
		getAuthToken: async () => 'session',
		resolveTokenUser: async () => account as any,
		mongoDataPlane: () => 'home',
		enforceRateLimit: async () => ({ allowed: true } as any),
		themeSyncSnapshot: async () => {
			reads++;
			return [];
		},
		synchronizeThemeWrite: async (owner, plane, raw, admit) => {
			assert.equal(owner, 'owner');
			assert.equal(plane, 'home');
			assert.deepEqual(raw, command);
			await admit();
			writes++;
			return receipt as any;
		},
		...overrides
	});
	return { run, writes: () => writes, reads: () => reads };
}
test('dedicated theme sync pins confirmed owner and selected plane while declaring home storage', async () => {
	const f = fixture();
	const response = await f.run({ request: request() });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual(await response.json(), { ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment: receipt });
	assert.equal(f.writes(), 1);
	const snapshot = await f.run({ request: request({ operation: 'snapshot', expectedOwnerId: 'owner' }) });
	assert.equal(snapshot.status, 200);
	assert.deepEqual((await snapshot.json()).themes, []);
	assert.equal(f.reads(), 1);
});
test('anonymous, temporary, service, changed-account, changed-plane and cross-origin callers never reach theme storage', async () => {
	for (const [req, overrides, status] of [
		[request(body, { Origin: '' }), {}, 403],
		[request(body, { Origin: 'https://other.example' }), {}, 403],
		[request(body, { 'Sec-Fetch-Site': 'cross-site' }), {}, 403],
		[request(body, { 'Content-Type': 'text/plain' }), {}, 415],
		[request(body, { 'X-Thingtime-Expected-Data-Plane': '' }), {}, 400],
		[request(), { getAuthToken: async () => null }, 401],
		[request(), { resolveTokenUser: async () => ({ ...account, user: { ...account.user, temporary: true } }) }, 401],
		[request(), { resolveTokenUser: async () => ({ ...account, user: { ...account.user, accountKind: 'service' } }) }, 401],
		[request({ ...body, expectedOwnerId: 'different' }), {}, 409],
		[request(), { mongoDataPlane: () => 'custom-' + 'b'.repeat(64) }, 409],
		[request({ ...body, ownerId: 'forged' }), {}, 400],
		[request({ operation: 'snapshot', expectedOwnerId: 'owner', command }), {}, 400],
		[request({ ...body, command: { data: 'x'.repeat(70 * 1024) } }), {}, 413]
	] as any[]) {
		const f = fixture(overrides);
		assert.equal((await f.run({ request: req })).status, status);
		assert.equal(f.writes() + f.reads(), 0);
	}
});
test('internal Action identity and failed rate admission do not authorize theme synchronization', async () => {
	const f = fixture(),
		req = request();
	const response = await withInternalRequestActor(
		req,
		async () => account.user as any,
		() => f.run({ request: req })
	);
	assert.equal(response.status, 403);
	assert.equal(f.writes(), 0);
	const capped = fixture({
		enforceRateLimit: async () => ({ allowed: false, limit: 60, remaining: 0, resetAt: new Date(Date.now() + 60000).toISOString() })
	});
	const denied = await capped.run({ request: request() });
	assert.equal(denied.status, 429);
	assert.equal(denied.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(capped.writes() + capped.reads(), 0);
	const failed = fixture({
		enforceRateLimit: async () => {
			throw Error('private storage outage');
		}
	});
	const limited = await failed.run({ request: request() });
	assert.equal(limited.status, 503);
	assert.equal(failed.writes(), 0);
	assert.ok(!(await limited.text()).includes('private storage outage'));
});
test('theme sync repeats session admission before mutation and response disclosure', async () => {
	for (const expiration of [2, 3]) {
		let resolved = 0;
		const f = fixture({ resolveTokenUser: async () => (++resolved >= expiration ? null : account) });
		const response = await f.run({ request: request() });
		assert.equal(response.status, 401);
		assert.equal(f.writes(), expiration === 2 ? 0 : 1);
		assert.ok(!(await response.text()).includes('resultVersion'));
	}
	let resolved = 0;
	const f = fixture({ resolveTokenUser: async () => (++resolved >= 2 ? null : account) });
	const response = await f.run({ request: request({ operation: 'snapshot', expectedOwnerId: 'owner' }) });
	assert.equal(response.status, 401);
	assert.equal(f.reads(), 1);
	assert.ok(!(await response.text()).includes('themes'));
});


test('selection reads and writes retain admission and disclosure boundaries', async () => {
 const selection = {themeId:null,version:'theme-selection-v1:'+'a'.repeat(64)};
 const command = {themeId:null,expectedVersion:selection.version,writeId:'selection-1'};
 for (const operation of ['selection','select']) {
  const payload = {operation,expectedOwnerId:'owner',...(operation==='select'?{command}:{})};
  for (const expiration of [1,2,3,99]) {
   let resolved=0,calls=0;
   const f=fixture({resolveTokenUser:async()=>++resolved>=expiration?null:account,
    readUserThemeSelection:async owner=>{assert.equal(owner,'owner');calls++;return selection;},
    synchronizeThemeSelection:async(owner,plane,raw,admit)=>{assert.equal(owner,'owner');assert.equal(plane,'home');assert.deepEqual(raw,command);await admit();calls++;return {...command,result:selection};}
   });
   const response=await f.run({request:request(payload)});
   const success=expiration>(operation==='select'?3:2);
   assert.equal(response.status,success?200:401);
   assert.equal(calls,expiration===1 || (operation==='select'&&expiration===2)?0:1);
   const result=await response.json();
   if(success) assert.deepEqual(operation==='select'?result.acknowledgment.result:result.selection,selection);
   else assert.ok(!JSON.stringify(result).includes('theme-selection-v1'));
  }
  for(const headers of [{Origin:'https://foreign.example'},{'X-Thingtime-Expected-Data-Plane':'custom-'+ 'a'.repeat(64)}]) {
   const f=fixture({readUserThemeSelection:async()=>assert.fail('Unauthorized read'),synchronizeThemeSelection:async()=>assert.fail('Unauthorized write')});
   assert.ok([403,409].includes((await f.run({request:request(payload,headers)})).status));
  }
 }
});


test('explicit home destination preserves receipt context without replacing current session admission', async () => {
 const selected = 'custom-' + 'a'.repeat(64), original = 'custom-' + 'b'.repeat(64);
 for (const operation of ['write','select']) {
  let calls=0;
  const context={storagePlane:'home',receiptPlane:original};
  const handler=async(owner:string,plane:string,raw:unknown,admit:()=>Promise<void>,received:unknown)=>{
   assert.equal(owner,'owner'); assert.equal(plane,selected); assert.deepEqual(raw,command); assert.deepEqual(received,context);
   await admit(); calls++; return receipt as any;
  };
  const f=fixture({mongoDataPlane:()=>selected,synchronizeThemeWrite:handler,synchronizeThemeSelection:handler});
  const payload={...body,operation,context};
  const response=await f.run({request:request(payload,{'X-Thingtime-Expected-Data-Plane':selected})});
  assert.equal(response.status,200); const result=await response.json();
  assert.equal(result.dataPlane,selected); assert.equal(result.storagePlane,'home'); assert.equal(calls,1);
  for(const [overrides,headers,status] of [
   [{getAuthToken:async()=>null},{},401],
   [{resolveTokenUser:async()=>({...account,user:{...account.user,id:'other'}})},{},409],
   [{mongoDataPlane:()=>original},{},409],
   [{},{Origin:'https://foreign.example'},403],
   [{enforceRateLimit:async()=>({allowed:false,limit:60,remaining:0,resetAt:new Date().toISOString()})},{},429]
  ] as const) {
   const denied=fixture({mongoDataPlane:()=>selected,synchronizeThemeWrite:async()=>assert.fail('Denied write'),synchronizeThemeSelection:async()=>assert.fail('Denied selection'),...overrides});
   assert.equal((await denied.run({request:request(payload,{'X-Thingtime-Expected-Data-Plane':selected,...headers})})).status,status);
  }
 }
});
test('home context rejects alternate destinations, extra authority and read operations before storage',async()=>{
 for(const operation of ['write','select','snapshot','selection']) {
  for(const context of [null,{storagePlane:'other',receiptPlane:'home'},{storagePlane:'home',receiptPlane:'custom-bad'},
   {storagePlane:'home',receiptPlane:'home',ownerId:'other'}, ...(operation==='snapshot'||operation==='selection'?[{storagePlane:'home',receiptPlane:'home'}]:[])]) {
   const f=fixture({synchronizeThemeSelection:async()=>assert.fail('Unexpected write'),readUserThemeSelection:async()=>assert.fail('Unexpected read')});
   const payload={operation,expectedOwnerId:'owner',context,...(['write','select'].includes(operation)?{command}:{})};
   assert.equal((await f.run({request:request(payload)})).status,400);
   assert.equal(f.writes()+f.reads(),0);
  }
 }
});


test('Character sync reauthorizes the selected actor before writes and disclosure', async () => {
 const actor = { ...account, user: { ...account.user, id: 'character' } };
 for (const selected of ['character', null]) {
  for (const revokeAt of [1, 2, 3, 99]) {
   let resolutions = 0, writes = 0;
   const f = fixture({
    resolveTokenUser: async (token: string, requested: string | null) => {
     assert.equal(token, 'session'); assert.equal(requested, selected);
     return ++resolutions >= revokeAt ? null : actor;
    },
    synchronizeThemeWrite: async (owner: string, _plane: string, raw: unknown, admit: () => Promise<void>) => {
     assert.equal(owner, actor.user.id); assert.deepEqual(raw, command);
     await admit(); writes++; return receipt;
    }
   });
   const response = await f.run({ request: request({ ...body, expectedOwnerId: actor.user.id }, selected ? { 'X-Thingtime-Character': selected } : {}) });
   assert.equal(response.status, revokeAt > 3 ? 200 : 401);
   assert.equal(writes, revokeAt > 2 ? 1 : 0);
   assert.ok(response.headers.get('Vary')?.includes('X-Thingtime-Character'));
   const result = await response.json();
   if (response.ok) assert.equal(result.ownerId, actor.user.id);
   else assert.equal(result.acknowledgment, undefined, 'a revoked delegation never discloses a receipt');
  }
 }
 for (const resolved of [null, account]) {
  const f = fixture({ resolveTokenUser: async (_token: string, requested: string) => { assert.equal(requested, 'character'); return resolved; } });
  const response = await f.run({ request: request({ operation: 'snapshot', expectedOwnerId: actor.user.id }, { 'X-Thingtime-Character': 'character' }) });
  assert.equal(response.status, resolved ? 409 : 401);
  assert.equal(f.reads() + f.writes(), 0, 'refused delegation cannot fall back to the principal');
 }
});
