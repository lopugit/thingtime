import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEDULED_HTTP_JOBS } from '../api/utils/automation/scheduledJobs';
import {
	AUTOMATION_SURFACES,
	AUTOMATION_SWITCHES,
	DEFAULT_AUTOMATION_SWITCHES,
	automationSwitchFor,
	isAutomationSwitchId,
	normalizeAutomationSwitches,
	scheduledJobSwitchId,
	validateAutomationSwitchChanges
} from './automationSwitches';

test('every switch is off by default and ids are unique', () => {
	const ids = AUTOMATION_SWITCHES.map((entry) => entry.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.ok(ids.every((id) => DEFAULT_AUTOMATION_SWITCHES[id] === false));
	assert.ok(AUTOMATION_SWITCHES.every((entry) => AUTOMATION_SURFACES.some((surface) => surface.id === entry.surface)));
	// Stored keys swap the first dot for an underscore, so surfaces must not contain one.
	assert.ok(AUTOMATION_SURFACES.every((surface) => !surface.id.includes('_')));
	assert.ok(ids.every((id) => /^[a-z]+\.[A-Za-z0-9-]+$/.test(id)), 'one dot, no underscores');
});

test('each scheduled job has its own switch', () => {
	for (const job of SCHEDULED_HTTP_JOBS) assert.ok(isAutomationSwitchId(scheduledJobSwitchId(job.id)), job.id);
});

test('normalizing keeps only known switches and only literal true turns one on', () => {
	const state = normalizeAutomationSwitches({ 'web.timeline': true, 'web.messenger': 'true', 'mac.node': 1, 'not.a-switch': true });
	assert.equal(state['web.timeline'], true);
	assert.equal(state['web.messenger'], false);
	assert.equal(state['mac.node'], false);
	assert.equal('not.a-switch' in state, false);
	assert.deepEqual(normalizeAutomationSwitches(null), DEFAULT_AUTOMATION_SWITCHES);
	assert.deepEqual(normalizeAutomationSwitches(['web.timeline']), DEFAULT_AUTOMATION_SWITCHES);
});

test('administrator changes must name known switches with boolean values', () => {
	assert.deepEqual(validateAutomationSwitchChanges({ 'web.timeline': true, 'scheduled.invites-expire': false }), {
		ok: true, changes: { 'web.timeline': true, 'scheduled.invites-expire': false }
	});
	assert.equal(validateAutomationSwitchChanges({}).ok, false);
	assert.equal(validateAutomationSwitchChanges({ 'web.unknown': true }).ok, false);
	assert.equal(validateAutomationSwitchChanges({ 'web.timeline': 'on' }).ok, false);
	assert.equal(validateAutomationSwitchChanges([['web.timeline', true]]).ok, false);
});

test('browser activity ids and refresh keys map to their owning switch', () => {
	assert.equal(automationSwitchFor('timer:timeline/TimelineProvider:1'), 'web.timeline');
	assert.equal(automationSwitchFor('timer:components/Nav/NotificationsBell:1'), 'web.notifications');
	assert.equal(automationSwitchFor('messenger-unread:user-1'), 'web.messenger');
	assert.equal(automationSwitchFor('lopu-tasks:user-1'), 'web.lopu');
	assert.equal(automationSwitchFor('timer:components/Watch/WatchPendingApprovals:1'), 'web.devices');
	assert.equal(automationSwitchFor('timer:components/Admin/CIControl/CIControlDashboard:2'), 'web.admin');
	assert.equal(automationSwitchFor('root-data'), 'web.pageData');
	assert.equal(automationSwitchFor('sync.remote-control'), 'desktop.fileSync');
	assert.equal(automationSwitchFor('sync.resources.local'), 'desktop.fileSync');
	assert.equal(automationSwitchFor('timer:components/Somewhere/New:1'), 'web.other');
});

// Every network poller registered in source must land on a real switch. A new
// prefix that silently maps to web.other is fine; a mapping to an unknown id is not.
test('every polling id in the web app resolves to a registered switch', () => {
	const root = join(process.cwd(), 'app');
	const ids = new Set<string>();
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) { if (name !== 'node_modules') walk(path); continue; }
			if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
			for (const match of readFileSync(path, 'utf8').matchAll(/activityInterval\(\s*'([^']+)'/g)) ids.add(match[1]);
		}
	};
	walk(root);
	assert.ok(ids.size > 10, 'found the activity intervals');
	for (const id of ids) assert.ok(isAutomationSwitchId(automationSwitchFor(id)), id);
});
