import assert from 'node:assert/strict';
import test from 'node:test';
import { ThingtimeApiError } from '../../hooks/apiFailure';
import { readThingSchema } from './readThingSchema';
const owned = { schemaId:'schema', rootId:'data', owned:true };
test('owned schema reads use the local-capable adapter without a remote capability or shared-root dependency', async()=>{
 const calls:any[]=[];const signal=new AbortController().signal;
 const result=await readThingSchema(async(args,options)=>{calls.push({args,options});return {thing:{id:'schema'}};},owned,signal);
 assert.equal(result.thing.id,'schema');assert.deepEqual(calls,[{args:{id:'schema'},options:{signal}}]);
});
test('shared and bearer-key reads retain their exact composition context',async()=>{
 for(const input of [{...owned,owned:false},{...owned,linkKey:'secret'}]){
  const calls:any[]=[];
  await readThingSchema(async(args)=>{calls.push(args);return {};},input,new AbortController().signal);
  assert.deepEqual(calls,[{id:'schema',sharedRoot:'data',...('linkKey' in input?{key:'secret'}:{})}]);
 }
});
test('a directly refused foreign schema can still resolve through an authorized root',async()=>{
 for(const status of [403,404]){
  const calls:any[]=[];
  const result=await readThingSchema(async(args)=>{calls.push(args);if(!args.sharedRoot)throw new ThingtimeApiError('Refused',{status});return 'inherited';},owned,new AbortController().signal);
  assert.equal(result,'inherited');assert.deepEqual(calls,[{id:'schema'},{id:'schema',sharedRoot:'data'}]);
 }
});
test('offline failures, lost identity and cancellation do not trigger a composition fallback',async()=>{
 for(const error of [new Error('Workspace changed'),new ThingtimeApiError('Offline'),new ThingtimeApiError('Failed',{status:503}),new ThingtimeApiError('Sign in',{status:401})]){
  let calls=0;await assert.rejects(readThingSchema(async()=>{calls++;throw error;},owned,new AbortController().signal),e=>e===error);assert.equal(calls,1);
 }
 const abort=new AbortController();let calls=0;
 await assert.rejects(readThingSchema(async()=>{calls++;abort.abort();throw new ThingtimeApiError('Refused',{status:404});},owned,abort.signal),{name:'AbortError'});
 assert.equal(calls,1);
 await assert.rejects(readThingSchema(async()=>{calls++;return {};},owned,abort.signal),{name:'AbortError'});assert.equal(calls,1);
});
