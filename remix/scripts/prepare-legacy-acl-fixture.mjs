#!/usr/bin/env node
// Build provenance for mixed-runtime acceptance, never a deployable fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, symlink, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const current = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const destination = resolve(process.argv[2] || '');
assert(process.argv[2] && !destination.startsWith(current + '/'), 'Supply a new external fixture directory');
assert(!(await access(destination).then(() => true).catch(() => false)), 'Fixture destination must not already exist');
const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { cwd: current, stdio: ['ignore', 'pipe', 'inherit'], ...options });
  const chunks = []; child.stdout?.on('data', chunk => chunks.push(chunk));
  child.on('error', reject); child.on('exit', code => code === 0 ? resolvePromise(Buffer.concat(chunks)) : reject(new Error(`${command} exited ${code}`)));
});
const selectedRevision = process.argv[3] || '451e79e';
assert(['451e79e', 'b8912cec'].includes(selectedRevision), 'Select the known inline-ACL or pre-floor relational fixture revision');
const revision = (await run('git', ['rev-parse', `${selectedRevision}^{commit}`])).toString().trim();
assert.equal((await run('git', ['diff', revision, '--', 'remix/pnpm-lock.yaml'])).length, 0, 'Legacy/current dependency lock must match before read-only dependency sharing');
await mkdir(destination, { recursive: true });
const archive = spawn('git', ['archive', revision, 'remix', 'docs/design'], { cwd: current, stdio: ['ignore', 'pipe', 'inherit'] });
const extract = spawn('tar', ['-x', '-C', destination], { stdio: ['pipe', 'inherit', 'inherit'] });
archive.stdout.pipe(extract.stdin);
await Promise.all([archive, extract].map(child => new Promise((done, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(new Error('Legacy archive extraction failed'))); })));
const remix = join(destination, 'remix');
await mkdir(join(remix, 'node_modules'));
for (const name of await readdir(join(current, 'remix/node_modules'))) {
  if (name !== '.nitro' && name !== '.cache') await symlink(join(current, 'remix/node_modules', name), join(remix, 'node_modules', name));
}
await symlink(join(current, 'remix/dist'), join(remix, 'dist'));
const assets = join(remix, 'server/assets'); await mkdir(assets, { recursive: true });
for (const name of await readdir(join(current, 'remix/server/assets'))) {
  const bytes = await readFile(join(current, 'remix/server/assets', name));
  await writeFile(join(assets, name), bytes);
}
const source = join(remix, 'app/api/utils/things/things.ts');
const original = await readFile(source, 'utf8');
const needle = '\tconst expectedSize = storageTracked\n';
assert.equal(original.split(needle).length, 2, 'Exactly one known legacy update timing boundary');
const barrier = `  // Acceptance-only timing barrier: authorization and mutation inputs are unchanged.
  if (process.env.THINGTIME_LEGACY_ACL_BARRIER_DIR) {
    const fs = await import('node:fs/promises');
    const dir = process.env.THINGTIME_LEGACY_ACL_BARRIER_DIR;
    const gate = await fs.readFile(dir + '/arm.json', 'utf8').then(JSON.parse).catch(() => null);
    if (gate?.id === doc.shareId) {
      await fs.writeFile(dir + '/entered.json', JSON.stringify({ id: doc.shareId, ordinaryCas: !storageScope?.sandbox, updatedAt: doc.updatedAt }));
      const deadline = Date.now() + 30000;
      while (!(await fs.access(dir + '/release').then(() => true).catch(() => false))) {
        if (Date.now() > deadline) throw new Error('Acceptance timing barrier timeout');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }
`;
const instrumented = selectedRevision === '451e79e' ? original.replace(needle, barrier + needle) : original;
await writeFile(source, instrumented);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await writeFile(join(remix, '.legacy-acl-fixture.json'), JSON.stringify({ revision, originalWriterSha256: hash(original), instrumentedWriterSha256: hash(instrumented), dependencyLockSha256: hash(await readFile(join(remix, 'pnpm-lock.yaml'))), ignoredEnvironmentCopied: false, generatedReuse: ['dist', 'server/assets'], instrumentation: selectedRevision === '451e79e' ? 'timing-only before expectedSize/updateOne' : 'none' }, null, 2));
console.log(JSON.stringify({ fixture: destination, revision, next: 'Build with NITRO_PRESET=node-server corepack pnpm exec nitro build from fixture/remix; run current harness --scoped-reconnect --mixed-legacy-acl with AGENT_REPORTING_LEGACY_SERVER pointing to fixture/remix/.output/server/index.mjs' }));
