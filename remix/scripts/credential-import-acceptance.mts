#!/usr/bin/env node
// Built Nitro, real HTTP/browser flows, disposable replica. Mongo access only initializes the replica.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { transferCredential } from './credential-import';
import {
  CREDENTIAL_IMPORT_API_PATH as importPath, CREDENTIAL_IMPORT_FEATURE, CREDENTIAL_IMPORT_OPERATIONS,
  CREDENTIAL_IMPORT_VERSION, CREDENTIAL_IMPORT_PAGE_PATH, CREDENTIAL_IMPORT_HEADERS as headers, GOOGLE_OAUTH_CREDENTIAL_LABEL,
  GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH, type CredentialImportTarget
} from '../app/credentials/importContract';
import { approveCredentialHandoff, importCredentialFile, verifyCompleted } from './credential-import-browser-acceptance.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const environment = 'credential-import-test';
const marker = 'SYNTHETIC-CREDENTIAL-' + randomUUID();
const children = new Set<ChildProcess>();
let stage = 'prerequisites';
let workspace: string | undefined;
let browser: { close: () => Promise<void> } | undefined;
let mongo: MongoClient | undefined;

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}
function start(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { cwd, env, stdio: 'ignore' });
  children.add(child);
  child.on('error', () => {});
  return child;
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    const closed = once(child, 'close').catch(() => {});
    child.kill();
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await closed;
    clearTimeout(timer);
  }
  children.delete(child);
}
async function waitFor(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(200);
  }
  assert.fail(message);
}
function cookies(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
const browserCookies = (cookie: string, origin: string) => cookie.split('; ').map(pair => {
  const split = pair.indexOf('=');
  return { name: pair.slice(0, split), value: pair.slice(split + 1), url: origin };
});

try {
  const playwrightPath = process.env.TT_PLAYWRIGHT_MODULE;
  const chromiumPath = process.env.TT_CHROMIUM_EXECUTABLE;
  assert(playwrightPath && chromiumPath, 'Set TT_PLAYWRIGHT_MODULE and TT_CHROMIUM_EXECUTABLE for task-owned Chromium');
  const { chromium } = await import(pathToFileURL(resolve(playwrightPath, 'index.mjs')).href);
  await access(join(cwd, '.output/server/index.mjs'));
  await access(chromiumPath);
  workspace = await mkdtemp(join(tmpdir(), 'tt-credential-import-'));
  const dbPath = join(workspace, 'db');
  await mkdir(dbPath);
  const [dbPort, apiPort] = await Promise.all([reservePort(), reservePort()]);
  const origin = `http://127.0.0.1:${apiPort}`;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || '/usr/bin:/bin', HOME: workspace, TMPDIR: workspace,
    NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(apiPort),
    APP_URL: origin, THINGTIME_PUBLIC_ORIGIN: origin, THINGTIME_DATA_AUTHORITY_ORIGIN: origin,
    THINGTIME_DATA_ENV: 'custom:' + environment,
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${dbPort}/thingtime?replicaSet=credentialimport`,
    JWT_SECRET: randomBytes(48).toString('hex'),
    THINGTIME_ADMIN_VAULT_KEY: randomBytes(32).toString('base64url'),
    THINGTIME_USER_VAULT_KEY: randomBytes(32).toString('base64url'), THINGTIME_EMAIL_PROVIDER: 'console'
  };

  stage = 'disposable replica';
  const mongod = start(process.env.MONGOD_PATH || 'mongod', [
    '--dbpath', dbPath, '--port', String(dbPort), '--bind_ip', '127.0.0.1', '--replSet', 'credentialimport', '--nounixsocket'
  ], env);
  mongo = new MongoClient(`mongodb://127.0.0.1:${dbPort}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => {
    assert(mongod.pid && mongod.exitCode === null, 'Disposable mongod failed to start');
    try { await mongo!.connect(); return true; } catch { return false; }
  }, 'Disposable mongod did not become reachable');
  await mongo.db('admin').command({ replSetInitiate: { _id: 'credentialimport', members: [{ _id: 0, host: `127.0.0.1:${dbPort}` }] } });
  await waitFor(async () => (await mongo!.db('admin').command({ hello: 1 })).isWritablePrimary === true, 'Replica never elected a primary');
  await mongo.close();
  mongo = undefined;

  async function boot() {
    const server = start(process.execPath, ['.output/server/index.mjs'], env);
    await waitFor(async () => {
      assert(server.pid && server.exitCode === null, 'Built Nitro process exited');
      try {
        return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(750) })).ok;
      } catch { return false; }
    }, 'Built Nitro did not become reachable');
    return server;
  }
  type RequestOptions = { cookie?: string; body?: unknown; raw?: string; headers?: Record<string, string>; status?: number; reveal?: boolean };
  async function request(path: string, options: RequestOptions = {}) {
    const { cookie, body, raw, status = 200 } = options;
    const response = await fetch(origin + path, {
      method: body !== undefined || raw !== undefined ? 'POST' : 'GET', redirect: 'error',
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(raw !== undefined ? { 'Content-Type': 'application/octet-stream' } : {}), ...options.headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(30_000)
    });
    const text = await response.text();
    assert.equal(response.status, status, path.split('?')[0] + ' returned unexpected HTTP status');
    if (!options.reveal) assert(!text.includes(marker), 'A write-only response included fixture credential bytes');
    assert(response.headers.get('content-type')?.includes('application/json'), 'Expected JSON response');
    return { data: JSON.parse(text), response, cookie: cookies(response) };
  }
  const op = (operation: string, options: RequestOptions = {}) => request(importPath + '/' + operation, options);
  const manifestPath = '/.well-known/thingtime-capabilities.json';
  stage = 'built API and account fixtures';
  let server = await boot();
  const manifest = (await request(manifestPath)).data;
  assert.equal(manifest.origin, origin);
  const feature = manifest.features?.[CREDENTIAL_IMPORT_FEATURE];
  assert.equal(feature?.version, CREDENTIAL_IMPORT_VERSION);
  for (const operation of CREDENTIAL_IMPORT_OPERATIONS) {
    const path = importPath + '/' + operation;
    assert(manifest.operations?.some((entry: { path: string; methods: string[]; feature: string }) =>
      entry.path === path && entry.methods.includes('POST') && entry.feature === CREDENTIAL_IMPORT_FEATURE + '-' + operation
    ), 'Built manifest omitted credential import ' + operation);
    const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 405, 'Built route did not mount ' + operation);
    assert.equal(response.headers.get('Allow'), 'POST');
  }
  const register = async (name: string) => {
    const username = name + randomBytes(5).toString('hex');
    const password = randomBytes(32).toString('hex');
    const result = await request('/api/v1/auth/register', {
      body: { username, email: username + '@example.invalid', password }
    });
    const { data } = await request('/api/v1/auth/me', { cookie: result.cookie });
    const id = data.user?.id;
    assert(typeof id === 'string' && id.length > 0, 'Registration did not produce an authenticated account');
    return { username, password, cookie: result.cookie, id };
  };
  const owner = await register('importowner');
  const stranger = await register('importstranger');
  await stop(server);
  env.ADMIN_USERNAMES = owner.username;
  server = await boot();
  assert.equal((await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user?.isAdmin, true);
  assert.notEqual((await request('/api/v1/auth/me', { cookie: stranger.cookie })).data.user?.isAdmin, true);

  stage = 'real browser approval and CLI transfer';
  const context = await chromium.launchPersistentContext(join(workspace, 'chrome'), {
    executablePath: chromiumPath, headless: true, chromiumSandbox: true, env
  });
  browser = context;
  await context.addCookies(browserCookies(owner.cookie, origin));
  const page = context.pages()[0] ?? await context.newPage();
  const evidence = process.env.TT_CREDENTIAL_IMPORT_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  const target: CredentialImportTarget = {
    destination: 'admin-provider-vault', format: 'text', label: 'fixture-cli-provider', environment, overwrite: { mode: 'create' }
  };
  let approval: Promise<void> | undefined;
  const abortTransfer = new AbortController();
  const transfer = transferCredential({
    origin, expectedAccountId: owner.id, target, signal: abortTransfer.signal,
    readInput: async () => {
      assert(approval, 'CLI read input before starting browser approval');
      await approval;
      return Buffer.from(marker + '-CLI');
    },
    emit: event => {
      if (event.status !== 'approval_required' || !event.verificationUrl) return;
      const verificationUrl = event.verificationUrl;
      approval = (async () => {
        const response = await fetch(verificationUrl, { redirect: 'error', signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-frame-options'), 'DENY');
        assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
        await response.body?.cancel();

        await page.goto(origin + CREDENTIAL_IMPORT_PAGE_PATH);
        await page.evaluate(url => new Promise<void>(done => {
          const frame = document.createElement('iframe');
          frame.id = 'credential-approval-frame';
          frame.src = url;
          frame.addEventListener('load', () => done(), { once: true });
          document.body.append(frame);
        }), verificationUrl);
        const actions = page.frameLocator('#credential-approval-frame').getByRole('button', {
          name: /approve this handoff|revoke|refresh status/i
        });
        assert.equal(await actions.count(), 0, 'A framed handoff exposed an action');
        await approveCredentialHandoff({
          page, origin, verificationUrl, target, accountId: owner.id, artifactDir: evidence
        });
      })();
      void approval.catch(() => abortTransfer.abort());
    }
  });
  try {
    const saved = await transfer;
    await verifyCompleted(page, saved);
    assert.equal(saved.label, target.label);
  } catch (error) {
    await approval;
    throw error;
  }

  stage = 'wrong account, revocation and exact-byte replay';
  const createIntent = async (label: string) => {
    const requestId = randomUUID();
    const verifier = randomBytes(32).toString('base64url');
    await op('start', { body: {
      requestId, expectedAccountId: owner.id, challenge: createHash('sha256').update(verifier).digest('base64url'),
      target: { ...target, label }
    } });
    return { requestId, verifier };
  };
  const control = (operation: string, requestId: string, actor: typeof owner, status = 200, expectedId = actor.id) => op(operation, {
    cookie: actor.cookie, body: { requestId }, status, headers: { [headers.expectedActor]: expectedId }
  });
  const upload = (proof: { requestId: string; verifier: string }, raw: string, status = 200) => op('upload', {
    raw, status, headers: { [headers.request]: proof.requestId, [headers.verifier]: proof.verifier }
  });
  const withdrawn = await createIntent('fixture-withdrawn');
  await control('inspect', withdrawn.requestId, stranger, 403);
  await control('approve', withdrawn.requestId, stranger, 409, owner.id);
  await upload(withdrawn, marker + '-PENDING', 409);
  await control('approve', withdrawn.requestId, owner);
  await control('revoke', withdrawn.requestId, owner);
  assert.equal((await op('status', { body: withdrawn })).data.status, 'revoked');
  await upload(withdrawn, marker + '-REVOKED', 403);
  const replay = await createIntent('fixture-replay');
  await control('approve', replay.requestId, owner);
  await upload({ ...replay, verifier: randomBytes(32).toString('base64url') }, marker + '-WRONG-PROOF', 404);
  const first = (await upload(replay, marker + '-REPLAY')).data.receipt;
  const retry = (await upload(replay, marker + '-REPLAY')).data.receipt;
  assert.equal(first?.credentialId, retry?.credentialId);
  assert.equal(first?.updatedAt, retry?.updatedAt);
  await upload(replay, marker + '-DIFFERENT', 409);

  stage = 'Character selection and approval invalidation';
  assert.equal(manifest.features?.['api.auth-characters']?.version?.split('.')[0], '1');
  const charactersPath = '/api/v1/auth/characters';
  const createdCharacter = (await request(charactersPath, { cookie: owner.cookie, body: {
    operation: 'create', requestId: randomUUID(), displayName: 'Credential acceptance', loginMode: 'switch'
  } })).data.character?.user?.id;
  assert(typeof createdCharacter === 'string' && createdCharacter !== owner.id, 'Character fixture was not created');
  const selectCharacter = async (characterId: string | null) => {
    const { data } = await request(charactersPath, { cookie: owner.cookie, body: { operation: 'select', characterId } });
    assert.equal(data.user?.id, characterId ?? owner.id);
  };
  const characterBlocked = await createIntent('fixture-character-blocked');
  await selectCharacter(createdCharacter);
  const blocked = await op('approve', { cookie: owner.cookie, body: { requestId: characterBlocked.requestId }, status: 409,
    headers: { [headers.expectedActor]: owner.id, 'X-Thingtime-Character': owner.id }
  });
  assert.equal(blocked.data.code, 'actor_changed');
  await selectCharacter(null);
  assert.equal((await op('status', { body: characterBlocked })).data.status, 'pending');

  const characterRevoked = await createIntent('fixture-character-revoked');
  assert.equal((await control('approve', characterRevoked.requestId, owner)).data.intent?.status, 'approved');
  await selectCharacter(createdCharacter);
  await selectCharacter(null);
  // Upload first, without a status request that might separately revoke the intent.
  const refused = await upload(characterRevoked, marker + '-CHARACTER-SWITCH', 403);
  assert.equal(refused.data.code, 'revoked');
  assert.equal((await op('status', { body: characterRevoked })).data.status, 'revoked');

  stage = 'Google JSON browser import and conditional update';
  const otherOrigin = 'https://fixture-secondary.example.invalid';
  const otherEntry = { clientId: 'fixture-other.apps.googleusercontent.com', clientSecret: marker + '-OTHER',
    redirectUri: otherOrigin + GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH };
  // Seed the legacy multi-origin document through the existing authorized write API.
  const existing = (await request('/api/v1/admin/integrations', { cookie: owner.cookie, body: {
    action: 'create-secret', label: GOOGLE_OAUTH_CREDENTIAL_LABEL,
    value: JSON.stringify({ environments: { [environment]: { origins: { [otherOrigin]: otherEntry } } } })
  } })).data.secret;
  const googleTarget: CredentialImportTarget = {
    ...target, format: 'google-oauth', label: GOOGLE_OAUTH_CREDENTIAL_LABEL,
    callbackUrl: origin + GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH,
    overwrite: { mode: 'replace', expectedId: existing.id, expectedUpdatedAt: existing.updatedAt }
  };
  const googlePayload = JSON.stringify({ web: { client_id: 'fixture-new.apps.googleusercontent.com',
    client_secret: marker + '-GOOGLE', redirect_uris: [googleTarget.callbackUrl] } });
  await importCredentialFile({ page, origin, target: googleTarget, artifactDir: evidence, file: {
    name: 'synthetic-client.json', mimeType: 'application/json', buffer: Buffer.from(googlePayload)
  } });
  await op('direct', { cookie: owner.cookie, raw: googlePayload, status: 409, headers: {
    [headers.expectedActor]: owner.id, [headers.target]: Buffer.from(JSON.stringify(googleTarget)).toString('base64url')
  } });
  const metadata = (await request('/api/v1/admin/integrations', { cookie: owner.cookie })).data;
  const matches = metadata.secrets.filter((row: { label: string }) => row.label === GOOGLE_OAUTH_CREDENTIAL_LABEL);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, existing.id);
  assert.notEqual(matches[0].updatedAt, existing.updatedAt);
  // The protected explicit reveal is used only to compare synthetic fixture values, never printed.
  const protectedRead = await request('/api/v1/vault/reveal', { cookie: owner.cookie, reveal: true, body: {
    vault: 'admin', id: existing.id, action: 'reveal', password: owner.password
  } });
  const origins = JSON.parse(protectedRead.data.value).environments[environment].origins;
  assert(JSON.stringify(origins[otherOrigin]) === JSON.stringify(otherEntry), 'Import did not preserve the other origin');
  assert(origins[origin]?.clientSecret === marker + '-GOOGLE', 'Exact intended credential did not reach the vault');
  assert(origins[origin]?.redirectUri === googleTarget.callbackUrl, 'Google callback changed');

  console.log('PASS built manifest and all seven routes, isolated browser and CLI approval, metadata-only readback, frame protection, wrong account, Character switch invalidation, revocation, replay, Google import, origin preservation and stale CAS');
} catch (error) {
  // Assertion messages may include synthetic data from Playwright; emit the stage and source line only.
  const location = error instanceof Error ? error.stack?.match(/credential-import-acceptance\.mts:(\d+):\d+/)?.[1] : undefined;
  console.error('Credential import acceptance failed at ' + stage + (location ? ' (line ' + location + ')' : ''));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await mongo?.close().catch(() => {});
  for (const child of Array.from(children).reverse()) await stop(child);
  if (workspace) await rm(workspace, { recursive: true, force: true });
}
