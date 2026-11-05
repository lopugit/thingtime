import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb';
import { TimelineNameQueue, TIMELINE_NAME_PENDING_LIMIT } from './nameQueue';
import { TimelineLocalStore } from './localStore';
import { TimelineSync } from './sync';
import { planVersionName } from './versionNameMutation';
import { entryFixture, eventFixture } from './testFixtures';
import type { TimelineVersionName, TimelineVersionNameCommand, TimelineVersionNameResult } from './versionNames';
const scope = { apiOrigin: 'https://thingtime.example', ownerId: 'user-1', dataPlane: 'home' };
const target = (id = 'base') =>
	eventFixture(id, { ownerId: scope.ownerId, actorId: scope.ownerId, thingId: 'page', mode: 'revision', source: 'api', clientId: null });
const command = (name: string | null, eventId = 'base', expectedRevision = 0): TimelineVersionNameCommand => ({
	command: 'name-version',
	operationId: randomUUID(),
	eventId,
	thingId: 'page',
	name,
	expectedRevision
});
const unused = async () => {
	throw new Error('unused');
};
function fixture() {
	const factory = new IDBFactory(),
		backend = new IndexedDbTimelineBackend(factory),
		queue = new TimelineNameQueue(scope, backend),
		events = new TimelineLocalStore(scope, backend);
	let clock = Date.now(),
		position = 1;
	const remote = new Map<string, { name: TimelineVersionName | null; revision: number; updatedAt: string | null }>(),
		replies = new Map<string, { command: TimelineVersionNameCommand; result: TimelineVersionNameResult }>(),
		calls: TimelineVersionNameCommand[] = [];
	const write = async (input: TimelineVersionNameCommand) => {
		calls.push(structuredClone(input));
		const replay = replies.get(input.operationId);
		if (replay) {
			assert.deepEqual(input, replay.command);
			return replay.result;
		}
		const prior = remote.get(input.eventId) ?? { name: null, revision: 10, updatedAt: null };
		const plan = planVersionName({
			ownerId: scope.ownerId,
			command: input,
			signature: input.operationId,
			target: entryFixture(target(input.eventId)),
			current: prior.name,
			baseRevision: prior.revision,
			previousUpdatedAt: prior.updatedAt,
			now: new Date(++clock).toISOString()
		});
		const result = { ok: true as const, name: plan.name, entry: plan.event ? entryFixture(plan.event, ++position) : null };
		remote.set(input.eventId, { name: plan.name, revision: plan.revision, updatedAt: plan.updatedAt });
		replies.set(input.operationId, { command: structuredClone(input), result });
		return result;
	};
	const sync = (q = queue, b = backend, fn = write) =>
		new TimelineSync(new TimelineLocalStore(scope, b), { push: unused, page: unused, nameVersion: fn }, undefined, undefined, undefined, q);
	return { factory, backend, queue, events, remote, replies, calls, write, sync };
}
test('offline name/rename/clear survives reopening and rebases only unsent successors from real receipts', async () => {
	const f = fixture();
	let reopened: IndexedDbTimelineBackend | undefined;
	try {
		await f.events.accept([entryFixture(target())]);
		const first = command('First'),
			second = command('Second', 'base', 1),
			clear = command(null, 'base', 2),
			last = command('Last', 'base', 0);
		for (const c of [first, second, clear, last]) await f.queue.enqueue(c, target());
		assert.equal((await f.queue.view(['base'])).get('base')!.name, 'Last');
		assert.equal((await f.events.forThing('page')).length, 1, 'local naming does not fabricate account effect events');
		await f.backend.close();
		reopened = new IndexedDbTimelineBackend(f.factory);
		const queue = new TimelineNameQueue(scope, reopened);
		assert.deepEqual(
			(await queue.queued()).map((row) => row.command),
			[first, second, clear, last]
		);
		assert.equal(await f.sync(queue, reopened).pushPending(), 4);
		assert.equal((await queue.queued()).length, 0);
		assert.deepEqual(
			f.calls.map((c) => c.expectedRevision),
			[0, 11, 12, 0]
		);
		assert.equal((await queue.view(['base'])).get('base')!.revision, 14);
		assert.equal(f.remote.get('base')!.name!.name, 'Last');
		assert.equal((await new TimelineLocalStore(scope, reopened).forThing('page')).length, 5);
	} finally {
		await (reopened ?? f.backend).close();
	}
});
test('a lost name reply keeps the exact frozen request while a later offline edit waits', async () => {
	const f = fixture();
	let reopened: IndexedDbTimelineBackend | undefined;
	try {
		const first = command('First');
		await f.queue.enqueue(first, target());
		const broken = f.sync(f.queue, f.backend, async (c) => {
			await f.write(c);
			throw new Error('Lost reply');
		});
		await assert.rejects(broken.pushPending(), /Lost reply/);
		const frozen = (await f.queue.queued())[0].sent;
		assert.ok(frozen);
		const second = command('Second', 'base', 1);
		await f.queue.enqueue(second, target());
		await f.backend.close();
		reopened = new IndexedDbTimelineBackend(f.factory);
		const queue = new TimelineNameQueue(scope, reopened);
		assert.equal(await f.sync(queue, reopened).pushPending(), 2);
		assert.deepEqual(f.calls[0], f.calls[1]);
		assert.equal(f.calls[2].expectedRevision, 11);
		assert.equal((await queue.view(['base'])).get('base')!.name, 'Second');
	} finally {
		await (reopened ?? f.backend).close();
	}
});
test('concurrent tabs serialize optimistic names, reject stale local edits and retain exact retries', async () => {
	const f = fixture(),
		other = new IndexedDbTimelineBackend(f.factory),
		queue = new TimelineNameQueue(scope, other);
	try {
		const first = command('One');
		await Promise.all([f.queue.enqueue(first, target()), queue.enqueue(first, target())]);
		assert.equal((await queue.queued()).length, 1);
		await assert.rejects(queue.enqueue(command('Stale'), target()), /changed on this device/);
		assert.deepEqual(await f.queue.freeze(first.operationId), await queue.freeze(first.operationId));
		await assert.rejects(queue.enqueue({ ...first, name: 'Reused' }, target()), /identity was reused/);
		const response = await f.write(first);
		await Promise.all([f.queue.acknowledge(first, response), queue.acknowledge(first, response)]);
		assert.equal((await queue.queued()).length, 0);
		await assert.rejects(queue.enqueue(command('Foreign'), { ...target(), ownerId: 'other' }), /retained content version/);
		assert.equal((await new TimelineNameQueue({ ...scope, ownerId: 'other' }, other).view(['base'])).size, 0);
	} finally {
		await other.close();
		await f.backend.close();
	}
});
test('a definitive refusal preserves local names, permits unrelated sync and requires explicit review', async () => {
	const f = fixture();
	try {
		const first = command('My name'),
			second = command('Unrelated', 'other');
		await f.queue.enqueue(first, target());
		await f.queue.enqueue(second, target('other'));
		await assert.rejects(
			f
				.sync(f.queue, f.backend, async (c) => {
					if (c.eventId === 'base') throw { status: 409, message: 'Changed elsewhere' };
					return f.write(c);
				})
				.pushPending(),
			/needs review/
		);
		assert.equal(f.remote.get('other')!.name!.name, 'Unrelated');
		assert.equal((await f.queue.view(['base'])).get('base')!.name, 'My name');
		const elsewhere = await f.write(command('Account name'));
		await f.queue.accept([elsewhere.name!], ['base'], Date.now() + 1000);
		await f.queue.retry('base', randomUUID());
		assert.equal(await f.sync().pushPending(), 1);
		assert.equal(f.remote.get('base')!.name!.name, 'My name');
		const pending = command('Next', 'base', 12);
		await f.queue.enqueue(pending, target());
		await assert.rejects(f.queue.dismiss('base'), /uncertain/);
		await f.queue.reject(pending.operationId, 422, 'Cannot apply');
		await f.queue.dismiss('base');
		assert.equal((await f.queue.view(['base'])).get('base')!.name, 'My name');
	} finally {
		await f.backend.close();
	}
});
test('late reads and old effects cannot undo an acknowledged name or resurrect a clear', async () => {
	const f = fixture();
	try {
		const before = Date.now() - 1000,
			first = command('First');
		await f.queue.enqueue(first, target());
		await f.sync().pushPending();
		const named = f.replies.get(first.operationId)!.result;
		await f.queue.accept([], ['base'], before);
		assert.equal((await f.queue.view(['base'])).get('base')!.name, 'First');
		const clear = command(null, 'base', 11);
		await f.queue.enqueue(clear, target());
		await f.sync().pushPending();
		await f.queue.effects([named.entry!.event]);
		assert.equal((await f.queue.view(['base'])).size, 0);
		const next = command('Pending');
		await f.queue.enqueue(next, target());
		await f.queue.clearCache();
		assert.equal((await f.queue.view(['base'])).get('base')!.name, 'Pending');
	} finally {
		await f.backend.close();
	}
});
test('retirement and malformed acknowledgements retain frozen work for an exact retry', async () => {
	const f = fixture();
	try {
		const first = command('Held');
		await f.queue.enqueue(first, target());
		let finish!: (value: TimelineVersionNameResult) => void, started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const sync = f.sync(f.queue, f.backend, async (c) => {
			const result = await f.write(c);
			started();
			return new Promise((resolve) => {
				finish = () => resolve(result);
			});
		});
		const run = sync.pushPending();
		await ready;
		sync.stop();
		finish(null as any);
		await assert.rejects(run, /stopped|abort|retired/i);
		assert.equal((await f.queue.queued()).length, 1);
		const wrong = structuredClone(f.replies.get(first.operationId)!.result);
		wrong.name!.ownerId = 'other';
		await assert.rejects(f.queue.acknowledge(first, wrong), /another version name/);
		assert.equal((await f.queue.queued()).length, 1);
		await f.sync().pushPending();
		assert.equal((await f.queue.queued()).length, 0);
	} finally {
		await f.backend.close();
	}
});
test('name queue bounds refuse atomically and remain durable at the limit', async () => {
	const f = fixture();
	try {
		for (let n = 0; n < TIMELINE_NAME_PENDING_LIMIT; n++) await f.queue.enqueue(command('Name ' + n, 'base', n), target());
		await assert.rejects(f.queue.enqueue(command('Too many', 'base', TIMELINE_NAME_PENDING_LIMIT), target()), /Too many/);
		assert.equal((await f.queue.queued()).length, TIMELINE_NAME_PENDING_LIMIT);
		assert.equal((await f.queue.view(['base'])).get('base')!.name, 'Name 127');
	} finally {
		await f.backend.close();
	}
});

