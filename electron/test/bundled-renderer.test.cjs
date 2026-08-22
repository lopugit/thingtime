'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const electronDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronDir, '..');

test('the desktop window always opens the packaged renderer while the selected endpoint configures only the API target', async () => {
	const mainSource = await readFile(path.join(electronDir, 'main.cjs'), 'utf8');
	const routesSource = await readFile(path.join(repoRoot, 'remix', 'app', 'routes.tsx'), 'utf8');
	const lopuSource = await readFile(path.join(repoRoot, 'remix', 'app', 'components', 'Lopu', 'useLopu.tsx'), 'utf8');
	const startupStart = mainSource.indexOf('app\n\t\t.whenReady()');
	const startupEnd = mainSource.indexOf("app.on('activate'");
	assert.ok(startupStart >= 0 && startupEnd > startupStart);
	const startup = mainSource.slice(startupStart, startupEnd);

	assert.match(mainSource, /function createWindow\(\)/u);
	assert.match(mainSource, /mainWindow\.loadURL\(appOrigin\)/u);
	assert.doesNotMatch(mainSource, /createWindow\(settings\.selectedEndpoint\.url\)/u);
	assert.doesNotMatch(mainSource, /mainWindow\.loadURL\(target\.url\)/u);
	assert.match(mainSource, /process\.env\.THINGTIME_API_FALLBACK_ORIGIN = new URL\(endpointUrl\)\.origin/u);
	assert.match(mainSource, /await session\.defaultSession\.clearCache\(\)/u);
	assert.ok(startup.indexOf('session.defaultSession.clearCache()') < startup.indexOf('initializeDesktopSettings()'));
	assert.ok(startup.indexOf('initializeDesktopSettings()') < startup.indexOf('startNitroServer()'));
	assert.match(routesSource, /cache: init\.cache \|\| 'no-store'/u);
	assert.match(lopuSource, /as=\{RouterLink\} to=\{link\.href\}/u);
});

test('the bundled Nitro API fallback reads the Electron-selected target at request time', async () => {
	const fallbackSource = await readFile(path.join(repoRoot, 'remix', 'server', 'utils', 'apiFallback.ts'), 'utf8');

	assert.match(fallbackSource, /process\.env\.THINGTIME_API_FALLBACK_ORIGIN/u);
	assert.match(fallbackSource, /requestUrl\.origin !== fallbackUrl\.origin/u);
	assert.doesNotMatch(fallbackSource, /getApiFallbackOrigin = \(\) => normaliseOrigin\(THINGTIME_PRODUCTION_ORIGIN\)/u);
});
