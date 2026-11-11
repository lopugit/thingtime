import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityManager } from './activityManager';
const fixture = () => {
	let saved = '[]',
		hidden = false;
	const manager = createActivityManager({
		storage: () => ({
			getItem: () => saved,
			setItem: (_key, value) => {
				saved = value;
			}
		}),
		hidden: () => hidden,
		notify: (fn) => fn()
	});
	return {
		manager,
		hide(value: boolean) {
			hidden = value;
			manager.visibilityChanged();
		},
		saved: () => saved
	};
};
test('disable persists before cleanup, aborts work and survives a new manager', () => {
	const f = fixture();
	let starts = 0,
		stops = 0,
		signal: AbortSignal;
	const dispose = f.manager.register({ id: 'sync', title: 'Sync', kind: 'schedule', background: true }, (value) => {
		signal = value;
		starts++;
		return () => {
			if (value.reason === 'disabled') assert.match(f.saved(), /sync/);
			stops++;
		};
	});
	f.manager.setEnabled('sync', false);
	assert.equal(signal!.aborted, true);
	assert.equal(signal!.reason, 'disabled');
	assert.equal(stops, 1);
	assert.equal(f.manager.read()[0].running, 0);
	const restarted = createActivityManager({ storage: () => ({ getItem: f.saved, setItem() {} }) });
	let restartedRuns = 0;
	restarted.register({ id: 'sync', title: 'Sync', kind: 'schedule' }, () => {
		restartedRuns++;
	});
	assert.equal(restartedRuns, 0);
	f.manager.setEnabled('sync', true);
	assert.equal(starts, 2);
	dispose();
	assert.equal(f.manager.read()[0].instances, 0);
});
test('hide releases view work; background work remains; unmount does not resurrect', () => {
	const f = fixture();
	let viewStarts = 0,
		viewStops = 0;
	const dispose = f.manager.register({ id: 'view', title: 'View', kind: 'polling' }, () => {
		viewStarts++;
		return () => {
			viewStops++;
		};
	});
	f.manager.register({ id: 'job', title: 'Job', kind: 'watcher', background: true }, () => {});
	f.hide(true);
	assert.equal(viewStops, 1);
	assert.equal(f.manager.read().find((x) => x.id === 'job')!.running, 1);
	f.hide(false);
	assert.equal(viewStarts, 2);
	dispose();
	f.hide(true);
	f.hide(false);
	assert.equal(viewStarts, 2);
});
test('multiple owners stop together and dispose independently', () => {
	const f = fixture();
	let active = 0;
	const start = () => {
		active++;
		return () => {
			active--;
		};
	};
	const a = f.manager.register({ id: 'same', title: 'Same', kind: 'listener' }, start),
		b = f.manager.register({ id: 'same', title: 'Same', kind: 'listener' }, start);
	assert.equal(active, 2);
	a();
	assert.equal(active, 1);
	f.manager.setEnabled('same', false);
	assert.equal(active, 0);
	b();
	assert.equal(f.manager.read()[0].instances, 0);
});
test('failed persistence leaves running work unchanged', () => {
	const m = createActivityManager({
		storage: () => ({
			getItem: () => null,
			setItem() {
				throw Error('disk');
			}
		})
	});
	let stopped = false;
	m.register({ id: 'x', title: 'X', kind: 'event' }, () => () => {
		stopped = true;
	});
	assert.throws(() => m.setEnabled('x', false));
	assert.equal(stopped, false);
	assert.equal(m.read()[0].enabled, true);
});
test('required lifecycle guards cannot be disabled', () => {
	const f = fixture();
	f.manager.register({ id: 'guard', title: 'Guard', kind: 'listener', essential: true }, () => {});
	assert.throws(() => f.manager.setEnabled('guard', false));
	assert.equal(f.manager.read()[0].running, 1);
});
test('callback accounting records actual measured duration and failures', async () => {
	let clock = 100;
	const m = createActivityManager({ now: () => clock, notify: (fn) => fn() });
	m.register({ id: 'x', title: 'X', kind: 'polling' }, () => {});
	await m.run('x', () => {
		clock = 105;
	});
	await assert.rejects(
		m.run('x', () => {
			clock = 109;
			throw Error('failed');
		})
	);
	const row = m.read()[0];
	assert.equal(row.calls, 2);
	assert.equal(row.failures, 1);
	assert.equal(row.durationMs, 9);
	assert.equal(row.lastRun, 105);
});
test('cross-window reload cancels already mounted work', () => {
	let saved = '[]',
		stopped = 0;
	const m = createActivityManager({
		storage: () => ({
			getItem: () => saved,
			setItem: (_k, v) => {
				saved = v;
			}
		})
	});
	m.register({ id: 'x', title: 'X', kind: 'watcher' }, () => () => {
		stopped++;
	});
	saved = '["x"]';
	m.reload();
	assert.equal(stopped, 1);
	assert.equal(m.read()[0].running, 0);
});

test('idle catalog choices refresh across windows and snapshots stay stable between changes', () => {
	let saved = '["idle"]';
	const manager = createActivityManager({
		storage: () => ({
			getItem: () => saved,
			setItem: (_key, value) => {
				saved = value;
			}
		})
	});
	manager.define({ id: 'idle', title: 'Idle work', kind: 'polling' });
	assert.equal(manager.read()[0].state, 'Disabled until you enable it');
	const snapshot = manager.read();
	assert.equal(manager.read(), snapshot);
	saved = '[]';
	manager.reload();
	assert.equal(manager.read()[0].enabled, true);
	assert.equal(manager.read()[0].state, 'Idle — no mounted owner');
});
