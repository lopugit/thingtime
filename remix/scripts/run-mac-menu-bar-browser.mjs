// Synthetic-only browser acceptance: enforce the boundary on the whole process tree.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'darwin' || !process.env.TT_PLAYWRIGHT_MODULE) {
	throw new Error('Requires macOS sandbox-exec and TT_PLAYWRIGHT_MODULE pointing to installed Playwright.');
}
const temporary = mkdtempSync(join(tmpdir(), 'tt-menu-bar-qa-'));
try {
	const profile = join(temporary, 'network.sb');
	writeFileSync(
		profile,
		`(version 1)\n(allow default)\n(deny network*)\n(allow network-inbound (local ip "localhost:13820"))\n(allow network-outbound (remote ip "localhost:13820"))\n`
	);
	const result = spawnSync(
		'/usr/bin/sandbox-exec',
		['-f', profile, process.execPath, fileURLToPath(new URL('./check-mac-menu-bar-browser.mjs', import.meta.url))],
		{
			cwd: dirname(fileURLToPath(new URL('../package.json', import.meta.url))),
			stdio: 'inherit',
			env: process.env
		}
	);
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
