import assert from 'node:assert/strict';
import test from 'node:test';
import { VERIFICATION_WINDOWS, verificationWindow, entryVerificationWindow, verificationContext, verificationSeconds, rememberedVerificationValid } from './verificationPolicy';
const now=1_000_000_000_000;
test('exact requested durations and safe defaults form a closed policy',()=>{
  assert.deepEqual(VERIFICATION_WINDOWS.map(([id])=>id),['always','5m','1h','6h','12h','1d','2d','3d','14d','30d','60d','90d','1y','never']);
  for(const [id]of VERIFICATION_WINDOWS)assert.equal(verificationWindow(id),id);
  assert.equal(entryVerificationWindow('global'),'global');
  for(const value of [undefined,null,0,'forever','global',{},'2y'])assert.throws(()=>verificationWindow(value));
});
test('each finite duration expires at the exact boundary and cannot gain time from a later preference',()=>{
  for(const [duration]of VERIFICATION_WINDOWS){if(['always','never'].includes(duration))continue;
    const seconds=verificationSeconds(duration), grant={verifiedAt:now,duration,session:'A',passwordVersion:'P'};
    assert.equal(rememberedVerificationValid(grant,duration,'A','P',now+seconds*1000-1),true,duration);
    assert.equal(rememberedVerificationValid(grant,duration,'A','P',now+seconds*1000),false,duration);
    assert.equal(rememberedVerificationValid(grant,'never','A','P',now+seconds*1000),false,'Setting Never never upgrades a timed grant');
    assert.equal(rememberedVerificationValid(grant,duration,'B','P',now+1),false,'Timed trust is session-bound');
  }
});
test('Never survives future sessions while Always, stricter expiry, password change and revoke win',()=>{
  const grant={verifiedAt:now,duration:'never' as const,session:'A',passwordVersion:'P'};
  assert.equal(rememberedVerificationValid(grant,'never','B','P',now+1e14),true);
  assert.equal(rememberedVerificationValid(grant,'always','A','P',now),false);
  assert.equal(rememberedVerificationValid(grant,'5m','A','P',now+300000),false);
  assert.equal(rememberedVerificationValid(grant,'never','A','changed',now),false);
  assert.equal(rememberedVerificationValid({...grant,revoked:true},'never','A','P',now),false);
  assert.equal(rememberedVerificationValid(grant,'never','A','P',now-1),false);
});
test('contexts bind a closed purpose, exact selected item and HTTPS fill origin',()=>{
  const entryId=crypto.randomUUID();
  assert.deepEqual(verificationContext({purpose:'fill',rp:'example.test',origin:'https://example.test',entryId}),{purpose:'fill',rp:'example.test',origin:'https://example.test',entryId});
  for(const value of [{purpose:'export',rp:'example.test'}, {purpose:'get',rp:'example.test'}, {purpose:'fill',rp:'example.test',entryId,origin:'https://elsewhere.test'}, {purpose:'fill',rp:'example.test',entryId,origin:'http://example.test'}, {purpose:'get',rp:'Example.test',entryId}])assert.throws(()=>verificationContext(value));
});

test('preview usernames require canonical public text/email fields even when names look like usernames',async()=>{
 const {passwordPreviewUsername}=await import('./model');
 for(const type of ['password','totp','ssh-key','structured']){
  const entry:any={title:'Fixture',passwordType:'login',fields:[{id:'username',type,value:'synthetic-secret'},{id:'email',type,value:'synthetic-secret'}]};
  assert.equal(passwordPreviewUsername(entry),'',type);
 }
 for(const extra of [{concealed:true},{structured:true}])assert.equal(passwordPreviewUsername({title:'Fixture',passwordType:'login',fields:[{id:'username',label:'Username',type:'text',value:'synthetic-secret',...extra}]}),'');
 assert.equal(passwordPreviewUsername({title:'Fixture',passwordType:'login',fields:[{id:'username',label:'Username',type:'text',value:'legacy-user'}]}),'legacy-user');
});
