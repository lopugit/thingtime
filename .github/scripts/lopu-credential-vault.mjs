#!/usr/bin/env node

import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_CREDENTIALS = 8;
const MAX_RESPONSE_BYTES = 256 * 1024;

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const validate = (value) => {
  if (!value || value.ok !== true || !Array.isArray(value.credentials) || value.credentials.length > MAX_CREDENTIALS) {
    throw new Error('Thingtime returned an invalid credential bundle.');
  }
  const ids = new Set();
  const names = new Set();
  return value.credentials.map((row, index) => {
    if (!row || typeof row !== 'object' || row.credentialType !== 'claude-code-oauth-token') throw new Error('Thingtime returned an unsupported credential type.');
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const credential = typeof row.value === 'string' ? row.value.trim() : '';
    if (!id || !name || /[\u0000-\u001f\u007f]/.test(name) || !credential || /[\r\n]/.test(credential) || ids.has(id) || names.has(name)) throw new Error('Thingtime returned malformed or duplicate credentials.');
    ids.add(id);
    names.add(name);
    return { id, name, credentialType: row.credentialType, value: credential, priority: index };
  });
};

const legacyCredentials = () => {
  const candidates = [
    ['Thingtime Claude', process.env.LOPU_LEGACY_CLAUDE_TOKEN_PREFERRED],
    ['Existing Claude', process.env.LOPU_LEGACY_CLAUDE_TOKEN_PRIMARY],
    ['Fallback Claude', process.env.LOPU_LEGACY_CLAUDE_TOKEN_FALLBACK]
  ];
  const seen = new Set();
  return candidates.flatMap(([name, raw]) => {
    const value = raw?.trim();
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [{ name, value }];
  });
};

const fetchBundle = async () => {
  const secret = required('THINGTIME_CI_ROUTER_SECRET');
  const origin = new URL(process.env.THINGTIME_CREDENTIAL_VAULT_ORIGIN?.trim() || 'https://thingtime.com');
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') throw new Error('Credential vault origin must use HTTPS.');
  origin.pathname = '/api/v1/integrations/ci/credentials';
  origin.search = '';
  origin.hash = '';
  const body = JSON.stringify({
    repository: required('GITHUB_REPOSITORY'),
    workflowRef: required('GITHUB_WORKFLOW_REF'),
    runId: required('GITHUB_RUN_ID'),
    runAttempt: required('GITHUB_RUN_ATTEMPT'),
    nonce: randomBytes(24).toString('base64url'),
    requestedAt: new Date().toISOString(),
    bootstrapCredentials: legacyCredentials()
  });
  const signature = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
  const response = await fetch(origin, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Thingtime-CI-Signature': signature },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000)
  });
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Thingtime credential response exceeded the size limit.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Thingtime credential fetch failed (${response.status}).`); }
  if (!response.ok) throw new Error(typeof parsed?.error === 'string' ? `Thingtime credential fetch failed (${response.status}): ${parsed.error}` : `Thingtime credential fetch failed (${response.status}).`);
  return validate(parsed);
};

const safeCache = async (file) => {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed.runId !== process.env.GITHUB_RUN_ID || parsed.runAttempt !== process.env.GITHUB_RUN_ATTEMPT) return null;
    return validate({ ok: true, credentials: parsed.credentials });
  } catch {
    return null;
  }
};

const exportBundle = async (credentials, file) => {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, credentials })}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
  await chmod(file, 0o600);
  for (const row of credentials) process.stdout.write(`::add-mask::${row.value}\n`);
  const envFile = required('GITHUB_ENV');
  const lines = [];
  for (let slot = 1; slot <= MAX_CREDENTIALS; slot += 1) {
    const row = credentials[slot - 1];
    lines.push(`LOPU_CLAUDE_TOKEN_${slot}=${row?.value ?? ''}`);
    lines.push(`LOPU_CLAUDE_NAME_${slot}=${row?.name ?? ''}`);
  }
  lines.push(`LOPU_CLAUDE_CREDENTIAL_COUNT=${credentials.length}`);
  lines.push(`LOPU_CLAUDE_CREDENTIAL_BUNDLE=${file}`);
  await writeFile(envFile, `${lines.join('\n')}\n`, { flag: 'a' });
  const outputFile = required('GITHUB_OUTPUT');
  await writeFile(outputFile, `count=${credentials.length}\n`, { flag: 'a' });
  process.stdout.write(`Loaded ${credentials.length} ordered Claude credential${credentials.length === 1 ? '' : 's'} from Thingtime.\n`);
};

const main = async () => {
  const file = path.join(required('RUNNER_TEMP'), 'lopu-credential-vault.json');
  if (process.argv[2] === 'needles') {
    const output = process.argv[3];
    const runnerTemp = `${path.resolve(required('RUNNER_TEMP'))}${path.sep}`;
    if (!output || !path.isAbsolute(output) || !`${path.resolve(output)}`.startsWith(runnerTemp)) throw new Error('Credential needle output must be inside RUNNER_TEMP.');
    const credentials = await safeCache(file);
    if (!credentials) {
      try { await readFile(file, 'utf8'); } catch {
        await writeFile(output, '', { mode: 0o600 });
        return;
      }
      throw new Error('The current-run credential cache is invalid.');
    }
    const needles = credentials.flatMap((row) => [row.value, Buffer.from(row.value, 'utf8').toString('base64')]);
    await writeFile(output, `${needles.join('\n')}\n`, { mode: 0o600 });
    await chmod(output, 0o600);
    return;
  }
  const cached = await safeCache(file);
  let credentials = cached;
  if (!credentials) {
    try {
      credentials = await fetchBundle();
    } catch (error) {
      const legacy = legacyCredentials().map((row, priority) => ({ id: `legacy-${priority + 1}`, ...row, credentialType: 'claude-code-oauth-token', priority }));
      if (!legacy.length) throw error;
      process.stdout.write('::warning::Thingtime credential vault was unavailable; using the transitional in-memory GitHub credential slots for this run.\n');
      credentials = legacy;
    }
  }
  if (!credentials.length) throw new Error('The Thingtime Lopu credential waterfall has no enabled credentials.');
  await exportBundle(credentials, file);
};

main().catch((error) => {
  process.stderr.write(`::error::${error instanceof Error ? error.message : 'Credential vault fetch failed.'}\n`);
  process.exitCode = 1;
});
