import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanupOwned, runArguments } from '../scripts/render-isolated.mjs';
import { stdioFrames } from './helpers/stdio-frames.mjs';

const STARTUP_MS = 90000, SHUTDOWN_MS = 10000, CLEANUP_MS = 35000;
// Allow the configured startup budget plus teardown within the session deadline.
const SESSION_SECONDS = 150, SCENARIO_MS = 180000;

test('real Docker: stdin EOF, wrapper process-group SIGKILL, independent runtime deadline', {
  skip: process.env.TT_RENDER_WRAPPER_TEST !== '1', timeout: 420000
}, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'tt-render-lifecycle-'));
  const state = await mkdtemp(join(tmpdir(), 'thingtime-render-docker-'));
  const callsFile = join(fixture, 'docker-calls.jsonl'), shim = join(fixture, 'docker');
  // Recording shim forwards the exact arguments/stdio to the real daemon CLI.
  // It identifies this launch's private directory/UUID without inspecting or
  // cleaning another connection, including a concurrently restarted desktop.
  await writeFile(shim, `#!${process.execPath}\nconst fs=require('fs'),{spawnSync}=require('child_process'),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify(a)+'\\n');const r=spawnSync('/opt/homebrew/bin/docker',a,{stdio:'inherit',env:process.env});process.exit(r.status??1);\n`, { mode: 0o700 });
  await chmod(shim,0o700);
  const options = { docker: shim, socket: process.env.TT_RENDER_DOCKER_SOCKET, image: process.env.TT_RENDER_DOCKER_IMAGE, 'lifetime-seconds': '1' };
  assert.match(options.image || '', /^sha256:[a-f0-9]{64}$/); assert.ok(options.socket);
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: state, TMPDIR: tmpdir(), DOCKER_HOST: `unix://${options.socket}` };
  const docker = args => spawnSync(options.docker, ['--config', state, ...args], { env, cwd: state, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536 });
  const calls = async () => { try { return (await readFile(callsFile,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  const gone = name => ['container', 'volume'].every(kind => { const r = docker([kind, 'inspect', kind === 'volume' ? `${name}-assets` : name]); return r.status !== 0 && /no such (container|volume|object)/i.test(r.stderr); });
  const report = { image: options.image, budgets: { startupMs: STARTUP_MS, shutdownMs: SHUTDOWN_MS, cleanupMs: CLEANUP_MS, sessionSeconds: SESSION_SECONDS, scenarioMs: SCENARIO_MS, testMs: 420000 }, scenarios: [], scope: 'Actual Docker lifecycle acceptance; no model or browser/render call; exact-argument recording CLI shim' };
  try {
    for (const scenario of ['stdin EOF', 'process-group SIGKILL']) {
      const offset = (await calls()).length;
      const child = spawn(process.execPath, ['scripts/render-isolated.mjs', '--docker', shim, '--socket', options.socket, '--image', options.image, '--lifetime-seconds', String(SESSION_SECONDS)], { detached: true, stdio: ['pipe','pipe','pipe'] });
      let diagnostics='', name, directory, framingError;
      const readFrames = stdioFrames(), responses = new Map();
      child.stdout.on('data', chunk => {
        try { for (const message of readFrames(chunk)) if ('id' in message) responses.set(message.id,message); }
        catch(error) { framingError=error; try { process.kill(-child.pid,'SIGKILL'); } catch {} }
      });
      const scenarioDeadline = setTimeout(() => { try { process.kill(-child.pid,'SIGKILL'); } catch {} },SCENARIO_MS);
      child.stderr.on('data', b => { diagnostics=(diagnostics+b).slice(-4000); });
      const exited = new Promise(resolve => child.once('exit',(code,signal)=>resolve({code,signal})));
      const readyDeadline=Date.now()+STARTUP_MS;
      const response = async id => {
        while(Date.now()<readyDeadline) {
          if(framingError)throw framingError;
          if(responses.has(id))return responses.get(id);
          if(child.exitCode!==null||child.signalCode!==null)throw Error('Wrapper exited during startup: '+diagnostics);
          await new Promise(r=>setTimeout(r,50));
        }
        throw Error('Wrapper did not initialize within startup budget: '+diagnostics);
      };
      try {
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'lifecycle',version:'1'}}})+'\n');
        assert.ok((await response(1)).result);
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');
        assert.deepEqual((await response(2)).result.tools.map(t=>t.name).sort(),['thingtime_capabilities','thingtime_render_and_export']);
        const launched=(await calls()).slice(offset).find(a=>a.includes('--name')&&!a[a.indexOf('--name')+1].endsWith('-stage'));
        assert.ok(launched);name=launched[launched.indexOf('--name')+1];directory=launched[launched.indexOf('--config')+1];
        if(scenario==='process-group SIGKILL')process.kill(-child.pid,'SIGKILL');else child.stdin.end();
        const completion=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('Wrapper did not exit on stdin EOF')),SHUTDOWN_MS).unref())]);
        if(scenario==='stdin EOF')assert.equal(completion.code,0,diagnostics);
        const deadline=Date.now()+CLEANUP_MS;
        while(!gone(name)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,250));
        assert.ok(gone(name),scenario+' left owned Docker resources: '+diagnostics);
        while(Date.now()<deadline){try{await readdir(directory);}catch{break;}await new Promise(r=>setTimeout(r,50));}
        await assert.rejects(readdir(directory),{code:'ENOENT'});
        report.scenarios.push({scenario,name,...completion,containerRemoved:true,volumeRemoved:true,privateDirectoryRemoved:true});
      } finally {
        clearTimeout(scenarioDeadline);
        if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL')}catch{}
        child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
        const run=(await calls()).slice(offset).find(a=>a.includes('--name')&&!a[a.indexOf('--name')+1].endsWith('-stage'));
        const create=(await calls()).slice(offset).find(a=>a.includes('volume')&&a.includes('create'));
        name ||= run?.[run.indexOf('--name')+1] || create?.at(-1).replace(/-assets$/,'');
        if(name&&!gone(name)){
          // Emergency test-owned cleanup gets its own scoped temporary config;
          // it never removes another connection's volume or performs a prune.
          const recovery=await mkdtemp(join(tmpdir(),'thingtime-render-docker-'));
          try{await cleanupOwned(options,recovery,name);}finally{await rm(recovery,{recursive:true,force:true});}
        }
      }
    }
    const name=`thingtime-render-${randomUUID()}`,volume=`${name}-assets`;
    const labels=['--label','thingtime.render-isolated=true','--label',`thingtime.render-session=${name}`];
    assert.equal(docker(['volume','create',...labels,volume]).status,0);
    try {
      // No launcher/guardian exists: GNU timeout must kill an event-loop-blocked
      // Node child, causing PID 1 to exit and Docker --rm to remove the container.
      const args=runArguments(options,name,volume,labels);args.splice(-2,2,'node','-e','while(true){}');
      const result=docker(args);assert.equal(result.status,137,result.stderr);
      const inspect=docker(['container','inspect',name]);assert.notEqual(inspect.status,0);assert.match(inspect.stderr,/no such (container|object)/i);
      report.scenarios.push({scenario:'independent GNU timeout',exitCode:result.status,containerRemoved:true,volumeRequiresGuardian:true});
    }finally{await cleanupOwned(options,state,name);}
    if(process.env.TT_RENDER_LIFECYCLE_ARTIFACTS){const output=resolve(process.env.TT_RENDER_LIFECYCLE_ARTIFACTS);await mkdir(output,{recursive:true});await writeFile(join(output,'verification.json'),JSON.stringify({ok:true,...report},null,2)+'\n');}
  }finally{await rm(state,{recursive:true,force:true});await rm(fixture,{recursive:true,force:true});}
});
