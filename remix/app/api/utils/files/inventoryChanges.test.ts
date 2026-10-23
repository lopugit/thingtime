import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudInventoryChangesService, CLOUD_CHANGES_MAX_BYTES } from './inventoryChanges';
import { createCloudInventoryPagesService } from './inventoryPages';
import { timelineFolderId } from '../timeline/repository';
import { TIMELINE_EVENT_KIND } from '../../../timeline/contract';
import { contentPartPlan } from '../../../fileSync/contentFingerprint';
const folder = (id: string, parent: string | null = 'root', name = id) => ({ shareId: id, ownerId: 'owner', thingtime: ['folder'],
    folderId: parent, acl: ['tt:user'], updatedAt: new Date('2026-10-20T00:00:00Z'), crystal: { name } });
const file = (id: string, parent = 'root') => ({ ...folder(id, parent), thingtime: ['file'], timelineHeadId: 'version-' + id,
    crystal: { name: id, trashed: false, content: { attachmentId: 'bytes-' + id, version: 'a'.repeat(64), size: 4,
        fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(4), sha256: 'b'.repeat(64) } } } });
function fixture(initial = [folder('root', null), file('first')]) {
    const docs: any[] = initial, events: any[] = []; let now = 0, closed = 0, queries = 0, wakes = 0;
    let wake: () => boolean | void = () => {}, prime = () => {}, session: any;
    const commit = (targetId: string, ownerId = 'owner') => {
        const position = events.length + 1;
        events.push({ ownerId, thingtime: [TIMELINE_EVENT_KIND], targetId, createdAt: new Date(position) });
        return position;
    };
    const collection: any = {
        findOne: async (filter: any, options: any) => {
            assert.equal(options.session, session);
            if (filter.shareId === timelineFolderId('owner')) return { timelinePosition: events.filter(e => e.ownerId === 'owner').at(-1)?.createdAt.getTime() ?? 0 };
            if (filter.thingtime === TIMELINE_EVENT_KIND) return events.find(e => e.ownerId === filter.ownerId && +e.createdAt === +filter.createdAt);
            return session.docs.find((d: any) => d.shareId === filter.shareId && d.ownerId === filter.ownerId);
        },
        find: (filter: any, options: any) => {
            assert.equal(options.session, session); queries++;
            let selected = filter.thingtime === TIMELINE_EVENT_KIND
                ? events.filter(e => e.ownerId === filter.ownerId && +e.createdAt > +filter.createdAt.$gt && +e.createdAt <= +filter.createdAt.$lte)
                : session.docs.filter((d: any) => d.ownerId === filter.ownerId && filter.folderId.$in.includes(d.folderId) && !d.crystal?.trashed);
            if (filter.thingtime === TIMELINE_EVENT_KIND) assert.deepEqual(options.projection, { targetId: 1, createdAt: 1 });
            return { sort() { return this; }, limit(n: number) { selected = selected.slice(0, n); return this; }, batchSize() { return this; },
                toArray: async () => selected, async *[Symbol.asyncIterator]() { yield* selected; }, close: async () => {} };
        },
        watch: (pipeline: any) => {
            assert.equal(pipeline[0].$match['fullDocument.ownerId'], 'owner'); assert.deepEqual(pipeline[1], { $project: { _id: 1 } });
            return { tryNext: async () => { now += 1000; if (++wakes === 1) { prime(); return null; } const changed = wake(); return changed === false ? null : { operationType: 'insert' }; }, close: async () => { closed++; } };
        }
    };
    const snapshot = async <T>(work: (session: any) => Promise<T>) => {
        session = { docs: structuredClone(docs), snapshotEnabled: true, inTransaction: () => false,
            snapshotTime: { getHighBitsUnsigned: () => 100, getLowBitsUnsigned: () => 1 } };
        return work(session);
    };
    const deps = { collection: async () => collection, snapshot, customPlane: () => false, now: () => now };
    return { docs, events, commit, service: createCloudInventoryChangesService(deps), pages: createCloudInventoryPagesService(deps),
        counts: () => ({ closed, queries, wakes }), prime: (fn: () => void) => { prime = fn; }, wake: (fn: () => boolean | void) => { wake = fn; } };
}

test('watermark precedes snapshot and durable cursor sees later creates/updates without a tree refresh', async () => {
    const f = fixture(); f.commit('first');
    const watermark = await f.service('owner', 'root', undefined, false);
    assert.ok(watermark.ok); assert.equal(watermark.feed.cursor, 1); assert.deepEqual(watermark.feed.changes, []);
    f.docs.push(file('new')); f.commit('new');
    f.docs[1].timelineHeadId = 'updated'; f.commit('first');
    const page = await f.service('owner', 'root', 1, false);
    assert.ok(page.ok); assert.equal(page.feed.cursor, 3); assert.equal(page.feed.hasMore, false);
    assert.deepEqual(page.feed.changes.map(c => [c.position, c.entry.path, c.entry.version]), [[2, 'new', 'version-new'], [3, 'first', 'updated']]);
    const replay = await f.service('owner', 'root', 1, false); assert.deepEqual(replay, page);
});

