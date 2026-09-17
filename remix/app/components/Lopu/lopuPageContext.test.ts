import assert from 'node:assert/strict';
import test from 'node:test';
import { lopuPageReference, lopuPageReferences } from '~/utils/lopuPageContext';
import { buildLopuContext } from './useLopuChat';
import { createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { thingtimeCapabilityManifest, capabilitySatisfies } from '~/api/utils/capabilities/thingtimeCapabilities';

test('page context strips bearer fragments and unknown query credentials; preserves navigation', () => {
 assert.deepEqual(lopuPageReference({ url: '/things?q=notes&token=secret#bearer', title: 'Notes' }), { url: '/things?q=notes', title: 'Notes' });
 for (const url of ['//evil.test', '/\\evil.test', 'javascript:alert(1)', '/invite#secret', '/oauth/callback?code=secret', '/api/v1/auth']) assert.equal(lopuPageReference({url}), null, url);
 assert.deepEqual(lopuPageReferences([{url:'/feed',title:'Feed'},{url:'/feed',title:'Duplicate'}]), [{url:'/feed',title:'Feed'}]);
 assert.equal(lopuPageReferences(Array.from({length:20},(_,i)=>({url:`/p/${i}`}))).length, 10);
});
test('opting out removes route, builder and selected block while keeping explicit page links', () => {
 const context = buildLopuContext({ route:'/builder', selectedBlockId:'block', viewport:'desktop', pages:[{url:'/feed',title:'Feed'}] }, false);
 assert.deepEqual(context, {viewport:'desktop',pages:[{url:'/feed',title:'Feed'}]});
});
test('both API manifests advertise page context and the requirement rejects older servers', () => {
 assert.equal(createApiCapabilitiesManifest().features['api.lopu-chats-reply'],'1.12.0');
 assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.lopu-chats-reply'].version,'1.12.0');
 for (const version of ['', '1.10.0', '2.0.0']) assert.equal(capabilitySatisfies(version,'1.12.0'),false);
 assert.equal(capabilitySatisfies('1.12.0','1.12.0'),true);
});
