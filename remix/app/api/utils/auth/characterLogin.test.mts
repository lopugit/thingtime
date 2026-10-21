import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let owner: any, character: any, sessions: string[], bound: string[], deliveredTo: string[];
mock.module('./users.ts', { namedExports: {
  findUserByUsername: async () => character,
  findUserById: async (id: string) => id === 'owner' ? owner : id === 'character' ? character : null,
  toPublicUserWithStorage: async (user: any) => ({id: user._id})
} });
mock.module('./sessions.ts', { namedExports: { getLiveSession: async () => null, createSession: async (id: string) => { sessions.push(id); return {jti:'test'}; } } });
mock.module('./jwt.ts', { namedExports: { signJwt: async () => 'fixture', verifyJwt: async () => null } });
mock.module('./authCookie.ts', { namedExports: { getAuthToken: async () => null } });
mock.module('./passwords.ts', { namedExports: { verifyPassword: async (password: string, hash: string) => password === hash } });
mock.module('./vaultKeys.ts', { namedExports: { bindVaultPassword: async (id: string) => { bound.push(id); } } });
mock.module('../notifications/notifications.ts', { namedExports: { emitLoginNotification: async () => {} } });
mock.module('./authOtps.ts', { namedExports: {
  consumeOtpChallenge: async () => ({ok:true,userId:'character'}), createOtpChallenge: async () => ({challenge:'fixture',expiresAt:new Date()}),
  deleteOtpChallenge: async () => {}, generateOtpCode: () => 'fixture'
} });
mock.module('./email.ts', { namedExports: { sendEmailOtp: async ({to}:any) => { deliveredTo.push(to); return {status:'sent'}; } } });
const {loginUser,completeOtpLogin} = await import('./loginUser.ts');
beforeEach(() => {
  owner={_id:'owner',passwordHash:'owner-password',email:'owner@example.invalid',meta:{}};
  character={_id:'character',passwordHash:'character-password',meta:{character:{ownerId:'owner',loginMode:'inherit',disabled:false}}};
  sessions=[];bound=[];deliveredTo=[];
});
test('inherited login verifies the current owner password and issues only a Character session',async()=>{
  assert.equal((await loginUser({username:'character',password:'owner-password'})).ok,true);
  assert.deepEqual(sessions,['character']);assert.deepEqual(bound,[]);
  owner.passwordHash='changed-owner-password';
  assert.equal((await loginUser({username:'character',password:'owner-password'})).ok,false);
  assert.equal((await loginUser({username:'character',password:'changed-owner-password'})).ok,true);
});
test('separate password never accepts the owner password',async()=>{
  character.meta.character.loginMode='password';
  assert.equal((await loginUser({username:'character',password:'owner-password'})).ok,false);
  assert.equal((await loginUser({username:'character',password:'character-password'})).ok,true);
  assert.deepEqual(bound,['character']);
});
test('switch-only, disabled and orphaned identities cannot independently log in',async()=>{
  character.meta.character.loginMode='switch';
  assert.equal((await loginUser({username:'character',password:'character-password'})).ok,false);
  character.meta.character.loginMode='password';character.meta.character.disabled=true;
  assert.equal((await loginUser({username:'character',password:'character-password'})).ok,false);
  character.meta.character.disabled=false;owner=null;
  assert.equal((await loginUser({username:'character',password:'character-password'})).ok,false);
  assert.deepEqual(sessions,[]);
});
test('inherited password preserves owner email second factor without exposing its address',async()=>{
  owner.meta.twoFactorEmailEnabled=true;
  const result=await loginUser({username:'character',password:'owner-password'});
  assert.equal(result.ok,true);assert('requiresOtp' in result);assert.deepEqual(sessions,[]);
  assert.deepEqual(deliveredTo,['owner@example.invalid']);assert(!JSON.stringify(result).includes(owner.email));
});
test('disabling after an OTP challenge prevents session issuance',async()=>{
  character.meta.character.disabled=true;
  assert.equal((await completeOtpLogin({challenge:'fixture',code:'fixture'})).ok,false);
  assert.deepEqual(sessions,[]);
});
