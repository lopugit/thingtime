import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vercelConfig = JSON.parse(readFileSync(resolve(repositoryRoot, 'vercel.json'), 'utf8'));

test('Vercel cron path and schedule pairs are unique', () => {
	const crons = vercelConfig.crons ?? [];
	const cronKeys = crons.map(({ path, schedule }) => `${path}\u0000${schedule}`);

	assert.equal(new Set(cronKeys).size, cronKeys.length, 'vercel.json must not register the same cron path and schedule twice');
});

test('recording processing, attachment cleanup, moderation sweep, peer sync, and notification digest schedules are registered once', () => {
	assert.deepEqual(vercelConfig.crons, [
		{ path: '/api/v1/auth/invites/expire', schedule: '11 * * * *' },
		{
			path: '/api/v1/lopu/recordings/run',
			schedule: '*/5 * * * *'
		},
		{
			path: '/api/v1/attachments/cleanup',
			schedule: '17 * * * *'
		},
		{
			path: '/api/v1/moderation/sweep',
			schedule: '29 * * * *'
		},
		{
			path: '/api/v1/peers/sync',
			schedule: '*/5 * * * *'
		},
		{
			path: '/api/v1/notifications/email/weekly-summary',
			schedule: '37 21 * * 0'
		}
	]);
});

import { prodCsp, devCsp } from './csp.mjs';
const cspSources = (csp, name) =>
	csp
		.split(';')
		.map((s) => s.trim())
		.find((s) => s.startsWith(name + ' '))
		.split(/\s+/)
		.slice(1);
test('native Maps can load under the deployed policy without broad script or eval exceptions', () => {
	const scripts = cspSources(prodCsp, 'script-src');
	assert.deepEqual(scripts, [
		"'self'",
		'https://cdn.jsdelivr.net',
		'https://va.vercel-scripts.com',
		'https://maps.googleapis.com',
		'https://maps.gstatic.com'
	]);
	for (const policy of [prodCsp, devCsp]) {
		assert(!cspSources(policy, 'script-src').includes("'unsafe-eval'"));
		for (const host of [
			'https://maps.googleapis.com',
			'https://mapsresources-pa.googleapis.com',
			'https://maps.gstatic.com',
			'https://csi.gstatic.com'
		])
			assert(cspSources(policy, 'connect-src').includes(host));
	}
});
