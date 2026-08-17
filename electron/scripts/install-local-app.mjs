import { accessSync, constants, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronDir = resolve(scriptDir, '..');
const appName = 'Thingtime.app';
const sourceApp = join(electronDir, 'release', 'mac-arm64', appName);
const targetDir = join(homedir(), 'Applications');
const targetApp = join(targetDir, appName);
const tempApp = join(targetDir, `.${appName}.tmp`);
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function runOptional(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit ${result.status}`;
    console.warn(`[install:local] ${command} failed (${detail}).`);
  }
}

function runRequired(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit ${result.status}`;
    console.error(`${label} failed (${detail}).`);
    process.exit(result.status || 1);
  }
}

if (process.platform !== 'darwin') {
  console.error('install:local currently installs the macOS app bundle only.');
  process.exit(1);
}

if (!existsSync(sourceApp)) {
  console.error(`Missing ${sourceApp}. Run "pnpm --dir electron build" first.`);
  process.exit(1);
}

const sourceVerification = spawnSync(
  'codesign',
  ['--verify', '--deep', '--strict', sourceApp],
  { stdio: 'ignore' }
);

if (sourceVerification.error || sourceVerification.status !== 0) {
  runRequired(
    'codesign',
    ['--force', '--deep', '--sign', '-', sourceApp],
    'Ad-hoc signing of the local app bundle'
  );
}

runRequired(
  'codesign',
  ['--verify', '--deep', '--strict', sourceApp],
  'Source app signature verification'
);

mkdirSync(targetDir, { recursive: true });
rmSync(tempApp, { force: true, recursive: true });

const copyResult = spawnSync('ditto', ['--rsrc', '--extattr', sourceApp, tempApp], { stdio: 'inherit' });

if (copyResult.error || copyResult.status !== 0) {
  const detail = copyResult.error ? copyResult.error.message : `exit ${copyResult.status}`;
  console.error(`Unable to copy Thingtime.app with ditto (${detail}).`);
  process.exit(copyResult.status || 1);
}

rmSync(targetApp, { force: true, recursive: true });
renameSync(tempApp, targetApp);

runRequired(
  'codesign',
  ['--verify', '--deep', '--strict', targetApp],
  'Installed app signature verification'
);

try {
  accessSync(join(targetApp, 'Contents', 'MacOS', 'Thingtime'), constants.X_OK);
} catch {
  console.error(`Installed app executable is missing or not executable: ${targetApp}`);
  process.exit(1);
}

if (existsSync(lsregister)) {
  runOptional(lsregister, ['-f', targetApp]);
}

runOptional('mdimport', [targetApp]);

console.log(`Installed ${targetApp}`);