test('only current owned private descendants are exposed; unrelated and trashed events advance cursor without absence', async () => {
    const f = fixture([folder('root', null), folder('other-root', null), file('outside', 'other-root'), file('trashed')]);
    f.docs[3].crystal.trashed = true;
    f.commit('outside'); f.commit('trashed'); f.commit('foreign', 'other-owner');
    const result = await f.service('owner', 'root', 0, false);
    assert.ok(result.ok); assert.equal(result.feed.cursor, 2); assert.deepEqual(result.feed.changes, []);
    f.docs[0].acl = ['tt:public'];
    assert.equal((await f.service('owner', 'root', 2, false)).ok, false);
    assert.equal((await f.service('foreign-owner', 'root', 0, false)).ok, false);
});

test('moved/renamed folder invalidations expand only the affected subtree with original-root paths', async () => {
    const f = fixture([folder('root', null), folder('nested', 'root', 'renamed'), file('child', 'nested'), file('unrelated')]);
    f.commit('nested');
    const delta = await f.service('owner', 'root', 0, false);
    assert.ok(delta.ok); assert.equal(delta.feed.changes[0].subtree, 'nested'); assert.equal(delta.feed.changes[0].entry.path, 'renamed');
    const paths: string[] = [];
    await f.pages('owner', 'root', async page => { paths.push(...page.nodes.map(n => n.path)); }, undefined, 'nested');
    assert.deepEqual(paths, ['renamed/child']);
    f.docs[1].folderId = 'other';
    await assert.rejects(f.pages('owner', 'root', async () => {}, undefined, 'nested'));
});

test('ambiguous namespaces, lost boundaries and invalid cursors fail without advancing', async () => {
    const f = fixture(); f.commit('first'); f.docs.push({ ...file('alias'), crystal: { ...file('alias').crystal, name: 'FIRST' } });
    const collision = await f.service('owner', 'root', 0, false); assert.equal(collision.ok, false);
    f.docs.pop(); f.events[0].createdAt = new Date(2);
    assert.equal((await f.service('owner', 'root', 1, false)).ok, false);
    assert.equal((await f.service('owner', 'root', 3, false)).ok, false);
    assert.equal((await f.service('owner', 'root', -1, false)).ok, false);
    assert.equal((await f.service('owner', 'root', undefined, true)).ok, false);
});

test('bounded pages use lightweight Timeline headers and expose no client-authored history payload', async () => {
    const f = fixture([folder('root', null), ...Array.from({ length: 12 }, (_, i) => file('f' + i))]);
    for (let i = 0; i < 12; i++) f.commit('f' + i);
    f.events[0].secure = 'forged metadata must never be read';
    const first = await f.service('owner', 'root', 0, false); assert.ok(first.ok);
    assert.equal(first.feed.changes.length, 8); assert.equal(first.feed.hasMore, true); assert.ok(Buffer.byteLength(JSON.stringify(first.feed)) <= CLOUD_CHANGES_MAX_BYTES);
    const second = await f.service('owner', 'root', first.feed.cursor, false); assert.ok(second.ok); assert.equal(second.feed.changes.length, 4);
});

test('native change-stream wake is primed before read and closes on wake, failure and cancellation', async () => {
    const f = fixture(); f.commit('first');
    f.prime(() => { f.docs.push(file('between')); f.commit('between'); });
    const caught = await f.service('owner', 'root', 1, true); assert.ok(caught.ok); assert.equal(caught.feed.changes[0].entry.path, 'between'); assert.equal(f.counts().closed, 1);
    const g = fixture(); g.commit('first');
    g.wake(() => { g.docs[1].timelineHeadId = 'wake-version'; if (g.events.length === 1) g.commit('first'); });
    const woke = await g.service('owner', 'root', 1, true); assert.ok(woke.ok); assert.equal(woke.feed.changes[0].entry.version, 'wake-version'); assert.equal(g.counts().closed, 1);
    const abort = new AbortController(); const h = fixture(); h.commit('first'); h.prime(() => abort.abort());
    assert.equal((await h.service('owner', 'root', 1, true, abort.signal)).ok, false); assert.ok(h.counts().closed >= 1);
});


test('idle wait rechecks revoked root ACLs and a failed native subscription fails explicitly', async () => {
    const f = fixture(); f.commit('first');
    f.wake(() => { f.docs[0].acl = ['tt:public']; return false; });
    const revoked = await f.service('owner', 'root', 1, true);
    assert.equal(revoked.ok, false); if (!revoked.ok) assert.equal(revoked.status, 409);
    assert.equal(f.counts().closed, 1);
    const g = fixture(); g.commit('first'); g.prime(() => { throw Error('native subscription refused'); });
    const failed = await g.service('owner', 'root', 1, true);
    assert.equal(failed.ok, false); if (!failed.ok) assert.equal(failed.status, 503);
    assert.equal(g.counts().closed, 1);
});
