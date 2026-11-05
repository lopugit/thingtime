import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultRevealAction, loader } from './_reveal';

const origin = 'https://thingtime.example';
const selection = { vault: 'ci', id: 'credential-example', action: 'reveal', password: 'synthetic-password' };
const account = { user: { id: 'owner', isAdmin: true, temporary: false }, claims: { jti: 'session', sub: 'owner' } };
const post = (body: unknown = selection, headers = {}) =>
	new Request(`${origin}/api/v1/vault/reveal`, {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
const fixture = (overrides: Record<string, unknown> = {}) => {
	const reads: string[] = [];
	const action = createVaultRevealAction({
		getAuthToken: async () => 'synthetic-session-token',
		resolveTokenUser: async () => account as any,
		confirmCurrentPassword: async () => 'confirmed',
		enforceFixedRateLimit: async () => ({ allowed: true } as any),
		revealLopuCredential: async (id) => {
			reads.push(id);
			return 'synthetic-secret';
		},
		revealSystemEnvironment: async (id) => { reads.push(id); return 'synthetic-secret'; },
		revealAdminSecret: async (id) => {
			reads.push(id);
			return 'synthetic-secret';
		},
		revealUserVaultValue: async (owner, id) => {
			reads.push(`${owner}:${id}`);
			return 'synthetic-secret';
		},
		...overrides
	} as any);
	return { action, reads };
};
const privateResponse = (response: Response) => assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');

test('reveals exactly one value after fresh password verification, never a bundle', async () => {
	for (const vault of ['ci', 'admin', 'personal', 'deployment']) {
		const { action, reads } = fixture();
		const response = await action({ request: post({ ...selection, vault }) });
		assert.equal(response.status, 200);
		privateResponse(response);
		assert.deepEqual(await response.json(), { ok: true, vault, id: selection.id, value: 'synthetic-secret' });
		assert.deepEqual(reads, [vault === 'personal' ? `owner:${selection.id}` : selection.id]);
	}
});
test('denies unverified, missing, temporary, non-admin and revoked sessions before decrypting', async () => {
	for (const overrides of [
		{ confirmCurrentPassword: async () => 'mismatch' },
		{ confirmCurrentPassword: async () => 'unavailable' },
		{ resolveTokenUser: async () => null },
		{ resolveTokenUser: async () => ({ ...account, user: { ...account.user, temporary: true } }) },
		{ resolveTokenUser: async () => ({ ...account, user: { ...account.user, isAdmin: false } }) },
		{
			resolveTokenUser: (() => {
				let reads = 0;
				return async () => (++reads === 1 ? account : null);
			})()
		}
	]) {
		const { action, reads } = fixture(overrides);
		const response = await action({ request: post() });
		assert.ok([401, 403].includes(response.status));
		privateResponse(response);
		assert.deepEqual(reads, []);
	}
});
test('personal reveal is scoped to current owner, not a client-supplied owner', async () => {
	const { action, reads } = fixture({ resolveTokenUser: async () => ({ ...account, user: { ...account.user, isAdmin: false } }) });
	assert.equal((await action({ request: post({ ...selection, vault: 'personal', ownerId: 'victim' }) })).status, 400);
	assert.equal((await action({ request: post({ ...selection, vault: 'personal' }) })).status, 200);
	assert.deepEqual(reads, [`owner:${selection.id}`]);
});
test('rejects cross-origin/missing Origin/non JSON/unknown fields and mixed verification methods', async () => {
	for (const request of [
		post(selection, { Origin: 'https://attacker.example' }),
		post(selection, { Origin: '' }),
		post(selection, { 'Content-Type': 'text/plain' }),
		post({ ...selection, path: 'secure' }),
		post({ ...selection, vault: 'environment' }),
		post({ ...selection, ticket: 'mixed' }),
		post({ ...selection, id: { $ne: '' } })
	]) {
		const { action, reads } = fixture();
		const response = await action({ request });
		assert.ok(response.status >= 400);
		privateResponse(response);
		assert.deepEqual(reads, []);
	}
});
test('security limits are fixed and fail closed, including paid accounts', async () => {
	for (const unavailable of [true, false]) {
		const { action, reads } = fixture({
			enforceFixedRateLimit: async (_request: Request, bucket: string, identity: string, policy: any) => {
				assert.equal(bucket, 'auth.vaultReveal');
				assert.equal(identity, 'user:owner');
				assert.deepEqual(policy, { limit: 5, windowMs: 900000 });
				return { allowed: false, unavailable, retryAfterSeconds: 60, limit: 5, remaining: 0, resetAt: new Date().toISOString() };
			}
		});
		const response = await action({ request: post() });
		assert.equal(response.status, unavailable ? 503 : 429);
		privateResponse(response);
		assert.deepEqual(reads, []);
	}
});
test('passkey options and verification use the same session/item binding, options never decrypt', async () => {
	let binding = '';
	const { action, reads } = fixture({
		startVaultPasskeyVerification: async (_request: Request, user: string, scope: string) => {
			assert.equal(user, 'owner');
			binding = scope;
			return { ok: true, options: {}, ticket: 'synthetic-ticket' };
		},
		finishVaultPasskeyVerification: async (_request: Request, user: string, scope: string, ticket: string) => {
			assert.equal(user, 'owner');
			assert.equal(scope, binding);
			assert.equal(ticket, 'synthetic-ticket');
			return true;
		}
	});
	const base = { vault: 'ci', id: selection.id };
	assert.equal((await action({ request: post({ ...base, action: 'options' }) })).status, 200);
	assert.deepEqual(reads, []);
	assert.equal((await action({ request: post({ ...base, action: 'reveal', ticket: 'synthetic-ticket', response: {} }) })).status, 200);
	assert.equal(reads.length, 1);
});
test('missing entry, decrypt errors and unsupported methods never leak secrets or cache responses', async () => {
	for (const revealLopuCredential of [
		async () => null,
		async () => {
			throw new Error('synthetic-private-detail');
		}
	]) {
		const { action } = fixture({ revealLopuCredential });
		const response = await action({ request: post() });
		assert.ok([404, 503].includes(response.status));
		privateResponse(response);
		assert.ok(!(await response.text()).includes('synthetic-private-detail'));
	}
	const response = await loader();
	assert.equal(response.status, 405);
	privateResponse(response);
});


test('deployment values require both current admin access and fresh verification', async () => {
  for (const overrides of [{ confirmCurrentPassword: async () => 'mismatch' }, { resolveTokenUser: async () => ({ ...account, user: { ...account.user, isAdmin: false } }) }]) {
    const { action, reads } = fixture(overrides);
    assert.ok((await action({ request: post({ ...selection, vault: 'deployment' }) })).status >= 400);
    assert.deepEqual(reads, []);
  }
});

test('optional personal version identifies the same freshly verified selected value', async () => {
 const version='vault-state-v1:'+'a'.repeat(64);let versionReads=0;
 const {action,reads}=fixture({revealUserVaultValueVersion:async(owner:string,id:string)=>{assert.equal(owner,'owner');assert.equal(id,selection.id);versionReads++;return {version,value:'selected versioned value'};}});
 const response=await action({request:post({...selection,vault:'personal',includeVersion:true})});assert.equal(response.status,200);privateResponse(response);
 assert.deepEqual(await response.json(),{ok:true,vault:'personal',id:selection.id,version,value:'selected versioned value'});assert.equal(versionReads,1);assert.deepEqual(reads,[]);
 for(const body of [{...selection,includeVersion:true},{...selection,vault:'personal',includeVersion:'true'}])assert.equal((await action({request:post(body)})).status,400);
 assert.equal(versionReads,1);
});
test('versioned personal reveal still refuses failed proof and revocation before disclosure',async()=>{
 let revealed=0,resolutions=0;const shared={revealUserVaultValueVersion:async()=>{revealed++;return {version:'vault-state-v1:'+'a'.repeat(64),value:'never disclosed'};}};
 const failed=fixture({...shared,confirmCurrentPassword:async()=> 'mismatch'});assert.equal((await failed.action({request:post({...selection,vault:'personal',includeVersion:true})})).status,401);assert.equal(revealed,0);
 const revoked=fixture({...shared,resolveTokenUser:async()=>++resolutions<3?account:null});const response=await revoked.action({request:post({...selection,vault:'personal',includeVersion:true})});assert.equal(response.status,403);assert.equal(revealed,1);assert.ok(!(await response.text()).includes('never disclosed'));
});
const scopedSelection={...selection,vault:'personal',includeVersion:true,expectedOwnerId:'owner'};
const planeHeaders={'X-Thingtime-Expected-Data-Plane':'home'};
test('offline retention reveal confirms owner and database before proof and decryption',async()=>{
 let verified=0,revealed=0;
 const {action}=fixture({mongoDataPlane:()=> 'home',confirmCurrentPassword:async()=>{verified++;return 'confirmed';},revealUserVaultValueVersion:async()=>{revealed++;return {version:'vault-state-v1:'+'a'.repeat(64),value:'selected fixture'};}});
 for(const [body,headers,status] of [
  [{...scopedSelection,expectedOwnerId:'someone-else'},planeHeaders,409],
  [scopedSelection,{},400],
  [scopedSelection,{'X-Thingtime-Expected-Data-Plane':'custom-'+'a'.repeat(64)},409],
  [{...scopedSelection,includeVersion:undefined},planeHeaders,400],
  [{...scopedSelection,vault:'admin'},planeHeaders,400]
 ] as const){const response=await action({request:post(body,headers)});assert.equal(response.status,status);privateResponse(response);}
 assert.equal(verified,0);assert.equal(revealed,0);
 const response=await action({request:post(scopedSelection,planeHeaders)});assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,vault:'personal',id:selection.id,version:'vault-state-v1:'+'a'.repeat(64),value:'selected fixture',ownerId:'owner',dataPlane:'home'});
 assert.equal(verified,1);assert.equal(revealed,1);
});
test('database changes during proof or selected-value lookup prevent disclosure',async()=>{
 for(const changeAt of [2,3]){
  let reads=0,reveals=0;
  const {action}=fixture({mongoDataPlane:()=> ++reads<changeAt?'home':'custom-'+'b'.repeat(64),revealUserVaultValueVersion:async()=>{reveals++;return{version:'vault-state-v1:'+'a'.repeat(64),value:'never disclose fixture'};}});
  const response=await action({request:post(scopedSelection,planeHeaders)});assert.equal(response.status,409);assert.ok(!(await response.text()).includes('never disclose'));assert.equal(reveals,changeAt===2?0:1);
 }
});
test('personal retention refuses service identities and binds passkey tickets to selected plane',async()=>{
 const denied=fixture({mongoDataPlane:()=> 'home',resolveTokenUser:async()=>({...account,user:{...account.user,accountKind:'service'}})});
 assert.equal((await denied.action({request:post(scopedSelection,planeHeaders)})).status,409);
 const bindings:string[]=[];
 const {action}=fixture({mongoDataPlane:()=> 'home',startVaultPasskeyVerification:async(_request:Request,_user:string,binding:string)=>{bindings.push(binding);return{ok:true,options:{},ticket:'synthetic-ticket'};}});
 const {password:_password,...options}=scopedSelection;
 assert.equal((await action({request:post({...options,action:'options'},planeHeaders)})).status,200);
 const {expectedOwnerId:_owner,includeVersion:_version,...legacy}=options;
 assert.equal((await action({request:post({...legacy,action:'options'})})).status,200);
 assert.equal(bindings.length,2);assert.notEqual(bindings[0],bindings[1]);
});
test('a role change during fresh proof refuses device retention before decrypting',async()=>{
 let reads=0,reveals=0;
 const {action}=fixture({mongoDataPlane:()=> 'home',resolveTokenUser:async()=>++reads===1?account:{...account,user:{...account.user,accountKind:'service'}},revealUserVaultValueVersion:async()=>{reveals++;return{version:'vault-state-v1:'+'a'.repeat(64),value:'never disclosed'};}});
 const response=await action({request:post(scopedSelection,planeHeaders)});assert.equal(response.status,403);assert.equal(reveals,0);
});
