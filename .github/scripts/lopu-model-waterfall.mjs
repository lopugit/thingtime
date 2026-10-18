#!/usr/bin/env node
// The database setting is the only model/effort order. This adapter compiles a
// validated plan into native, pinned provider actions; it never invents a model.
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, rename, copyFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBundle, legacyCredentials, validate } from './lopu-credential-vault.mjs';
import { classifyClaudeCredentialFailure } from './classify-claude-credential-failure.mjs';

const CLAUDE = 'anthropics/claude-code-action@1623c36729ac1cd5895198cded705a287de7db79';
const CODEX = 'openai/codex-action@86365089eb2b84e0a8fb0717b304f8bdcb13b20e';
const KEY = 'Thingtime.PRConflictAutoResolverModelWaterfall';
const MAX_BYTES = 256 * 1024;
const ROOT = '.lopu-waterfall-action';
const req = name => { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value; };
const expr = value => '${{ ' + value + ' }}';

export function parseWaterfall(data) {
  if (data?.ok !== true || data.key !== KEY || !Array.isArray(data.waterfall) || !data.waterfall.length || data.waterfall.length > 256
      || !Array.isArray(data.models) || new Set(data.waterfall).size !== data.waterfall.length) throw new Error('Invalid configured AI waterfall.');
  return data.waterfall.map(id => {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,100}(?::[a-z]+){0,2}$/.test(id)) throw new Error('Invalid configured model option.');
    const [model, ...options] = id.split(':');
    const catalog = data.models.find(row => row.id === model);
    const effort = options.find(value => value !== 'fast') ?? '';
    if (!catalog || new Set(options).size !== options.length || options.filter(value => value !== 'fast').length > 1
        || (effort && !['none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort))
        || (effort && !catalog.efforts?.includes(effort))) throw new Error('Configured model or effort is absent from the provider catalog.');
    const backend = catalog.provider === 'anthropic' || (model === 'default' && catalog.provider === 'default') ? 'claude'
      : catalog.provider === 'openai' ? 'codex' : null;
    if (!backend) throw new Error('A configured provider has no GitHub Lopu agent adapter.');
    // Neither adapter may silently change an explicitly requested speed.
    if (options.includes('fast')) throw new Error('Fast model options are not supported by the GitHub Lopu adapters. Choose normal speed.');
    return { id, model, effort, backend, platform: backend === 'claude' ? 'Anthropic' : 'OpenAI', label: `${backend === 'claude' ? 'Claude Code' : 'OpenAI API'} ${model}${effort ? ` ${effort}` : ''}` };
  });
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Configured AI endpoint returned HTTP ${response.status}.`); }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Configured AI response exceeded its limit.');
  try { return JSON.parse(text); } catch { throw new Error('Configured AI endpoint returned invalid JSON.'); }
}

export function acceptsCapabilities(manifest, origin) {
  const needs = { 'api.settings-pr-conflict-auto-resolver-model-waterfall': [1,1,0], 'api.integration-ci-credentials': [1,1,1] };
  return manifest?.schemaVersion === 1 && manifest.origin === origin && Object.entries(needs).every(([feature, [major, minor, patch]]) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.features?.[feature]?.version ?? '');
    return !!match && +match[1] === major && (+match[2] > minor || (+match[2] === minor && +match[3] >= patch));
  });
}

async function configuredPlan() {
  const url = new URL(process.env.THINGTIME_CREDENTIAL_VAULT_ORIGIN || 'https://thingtime.com');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The model/vault origin must use HTTPS without embedded credentials.');
  if (!acceptsCapabilities(await jsonFetch(`${url.origin}/.well-known/thingtime-capabilities.json`), url.origin)) throw new Error('The configured origin lacks compatible Lopu capabilities.');
  return parseWaterfall(await jsonFetch(`${url.origin}/api/v1/settings/pr-conflict-auto-resolver-model-waterfall`));
}

export function orderedAttempts(plan, bundles) {
  return plan.flatMap(entry => {
    const rows = bundles[entry.platform] ?? [];
    return rows.length ? rows.map((row, index) => ({ ...entry, slot: index + 1, name: row.name })) : [{ ...entry, slot: 0, name: '' }];
  });
}

// Remove only the old model routing flags; preserve the caller's tool and turn
// constraints verbatim. Per-attempt model and effort are added from the DB plan.
export function taskClaudeArgs(value = '') {
  return value.replace(/(?:^|\s)--(?:fallback-model|model|effort)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/g, ' ').trim();
}

const shell = (name, id, run, extra = {}) => ({ name, ...(id ? { id } : {}), shell: 'bash', run, ...extra });
export function compileAction(attempts, hashes = {}) {
  const verifiedRun = operation => {
    const checks = Object.entries(hashes).map(([file, hash]) => `${hash}  ${file}`).join('\n');
    return `cd "$GITHUB_ACTION_PATH"\nprintf '%s\n' '${checks}' | sha256sum --check --status\nnode "$GITHUB_ACTION_PATH/lopu-model-waterfall.mjs" ${operation}`;
  };
  const steps = [];
  const input = name => expr(`inputs['${name}']`);
  for (const [index, attempt] of attempts.entries()) {
    const i = String(index);
    steps.push(shell(`Check configured entry ${index + 1}: ${attempt.id}`, `check_${i}`, verifiedRun('check'), {
      if: index ? expr(`success() && steps.result_${index - 1}.outputs.retryable == 'true'`) : expr('success()'),
      env: { ATTEMPT_INDEX: i, CALLER_CLAUDE_ARGS: input('claude-args') }
    }));
    const withArgs = attempt.backend === 'claude' ? {
      claude_code_oauth_token: expr(`env.LOPU_CLAUDE_TOKEN_${attempt.slot}`), github_token: input('github-token'),
      allowed_bots: input('allowed-bots'), prompt: input('prompt'), settings: input('settings'),
      claude_args: expr(`steps.check_${i}.outputs.claude_args`)
    } : {
      'openai-api-key': expr(`env.LOPU_OPENAI_TOKEN_${attempt.slot}`), 'working-directory': input('working-directory'),
      sandbox: input('sandbox'), 'safety-strategy': 'drop-sudo', model: attempt.model,
      ...(attempt.effort ? { effort: attempt.effort } : {}),
      'codex-home': expr(`format('{0}/lopu-codex-${attempt.nonce}-${i}', runner.temp)`),
      'codex-args': '["--json"]', 'allow-bots': true, 'allow-bot-users': input('allowed-bots'), prompt: input('prompt')
    };
    steps.push({ name: `Run configured entry ${index + 1}: ${attempt.id}`, id: `agent_${i}`, if: expr(`steps.check_${i}.outputs.available == 'true'`),
      'continue-on-error': true, uses: attempt.backend === 'claude' ? CLAUDE : CODEX,
      env: { GH_TOKEN: input('github-token') }, with: withArgs });
    steps.push(shell(`Classify configured entry ${index + 1}`, `result_${i}`, verifiedRun('classify'), {
      if: expr(`success() && steps.check_${i}.outcome == 'success'`), env: {
        ATTEMPT_INDEX: i, AGENT_OUTCOME: expr(`steps.agent_${i}.outcome`),
        PREFLIGHT_RETRYABLE: expr(`steps.check_${i}.outputs.retryable`),
        EXECUTION_FILE: expr(`steps.agent_${i}.outputs.execution_file`)
      }
    }));
  }
  steps.push(shell('Record the actual provider and require success', 'result', verifiedRun('finish'), {
    if: expr('always()'), env: { OUTCOMES: JSON.stringify(attempts.map((_, i) => expr(`steps.agent_${i}.outcome`))) }
  }));
  return { name: 'Configured Lopu waterfall', description: 'Compiled from the validated Thingtime admin model order.',
    inputs: Object.fromEntries(['prompt','settings','github-token','allowed-bots','claude-args','working-directory','sandbox'].map(name => [name, { required: false, description: name }])),
    outputs: Object.fromEntries(['backend','backend-label','claude-credential-slot','claude-credential-name'].map(name => [name, { description: name, value: expr(`steps.result.outputs['${name}']`) }])),
    runs: { using: 'composite', steps } };
}

async function privateJson(file, value) {
  const temp = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(temp, file); await chmod(file, 0o600);
}
async function prepare() {
  if (!['read-only','workspace-write','danger-full-access'].includes(req('LOPU_SANDBOX')) || req('LOPU_SAFETY_STRATEGY') !== 'drop-sudo') throw new Error('Invalid Lopu sandbox/hardening strategy.');
  const plan = await configuredPlan();
  const bundles = {};
  const lines = ['LOPU_SELECTED_OPENAI_API_KEY=', 'LOPU_SELECTED_BACKEND=', 'LOPU_SELECTED_MODEL='];
  for (const platform of [...new Set(plan.map(entry => entry.platform))]) {
    let rows;
    try { rows = await fetchBundle(platform); }
    catch (error) {
      if (platform !== 'Anthropic') throw error;
      rows = legacyCredentials().map((row, index) => ({ ...row, id: `legacy-${index + 1}`, platform, credentialType: 'claude-code-oauth-token' }));
      if (!rows.length) throw error;
    }
    bundles[platform] = validate({ ok: true, credentials: rows }, platform);
    for (const row of rows) process.stdout.write(`::add-mask::${row.value}\n`);
    const prefix = platform === 'Anthropic' ? 'LOPU_CLAUDE' : 'LOPU_OPENAI';
    for (let index = 0; index < 8; index++) lines.push(`${prefix}_TOKEN_${index + 1}=${rows[index]?.value ?? ''}`, `${prefix}_NAME_${index + 1}=${rows[index]?.name ?? ''}`);
    lines.push(`${prefix}_CREDENTIAL_COUNT=${rows.length}`);
    const file = path.join(req('RUNNER_TEMP'), platform === 'Anthropic' ? 'lopu-credential-vault.json' : 'lopu-openai-vault.json');
    await privateJson(file, { runId: req('GITHUB_RUN_ID'), runAttempt: req('GITHUB_RUN_ATTEMPT'), credentials: rows });
  }
  const nonce = randomBytes(12).toString('hex');
  const attempts = orderedAttempts(plan, bundles).map(entry => ({ ...entry, nonce }));
  const directory = path.join(req('GITHUB_WORKSPACE'), ROOT);
  // Never overwrite a directory supplied by a checkout or a previous model.
  await mkdir(directory, { mode: 0o700 });
  await writeFile(req('GITHUB_OUTPUT'), 'prepared=true\n', { flag: 'a' });
  for (const file of ['lopu-model-waterfall.mjs','lopu-credential-vault.mjs','classify-claude-credential-failure.mjs']) await copyFile(new URL(file, import.meta.url), path.join(directory, file));
  await privateJson(path.join(directory, 'plan.json'), attempts);
  const hashes = {};
  for (const file of ['lopu-model-waterfall.mjs','lopu-credential-vault.mjs','classify-claude-credential-failure.mjs','plan.json']) hashes[file] = createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex');
  await writeFile(path.join(directory, 'action.yml'), JSON.stringify(compileAction(attempts, hashes), null, 2));
  await writeFile(req('GITHUB_ENV'), lines.join('\n') + '\n', { flag: 'a' });
  await writeFile(req('GITHUB_OUTPUT'), 'prepared=true\n', { flag: 'a' });
  console.log(`Lopu admin model order: ${plan.map(entry => entry.id).join(' → ')}`);
}

const output = async values => writeFile(req('GITHUB_OUTPUT'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'a' });
const readPlan = async () => JSON.parse(await readFile(new URL('plan.json', import.meta.url), 'utf8'));
export function retryableOpenAiError(status, code) {
  return [401,403,429,500,502,503,504].includes(status) || (status === 404 && ['model_not_found','model_not_available'].includes(code));
}
async function check() {
  const plan = await readPlan(); const entry = plan[Number(req('ATTEMPT_INDEX'))];
  if (!entry) throw new Error('Invalid attempt index.');
  if (!entry.slot) { console.log(`No enabled ${entry.platform} credential; advancing the configured order.`); return output({ available: false, retryable: true }); }
  if (entry.backend === 'claude') await rm(path.join(req('RUNNER_TEMP'), 'claude-execution-output.json'), { force: true });
  if (entry.backend === 'codex') {
    // Check capacity before giving an agent a mutable task. An ambiguous
    // network failure stops; only an explicit provider rejection advances.
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req(`LOPU_OPENAI_TOKEN_${entry.slot}`)}` },
      body: JSON.stringify({ model: entry.model, input: 'Reply OK.', max_output_tokens: 16, store: false, ...(entry.effort ? { reasoning: { effort: entry.effort } } : {}) }),
      redirect: 'error', signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      return output({ available: false, retryable: retryableOpenAiError(response.status, data?.error?.code) });
    }
    await response.body?.cancel();
  }
  const claudeArgs = `${taskClaudeArgs(process.env.CALLER_CLAUDE_ARGS)} --model ${entry.model}${entry.effort ? ` --effort ${entry.effort}` : ''}`.trim();
  // Trusted caller arguments can be multiline. GitHub's delimiter syntax
  // preserves them without allowing argument text to introduce other outputs.
  const delimiter = randomBytes(24).toString('hex');
  await writeFile(req('GITHUB_OUTPUT'), `claude_args<<${delimiter}\n${claudeArgs}\n${delimiter}\n`, { flag: 'a' });
  await output({ available: true, retryable: false });
}

