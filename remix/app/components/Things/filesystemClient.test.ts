import assert from 'node:assert/strict';
import test from 'node:test';
import { FILESYSTEM_REQUIREMENTS, remoteFileCommand } from './filesystemClient';

test('transient relay errors retain the exact request identity and reject unapproved or mismatched results', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  Object.assign(globalThis, { window: { location: { origin: 'https://thingtime.test' } } });
  const sent: any[] = [];
  let status = 'succeeded';
  const reply = (value: any, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Retry-After': '0' } });
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('capabilities.json')) return reply({schemaVersion:1, origin:'https://thingtime.test', features:Object.fromEntries(Object.entries(FILESYSTEM_REQUIREMENTS).map(([k, version])=>[k,{version}]))});
    if (options?.method === 'POST') {
      sent.push(JSON.parse(String(options.body)));
      return sent.length === 1 ? reply({error:'Try later'},429) : reply({command:{id:'accepted'}});
    }
    return reply({command:{id:'accepted',status,result:{path:'new-folder'}}});
  };
  try {
    const controller = new AbortController();
    assert.deepEqual(await remoteFileCommand('mac',{op:'mkdir',path:'new-folder'},controller.signal,async()=>{},'stable-operation'), {path:'new-folder'});
    assert.equal(sent.length,2); assert.deepEqual(sent[0],sent[1]);
    status='cancelled';
    await assert.rejects(remoteFileCommand('mac',{op:'mkdir',path:'another'},controller.signal,async()=>{}),/could not confirm/);
    status='succeeded';
    await assert.rejects(remoteFileCommand('mac',{op:'mkdir',path:'another'},controller.signal,async()=>{}),/expired or was invalid/);
    controller.abort(); const before=sent.length;
    await assert.rejects(remoteFileCommand('mac',{op:'mkdir',path:'abort'},controller.signal,async()=>{}));
    assert.equal(sent.length,before);
  } finally { globalThis.fetch=originalFetch; Object.assign(globalThis,{window:originalWindow}); }
});
