import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Repair absent or incomplete worktree dependencies before building resources. */
export function ensureElectronBuildDependencies({ electronDir, packageManager, environment = process.env, runner = spawnSync }) {
	if (!/^pnpm@\d+\.\d+\.\d+$/u.test(packageManager)) throw new Error('Electron build dependencies require an exact pnpm pin.');
	const builder = path.join(electronDir, 'node_modules', '.bin', 'electron-builder');
	const probe = () => runner(builder, ['--version'], { cwd: electronDir, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
	const ready = result => !result.error && result.status === 0;
	if (ready(probe())) return;
	const repaired = runner('corepack', [packageManager, 'install', '--frozen-lockfile'], { cwd: electronDir, env: environment, stdio: 'inherit' });
	if (!ready(repaired)) throw new Error('Electron dependency repair failed; resource builds were not started.');
	if (!ready(probe())) throw new Error('Electron dependencies remain incomplete after frozen-lockfile repair; resource builds were not started.');
}
