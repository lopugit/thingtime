const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordProvider, requirePasswordSender } = require('../lib/password-provider.cjs');
test('password bridge only accepts the active main frame at the configured HTTPS origin', () => {
 const mainFrame = { url: 'https://thingtime.example/passwords' }, event = { senderFrame: mainFrame, sender: { mainFrame } };
 assert.doesNotThrow(() => requirePasswordSender(event, 'https://thingtime.example'));
 assert.throws(() => requirePasswordSender({ ...event, senderFrame: { url: mainFrame.url } }, 'https://thingtime.example'));
 assert.throws(() => requirePasswordSender(event, 'https://other.example'));
 assert.throws(() => requirePasswordSender({ ...event, senderFrame: null }, 'https://thingtime.example'));
 mainFrame.url = 'http://thingtime.example/passwords'; assert.throws(() => requirePasswordSender(event, 'http://thingtime.example'));
});

test('endpoint disconnect runs after an outstanding native connect', {skip: process.platform !== 'darwin'}, async () => {
 const calls = []; let finish;
 const mainFrame = {url:'https://thingtime.example/passwords'};
 const sender = {mainFrame, session:{cookies:{get:async()=>[{httpOnly:true, secure:true,path:'/',value:'synthetic'}]}}};
 const provider = createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example',helper:async (_exe,action)=>{calls.push(action); if(action==='connect') await new Promise(resolve=>{finish=resolve;});}});
 const connected = provider({sender,senderFrame:mainFrame},{action:'connect',ownerId:'fixture'});
 await new Promise(resolve=>setImmediate(resolve)); const cleared = provider.disconnect();
 assert.deepEqual(calls,['connect']); finish(); await connected; await cleared;
 assert.deepEqual(calls,['connect','disconnect']);
});
