import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { access, chmod, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

let runtime: Promise<string> | undefined;
// Vercel counts uncompressed function assets, so ship the pinned executable as
// gzip and expand it once in private /tmp. No runtime download or user config.
export const resolveClaudeRuntime = () =>
	(runtime ||= locateRuntime().catch((error) => {
		runtime = undefined;
		throw error;
	}));
async function locateRuntime(): Promise<string> {
	const require = createRequire(import.meta.url);
	const packageRequire = createRequire(require.resolve('@anthropic-ai/claude-code/package.json'));
	const nativeName = `@anthropic-ai/claude-code-${process.platform}-${process.arch}`;
	const root = dirname(packageRequire.resolve(`${nativeName}/package.json`));
	const executable = join(root, process.platform === 'win32' ? 'claude.exe' : 'claude');
	try {
		await access(executable);
		return executable;
	} catch {
		/* packaged runtime */
	}
	return unpackClaudeRuntime(root);
}

export async function unpackClaudeRuntime(root: string, cacheRoot = join(tmpdir(), 'thingtime-claude-runtime')): Promise<string> {
	const manifest = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'));
	if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > 250 * 1024 * 1024)
		throw new Error('Invalid Claude runtime manifest.');
	const target = join(cacheRoot, manifest.sha256);
	await mkdir(target, { recursive: true, mode: 0o700 });
	const stage = join(target, `claude-${randomUUID()}`);
	const final = join(target, 'claude');
	const hash = createHash('sha256');
	let bytes = 0;
	try {
		await pipeline(
			createReadStream(join(root, 'claude.gz')),
			createGunzip(),
			new Transform({
				transform(chunk, _encoding, callback) {
					bytes += chunk.length;
					if (bytes > manifest.bytes) return callback(new Error('Claude runtime exceeded its declared size.'));
					hash.update(chunk);
					callback(null, chunk);
				}
			}),
			createWriteStream(stage, { mode: 0o700, flags: 'wx' })
		);
		if (bytes !== manifest.bytes || hash.digest('hex') !== manifest.sha256) throw new Error('Claude runtime integrity check failed.');
		await chmod(stage, 0o700);
		await rename(stage, final);
		return final;
	} catch (error) {
		await rm(stage, { force: true });
		throw error;
	}
}
