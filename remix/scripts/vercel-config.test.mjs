import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const remixRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(remixRoot, '..');
const vercelConfig = JSON.parse(readFileSync(resolve(repositoryRoot, 'vercel.json'), 'utf8'));

test('Vercel cron path and schedule pairs are unique', () => {
	const crons = vercelConfig.crons ?? [];
	const cronKeys = crons.map(({ path, schedule }) => `${path}\u0000${schedule}`);

	assert.equal(new Set(cronKeys).size, cronKeys.length, 'root vercel.json must not register the same cron path and schedule twice');
});

test('attachment cleanup and notification digest schedules are registered once', () => {
	assert.deepEqual(vercelConfig.crons, [
		{
			path: '/api/v1/attachments/cleanup',
			schedule: '17 * * * *'
		},
		{
			path: '/api/v1/notifications/email/weekly-summary',
			schedule: '37 21 * * 0'
		}
	]);
});
