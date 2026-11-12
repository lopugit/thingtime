'use strict';

const assert = require('node:assert/strict');
const {
	cpSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const installerPromise = import('../scripts/install-local-app.mjs');

function makeApp(root, identifier, marker) {
	const app = path.join(root, 'Thingtime.app');
	const executable = path.join(app, 'Contents', 'MacOS', 'Thingtime');
	mkdirSync(path.dirname(executable), { recursive: true });
	writeFileSync(path.join(app, 'bundle-id.txt'), identifier);
	writeFileSync(path.join(app, 'marker.txt'), marker);
	writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	return app;
}

function identifierReader(app) {
	return readFileSync(path.join(app, 'bundle-id.txt'), 'utf8');
}

function installOptions(sourceApp, targetDir, overrides = {}) {
	return {
		allowNonDarwin: true,
		copyApp: (source, destination) => cpSync(source, destination, { recursive: true }),
		identifierReader,
		nodeRunningPids: () => [],
		registerMetadata: () => {},
		runningPids: () => [],
		serviceLifecycle: {
			snapshot: () => ({ registered: false }),
			start: () => {},
			stop: () => {}
		},
		sourceApp,
		targetDir,
		verifyApp: () => {},
		...overrides
	};
}

function registeredServiceLifecycle(targetDir, events, { failFirstStart = false } = {}) {
	let startCount = 0;
	return {
		snapshot: () => ({ registered: true }),
		stop: () => events.push('stop'),
		start: () => {
			startCount += 1;
			const marker = readFileSync(path.join(targetDir, 'Thingtime.app', 'marker.txt'), 'utf8');
			events.push(`start:${marker}`);
			if (failFirstStart && startCount === 1) throw new Error('new service failed');
		}
	};
}

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'thingtime-installer-'));
	const sourceRoot = path.join(root, 'source');
	const targetDir = path.join(root, 'Applications');
	mkdirSync(sourceRoot, { recursive: true });
	mkdirSync(targetDir, { recursive: true });
	return { root, sourceApp: makeApp(sourceRoot, 'com.thingtime.desktop', 'new'), targetDir };
}

