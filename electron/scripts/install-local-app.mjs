import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronDir = resolve(scriptDir, '..');
const appName = 'Thingtime.app';
const expectedBundleIdentifier = 'com.thingtime.desktop';
const managedPlistMarker = 'Managed by Thingtime Electron';
const nodeLabel = 'com.thingtime.desktop.node';
const verifyScript = join(scriptDir, 'verify-signed-app.mjs');
const defaultTargetDir = join(homedir(), 'Applications');
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function commandFailure(result, label) {
  const detail = result.error ? result.error.message : (result.stderr || result.stdout || `exit ${result.status}`).toString().trim();
  return new Error(`${label} failed (${detail}).`);
}

function runRequired(command, args, label, options = {}) {
  const result = spawnSync(command, args, { encoding: options.encoding, stdio: options.stdio || 'inherit', input: options.input });
  if (result.error || result.status !== 0) throw commandFailure(result, label);
  return result;
}

function runOptional(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit ${result.status}`;
    console.warn(`[install:local] ${command} failed (${detail}).`);
  }
}

export function resolveSourceApp(explicitPath = process.env.THINGTIME_ELECTRON_APP_PATH) {
  if (explicitPath) return resolve(explicitPath);
  const releaseRoot = join(electronDir, 'release');
  if (!existsSync(releaseRoot)) return join(releaseRoot, `mac-${process.arch}`, appName);
  const candidates = readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => join(releaseRoot, entry.name, appName))
    .filter((candidate) => existsSync(candidate));
  if (candidates.length !== 1) {
    throw new Error(`Expected one signed Thingtime.app build, found ${candidates.length}. Set THINGTIME_ELECTRON_APP_PATH explicitly.`);
  }
  return candidates[0];
}

export function readBundleIdentifier(appPath) {
  const result = runRequired(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', join(appPath, 'Contents', 'Info.plist')],
    `Bundle identifier check for ${appPath}`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return result.stdout.trim();
}

export function assertExpectedBundle(appPath, label, identifierReader = readBundleIdentifier, expectedIdentifier = expectedBundleIdentifier) {
  let stat;
  try {
    stat = lstatSync(appPath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${appPath}`);
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${appPath}`);
  if (!stat.isDirectory()) throw new Error(`${label} must be an application bundle directory: ${appPath}`);
  const identifier = identifierReader(appPath);
  if (identifier !== expectedIdentifier) {
    throw new Error(`${label} has bundle identifier ${identifier || '(missing)'}; expected ${expectedIdentifier}.`);
  }
}

const companionIdentifier = 'com.thingtime.passwords';
const providerIdentifier = 'com.thingtime.passwords.provider';
const privateOutput = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

function readPlist(appPath) {
  return JSON.parse(runRequired('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(appPath, 'Contents', 'Info.plist')],
    'Password AutoFill bundle metadata', privateOutput).stdout);
}

function signedFacts(appPath) {
  const signature = runRequired('/usr/bin/codesign', ['--display', '--verbose=4', appPath],
    'Password AutoFill signing identity', privateOutput);
  const team = signature.stderr.match(/^TeamIdentifier=([A-Z0-9]{10})$/mu)?.[1];
  if (!team) throw new Error('Password AutoFill signing team is unavailable.');
  const authorities = signature.stderr.match(/^Authority=.+$/gmu) || [];
  const requirement = runRequired('/usr/bin/codesign', ['-dr', '-', appPath],
    'Password AutoFill designated requirement', privateOutput).stdout.match(/^designated => (.+)$/mu)?.[1];
  if (!authorities.length || !requirement) throw new Error('Password AutoFill signing requirement is unavailable.');
  const xml = runRequired('/usr/bin/codesign', ['--display', '--entitlements', ':-', appPath],
    'Password AutoFill signed entitlements', privateOutput).stdout;
  const entitlements = JSON.parse(runRequired('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'],
    'Password AutoFill signed entitlements', { ...privateOutput, input: xml }).stdout);
  const profileXml = runRequired('/usr/bin/security', ['cms', '-D', '-i', join(appPath, 'Contents', 'embedded.provisionprofile')],
    'Password AutoFill provisioning profile', privateOutput).stdout;
  const profileField = (key, format) => runRequired('/usr/bin/plutil', ['-extract', key, format, '-o', '-', '-'],
    'Password AutoFill provisioning profile', { ...privateOutput, input: profileXml }).stdout.trim();
  const profile = {
    ExpirationDate: profileField('ExpirationDate', 'raw'),
    TeamIdentifier: JSON.parse(profileField('TeamIdentifier', 'json')),
    Entitlements: JSON.parse(profileField('Entitlements', 'json'))
  };
  return { team, authorities, requirement, entitlements, profile };
}

export function profileAllowsCompanion(facts, identifier, group) {
    const teams = facts.profile.TeamIdentifier;
    const groups = facts.profile.Entitlements?.['keychain-access-groups'];
    return Date.parse(facts.profile.ExpirationDate) > Date.now() &&
      Array.isArray(teams) && teams.every(value => typeof value === 'string') && teams.includes(facts.team) &&
      facts.profile.Entitlements?.['com.apple.developer.authentication-services.autofill-credential-provider'] === true &&
      facts.profile.Entitlements?.['com.apple.application-identifier'] === `${facts.team}.${identifier}` &&
      Array.isArray(groups) && groups.every(value => typeof value === 'string') &&
      (groups.includes(group) || groups.includes(`${facts.team}.*`));
}

export function readCompanionFacts(appPath, identifierReader = readBundleIdentifier) {
  assertExpectedBundle(appPath, 'Password AutoFill host', identifierReader, companionIdentifier);
  const provider = join(appPath, 'Contents', 'PlugIns', 'ThingtimePasswordProvider.appex');
  assertExpectedBundle(provider, 'Password AutoFill provider', identifierReader, providerIdentifier);
  const hostInfo = readPlist(appPath), providerInfo = readPlist(provider);
  const host = signedFacts(appPath), extension = signedFacts(provider);
  const group = hostInfo.ThingtimePasswordKeychainGroup;
  if (hostInfo.CFBundleIdentifier !== companionIdentifier || providerInfo.CFBundleIdentifier !== providerIdentifier ||
    typeof group !== 'string' || !group || providerInfo.ThingtimePasswordKeychainGroup !== group || host.team !== extension.team ||
    hostInfo.CFBundleShortVersionString !== providerInfo.CFBundleShortVersionString ||
    hostInfo.CFBundleVersion !== providerInfo.CFBundleVersion ||
    !profileAllowsCompanion(host, companionIdentifier, group) || !profileAllowsCompanion(extension, providerIdentifier, group) ||
    ![host.entitlements, extension.entitlements].every(value => value['com.apple.developer.authentication-services.autofill-credential-provider'] === true &&
      value['com.apple.developer.team-identifier'] === host.team && Array.isArray(value['keychain-access-groups']) && value['keychain-access-groups'].includes(group))) {
    throw new Error('Password AutoFill host and provider identity or signed entitlements do not match.');
  }
  return { version: hostInfo.CFBundleShortVersionString, build: hostInfo.CFBundleVersion, team: host.team, group,
    hostAuthorities: host.authorities, providerAuthorities: extension.authorities,
    hostRequirement: host.requirement, providerRequirement: extension.requirement,
    hostIdentifier: companionIdentifier, providerIdentifier };
}

function numericVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value)) throw new Error('Password AutoFill version is unknown.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Password AutoFill version is unknown.');
  return parts;
}

function numericBuild(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Password AutoFill build is unknown.');
  }
  return Number(value);
}

export function preserveNewerCompanion(source, installed) {
  if (source?.hostIdentifier !== companionIdentifier || installed?.hostIdentifier !== companionIdentifier ||
    source?.providerIdentifier !== providerIdentifier || installed?.providerIdentifier !== providerIdentifier ||
    !source.team || installed.team !== source.team || !source.group || installed.group !== source.group ||
    !source.hostRequirement || installed.hostRequirement !== source.hostRequirement ||
    !source.providerRequirement || installed.providerRequirement !== source.providerRequirement ||
    !Array.isArray(source.hostAuthorities) || !source.hostAuthorities.length ||
    JSON.stringify(installed.hostAuthorities) !== JSON.stringify(source.hostAuthorities) ||
    !Array.isArray(source.providerAuthorities) || !source.providerAuthorities.length ||
    JSON.stringify(installed.providerAuthorities) !== JSON.stringify(source.providerAuthorities)) {
    throw new Error('Password AutoFill companion identity is incompatible.');
  }
  const sourceVersion = numericVersion(source.version), installedVersion = numericVersion(installed.version);
  const sourceBuild = numericBuild(source.build), installedBuild = numericBuild(installed.build);
  const versionOrder = sourceVersion.reduce((order, part, index) => order || Math.sign(installedVersion[index] - part), 0);
  const buildOrder = Math.sign(installedBuild - sourceBuild);
  if (versionOrder > 0 || buildOrder > 0) {
    if (installedVersion[0] !== sourceVersion[0] || versionOrder < 0 || buildOrder < 0) {
      throw new Error('Password AutoFill companion versions are incompatible.');
    }
    return true;
  }
  return false;
}

function exactRunningPids(executablePath, processName, label) {
  const lookup = spawnSync('/usr/bin/pgrep', ['-x', processName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (lookup.error) throw commandFailure(lookup, `${label} process lookup`);
  if (lookup.status === 1) return [];
  if (lookup.status !== 0) throw commandFailure(lookup, `${label} process lookup`);
  const matches = [];
  for (const value of lookup.stdout.split(/\s+/u).filter(Boolean)) {
    if (!/^\d+$/u.test(value)) continue;
    const detail = spawnSync('/bin/ps', ['-p', value, '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (detail.status !== 0) continue;
    const command = detail.stdout.trim();
    if (command === executablePath || command.startsWith(`${executablePath} `)) matches.push(Number(value));
  }
  return matches;
}

export function exactRunningInstalledPids(executablePath) {
  return exactRunningPids(executablePath, 'Thingtime', 'Thingtime');
}

export function exactRunningNodePids(executablePath) {
  return exactRunningPids(executablePath, 'ThingtimeNode', 'Thingtime Node');
}

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function assertManagedNodeLaunchAgent(contents, helperExecutable) {
  const programArguments = typeof contents === 'string'
    ? contents.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u)?.[1]
    : null;
  if (
    typeof contents !== 'string' ||
    !contents.includes(managedPlistMarker) ||
    !contents.includes(`<key>Label</key>\n    <string>${nodeLabel}</string>`) ||
    !programArguments?.includes(`<string>${xmlEscape(helperExecutable)}</string>`)
  ) {
    throw new Error('The registered Thingtime Node LaunchAgent is not an Electron-managed agent for this installed app.');
  }
}

function launchctlReportsMissingService(result) {
  return /could not find|no such process|service not found/iu.test(`${result?.stdout || ''}\n${result?.stderr || ''}`);
}

function requireLifecycleCommand(result, label, { allowMissing = false } = {}) {
  if (result?.status === 0 || (allowMissing && launchctlReportsMissingService(result))) return;
  throw commandFailure(result, label);
}

export function createNodeServiceLifecycle(options = {}) {
  const targetApp = resolve(options.targetApp);
  const helperExecutable = join(targetApp, 'Contents', 'Helpers', 'Thingtime Node.app', 'Contents', 'MacOS', 'ThingtimeNode');
  const launchAgentPath = options.launchAgentPath || join(homedir(), 'Library', 'LaunchAgents', `${nodeLabel}.plist`);
  const uid = options.uid ?? process.getuid();
  const domain = `gui/${uid}`;
  const serviceTarget = `${domain}/${nodeLabel}`;
  const runner = options.runner || ((command, args, spawnOptions = {}) => spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOptions
  }));

  function managedAgentContents() {
    let stat;
    try {
      stat = lstatSync(launchAgentPath);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('The registered Thingtime Node LaunchAgent is not a regular Thingtime-managed file.');
    }
    const contents = readFileSync(launchAgentPath, 'utf8');
    assertManagedNodeLaunchAgent(contents, helperExecutable);
    return contents;
  }

  function snapshot() {
    const result = runner('/bin/launchctl', ['print', serviceTarget]);
    if (result.error) throw commandFailure(result, 'Thingtime Node service lookup');
    if (result.status === 0) {
      if (managedAgentContents() === null) {
        throw new Error('Thingtime Node is registered without an Electron-managed LaunchAgent; installation was left unchanged.');
      }
      return { registered: true };
    }
    if (launchctlReportsMissingService(result)) return { registered: false };
    throw commandFailure(result, 'Thingtime Node service lookup');
  }

  function stop(state) {
    if (!state?.registered) return;
    assertManagedNodeLaunchAgent(managedAgentContents(), helperExecutable);
    const result = runner('/bin/launchctl', ['bootout', serviceTarget]);
    requireLifecycleCommand(result, 'Thingtime Node service stop');
  }

  function start(state) {
    if (!state?.registered) return;
    assertManagedNodeLaunchAgent(managedAgentContents(), helperExecutable);
    const bootout = runner('/bin/launchctl', ['bootout', serviceTarget]);
    requireLifecycleCommand(bootout, 'Thingtime Node partial-service cleanup', { allowMissing: true });
    const enable = runner('/bin/launchctl', ['enable', serviceTarget]);
    requireLifecycleCommand(enable, 'Thingtime Node service enable');
    // RunAtLoad starts the service during bootstrap. Avoid immediately killing
    // that healthy process with `kickstart -k`, which can block indefinitely.
    const bootstrap = runner('/bin/launchctl', ['bootstrap', domain, launchAgentPath]);
    requireLifecycleCommand(bootstrap, 'Thingtime Node service bootstrap');
  }

  return { helperExecutable, launchAgentPath, snapshot, start, stop };
}

export function acquireInstallLock(targetDir) {
  const lockPath = join(targetDir, `.${appName}.install.lock`);
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
    writeFileSync(descriptor, `${process.pid}\n`, { encoding: 'utf8' });
  } catch (error) {
		if (descriptor !== undefined) closeSync(descriptor);
		if (descriptor !== undefined) rmSync(lockPath, { force: true });
    if (error?.code === 'EEXIST') throw new Error(`Another ${appName} installation is already in progress.`);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  };
}

function defaultVerifyApp(appPath, signatureMode = 'local') {
  runRequired(process.execPath, [verifyScript, '--mode', signatureMode, appPath], `Stable signature verification for ${appPath}`);
}

function defaultCopyApp(sourceApp, destinationApp) {
  runRequired('/usr/bin/ditto', ['--rsrc', '--extattr', sourceApp, destinationApp], 'Thingtime application copy');
}

export function rollbackAppReplacements(replacements, { remove = rmSync, rename = renameSync } = {}) {
  const failures = [];
  for (const { target, backup, installedMoved, backupMoved } of replacements) {
    try {
      if (installedMoved) remove(target, { force: true, recursive: true });
      if (backupMoved) rename(backup, target);
    } catch (error) { failures.push(error); }
  }
  return failures;
}

export function installLocalApp(options = {}) {
  if (process.platform !== 'darwin' && options.allowNonDarwin !== true) {
    throw new Error('install:local currently installs the macOS app bundle only.');
  }

  const sourceApp = resolve(options.sourceApp || resolveSourceApp());
  const targetDir = resolve(options.targetDir || defaultTargetDir);
  const targetApp = join(targetDir, appName);
  const targetExecutable = join(targetApp, 'Contents', 'MacOS', 'Thingtime');
  const targetNodeExecutable = join(targetApp, 'Contents', 'Helpers', 'Thingtime Node.app', 'Contents', 'MacOS', 'ThingtimeNode');
  const signatureMode = options.signatureMode || process.env.THINGTIME_ELECTRON_SIGNATURE_MODE || 'local';
  if (!['local', 'production'].includes(signatureMode)) throw new Error('Thingtime installation signature mode is invalid.');
  const verifyApp = options.verifyApp || ((appPath) => defaultVerifyApp(appPath, signatureMode));
  const copyApp = options.copyApp || defaultCopyApp;
  const companionName = 'Thingtime Passwords.app';
  const sourceCompanion = join(sourceApp, 'Contents', 'Helpers', companionName);
  const targetCompanion = join(targetDir, companionName);
  // verifyApp validates the nested helper before it becomes the canonical
  // standalone provider too. Older standalone copies otherwise keep winning
  // LaunchServices discovery even after the Electron app has been updated.
  const hasCompanion = existsSync(sourceCompanion);
  const verifyCompanion = options.verifyCompanion || ((appPath) => {
    runRequired('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], 'Password AutoFill signature verification');
    accessSync(join(appPath, 'Contents', 'MacOS', 'Thingtime Passwords'), constants.X_OK);
  });
  const companionRunningPids = options.companionRunningPids || ((executable) => exactRunningPids(executable, 'Thingtime Passwords', 'Thingtime Passwords'));
  const identifierReader = options.identifierReader || readBundleIdentifier;
  const companionFactsReader = options.companionFactsReader || ((appPath) => readCompanionFacts(appPath, identifierReader));
  const runningPids = options.runningPids || exactRunningInstalledPids;
  const nodeRunningPids = options.nodeRunningPids || exactRunningNodePids;
  const serviceLifecycle = options.serviceLifecycle || createNodeServiceLifecycle({ targetApp });
  const registerMetadata = options.registerMetadata || (() => {
    if (existsSync(lsregister)) runOptional(lsregister, ['-f', targetApp]);
    runOptional('/usr/bin/mdimport', [targetApp]);
  });

  mkdirSync(targetDir, { recursive: true });
  const releaseLock = acquireInstallLock(targetDir);
  let stageRoot = null;
  let preserveStage = false;
  try {
    assertExpectedBundle(sourceApp, 'Source Thingtime app', identifierReader);
    verifyApp(sourceApp);
    const companionStat = lstatSync(targetCompanion, { throwIfNoEntry: false });
    const companionExists = companionStat !== undefined;
    let preserveCompanion = false;
    let preservedCompanionFacts = null;
    if (hasCompanion) {
      assertExpectedBundle(sourceCompanion, 'Source Password AutoFill companion', identifierReader, companionIdentifier);
      verifyCompanion(sourceCompanion);
      if (companionExists) {
        assertExpectedBundle(targetCompanion, 'Installed Password AutoFill companion', identifierReader, companionIdentifier);
        // A failed classification cannot prove that replacement is safe either:
        // the installed companion may be newer even when its signed facts are
        // unreadable. Keep the existing installation intact on uncertainty.
        try {
          verifyCompanion(targetCompanion);
          const sourceFacts = companionFactsReader(sourceCompanion);
          preservedCompanionFacts = companionFactsReader(targetCompanion);
          preserveCompanion = preserveNewerCompanion(sourceFacts, preservedCompanionFacts);
        } catch {
          throw new Error('Installed Password AutoFill companion identity or version is unverified; no app was replaced.');
        }
      }
    }
    const verifyPreservedCompanion = () => {
      if (!preserveCompanion) return;
      const currentStat = lstatSync(targetCompanion);
      if (!currentStat.isDirectory() || currentStat.isSymbolicLink() ||
        currentStat.dev !== companionStat.dev || currentStat.ino !== companionStat.ino) {
        throw new Error('The preserved Password AutoFill companion changed during installation.');
      }
      assertExpectedBundle(targetCompanion, 'Preserved Password AutoFill companion', identifierReader, companionIdentifier);
      verifyCompanion(targetCompanion);
      if (JSON.stringify(companionFactsReader(targetCompanion)) !== JSON.stringify(preservedCompanionFacts)) {
        throw new Error('The preserved Password AutoFill companion changed during installation.');
      }
    };

    const targetExists = lstatSync(targetApp, { throwIfNoEntry: false }) !== undefined;
    if (targetExists) {
      assertExpectedBundle(targetApp, 'Existing installed Thingtime app', identifierReader);
    }
    const serviceState = serviceLifecycle.snapshot();
    if (serviceState.registered && !targetExists) {
      throw new Error('Thingtime Node is registered but the installed Thingtime app is missing; unregister the stale service before installing.');
    }

    stageRoot = mkdtempSync(join(targetDir, '.Thingtime-install-'));
    const stagedApp = join(stageRoot, appName);
    const backupApp = join(stageRoot, 'Previous Thingtime.app');
    copyApp(sourceApp, stagedApp);
    assertExpectedBundle(stagedApp, 'Staged Thingtime app', identifierReader);
    verifyApp(stagedApp);

    const stagedCompanion = join(stageRoot, companionName);
    const backupCompanion = join(stageRoot, 'Previous Thingtime Passwords.app');
    if (hasCompanion && !preserveCompanion) {
      copyApp(sourceCompanion, stagedCompanion);
      assertExpectedBundle(stagedCompanion, 'Staged Password AutoFill companion', identifierReader, companionIdentifier);
      verifyCompanion(stagedCompanion);
    }
    let companionBackupMoved = false;
    let companionInstalledMoved = false;
    let backupMoved = false;
    let installedMoved = false;
    let serviceStopped = false;
    try {
      if (serviceState.registered) {
        serviceLifecycle.stop(serviceState);
        serviceStopped = true;
      }
      let pids = runningPids(targetExecutable);
      let nodePids = nodeRunningPids(targetNodeExecutable);
      if (serviceStopped && (pids.length || nodePids.length)) {
        // launchctl bootout can return before Node and its bundled Electron
        // child have exited. Keep both replacement guards active while they drain.
        const deadline = performance.now() + 2000;
        const delay = new Int32Array(new SharedArrayBuffer(4));
        while ((pids.length || nodePids.length) && performance.now() < deadline) {
          Atomics.wait(delay, 0, 0, 50);
          pids = runningPids(targetExecutable);
          nodePids = nodeRunningPids(targetNodeExecutable);
        }
      }
      if (pids.length) {
        throw new Error(`Quit the installed Thingtime app before replacing it (running PID${pids.length === 1 ? '' : 's'}: ${pids.join(', ')}).`);
      }
      if (nodePids.length) {
        const qualifier = serviceState.registered ? 'Thingtime Node did not stop cleanly' : 'Quit the unmanaged Thingtime Node process';
        throw new Error(`${qualifier} before replacing the app (running PID${nodePids.length === 1 ? '' : 's'}: ${nodePids.join(', ')}).`);
      }
      verifyPreservedCompanion();
      if (hasCompanion && !preserveCompanion && companionRunningPids(join(targetCompanion, 'Contents', 'MacOS', 'Thingtime Passwords')).length) {
        throw new Error('Quit the Thingtime AutoFill companion before replacing it.');
      }
      if (targetExists) {
        renameSync(targetApp, backupApp);
        backupMoved = true;
      }
      renameSync(stagedApp, targetApp);
      installedMoved = true;
      assertExpectedBundle(targetApp, 'Installed Thingtime app', identifierReader);
      verifyApp(targetApp);
      accessSync(targetExecutable, constants.X_OK);
      verifyPreservedCompanion();
      if (hasCompanion && !preserveCompanion) {
        if (companionExists) { renameSync(targetCompanion, backupCompanion); companionBackupMoved = true; }
        renameSync(stagedCompanion, targetCompanion); companionInstalledMoved = true;
        assertExpectedBundle(targetCompanion, 'Installed Password AutoFill companion', identifierReader, companionIdentifier);
        verifyCompanion(targetCompanion);
      }
      if (serviceState.registered) {
        serviceLifecycle.start(serviceState);
        serviceStopped = false;
      }
    } catch (error) {
      const rollbackErrors = rollbackAppReplacements([
        ...(!preserveCompanion && hasCompanion ? [{ target: targetCompanion, backup: backupCompanion, installedMoved: companionInstalledMoved, backupMoved: companionBackupMoved }] : []),
        { target: targetApp, backup: backupApp, installedMoved, backupMoved }
      ]);
      if (serviceStopped) {
        try {
          serviceLifecycle.start(serviceState);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        preserveStage = true;
        const failure = new AggregateError(rollbackErrors, `Thingtime installation failed and the prior app or node service could not be fully restored. Recovery backups are preserved at ${stageRoot}.`);
        failure.cause = error;
        throw failure;
      }
      throw error;
    }

    registerMetadata(targetApp);
    if (hasCompanion && !preserveCompanion && existsSync(lsregister)) runOptional(lsregister, ['-f', targetCompanion]);
    return { sourceApp, targetApp, ...(hasCompanion ? { targetCompanion, companionPreserved: preserveCompanion } : {}) };
  } finally {
    if (stageRoot && !preserveStage) rmSync(stageRoot, { force: true, recursive: true });
    releaseLock();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const result = installLocalApp();
    console.log(`Installed ${result.targetApp}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
