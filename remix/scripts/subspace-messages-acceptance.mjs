#!/usr/bin/env node
// Real product APIs over a disposable replica set. No application test data is
// written through Mongo, and inherited credentials/configuration are discarded.
// --ui requires an approved isolated browser executable; manager preflight and
// allocation are performed by the caller under the installed capability contract.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

if (process.argv.includes('--browser-worker')) await browserAcceptance();
else await apiAcceptance();

async function apiAcceptance() {
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-subspace-messages-'));
const ports = { api: 19741, db: 19742, web: 19743, hmr: 19744 };
const origin = `http://127.0.0.1:${ports.api}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=subspace_messages`;
const children = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const password = randomBytes(24).toString('hex');
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
  TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
let trapHits = 0;
const trap = createServer((req,res) => { trapHits++; res.writeHead(307, { Location: 'http://1.1.1.1:80/' }); res.end(); });
await new Promise(r => trap.listen(0, '127.0.0.1', r));
const policy = join(dir, 'network.sb');
await writeFile(policy, `(version 1)(allow default)(deny network*)
(allow network-bind (local unix-socket))
(allow network-inbound ${Object.values(ports).map(p => `(local ip "localhost:${p}")`).join(' ')})
(allow network-outbound ${[...Object.values(ports),trap.address().port].map(p => `(remote ip "localhost:${p}")`).join(' ')})`);
function start(executable,args,extra={}) {
  const child = spawn('/usr/bin/sandbox-exec',['-f',policy,executable,...args], {cwd,detached:true,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
  let log=''; child.stdout.on('data',d=>log+=d); child.stderr.on('data',d=>log+=d); children.push(child);
  return {child,log:()=>log};
}
async function stop(running) {
  const killGroup = signal => { try { process.kill(-running.child.pid, signal); } catch(error) { if(error.code !== 'ESRCH') throw error; } };
  const exited = running.child.exitCode !== null || running.child.signalCode !== null;
  const exit = exited ? Promise.resolve() : once(running.child, 'exit');
  killGroup('SIGTERM');
  const forced = setTimeout(() => killGroup('SIGKILL'), 3000);
  await exit; clearTimeout(forced);
  killGroup('SIGKILL');
}
async function ready(running, readyOrigin = origin) {
  for(let n=0;n<100;n++) { if(running.child.exitCode!==null) throw new Error(running.log());
    try { if((await fetch(`${readyOrigin}/.well-known/thingtime-capabilities.json`,{signal:AbortSignal.timeout(700)})).ok)return; } catch{}
    await delay(200);
  } throw new Error(`Server not ready: ${running.log()}`);
}
async function api(path,{body,cookie,as,method,status=200}={}) {
  console.log(`${method||(body?'POST':'GET')} ${path.split('?')[0]}`);
  const started = Date.now();
  const response=await fetch(origin+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(as?{'X-Thingtime-Character':as}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  console.log(`Completed ${path.split('?')[0]} in ${Date.now() - started}ms (${response.status})`);
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return {data,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
let server;
let database;
try {
  assert.equal(process.platform, 'darwin', 'Requires OS network sandbox; refusing unrestricted fallback');
  for (const port of Object.values(ports)) {
    const listener = createServer();
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => listener.close(resolve));
  }
  const preflight = start(process.execPath, ['--input-type=module', '-e', `for(const url of ['http://1.1.1.1:80/','http://127.0.0.1:${trap.address().port}/redirect']){try{await fetch(url,{signal:AbortSignal.timeout(2000)});throw Error('BOUNDARY_FAILED')}catch(e){if(e.cause?.code!=='EPERM')throw e}}`]);
  assert.equal((await once(preflight.child, 'exit'))[0], 0, preflight.log());
  assert.equal(trapHits, 1, 'Redirect must reach the local trap before external target is denied');
  await mkdir(join(dir, 'db'));
  database = start('/opt/homebrew/bin/mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'subspace_messages', '--nounixsocket']);
  const client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
  try {
    for (let n = 0;; n++) { try { await client.connect(); break; } catch (error) { if (n > 20) throw error; await delay(300); } }
    await client.db('admin').command({ replSetInitiate: { _id: 'subspace_messages', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
    for (let n = 0;; n++) {
      if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      if (n > 100) throw Error('Disposable replica set did not become primary');
      await delay(200);
    }
  } finally { await client.close(); }
  server = start(process.execPath, ['.output/server/index.mjs']);
  await ready(server);
  const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, origin, 'Manifest must describe this isolated origin');
  const requirements = { 'api.subspaces': '1.5.1', 'api.chats': '1.1.0', 'api.chats-messages': '1.2.1', 'api.subspaces-embeds': '1.0.0' };
  for (const [feature, minimum] of Object.entries(requirements)) {
    const actual = manifest.features[feature]?.version?.split('.').map(Number);
    const required = minimum.split('.').map(Number);
    assert(actual?.length === 3 && actual[0] === required[0] && (actual[1] > required[1] || actual[1] === required[1] && actual[2] >= required[2]), `Incompatible required capability ${feature}`);
  }
  const register = async username => api('/api/v1/auth/register', { body: { username, email: `${username}@example.invalid`, password, displayName: username } });
  const owner = await register('subspace-owner-test');
  const member = await register('subspace-member-test');
  const outsider = await register('subspace-outsider-test');
  const pending = await register('subspace-pending-test');
  await stop(server);
  server = start(process.execPath, ['.output/server/index.mjs'], { ADMIN_USERNAMES: 'subspace-owner-test' });
  await ready(server);
  const createSpace = async (slug, access) => (await api('/api/v1/subspaces', { cookie: owner.cookie, body: { slug, name: slug.replaceAll('_', ' '), access }, status: 201 })).data.subspace;
  const space = await createSpace('messages_acceptance', 'public');
  const second = await createSpace('messages_scope_test', 'private');
  for (let n = 0; n < 2; n++) {
    const migration = (await api('/api/v1/admin/migrations/run', { cookie: owner.cookie, body: { migration: 'subspace-messaging-spaces' } })).data;
    assert.equal(migration.ok, true);
  }
  const chatId = space.messagesChatId;
  const communityId = space.messagesCommunityId;
  assert.equal(chatId, `subspace-general-${space.id}`);
  assert.equal(communityId, `subspace-space-${space.id}`);
  const detail = async (actor = owner) => (await api(`/api/v1/subspaces/get?id=${space.id}`, { cookie: actor.cookie })).data.subspace;
  const chat = async actor => (await api(`/api/v1/chats/get?id=${chatId}`, { cookie: actor.cookie })).data;
  const messages = async actor => (await api(`/api/v1/chats/messages?chatId=${chatId}`, { cookie: actor.cookie })).data;
  const joinSpace = async actor => api('/api/v1/subspaces/join', { cookie: actor.cookie, body: { id: space.id } });
  const manage = async (actor, action) => api('/api/v1/subspaces/members', { cookie: owner.cookie, body: { id: space.id, userId: actor.data.user.id, action } });
  const send = async (actor, text, requestId = randomUUID()) => (await api('/api/v1/chats/messages', { cookie: actor.cookie, body: { chatId, text, requestId } })).data.message;
  const assertNoLeak = async (actor, label) => {
    for (const path of [`/api/v1/chats/get?id=${chatId}`, `/api/v1/chats/messages?chatId=${chatId}`, `/api/v1/communities/get?id=${communityId}`]) {
      const response = await fetch(origin + path, { headers: { Cookie: actor.cookie }, signal: AbortSignal.timeout(30000) });
      assert([403, 404].includes(response.status), `${label}: direct read must be denied (${path}, ${response.status})`);
      const payload = await response.text();
      assert(!payload.includes('Secret general message'), `${label}: denied body leaked message text`);
    }
    await api('/api/v1/chats/messages', { cookie: actor.cookie, body: { chatId, text: `${label} must not send` }, status: 403 });
    for (const [path, key, id] of [['/api/v1/chats', 'chats', chatId], ['/api/v1/communities', 'communities', communityId]]) {
      const data = (await api(path, { cookie: actor.cookie })).data;
      assert(!data[key].some(row => row.id === id), `${label}: revoked ${key} must be omitted`);
      assert(!JSON.stringify(data).includes('Secret general message'), `${label}: newest-message preview leaked`);
    }
  };
  await chat(owner);
  await joinSpace(member);
  await joinSpace(member);
  for (let n = 0; n < 3; n++) {
    assert.equal((await detail()).messagesChatId, chatId);
    assert.equal((await detail()).messagesCommunityId, communityId);
    await chat(member);
    const channels = (await api(`/api/v1/communities/get?id=${communityId}`, { cookie: member.cookie })).data.channels;
    assert.equal(channels.filter(row => row.id === chatId).length, 1, 'Provisioning retries must not duplicate general channel');
    const communities = (await api('/api/v1/communities', { cookie: member.cookie })).data.communities;
    assert.equal(communities.filter(row => row.id === communityId).length, 1, 'Provisioning retries must not duplicate community');
  }
  const requestId = randomUUID();
  const sent = await send(owner, 'Secret general message from the real API', requestId);
  const retry = await send(owner, 'Secret general message from the real API', requestId);
  assert.equal(sent.id, retry.id, 'Message retry must deduplicate');
  assert((await messages(member)).messages.some(message => message.id === sent.id && message.text === 'Secret general message from the real API'));
  const responseMessage = await send(member, 'Active member reply');
  assert((await messages(owner)).messages.some(message => message.id === responseMessage.id && message.text === 'Active member reply'));
  await assertNoLeak(outsider, 'outsider');
  await api('/api/v1/subspaces/update', { cookie: owner.cookie, body: { id: space.id, access: 'private' } });
  assert.equal((await detail()).access, 'private');
  await joinSpace(pending);
  await assertNoLeak(pending, 'pending');
  await manage(pending, 'accept');
  assert((await messages(pending)).messages.some(message => message.id === sent.id));
  await manage(pending, 'ban');
  await assertNoLeak(pending, 'banned');
  await api('/api/v1/subspaces/leave', { cookie: member.cookie, body: { id: space.id } });
  await assertNoLeak(member, 'left');
  await api('/api/v1/subspaces/update', { cookie: owner.cookie, body: { id: space.id, access: 'public' } });
  await assertNoLeak(member, 'left after becoming public');
  await joinSpace(member);
  assert((await messages(member)).messages.some(message => message.id === sent.id));
  await manage(member, 'remove');
  await assertNoLeak(member, 'removed');
  await joinSpace(member);
  const richText = { kind: 'rich-text', blocks: [{ id: 'acceptance-heading', type: 'header', data: { text: 'Subspace acceptance discussion', level: 2 } }, { id: 'acceptance-paragraph', type: 'paragraph', data: { text: 'Ordinary rich-text embedded post body' } }] };
  const post = (await api('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['post'], crystal: { type: 'text', text: 'Subspace acceptance discussion', richText, subspaceId: space.id }, acl: ['tt:all'] } })).data.post;
  assert(post.id);
  await api('/api/v1/things/comment', { cookie: member.cookie, body: { id: post.id, text: 'First saved subspace comment' } });
  const makeComponent = async (name, acl = ['tt:all']) => (await api('/api/v1/things', { cookie: owner.cookie, body: {
    thingtime: ['component'], acl, crystal: { name, componentKey: 'acceptance-' + randomUUID(), version: 1,
      args: [], render: { tag: 'div', children: [name] } }
  } })).data.thing;
  const embedded = await makeComponent('Embedded acceptance component');
  const privateEmbedded = await makeComponent('Private embedded source', ['tt:user']);
  const addEmbed = async (thingId, region = 'sidebar', requestId = randomUUID()) => (await api('/api/v1/subspaces/embeds', {
    cookie: owner.cookie, body: { id: space.id, operation: 'add', thingId, region, requestId }
  })).data;
  const readEmbeds = async (actor, region = 'sidebar', cursor) => (await api(`/api/v1/subspaces/embeds?id=${space.id}&region=${region}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { cookie: actor.cookie })).data;
  const embedRequestId = randomUUID();
  const firstEmbed = await addEmbed(embedded.id, 'sidebar', embedRequestId);
  assert.equal((await addEmbed(embedded.id, 'sidebar', embedRequestId)).embed.id, firstEmbed.embed.id, 'Add retry must deduplicate');
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'add', thingId: privateEmbedded.id, region: 'sidebar', requestId: embedRequestId }, status: 409 });
  const privateEmbed = await addEmbed(privateEmbedded.id);
  const privateAsMember = (await readEmbeds(member)).embeds.find(row => row.id === privateEmbed.embed.id);
  assert.equal(privateAsMember.thing, null, 'Subspace membership never grants access to a private source');
  const ownerEmbeds = await readEmbeds(owner);
  assert.equal(ownerEmbeds.embeds.find(row => row.id === privateEmbed.embed.id).thing.crystal.name, 'Private embedded source');
  for (const row of ownerEmbeds.embeds) {
    for (const field of ['linkKey', 'tokenAcl', 'audience', 'timelineHeadId', 'secure']) assert.equal(field in row.thing, false, field);
  }
  for (const operation of [
    { operation: 'add', thingId: embedded.id, region: 'sidebar', requestId: randomUUID() },
    { operation: 'remove', embedId: firstEmbed.embed.id },
    { operation: 'move', embedId: firstEmbed.embed.id, direction: 'down' }
  ]) await api('/api/v1/subspaces/embeds', { cookie: member.cookie, body: { id: space.id, ...operation }, status: 403 });
  await api('/api/v1/subspaces/members', { cookie: owner.cookie, body: { id: space.id, userId: member.data.user.id, action: 'role', role: 'moderator' } });
  const moderatorEmbed = (await api('/api/v1/subspaces/embeds', { cookie: member.cookie, body: { id: space.id, region: 'feed', operation: 'add', thingId: embedded.id, requestId: randomUUID() } })).data.embed;
  await api('/api/v1/subspaces/members', { cookie: owner.cookie, body: { id: space.id, userId: member.data.user.id, action: 'role', role: 'member' } });
  await api('/api/v1/subspaces/embeds', { cookie: member.cookie, body: { id: space.id, operation: 'remove', embedId: moderatorEmbed.id }, status: 403 });
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'remove', embedId: moderatorEmbed.id } });
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'move', embedId: privateEmbed.embed.id, direction: 'up' } });
  assert.equal((await readEmbeds(owner)).embeds[0].id, privateEmbed.embed.id, 'Move atomically swaps neighboring positions');
  await api('/api/v1/things/update', { cookie: owner.cookie, body: { id: embedded.id, acl: ['tt:user'] } });
  assert.equal((await readEmbeds(member)).embeds.find(row => row.id === firstEmbed.embed.id).thing, null, 'Source ACL revocation is enforced on the next embed read');
  await api('/api/v1/things/update', { cookie: owner.cookie, body: { id: embedded.id, acl: ['tt:all'] } });
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'remove', embedId: privateEmbed.embed.id } });
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'remove', embedId: privateEmbed.embed.id } });
  // A replay after removal must not recreate the original reference.
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'remove', embedId: firstEmbed.embed.id } });
  const removedRetry = await addEmbed(embedded.id, 'sidebar', embedRequestId);
  assert.equal(removedRetry.existing, true); assert.equal(removedRetry.embed, null);
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: second.id, operation: 'add', thingId: embedded.id, region: 'feed', requestId: randomUUID() } });
  await api(`/api/v1/subspaces/embeds?id=${second.id}&region=feed`, { cookie: outsider.cookie, status: 403 });
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'add', thingId: 'not-a-real-source', region: 'sidebar', requestId: randomUUID() }, status: 404 });
  const feedEmbed = await addEmbed(embedded.id, 'feed');
  const genericRead = await fetch(origin + '/api/v1/things?id=' + feedEmbed.embed.id, { headers: { Cookie: owner.cookie } });
  assert.equal(genericRead.status, 404, 'Generic Thing reads cannot bypass dedicated embed gates');
  const richPostEmbeds = {};
  for (const region of ['feed', 'sidebar']) {
    richPostEmbeds[region] = (await addEmbed(post.id, region)).embed.id;
    const projection = await readEmbeds(owner, region);
    const projected = projection.embeds.find(row => row.id === richPostEmbeds[region]);
    assert(projected?.thing, `${region}: ordinary rich-text post must be projected`);
    assert.deepEqual(projected.thing.crystal.richText, richText);
    if (process.env.SUBSPACE_EVIDENCE_DIR) await writeFile(join(process.env.SUBSPACE_EVIDENCE_DIR, `${region}-rich-post-projection.json`), JSON.stringify(projected, null, 2));
  }
  // More than one page proves batching is not a product count cap.
  for (let n = 0; n < 21; n++) await addEmbed(embedded.id);
  const firstPage = await readEmbeds(member);
  assert.equal(firstPage.embeds.length, 20); assert(firstPage.nextCursor);
  const secondPage = await readEmbeds(member, 'sidebar', firstPage.nextCursor);
  assert(secondPage.embeds.length > 0);
  assert(!secondPage.embeds.some(row => firstPage.embeds.some(previous => previous.id === row.id)), 'Stable cursor pages must not repeat references');
  const crossing = secondPage.embeds[0];
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: space.id, operation: 'move', embedId: crossing.id, direction: 'up' } });
  assert((await readEmbeds(member)).embeds.some(row => row.id === crossing.id), 'Moving across a page boundary must change first-page membership');
  await api(`/api/v1/subspaces/embeds?id=${space.id}&region=sidebar&cursor=malformed`, { cookie: owner.cookie, status: 400 });
  if (process.argv.includes('--ui')) {
    assert(process.env.SUBSPACE_BROWSER_EXECUTABLE, '--ui requires an allocated isolated browser executable after installed manager preflight');
    assert(process.env.SUBSPACE_EVIDENCE_DIR, '--ui requires an evidence output directory');
    const vite = start(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`], { NODE_ENV: 'development' });
    const webOrigin = `http://127.0.0.1:${ports.web}`;
    await ready(vite, webOrigin);
    const fixture = join(dir, 'browser-fixture.json');
    await writeFile(fixture, JSON.stringify({ origin: webOrigin, cookie: owner.cookie, outsiderCookie: outsider.cookie, space, second, memberCookie: member.cookie, memberId: member.data.user.id, embeddedThingId: embedded.id, feedEmbedId: feedEmbed.embed.id, richPostEmbeds, postId: post.id, messageId: sent.id, redirect: `http://127.0.0.1:${trap.address().port}/redirect` }), { mode: 0o600 });
    const ui = start(process.execPath, ['scripts/subspace-messages-acceptance.mjs', '--browser-worker', fixture], {
      PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE,
      SUBSPACE_BROWSER_EXECUTABLE: process.env.SUBSPACE_BROWSER_EXECUTABLE,
      SUBSPACE_EVIDENCE_DIR: process.env.SUBSPACE_EVIDENCE_DIR
    });
    const timeout = setTimeout(() => { try { process.kill(-ui.child.pid, 'SIGTERM'); } catch {} }, 300_000);
    const result = await once(ui.child, 'exit'); clearTimeout(timeout);
    assert.equal(result[0], 0, ui.log()); console.log(ui.log());
  }
  const deleteSpace = await createSpace('delete_messages_test', 'private');
  await api('/api/v1/subspaces/embeds', { cookie: owner.cookie, body: { id: deleteSpace.id, operation: 'add', thingId: embedded.id, region: 'sidebar', requestId: randomUUID() } });
  await api('/api/v1/chats/messages', { cookie: owner.cookie, body: { chatId: deleteSpace.messagesChatId, text: 'Disposable channel before deletion' } });
  await api('/api/v1/subspaces/delete', { cookie: owner.cookie, body: { id: deleteSpace.id, confirmSlug: deleteSpace.slug } });
  await api('/api/v1/subspaces/delete', { cookie: owner.cookie, body: { id: deleteSpace.id, confirmSlug: deleteSpace.slug }, status: 404 });
  await api(`/api/v1/chats/get?id=${deleteSpace.messagesChatId}`, { cookie: owner.cookie, status: 404 });
  assert(!(await api('/api/v1/chats', { cookie: owner.cookie })).data.chats.some(row => row.id === deleteSpace.messagesChatId));
  assert(!(await api('/api/v1/communities', { cookie: owner.cookie })).data.communities.some(row => row.id === deleteSpace.messagesCommunityId));
  console.log(JSON.stringify({ ok: true, productionAccess: false, checks: ['backend OS boundary and redirect denial', 'disposable replica set', 'origin capability manifest', 'idempotent general provisioning', 'real message send/read and retry', 'outsider/pending/banned/left/removed denial', 'list-preview redaction', 'private/public transition and rejoin', 'embeds moderation and source revocation', 'embed ordering, pagination and replay safety'], browser: process.argv.includes('--ui') ? 'passed' : 'not requested' }));
} catch (error) {
  console.error(error.message);
  if (server) await writeFile(join(process.env.SUBSPACE_EVIDENCE_DIR || tmpdir(), 'thingtime-subspace-messages-server.log'), server.log(), { mode: 0o600 });
  if (database) {
    const events = database.log().split('\n').flatMap(line => { try {
      const event = JSON.parse(line); const attr = event.attr || {};
      return [{ time: event.t, severity: event.s, component: event.c, eventId: event.id,
        durationMillis: attr.durationMillis, errorCode: attr.code, keysExamined: attr.keysExamined, docsExamined: attr.docsExamined,
        writeConflicts: attr.writeConflicts, numYields: attr.numYields }];
    } catch { return []; } });
    await writeFile(join(process.env.SUBSPACE_EVIDENCE_DIR || tmpdir(), 'database-timings.json'), JSON.stringify(events, null, 2), { mode: 0o600 });
  }
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) await stop({ child });
  await new Promise(resolve => trap.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
}

async function browserAcceptance() {
  const { readFile, appendFile } = await import('node:fs/promises');
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const fixture = JSON.parse(await readFile(process.argv.at(-1), 'utf8'));
  const out = process.env.SUBSPACE_EVIDENCE_DIR;
  await mkdir(out, { recursive: true });
  await rm(join(out, 'browser-result.json'), { force: true });
  await rm(join(out, 'browser-failure.json'), { force: true });
  await writeFile(join(out, 'browser-progress.log'), 'Starting browser checks\n');
  const note = message => appendFile(join(out, 'browser-progress.log'), message + '\n');
  // The worker and its Chromium descendants inherit the harness OS fence.
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SUBSPACE_BROWSER_EXECUTABLE,
    args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); void writeFile(join(out, 'pageerrors.json'), JSON.stringify(errors, null, 2)); });
  const setSession = async cookie => {
    await context.clearCookies();
    await context.addCookies(cookie.split('; ').map(pair => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: fixture.origin, httpOnly: true, sameSite: 'Lax' };
    }));
  };
  const viewGroup = () => page.getByRole('group', { name: 'Subspace view', exact: true });
  const mode = name => viewGroup().getByRole('button', { name, exact: true });
  const commentsToggle = () => page.getByRole('checkbox', { name: 'Automatically expand all comments', exact: true });
  const openSpace = async space => {
    await page.goto(fixture.origin + '/s/' + space.slug, { waitUntil: 'domcontentloaded' });
    await viewGroup().waitFor({ timeout: 60000 });
  };
  const assertMode = async name => { assert.equal(await mode(name).getAttribute('aria-pressed'), 'true', `${name} must be selected`); };
  const measure = async label => {
    const sidebar = page.getByTestId('subspace-sidebar-embeds');
    await sidebar.locator('article').first().waitFor({ timeout: 30000 });
    assert(await sidebar.locator('article').count() > 0, `${label}: sidebar Thing cards must remain rendered`);
    await page.evaluate(async () => {
      const max = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      for (let y = 0; y < max; y += 500) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 40)); }
      window.scrollTo(0, max);
    });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: horizontal overflow`);
    const bounds = await viewGroup().boundingBox();
    assert(bounds && bounds.x >= -1 && bounds.x + bounds.width <= await page.evaluate(() => innerWidth) + 1, `${label}: controls escape viewport`);
    await page.screenshot({ path: join(out, label + '.png'), fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  const editNestedText = async (documentKey, blockId, text) => {
    const host = page.locator(`[data-settings-document="${documentKey}"]`);
    await host.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await host.getByRole('button', { name: 'Open Builder inspector', exact: true }).click();
    await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(blockId);
    await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Opened Builder inspector overflow');
    await page.screenshot({ path: join(out, `editable-${documentKey}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Close builder', exact: true }).click();
    await host.getByRole('button', { name: 'Save layout', exact: true }).click();
    await host.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
    await host.getByRole('button', { name: 'Done editing layout', exact: true }).click();
  };
  try {
    for (const url of ['http://1.1.1.1:80/', fixture.redirect]) {
      let denied = false;
      try { await page.goto(url, { timeout: 4000 }); }
      catch (error) { assert(/ERR_NETWORK_ACCESS_DENIED|ERR_ACCESS_DENIED/.test(error.message), error.message); denied = true; }
      assert(denied, 'Browser must deny direct IP and redirected external traffic');
    }
    await note('Browser network boundary verified');
    await setSession(fixture.cookie);
    await openSpace(fixture.space);
    await assertMode('Posts');
    await page.getByText('Subspace acceptance discussion', { exact: true }).first().waitFor({ timeout: 30000 });
    const sidebar = page.getByTestId('subspace-sidebar-embeds');
    await sidebar.getByText('Embedded acceptance component', { exact: true }).first().waitFor({ timeout: 30000 });
    const sidebarRead = await page.evaluate(async id => (await fetch('/api/v1/subspaces/embeds?id=' + id + '&region=sidebar')).json(), fixture.space.id);
    assert(sidebarRead.embeds.some(row => row.thing?.id === fixture.embeddedThingId), 'Sidebar source must match the real API projection');
    assert(await sidebar.locator('article').count() > 0, 'Sidebar must render actual repeated Thing cards');
    await sidebar.getByText('Ordinary rich-text embedded post body', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByTestId('subspace-feed-embeds').getByText('Ordinary rich-text embedded post body', { exact: true }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(out, 'rich-post-embedded-feed-sidebar.png'), fullPage: true });
    await note('Ordinary Editor.js post rendered in feed and sidebar with independent API evidence');
    await commentsToggle().check();
    await page.getByText('First saved subspace comment', { exact: true }).waitFor({ timeout: 30000 });
    const editor = page.locator('[contenteditable="true"]').first();
    if (!await editor.isVisible()) await page.getByText(/on your mind/).first().click();
    await editor.fill('Unpublished post draft must survive mode changes');
    await mode('Messages').click();
    await assertMode('Messages');
    await page.getByText('Secret general message from the real API', { exact: true }).waitFor({ timeout: 30000 });
    const composer = page.getByPlaceholder(/^Message /).last();
    await composer.fill('Unsent message draft must survive mode changes');
    await mode('Posts').click();
    const hiddenRequests = [];
    const inspectHiddenRequest = request => { if (/\/api\/v1\/chats\/(?:messages|read)(?:\?|$)/.test(request.url())) hiddenRequests.push(new URL(request.url()).pathname); };
    page.on('request', inspectHiddenRequest);
    await page.waitForTimeout(5000);
    page.off('request', inspectHiddenRequest);
    assert.deepEqual(hiddenRequests, [], 'Hidden Messages must not poll messages or mark them read');
    assert.equal(await editor.innerText(), 'Unpublished post draft must survive mode changes');
    assert.equal(await commentsToggle().isChecked(), true);
    await mode('Messages').click();
    assert.equal(await composer.inputValue(), 'Unsent message draft must survive mode changes');
    await composer.fill('Browser acceptance real general message');
    const [sent] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/chats/messages' && response.request().method() === 'POST'),
      composer.press('Enter')
    ]);
    const saved = await sent.json();
    assert.equal(sent.status(), 200, JSON.stringify(saved));
    assert.equal(saved.message.text, 'Browser acceptance real general message');
    const readback = await page.evaluate(async chatId => (await fetch('/api/v1/chats/messages?chatId=' + chatId)).json(), fixture.space.messagesChatId);
    assert(readback.messages.some(message => message.id === saved.message.id && message.text === saved.message.text), 'Rendered send must independently read back from the real API');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await viewGroup().waitFor({ timeout: 30000 });
    await assertMode('Messages');
    await page.getByText('Browser acceptance real general message', { exact: true }).waitFor({ timeout: 30000 });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await measure(`subspace-messages-${viewport.width}`);
      await mode('Posts').click();
      await page.getByText('First saved subspace comment', { exact: true }).waitFor({ timeout: 30000 });
      await measure(`subspace-expanded-comments-${viewport.width}`);
      await commentsToggle().uncheck();
      await page.getByText('First saved subspace comment', { exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
      await measure(`subspace-collapsed-comments-${viewport.width}`);
      await commentsToggle().check();
      await mode('Messages').click();
    }
    await note('Desktop/mobile views, comments, drafts and message send passed');
    await openSpace(fixture.second);
    await assertMode('Posts');
    assert.equal(await commentsToggle().isChecked(), false, 'Second subspace must retain independent default');
    await openSpace(fixture.space);
    await assertMode('Messages');
    await mode('Posts').click();
    assert.equal(await commentsToggle().isChecked(), true, 'Returning to first subspace restores its comment preference');
    await setSession(fixture.outsiderCookie);
    await openSpace(fixture.space);
    await assertMode('Posts');
    assert.equal(await commentsToggle().isChecked(), false, 'Another account must not inherit owner preferences');
    await setSession(fixture.cookie);
    await openSpace(fixture.space);
    assert.equal(await commentsToggle().isChecked(), true, 'Owner preferences survive account switch');
    await note('Subspace and account preference scoping passed');
    await page.goto(fixture.origin + '/s/' + fixture.space.slug + '/mod?tab=embeds', { waitUntil: 'domcontentloaded' });
    const feedEditor = page.getByRole('group', { name: 'Things above posts', exact: true });
    await feedEditor.waitFor({ timeout: 30000 });
    const searchInput = feedEditor.getByRole('textbox', { name: 'Search Things to embed', exact: true });
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things/search' && response.request().method() === 'POST' && response.request().postDataJSON()?.q === 'Embedded acceptance component'),
      searchInput.fill('Embedded acceptance component')
    ]);
    await feedEditor.getByRole('button', { name: 'Add this Thing', exact: true }).first().waitFor();
    const [addedResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/subspaces/embeds' && response.request().method() === 'POST' && response.request().postDataJSON()?.operation === 'add'),
      feedEditor.getByRole('button', { name: 'Add this Thing', exact: true }).first().click()
    ]);
    const added = await addedResponse.json(); assert.equal(addedResponse.status(), 200, JSON.stringify(added));
    assert.equal(added.embed.thingId, fixture.embeddedThingId, 'Search picker must add the selected real source');
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent === 'Add Thing' && button.disabled));
    assert(added.embed.id);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 40)); } });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mod embeds overflow');
      await page.screenshot({ path: join(out, `subspace-mod-embeds-${viewport.width}.png`), fullPage: true });
    }
    const [removeResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/subspaces/embeds' && response.request().method() === 'POST' && response.request().postDataJSON()?.operation === 'remove'),
      feedEditor.getByRole('button', { name: 'Remove', exact: true }).last().click()
    ]);
    assert.equal(removeResponse.status(), 200);
    const remaining = await page.evaluate(async id => (await fetch('/api/v1/subspaces/embeds?id=' + id + '&region=feed')).json(), fixture.space.id);
    assert(!remaining.embeds.some(row => row.id === added.embed.id), 'UI removal must persist via the real API');
    await editNestedText('subspace-embed-feed', 'embed-add', 'Add selected Thing');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add selected Thing', exact: true }).waitFor({ timeout: 30000 });
    await note('Search picker and independent editable control persisted');
    await openSpace(fixture.space);
    await mode('Posts').click();
    await editNestedText('subspace-display-feed', 'embed-card-title', '{item.name} · editable');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Embedded acceptance component · editable', exact: true }).waitFor({ timeout: 30000 });
    await note('Repeated embedded Thing title independently edited, saved and reloaded');
    const controlsDocument = page.locator('[data-settings-document="subspace-view-controls"]');
    await controlsDocument.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await controlsDocument.getByRole('button', { name: 'Open Builder inspector', exact: true }).click();
    await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption('subspace-expand-label');
    await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Expand comments automatically');
    await page.screenshot({ path: join(out, 'subspace-editable-view-blocks.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close builder', exact: true }).click();
    await controlsDocument.getByRole('button', { name: 'Save layout', exact: true }).click();
    await controlsDocument.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
    await controlsDocument.getByRole('button', { name: 'Done editing layout', exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Expand comments automatically', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await commentsToggle().isChecked(), true, 'Nested Builder label edit must preserve its independent checkbox action');
    await note('Nested view control edited, saved and reloaded');
    assert.deepEqual(errors, [], 'Browser runtime errors');
    await writeFile(join(out, 'browser-result.json'), JSON.stringify({ ok: true, desktopAndMobile: true, persistedViews: true, scopedComments: true, draftSwitching: true, realMessageSendRead: true, realEmbedAddRemove: true, browserNetworkDenied: true, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, browser: true, evidenceDir: out, errors }));
  } catch (error) {
    await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(out, 'browser-failure.json'), JSON.stringify({ error: error.message, errors }, null, 2));
    throw error;
  } finally { await context.close(); await browser.close(); }
}
