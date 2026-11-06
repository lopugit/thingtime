import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanonicalDeviceAlertSender} from './apns';
const device={id:'exact-registration',ownerId:'owner',token:'fixture-token',platform:'ios' as const,environment:'sandbox' as const,topic:'com.thingtime.appletime',updatedAt:new Date()};
const message={notificationId:'notification',title:'Find phone',message:'Please return it',sound:null};
test('targeted push sends to exactly the verified registration, never user fan-out',async()=>{
 const calls:any[]=[];const sender=createCanonicalDeviceAlertSender({token:()=> 'fixture-auth',send:async(_token,actual,payload)=>{assert.equal(actual,device);calls.push(payload);return{status:200,reason:null};},remove:async()=>{}});
 const result=await sender(device,message);assert.equal(result.status,'provider-accepted');assert.equal(calls.length,1);assert.equal('sound' in calls[0].aps,false);assert.equal('played' in result,false);
 await assert.rejects(sender(device,{...message,sound:'../external.caf'}),/Invalid prepared/);assert.equal(calls.length,1);
});
test('unconfigured provider makes no request and invalid registrations retire only themselves',async()=>{
 let sent=0;const removed:string[]=[];const dependencies={token:()=>null,send:async()=>{sent++;return{status:410,reason:'Unregistered'};},remove:async(id:string)=>{removed.push(id);}};
 assert.equal((await createCanonicalDeviceAlertSender(dependencies)(device,message)).status,'unconfigured');assert.equal(sent,0);
 assert.equal((await createCanonicalDeviceAlertSender({...dependencies,token:()=> 'fixture'})(device,{...message,sound:'default'})).status,'rejected');assert.equal(sent,1);assert.deepEqual(removed,[device.id]);
});
