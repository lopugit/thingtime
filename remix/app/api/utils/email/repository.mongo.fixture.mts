// Hosted query-shape regression only. No Mongo server or provider delivery.
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {ObjectId} from 'mongodb';
import Module from 'node:module';
import * as original from '../mongodb/collections.ts';
process.env.THINGTIME_EMAIL_PROVIDER='console';
const calls:any[]=[],inserted:any[]=[];
const id=new ObjectId();
const policy=(kind:string,rows:any[])=>({find(filter:any){calls.push({kind,filter});return{project(projection:any){assert.deepEqual(projection,{email:1});return{toArray:async()=>rows};}};},updateOne:async(filter:any,update:any,options:any)=>{calls.push({kind,filter,update,options});}});
mock.module(new URL('../mongodb/collections.ts',import.meta.url).href,{defaultExport:{},namedExports:{...original,
 getEmailMessagesCollection:async()=>({insertOne:async(document:any)=>{inserted.push(document);return{insertedId:id};},updateOne:async(filter:any,update:any)=>{calls.push({kind:'message',filter,update});}}),
 getEmailSuppressionListCollection:async()=>policy('suppression',[{email:'blocked@example.invalid'}]),
 getEmailUnsubscribesCollection:async()=>policy('unsubscribe',[{email:'news@example.invalid'}]),
 getEmailEventsCollection:async()=>({insertOne:async(document:any)=>{calls.push({kind:'event',document});}})
}});
const load=(Module as any)._load;
(Module as any)._load=function(name:string,...args:unknown[]){if(name==='node:sqlite'||name.includes('nativeEmailRepository'))throw Error('Hosted path imported native persistence');return Reflect.apply(load,this,[name,...args]);};
mock.module(new URL('./ses.ts',import.meta.url).href,{defaultExport:{},namedExports:{sendWithSes:async()=>{throw Error('synthetic transport unavailable');}}});
const {sendEmail}=await import('./service.ts');const {sendVerificationEmail}=await import('../auth/email.ts');
const {recordEmailEvent,suppressEmailAddress,unsubscribeEmailAddress}=await import('./events.ts');
const logged:string[]=[];const error=console.error;console.error=()=>{};const log=console.log;console.log=(...values:unknown[])=>{logged.push(values.map(String).join(' '));}; // Never emit synthetic credential mail bodies.
try{
 const result=await sendEmail({to:[' BLOCKED@example.invalid ','allowed@example.invalid'],subject:'Synthetic',html:'<p>body</p>',text:'body'});
 assert.equal(result.delivered,false);assert.equal(result.status,'logged');assert.equal(result.emailMessageId,String(id));
 assert.deepEqual(inserted[0].to,['blocked@example.invalid','allowed@example.invalid']);assert.equal(inserted[0].html,'<p>body</p>');
 assert.deepEqual(calls.find(c=>c.kind==='suppression').filter,{email:{$in:['blocked@example.invalid','allowed@example.invalid']},active:{$ne:false}});
 const status=calls.find(c=>c.kind==='message');assert.deepEqual(status.filter,{_id:id});assert.equal(status.update.$set.status,'logged');assert.deepEqual(status.update.$set.suppressedRecipients,['blocked@example.invalid']);
 await sendEmail({to:'news@example.invalid',subject:'Newsletter',html:'body',text:'body',stream:'newsletter'});
 assert.deepEqual(calls.find(c=>c.kind==='unsubscribe').filter,{email:{$in:['news@example.invalid']}});
 await sendVerificationEmail({to:'allowed@example.invalid',link:'https://example.invalid/verify?token=synthetic-sensitive-link'});
 const verification=inserted.find(row=>row.templateKey==='auth.verify_email');assert.equal(verification.sensitive,true);assert.equal(verification.html,'[redacted: single-use secret]');assert.equal(verification.text,'[redacted: single-use secret]');assert.equal(JSON.stringify(verification).includes('synthetic-sensitive-link'),false);assert.equal(logged.some(line=>line.includes('synthetic-sensitive-link')),false);
 const count=inserted.length;await assert.rejects(sendEmail({to:'allowed@example.invalid',subject:'Synthetic',html:'body',text:'body',idempotencyKey:'not-supported-here'}),e=>(e as any).code==='EMAIL_IDEMPOTENCY_UNSUPPORTED');assert.equal(inserted.length,count);
 await recordEmailEvent({eventType:'synthetic',email:' ALLOWED@example.invalid '});assert.equal(calls.find(c=>c.kind==='event').document.email,'allowed@example.invalid');
 await suppressEmailAddress({email:' ALLOWED@example.invalid ',reason:'synthetic'});const suppression=calls.find(c=>c.kind==='suppression'&&c.update);assert.deepEqual(suppression.filter,{email:'allowed@example.invalid'});assert.equal(suppression.update.$set.active,true);assert.deepEqual(suppression.options,{upsert:true});
 await unsubscribeEmailAddress({email:' ALLOWED@example.invalid '});const unsubscribe=calls.find(c=>c.kind==='unsubscribe'&&c.update);assert.deepEqual(unsubscribe.filter,{email:'allowed@example.invalid',listId:'newsletter'});assert.equal(unsubscribe.update.$set.source,'app');assert.deepEqual(unsubscribe.options,{upsert:true});
 process.env.THINGTIME_EMAIL_PROVIDER='ses';process.env.THINGTIME_EMAIL_FAIL_CLOSED='true';
 await assert.rejects(sendEmail({to:'allowed@example.invalid',subject:'Failure contract',html:'body',text:'body'}),/synthetic transport unavailable/);
 assert.equal(calls.filter(c=>c.kind==='message').at(-1).update.$set.status,'failed');
 process.env.THINGTIME_EMAIL_FAIL_CLOSED='false';assert.equal((await sendEmail({to:'allowed@example.invalid',subject:'Failure contract',html:'body',text:'body'})).status,'failed');
}finally{console.log=log;console.error=error;}
console.log('hosted-email-query-contract-ok; no server or provider delivery');