test('a name transaction failure preserves accepted context and every pending intent', async () => {
	class FailingBackend extends IndexedDbTimelineBackend {
		fail = false;
		override changeNameState(scope: string, update: Parameters<IndexedDbTimelineBackend['changeNameState']>[1]) {
			return super.changeNameState(scope, (state) => {
				const next = update(state);
				if (this.fail) throw new Error('Injected name quota failure');
				return next;
			});
		}
	}
	const backend = new FailingBackend(new IDBFactory()),
		queue = new TimelineNameQueue(scope, backend);
	try {
		const first = command('Retained');
		await queue.enqueue(first, target());
		const before = await queue.queued();
		backend.fail = true;
		await assert.rejects(queue.enqueue(command('Next', 'base', 1), target()), /quota failure/);
		assert.deepEqual(await queue.queued(), before);
		assert.equal((await queue.view(['base'])).get('base')!.name, 'Retained');
	} finally {
		await backend.close();
	}
});

test('offline transport gates preserve every command without attempting network work', async () => {
	const f = fixture();
	let online = false;
	try {
		const first = command('First');
		await f.queue.enqueue(first, target());
		const sync = new TimelineSync(f.events, { push: unused, page: unused, nameVersion: f.write }, undefined, undefined, undefined, f.queue, () => {
			if (!online) throw new Error('Offline');
		});
		await assert.rejects(sync.pushPending(), /Offline/);
		assert.equal(f.calls.length, 0);
		assert.equal((await f.queue.queued())[0].sent, null);
		online = true;
		assert.equal(await sync.pushPending(), 1);
		assert.equal(f.calls.length, 1);
		assert.equal((await f.queue.queued()).length, 0);
	} finally {
		await f.backend.close();
	}
});


