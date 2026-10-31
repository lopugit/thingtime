import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('browser navigation shares the drawer trigger control grid and keeps Commander search available', async () => {
	const source = await readFile(new URL('./Nav.tsx', import.meta.url), 'utf8');

	assert.match(source, /className="thingtimeTopNavInner"/u);
	assert.match(source, /height="52px"/u);
	assert.match(source, /className="nav-left-section"[\s\S]*?height="36px"/u);
	assert.match(source, /className="electron-titlebar-home-button"[\s\S]*?height="36px"[\s\S]*?width="36px"/u);
	assert.match(source, /className="electron-titlebar-search-button"[\s\S]*?display=\{\['none', 'flex'\]\}/u);
	assert.match(source, /aria-label="Open Commander search"/u);
	assert.match(source, /onClick=\{onElectronSearchClick\}/u);
});

test('footer links the exact deployment branch and full commit SHA', async () => {
	const source = await readFile(new URL('./Footer.tsx', import.meta.url), 'utf8');

	assert.match(source, /THINGTIME_BRANCH_NAME/u);
	assert.match(source, /THINGTIME_VERCEL_GIT_COMMIT_SHA/u);
	assert.match(source, /thingtime\/tree\/\$\{branchName\}/u);
	assert.match(source, /thingtime\/commit\/\$\{commitSha\}/u);
	assert.match(source, /Exact git commit \$\{commitSha\}/u);
	assert.match(source, /🔖 \{commitSha\}/u);
});
