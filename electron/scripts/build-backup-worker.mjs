import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../remix/package.json', import.meta.url));
/** Bundle only the local portable engine; no runtime Remix install is needed. */
export async function buildBackupWorker(output = resolve(root, 'electron/dist/backup/backup-copy.cjs')) {
	const { build } = createRequire(require.resolve('tsx'))('esbuild');
	await mkdir(dirname(output), { recursive: true });
	await build({ entryPoints: [resolve(root, 'electron/workers/backup-copy.ts')], outfile: output,
		bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: false, logLevel: 'silent' });
	return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await buildBackupWorker();
}