test('device draft names survive a lost upload reply and wait for the exact draft acknowledgement', async () => {
 const factory=new IDBFactory(),backend=new IndexedDbTimelineBackend(factory),store=new TimelineLocalStore(scope,backend),queue=new TimelineNameQueue(scope,backend);
 const draft=eventFixture('queued-device-version',{ownerId:scope.ownerId,actorId:scope.ownerId,thingId:'page'}),name=command('Local experiment',draft.id);
 let lost=true,acceptedDraft=false,names=0;
 const original=structuredClone(draft);
 const transport={page:unused,push:async(event:any)=>{assert.deepEqual(event,original);acceptedDraft=true;if(lost){lost=false;throw new Error('lost upload reply');}return entryFixture(event,1);},nameVersion:async(input:TimelineVersionNameCommand)=>{
  assert.ok(acceptedDraft);assert.equal((await store.forThing('page')).find(row=>row.event.id===draft.id)?.status,'accepted');names++;
  const plan=planVersionName({ownerId:scope.ownerId,command:input,signature:input.operationId,target:entryFixture(draft,1),current:null,baseRevision:0,previousUpdatedAt:null,now:new Date().toISOString()});
  return {ok:true as const,name:plan.name,entry:entryFixture(plan.event!,2)};
 }};
 try {
  await store.enqueue(draft);await queue.enqueue(name,draft);
  const sync=new TimelineSync(store,transport,undefined,undefined,undefined,queue);
  await assert.rejects(sync.pushPending(),/lost upload reply/);assert.equal(names,0);
  const reopened=new TimelineNameQueue(scope,backend);
  assert.equal((await reopened.view([draft.id])).get(draft.id)?.name,name.name);
  await new TimelineSync(store,transport,undefined,undefined,undefined,reopened).pushPending();
  assert.equal(names,1);assert.equal((await reopened.queued()).length,0);
  assert.equal((await reopened.accepted([draft.id])).get(draft.id)?.name,name.name);
  assert.deepEqual((await store.forThing('page')).find(row=>row.event.id===draft.id)?.event,original);
 } finally { await backend.close(); }
});
