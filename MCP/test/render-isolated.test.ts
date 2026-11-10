import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
// @ts-expect-error JavaScript launcher is intentionally usable without a TS runtime.
import { parseOptions, runArguments, verifyMount } from '../scripts/render-isolated.mjs';

const image = `sha256:${'a'.repeat(64)}`;
test('isolated renderer requires explicit pinned image and socket; never accepts extra Docker arguments', () => {
  assert.throws(() => parseOptions([]), /exact cached image/);
  assert.throws(() => parseOptions(['--image', image, '--socket', '/tmp/docker.sock', '--privileged', 'true']), /Expected/);
  const options = parseOptions(['--image', image, '--socket', '/tmp/docker.sock']);
  const args = runArguments(options, 'test-task', 'test-assets');
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('no-new-privileges'));
  assert.ok(args.includes('-i'));
  assert.equal(args.filter((x: string) => x.startsWith('type=bind')).length, 0);
  assert.ok(args.includes('type=volume,src=test-assets,dst=/opt/thingtime,readonly'));
  assert.ok(args.includes('1001:1001'));
  assert.ok(!args.includes('--env-file') && !args.includes('--privileged') && !args.includes('-p'));
});

test('mounted trees reject dotenv files and escaping symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tt-render-mount-'));
  try {
    await writeFile(join(root, '.env'), 'synthetic-not-a-secret');
    await assert.rejects(verifyMount(root), /dotenv/);
    await rm(join(root, '.env'));
    await symlink(tmpdir(), join(root, 'escape'));
    await assert.rejects(verifyMount(root), /escaping symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed Docker invocation preserves failure, sanitizes CLI environment and cleans temporary state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tt-render-launch-'));
  const socket = join(root, 'docker.sock');
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(socket, resolve));
  try {
    const log = join(root, 'calls.jsonl');
    const docker = join(root, 'docker');
    const timeoutFlag = join(root, 'test-timeout');
    await mkdir(join(root, 'resources'));
    await writeFile(docker, `#!${process.execPath}
const fs=require('fs'),path=require('path'),a=process.argv.slice(2),base=${JSON.stringify(root)};
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args:[...a],env:process.env,cwd:process.cwd()})+'\\n');
a.splice(a.indexOf('--config'),2);const labels={};for(let i=0;i<a.length;i++)if(a[i]==='--label'){const [k,...v]=a[i+1].split('=');labels[k]=v.join('=');}const p=n=>path.join(base,'resources',n);
if(a[0]==='image')console.log(${JSON.stringify(image)});
else if(a.includes('inspect')){const id=a[a.indexOf('inspect')+1];if(!fs.existsSync(p(id))){console.error('No such '+a[0]);process.exit(1);}console.log(JSON.stringify(JSON.parse(fs.readFileSync(p(id))).labels));}
else if(a[0]==='volume'&&a[1]==='create'){fs.writeFileSync(p(a.at(-1)),JSON.stringify({labels}));console.log(a.at(-1));}
else if(a.includes('rm')){const id=a.at(-1);if(fs.existsSync(p(id))){const v=JSON.parse(fs.readFileSync(p(id)));if(v.pid)try{process.kill(v.pid,'SIGTERM')}catch{}try{fs.unlinkSync(p(id))}catch{}}else{console.error('No such '+(a[0]==='volume'?'volume':'container'));process.exit(1);}}
else if(a[0]==='run'){const name=a[a.indexOf('--name')+1];fs.writeFileSync(p(name),JSON.stringify({labels,pid:process.pid}));const finish=code=>{try{fs.unlinkSync(p(name))}catch{}process.exit(code)};process.on('SIGTERM',()=>finish(143));if(name.endsWith('-stage')){process.stdin.resume();process.stdin.on('end',()=>finish(0));}else if(fs.existsSync(${JSON.stringify(timeoutFlag)}))setInterval(()=>{},1000);else finish(17);}
`);
    await chmod(docker, 0o700);
    for (const name of ['dist', 'modules', 'renderer']) await mkdir(join(root, name));
    await writeFile(join(root, 'modules/actual.js'), 'module.exports = {};');
    await symlink('actual.js', join(root, 'modules/alias.js'));
    const result = spawnSync(process.execPath, ['scripts/render-isolated.mjs', '--docker', docker,
      '--socket', socket, '--image', image, '--mcp-dist', join(root, 'dist'),
      '--mcp-modules', join(root, 'modules'), '--renderer', join(root, 'renderer')], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 15000,
      env: { ...process.env, THINGTIME_FAKE_SECRET: 'do-not-forward', NODE_OPTIONS: '' }
    });
    assert.equal(result.status, 17, result.stderr);
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.some(call => call.args.includes('volume') && call.args.includes('rm')));
    assert.deepEqual(await readdir(join(root, 'resources')), []);
    for (const call of calls) {
      assert.equal(call.env.THINGTIME_FAKE_SECRET, undefined);
      assert.equal(call.env.NODE_OPTIONS, undefined);
      assert.equal(call.env.DOCKER_HOST, `unix://${socket}`);
    }
    await assert.rejects(readFile(join(calls[0].cwd, 'config.json')), /ENOENT/);
    await assert.rejects(readFile(calls[0].cwd), /ENOENT/);
    await writeFile(timeoutFlag, 'synthetic timeout scenario');
    await writeFile(log, '');
    const expired = spawnSync(process.execPath, ['scripts/render-isolated.mjs', '--docker', docker,
      '--socket', socket, '--image', image, '--mcp-dist', join(root, 'dist'),
      '--mcp-modules', join(root, 'modules'), '--renderer', join(root, 'renderer'), '--lifetime-seconds', '1'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 15000
    });
    assert.equal(expired.status, 124, expired.stderr);
    const expiredCalls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(await readdir(join(root, 'resources')), []);
    await assert.rejects(readFile(expiredCalls[0].cwd), /ENOENT/);
    await writeFile(log, '');
    const killed = spawn(process.execPath, ['scripts/render-isolated.mjs', '--docker', docker,
      '--socket', socket, '--image', image, '--mcp-dist', join(root, 'dist'),
      '--mcp-modules', join(root, 'modules'), '--renderer', join(root, 'renderer')], {
      cwd: new URL('..', import.meta.url), detached: true, stdio: ['pipe', 'ignore', 'pipe']
    });
    let killedErrors = ''; killed.stderr.on('data', chunk => killedErrors += chunk);
    const exited = new Promise(resolve => killed.once('exit', resolve));
    let runtimeReady = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await readdir(join(root, 'resources'))).some(name => !name.endsWith('-assets') && !name.endsWith('-stage'))) { runtimeReady = true; break; }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (!runtimeReady) { killed.kill('SIGKILL'); killed.stdin.destroy(); killed.stderr.destroy(); console.error('runtime diagnostic', killedErrors, await readFile(log, 'utf8')); }
    assert.ok(runtimeReady, 'runtime starts before forced wrapper loss');
    process.kill(-killed.pid!, 'SIGKILL'); await exited;
    let orphanCleaned = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await readdir(join(root, 'resources'))).length === 0) { orphanCleaned = true; break; }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    killed.stdin.destroy(); killed.stderr.destroy();
    if (!orphanCleaned) console.error('guardian diagnostic', killedErrors, await readFile(log, 'utf8'));
    assert.ok(orphanCleaned, 'detached IPC guardian cleans exact resources after wrapper SIGKILL');
    const killedCalls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    for (let attempt=0;attempt<100;attempt++) { try { await readdir(killedCalls[0].cwd); } catch { break; } await new Promise(resolve=>setTimeout(resolve,30)); }
    await assert.rejects(readFile(killedCalls[0].cwd), /ENOENT/);
  } finally {
    await new Promise<void>(resolve => listener.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup refuses a matching resource name with a different ownership label', async () => {
  const root = await mkdtemp(join(tmpdir(), 'thingtime-render-docker-'));
  try {
    const docker = join(root, 'docker'), log = join(root, 'calls');
    await writeFile(docker, `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');console.log(JSON.stringify({'thingtime.render-isolated':'true','thingtime.render-session':'some-other-owner'}));\n`);
    await chmod(docker, 0o700);
    const { cleanupOwned } = await import('../scripts/render-isolated.mjs');
    await assert.rejects(cleanupOwned({docker, socket:'/tmp/test.sock'}, root, 'thingtime-render-11111111-1111-1111-1111-111111111111'), /mismatched ownership/);
    assert.ok(!(await readFile(log,'utf8')).includes('"rm"'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('cleanup repeats the complete ownership sweep to catch a late acquisition', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'tt-render-late-'));
  const directory = await mkdtemp(join(tmpdir(), 'thingtime-render-docker-'));
  try {
    const docker = join(fixture, 'docker'), log = join(fixture, 'calls'), marker = join(fixture, 'late');
    const name = 'thingtime-render-11111111-1111-1111-1111-111111111111';
    await writeFile(docker, `#!${process.execPath}\nconst fs=require('fs'),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');if(a.includes('rm'))fs.writeFileSync(${JSON.stringify(marker)},'removed');else if(a.includes(${JSON.stringify(name)})){if(!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'created-after-first-inspect');console.error('No such container');process.exit(1);}if(fs.readFileSync(${JSON.stringify(marker)},'utf8')!=='removed'){console.log(JSON.stringify({'thingtime.render-isolated':'true','thingtime.render-session':${JSON.stringify(name)}}));process.exit(0);}}console.error('No such object');process.exit(1);\n`);
    await chmod(docker,0o700);
    const { cleanupOwned } = await import('../scripts/render-isolated.mjs');
    await cleanupOwned({docker,socket:'/tmp/test.sock'},directory,name);
    assert.equal(await readFile(marker,'utf8'),'removed');
    assert.ok((await readFile(log,'utf8')).split('\n').filter(line=>line.includes('"container","inspect"')).length >= 6);
    await assert.rejects(readdir(directory),/ENOENT/);
  } finally { await rm(fixture,{recursive:true,force:true}); await rm(directory,{recursive:true,force:true}); }
});