test('refuses to replace an app with another bundle identifier', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.example.not-thingtime', 'original');
		assert.throws(() => installLocalApp(installOptions(value.sourceApp, value.targetDir)), /bundle identifier/u);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('refuses a symbolic-link install destination', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const elsewhere = path.join(value.root, 'elsewhere');
		makeApp(elsewhere, 'com.thingtime.desktop', 'external');
		symlinkSync(path.join(elsewhere, 'Thingtime.app'), path.join(value.targetDir, 'Thingtime.app'));
		assert.throws(() => installLocalApp(installOptions(value.sourceApp, value.targetDir)), /symbolic link/u);
		assert.equal(readFileSync(path.join(elsewhere, 'Thingtime.app', 'marker.txt'), 'utf8'), 'external');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('serializes concurrent install attempts with an exclusive lock', async () => {
	const { acquireInstallLock, installLocalApp } = await installerPromise;
	const value = fixture();
	const release = acquireInstallLock(value.targetDir);
	try {
		assert.throws(() => installLocalApp(installOptions(value.sourceApp, value.targetDir)), /already in progress/u);
	} finally {
		release();
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('leaves the installed app untouched when copying fails', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() => installLocalApp(installOptions(value.sourceApp, value.targetDir, { copyApp: () => { throw new Error('copy failed'); } })),
			/copy failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior app when final installed verification fails', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		let verificationCount = 0;
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						verifyApp: () => {
							verificationCount += 1;
							if (verificationCount === 3) throw new Error('installed verification failed');
						}
					})
				),
			/installed verification failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('refuses replacement while the installed executable is running', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() => installLocalApp(installOptions(value.sourceApp, value.targetDir, { runningPids: () => [123, 456] })),
			/running PIDs: 123, 456/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('atomically replaces the intended app and cleans temporary state', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		const result = installLocalApp(installOptions(value.sourceApp, value.targetDir));
		assert.equal(readFileSync(path.join(result.targetApp, 'marker.txt'), 'utf8'), 'new');
		assert.deepEqual(readdirSync(value.targetDir), ['Thingtime.app']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('stops and restarts a registered persistent node around atomic replacement', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		const serviceLifecycle = registeredServiceLifecycle(value.targetDir, events);
		const result = installLocalApp(installOptions(value.sourceApp, value.targetDir, { serviceLifecycle }));
		assert.equal(readFileSync(path.join(result.targetApp, 'marker.txt'), 'utf8'), 'new');
		assert.deepEqual(events, ['stop', 'start:new']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('waits for a stopped managed node and its Electron child before replacing the app', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		let childChecks = 0;
		let nodeChecks = 0;
		const checkOldBundle = () => {
			assert.deepEqual(events, ['stop']);
			assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
		};
		const result = installLocalApp(installOptions(value.sourceApp, value.targetDir, {
			serviceLifecycle: registeredServiceLifecycle(value.targetDir, events),
			runningPids: () => {
				checkOldBundle();
				return ++childChecks < 3 ? [321] : [];
			},
			nodeRunningPids: () => {
				checkOldBundle();
				return ++nodeChecks < 2 ? [777] : [];
			}
		}));
		assert.equal(readFileSync(path.join(result.targetApp, 'marker.txt'), 'utf8'), 'new');
		assert.equal(childChecks, 3);
		assert.deepEqual(events, ['stop', 'start:new']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior node service when the desktop app remains open after node shutdown', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						runningPids: () => [321],
						serviceLifecycle: registeredServiceLifecycle(value.targetDir, events)
					})
				),
			/running PID: 321/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
		assert.deepEqual(events, ['stop', 'start:original']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior app before restarting its persistent node after verification failure', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		let verificationCount = 0;
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						serviceLifecycle: registeredServiceLifecycle(value.targetDir, events),
						verifyApp: () => {
							verificationCount += 1;
							if (verificationCount === 3) throw new Error('installed verification failed');
						}
					})
				),
			/installed verification failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
		assert.deepEqual(events, ['stop', 'start:original']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior app and retries its node service when the replacement service cannot start', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						serviceLifecycle: registeredServiceLifecycle(value.targetDir, events, { failFirstStart: true })
					})
				),
			/new service failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
		assert.deepEqual(events, ['stop', 'start:new', 'start:original']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('refuses an unmanaged persistent node process without stopping it', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() => installLocalApp(installOptions(value.sourceApp, value.targetDir, { nodeRunningPids: () => [777] })),
			/unmanaged Thingtime Node.*777/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('validates the managed LaunchAgent marker and exact installed helper path', async () => {
	const { assertManagedNodeLaunchAgent } = await installerPromise;
	const helper = '/Users/test/Applications/Thingtime.app/Contents/Helpers/Thingtime Node.app/Contents/MacOS/ThingtimeNode';
	const plist = `<!-- Managed by Thingtime Electron. -->
<key>Label</key>
    <string>com.thingtime.desktop.node</string>
<key>ProgramArguments</key>
<array>
    <string>${helper}</string>
</array>`;
	assert.doesNotThrow(() => assertManagedNodeLaunchAgent(plist, helper));
	assert.throws(() => assertManagedNodeLaunchAgent(plist.replace('Managed by Thingtime Electron', 'Foreign owner'), helper), /not an Electron-managed agent/u);
	assert.throws(() => assertManagedNodeLaunchAgent(plist, `${helper}-other`), /not an Electron-managed agent/u);
});

test('default node lifecycle targets only the managed exact-label service and plist', async () => {
	const { createNodeServiceLifecycle } = await installerPromise;
	const value = fixture();
	const events = [];
	let registered = true;
	try {
		const targetApp = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		const helper = path.join(targetApp, 'Contents', 'Helpers', 'Thingtime Node.app', 'Contents', 'MacOS', 'ThingtimeNode');
		const launchAgentPath = path.join(value.root, 'Library', 'LaunchAgents', 'com.thingtime.desktop.node.plist');
		mkdirSync(path.dirname(launchAgentPath), { recursive: true });
		writeFileSync(
			launchAgentPath,
			`<!-- Managed by Thingtime Electron. -->
<key>Label</key>
    <string>com.thingtime.desktop.node</string>
<key>ProgramArguments</key>
<array>
    <string>${helper}</string>
</array>`
		);
		const runner = (command, args) => {
			events.push([command, ...args]);
			if (args[0] === 'print') {
				return { status: registered ? 0 : 1, stdout: '', stderr: registered ? '' : 'Could not find service' };
			}
			if (args[0] === 'bootout') {
				if (!registered) return { status: 1, stdout: '', stderr: 'Could not find service' };
				registered = false;
				return { status: 0, stdout: '', stderr: '' };
			}
			if (args[0] === 'bootstrap') registered = true;
			return { status: 0, stdout: '', stderr: '' };
		};
		const lifecycle = createNodeServiceLifecycle({ launchAgentPath, runner, targetApp, uid: 501 });
		const state = lifecycle.snapshot();
		lifecycle.stop(state);
		lifecycle.start(state);

		assert.equal(registered, true);
		assert.deepEqual(events, [
			['/bin/launchctl', 'print', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'bootout', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'bootout', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'enable', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'bootstrap', 'gui/501', launchAgentPath]
		]);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});


function makeCompanion(app, marker) {
 const executable=path.join(app,'Contents','MacOS','Thingtime Passwords');
 mkdirSync(path.dirname(executable),{recursive:true});
 writeFileSync(path.join(app,'bundle-id.txt'),'com.thingtime.passwords');
 writeFileSync(path.join(app,'marker.txt'),marker);
 writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o755});
 return app;
}

const companionFacts = (version, build, overrides = {}) => ({
 version, build, team: '6DQQ9V7C84', group: '6DQQ9V7C84.com.thingtime.passwords',
 hostAuthorities: ['Authority=Developer ID Application', 'Authority=Apple Root CA'],
 providerAuthorities: ['Authority=Developer ID Application', 'Authority=Apple Root CA'],
 hostRequirement: 'identifier com.thingtime.passwords and anchor apple generic',
 providerRequirement: 'identifier com.thingtime.passwords.provider and anchor apple generic',
 hostIdentifier: 'com.thingtime.passwords', providerIdentifier: 'com.thingtime.passwords.provider', ...overrides
});
const companionFactsReader = app => readFileSync(path.join(app, 'marker.txt'), 'utf8') === 'old-helper'
 ? companionFacts('1.0.7', '8') : companionFacts('1.0.8', '9');

test('installs the verified nested provider as the standalone companion with the same revision',async()=>{
 const {installLocalApp}=await installerPromise; const value=fixture();
 try {
  makeCompanion(path.join(value.sourceApp,'Contents','Helpers','Thingtime Passwords.app'),'new-helper');
  const companion=makeCompanion(path.join(value.targetDir,'Thingtime Passwords.app'),'old-helper');
  const result=installLocalApp(installOptions(value.sourceApp,value.targetDir,{verifyCompanion:()=>{},companionFactsReader,companionRunningPids:()=>[]}));
  assert.equal(result.targetCompanion,companion);
  assert.equal(readFileSync(path.join(companion,'marker.txt'),'utf8'),'new-helper');
  assert.equal(readFileSync(path.join(result.targetApp,'Contents','Helpers','Thingtime Passwords.app','marker.txt'),'utf8'),'new-helper');
 } finally {rmSync(value.root,{recursive:true,force:true});}
});

test('restores both main and standalone apps when replacement companion verification fails',async()=>{
 const {installLocalApp}=await installerPromise; const value=fixture();
 try {
  makeCompanion(path.join(value.sourceApp,'Contents','Helpers','Thingtime Passwords.app'),'new-helper');
  const companion=makeCompanion(path.join(value.targetDir,'Thingtime Passwords.app'),'old-helper');
  const target=makeApp(value.targetDir,'com.thingtime.desktop','original');
  assert.throws(()=>installLocalApp(installOptions(value.sourceApp,value.targetDir,{verifyCompanion:app=>{
   if(app===companion && readFileSync(path.join(app,'marker.txt'),'utf8')==='new-helper') throw new Error('companion verification failed');
  },companionFactsReader,companionRunningPids:()=>[]})),/companion verification failed/);
  assert.equal(readFileSync(path.join(companion,'marker.txt'),'utf8'),'old-helper');
  assert.equal(readFileSync(path.join(target,'marker.txt'),'utf8'),'original');
 } finally {rmSync(value.root,{recursive:true,force:true});}
});

test('keeps a signed newer running companion out of staging, replacement, and rollback', async () => {
 const {installLocalApp}=await installerPromise; const value=fixture();
 try {
  makeCompanion(path.join(value.sourceApp,'Contents','Helpers','Thingtime Passwords.app'),'new-helper');
  const companion=makeCompanion(path.join(value.targetDir,'Thingtime Passwords.app'),'old-helper');
  const originalCompanionInode=statSync(companion).ino;
  makeApp(value.targetDir,'com.thingtime.desktop','original');
  const copied=[];
  const options=installOptions(value.sourceApp,value.targetDir,{
   verifyCompanion:()=>{}, companionRunningPids:()=>{throw new Error('preserved companion was checked for quit');},
   companionFactsReader:app=>readFileSync(path.join(app,'marker.txt'),'utf8')==='old-helper'
    ? companionFacts('1.0.10','11') : companionFacts('1.0.8','9'),
   copyApp:(source,destination)=>{copied.push(path.basename(source));cpSync(source,destination,{recursive:true});}
  });
  const installed=installLocalApp(options);
  assert.equal(installed.companionPreserved,true);
  assert.deepEqual(copied,['Thingtime.app']);
  assert.equal(readFileSync(path.join(companion,'marker.txt'),'utf8'),'old-helper');
  assert.equal(statSync(companion).ino,originalCompanionInode);
  assert.equal(readFileSync(path.join(installed.targetApp,'marker.txt'),'utf8'),'new');

  let verifyCount=0;
  assert.throws(()=>installLocalApp({...options,verifyApp:()=>{
   if(++verifyCount===3) throw new Error('main verification failed');
  }}),/main verification failed/u);
  assert.equal(readFileSync(path.join(companion,'marker.txt'),'utf8'),'old-helper');
  assert.equal(statSync(companion).ino,originalCompanionInode);
  assert.equal(readFileSync(path.join(installed.targetApp,'marker.txt'),'utf8'),'new');
 } finally {rmSync(value.root,{recursive:true,force:true});}
});

test('an idle newer or unverified companion is never replaced on ambiguous identity', async () => {
 const {installLocalApp}=await installerPromise;
 // A failed identity read does not establish that the installed version is old.
 const unproven=[
  companion=>app=>app===companion?companionFacts('1.0.10','11',{group:'DIFFERENTGROUP'}):companionFacts('1.0.8','9'),
  companion=>app=>app===companion?companionFacts('1.0.10','11',{hostAuthorities:['Authority=Apple Development']}):companionFacts('1.0.8','9'),
  companion=>app=>{if(app===companion) throw new Error('private verifier detail must not be logged');return companionFacts('1.0.8','9');},
  companion=>app=>app===companion?companionFacts('unknown','11'):companionFacts('1.0.8','9')
 ];
 for(const reader of unproven) {
  const value=fixture();
  try {
   makeCompanion(path.join(value.sourceApp,'Contents','Helpers','Thingtime Passwords.app'),'new-helper');
   const companion=makeCompanion(path.join(value.targetDir,'Thingtime Passwords.app'),'old-helper');
   const target=makeApp(value.targetDir,'com.thingtime.desktop','original');
   const copied=[];
   assert.throws(()=>installLocalApp(installOptions(value.sourceApp,value.targetDir,{
    verifyCompanion:()=>{},companionRunningPids:()=>[],companionFactsReader:reader(companion),
    copyApp:(source,destination)=>{copied.push(source);cpSync(source,destination,{recursive:true});}
   })),error=>error.message==='Installed Password AutoFill companion identity or version is unverified; no app was replaced.');
   assert.deepEqual(copied,[]);
   assert.equal(readFileSync(path.join(companion,'marker.txt'),'utf8'),'old-helper');
   assert.equal(readFileSync(path.join(target,'marker.txt'),'utf8'),'original');
  } finally {rmSync(value.root,{recursive:true,force:true});}
 }
});

test('an unverifiable running companion is refused before the quit-and-replace path', async () => {
 const {installLocalApp}=await installerPromise;const value=fixture();
 try {
  makeCompanion(path.join(value.sourceApp,'Contents','Helpers','Thingtime Passwords.app'),'new-helper');
  const companion=makeCompanion(path.join(value.targetDir,'Thingtime Passwords.app'),'old-helper');
  const target=makeApp(value.targetDir,'com.thingtime.desktop','original');
  assert.throws(()=>installLocalApp(installOptions(value.sourceApp,value.targetDir,{
   verifyCompanion:app=>{if(app===companion) throw new Error('installed companion signature is broken');},
   companionFactsReader:app=>app===companion?companionFacts('1.0.10','11'):companionFacts('1.0.8','9'),
   companionRunningPids:()=>[123]
  })),/identity or version is unverified/u);
  assert.equal(readFileSync(path.join(companion,'marker.txt'),'utf8'),'old-helper');
  assert.equal(readFileSync(path.join(target,'marker.txt'),'utf8'),'original');
 } finally {rmSync(value.root,{recursive:true,force:true});}
});

test('refuses a preserved companion changed during staging before main replacement', async () => {
 const {installLocalApp}=await installerPromise;const value=fixture();
 try {
  makeCompanion(path.join(value.sourceApp,'Contents','Helpers','Thingtime Passwords.app'),'new-helper');
  const companion=makeCompanion(path.join(value.targetDir,'Thingtime Passwords.app'),'old-helper');
  const target=makeApp(value.targetDir,'com.thingtime.desktop','original');
  assert.throws(()=>installLocalApp(installOptions(value.sourceApp,value.targetDir,{
   verifyCompanion:()=>{},
   companionFactsReader:app=>readFileSync(path.join(app,'marker.txt'),'utf8')==='old-helper'
    ? companionFacts('1.0.10','11') : companionFacts('1.0.8','9'),
   copyApp:(source,destination)=>{
    cpSync(source,destination,{recursive:true});
    writeFileSync(path.join(companion,'marker.txt'),'changed-by-other-process');
   }
  })),/preserved Password AutoFill companion changed/u);
  assert.equal(readFileSync(path.join(target,'marker.txt'),'utf8'),'original');
 } finally {rmSync(value.root,{recursive:true,force:true});}
});

test('only same-major monotone newer companion versions qualify for preservation', async () => {
 const {preserveNewerCompanion}=await installerPromise;
 const source=companionFacts('1.0.8','9');
 assert.equal(preserveNewerCompanion(source,companionFacts('1.0.10','11')),true);
 assert.equal(preserveNewerCompanion(source,companionFacts('1.0.8','10')),true);
 assert.equal(preserveNewerCompanion(source,companionFacts('1.0.8','9')),false);
 assert.equal(preserveNewerCompanion(source,companionFacts('1.0.7','8')),false);
 for(const facts of [
  companionFacts('2.0.0','11'), companionFacts('1.0.10','8'),
  companionFacts('1.0.7','11'), companionFacts('1.0.10','bad'),
  companionFacts('1.0','11'), companionFacts('1.0.10','11',{team:'OTHERTEAM'}),
  companionFacts('1.0.10','11',{group:'OTHERGROUP'}),
  companionFacts('1.0.10','11',{hostAuthorities:['Authority=Apple Development']}),
  companionFacts('1.0.10','11',{providerRequirement:'other requirement'}),
  companionFacts('1.0.10','11',{providerIdentifier:'other.provider'})
 ]) assert.throws(()=>preserveNewerCompanion(source,facts),/incompatible|unknown/u);
});

test('provision profiles must authorize the exact group with typed membership', async () => {
 const {profileAllowsCompanion}=await installerPromise;
 const team='6DQQ9V7C84';const identifier='com.thingtime.passwords';
 const group=`${team}.${identifier}`;
 const facts={team,profile:{ExpirationDate:'2099-01-01T00:00:00Z',TeamIdentifier:[team],
  Entitlements:{'com.apple.developer.authentication-services.autofill-credential-provider':true,
   'com.apple.application-identifier':`${team}.${identifier}`,
   'keychain-access-groups':[`${team}.*`]}}};
 assert.equal(profileAllowsCompanion(facts,identifier,group),true);
 assert.equal(profileAllowsCompanion({...facts,profile:{...facts.profile,
  Entitlements:{...facts.profile.Entitlements,'keychain-access-groups':[group]}}},identifier,group),true);
 for(const invalid of [
  {...facts,profile:{...facts.profile,TeamIdentifier:team}},
  {...facts,profile:{...facts.profile,Entitlements:{...facts.profile.Entitlements,
   'keychain-access-groups':`${team}.*`}}},
  {...facts,profile:{...facts.profile,Entitlements:{...facts.profile.Entitlements,
   'keychain-access-groups':['OTHERTEAM.*']}}}
 ]) assert.equal(profileAllowsCompanion(invalid,identifier,group),false);
});

test('equal and older running companions retain the replacement guard', async () => {
 const {installLocalApp}=await installerPromise;
 for(const installedFacts of [companionFacts('1.0.8','9'),companionFacts('1.0.7','8')]) {
  const value=fixture();
  try {
   makeCompanion(path.join(value.sourceApp,'Contents','Helpers','Thingtime Passwords.app'),'new-helper');
   const companion=makeCompanion(path.join(value.targetDir,'Thingtime Passwords.app'),'old-helper');
   makeApp(value.targetDir,'com.thingtime.desktop','original');
   assert.throws(()=>installLocalApp(installOptions(value.sourceApp,value.targetDir,{
    verifyCompanion:()=>{},companionFactsReader:app=>app===companion?installedFacts:companionFacts('1.0.8','9'),
    companionRunningPids:()=>[123]
   })),/Quit the Thingtime AutoFill companion/u);
   assert.equal(readFileSync(path.join(companion,'marker.txt'),'utf8'),'old-helper');
   assert.equal(readFileSync(path.join(value.targetDir,'Thingtime.app','marker.txt'),'utf8'),'original');
  } finally {rmSync(value.root,{recursive:true,force:true});}
 }
});


test('a failed companion rollback still restores the prior main app independently',async()=>{
 const {rollbackAppReplacements}=await installerPromise;
 const restored=[];
 const failures=rollbackAppReplacements([
  {target:'/companion',backup:'/companion-backup',installedMoved:true,backupMoved:true},
  {target:'/main',backup:'/main-backup',installedMoved:true,backupMoved:true}
 ],{remove:()=>{},rename:(backup,target)=>{if(target==='/companion') throw new Error('companion filesystem unavailable');restored.push([backup,target]);}});
 assert.equal(failures.length,1);assert.deepEqual(restored,[['/main-backup','/main']]);
});