async function codexErrors(directory) {
  const errors = [];
  async function walk(dir) {
    let files; try { files = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const file of files) {
      const full = path.join(dir, file.name);
      if (file.isDirectory()) await walk(full);
      else if (file.isFile() && file.name.endsWith('.jsonl')) {
        const content = await readFile(full, 'utf8');
        for (const line of content.split('\n')) {
          try {
            const row = JSON.parse(line);
            // Only terminal error events, never user prompts or tool output.
            if (row.type === 'turn.failed' && row.error) errors.push(row.error);
            if (row.type === 'event_msg' && row.payload?.type === 'error') errors.push(row.payload);
          } catch { /* incomplete terminal record is not retry evidence */ }
        }
      }
    }
  }
  await walk(path.join(directory, 'sessions'));
  return errors;
}
// Task text and tool output may quote quota/authentication errors. Only the
// provider's terminal result or explicitly marked API error is retry evidence.
export function claudeProviderErrors(data) {
  const messages = Array.isArray(data) ? data : [data];
  const result = messages.findLast(message => message?.type === 'result');
  if (!result || result.is_error !== true) return [];
  return [
    { type: result.type, is_error: result.is_error, subtype: result.subtype,
      num_turns: result.num_turns, total_cost_usd: result.total_cost_usd,
      error: result.error, errors: result.errors },
    ...messages.filter(message => message?.type === 'assistant' &&
      ['authentication_failed', 'rate_limit', 'billing_error'].includes(message.error))
      .map(message => ({ error: message.error, message: message.message?.content }))
  ];
}
async function classify() {
  const entry = (await readPlan())[Number(req('ATTEMPT_INDEX'))];
  const outcome = process.env.AGENT_OUTCOME;
  if (outcome === 'skipped') return output({ retryable: process.env.PREFLIGHT_RETRYABLE === 'true' });
  if (outcome !== 'failure') return output({ retryable: false });
  let data;
  if (entry.backend === 'claude') {
    try { data = JSON.parse(await readFile(process.env.EXECUTION_FILE || path.join(req('RUNNER_TEMP'), 'claude-execution-output.json'), 'utf8')); data = claudeProviderErrors(data); }
    catch { return output({ retryable: false }); }
  } else data = await codexErrors(path.join(req('RUNNER_TEMP'), `lopu-codex-${entry.nonce}-${req('ATTEMPT_INDEX')}`));
  return output({ retryable: classifyClaudeCredentialFailure(data).retryable });
}
async function finish() {
  const plan = await readPlan(); const outcomes = JSON.parse(req('OUTCOMES'));
  const selected = outcomes.findIndex(outcome => outcome === 'success');
  const last = selected >= 0 ? selected : outcomes.findLastIndex(outcome => outcome === 'failure');
  if (last >= 0) {
    const entry = plan[last];
    const values = { backend: entry.backend, 'backend-label': entry.label };
    if (entry.backend === 'claude') {
      values['claude-credential-slot'] = `vault-${entry.slot}`; values['claude-credential-name'] = entry.name;
      await writeFile(path.join(req('RUNNER_TEMP'), 'lopu-claude-credential-slot'), `vault-${entry.slot}\n`);
      await writeFile(path.join(req('RUNNER_TEMP'), 'lopu-claude-credential-token'), req(`LOPU_CLAUDE_TOKEN_${entry.slot}`), { mode: 0o600 });
      await chmod(path.join(req('RUNNER_TEMP'), 'lopu-claude-credential-token'), 0o600);
    }
    if (selected >= 0) await writeFile(req('GITHUB_ENV'), [
      `LOPU_SELECTED_BACKEND=${entry.backend}`, `LOPU_SELECTED_MODEL=${entry.model}`,
      `LOPU_SELECTED_OPENAI_API_KEY=${entry.backend === 'codex' ? req(`LOPU_OPENAI_TOKEN_${entry.slot}`) : ''}`
    ].join('\n') + '\n', { flag: 'a' });
    await output(values); console.log(`Lopu actual backend: ${entry.label}`);
  }
  if (selected < 0) throw new Error('The configured AI waterfall did not complete. No unconfigured model was attempted.');
}
async function metadata() {
  const plan = await configuredPlan(); const first = plan[0];
  await output({ model_args: first.backend === 'claude' ? `--model ${first.model}${first.effort ? ` --effort ${first.effort}` : ''}` : '', primary_model: first.model,
    backend_label: first.label, agent_backend: first.backend, agent_backend_label: first.label, review_backend: first.backend, review_backend_label: first.label,
    codex_model: first.backend === 'codex' ? first.model : '', codex_reasoning_effort: first.backend === 'codex' ? first.effort : '' });
}
async function main() {
  switch (process.argv[2]) {
    case 'prepare': return prepare();
    case 'metadata': return metadata();
    case 'check': return check();
    case 'classify': return classify();
    case 'finish': return finish();
    case 'cleanup': return rm(path.join(req('GITHUB_WORKSPACE'), ROOT), { recursive: true, force: true });
    default: throw new Error('Unknown waterfall operation.');
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => { console.error('::error::Lopu configured waterfall failed; no secrets or provider response bodies are logged.'); process.exitCode = 1; });
