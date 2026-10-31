import assert from 'node:assert/strict';
import test from 'node:test';
import { includeForkComments as include, MAX_FORK_THINGS } from './forkComments';
import type { SharedComposition } from './sharedComposition';

const includeForkComments = (...args: Parameters<typeof include>) => include(args[0], args[1], args[2], args[3], args[4] || (async () => []));

const root: any = { shareId: 'root', schemaVersion: 2, ownerId: 'author', thingtime: ['post'], acl: ['tt:all'], crystal: { text: 'Root' } };
const comment = (id: string, targetId: string, extra = {}) => ({ ...root, shareId: id, targetId, thingtime: ['post', 'comment'], acl: ['tt:inherit'], ...extra });
const composition = () => ({ root, docs: new Map([[root.shareId, root]]) } as SharedComposition);
const collection = (rows: any[], batches: string[][] = []) => (async () => ({ find: (query: any) => {
 batches.push(query.targetId.$in);
 return { sort: () => ({ limit: (n: number) => ({ toArray: async () => rows.filter(row => query.targetId.$in.includes(row.targetId)).slice(0, n) }) }) };
} })) as any;

test('copy walks beyond the rendered reply preview and batches wide levels', async () => {
 const rows = [comment('first', 'root'), comment('second', 'root')];
 for (let i = 0; i < 8; i++) rows.push(comment(`deep-${i}`, i ? `deep-${i - 1}` : 'first'));
 const batches: string[][] = [];
 const result = await includeForkComments({ id: 'reader' }, composition(), collection(rows, batches));
 assert.ok(!('ok' in result)); if ('ok' in result) return;
 assert.equal(result.docs.size, 11);
 assert.deepEqual(batches[1], ['first', 'second']);
 assert.equal([...result.docs.keys()].at(-1), 'deep-7');
});

test('blocked and born-private comments and their descendants stay excluded', async () => {
 const rows = [comment('blocked', 'root', { moderation: { status: 'blocked' } }), comment('pending', 'root', { moderation: { status: 'pending' } }), comment('hidden-reply', 'blocked'), comment('safe', 'root')];
 const result = await includeForkComments({ id: 'reader' }, composition(), collection(rows));
 assert.ok(!('ok' in result)); if ('ok' in result) return;
 assert.deepEqual([...result.docs.keys()], ['root', 'safe']);
});

test('oversized threads fail explicitly instead of silently returning a partial copy', async () => {
 const result = await includeForkComments({ id: 'reader' }, composition(), collection(Array.from({ length: MAX_FORK_THINGS + 1 }, (_, i) => comment(`c${i}`, 'root'))));
 assert.equal('ok' in result && result.ok, false);
});


test('media comment threads and their nested galleries are included with exact readable parents', async () => {
 const files: any[] = [
  { ...root, shareId: 'root-file', targetId: 'root', thingtime: ['attachment'], acl: ['tt:inherit'] },
  { ...root, shareId: 'reply-file', targetId: 'media-comment', thingtime: ['attachment'], acl: ['tt:inherit'] },
  { ...root, shareId: 'blocked-file', targetId: 'root', thingtime: ['attachment'], acl: ['tt:inherit'], moderation: { status: 'blocked' } }
 ];
 const rows = [comment('media-comment', 'root-file'), comment('nested-media-comment', 'reply-file'), comment('hidden', 'blocked-file')];
 const result = await includeForkComments({ id: 'reader' }, composition(), collection(rows), undefined,
  async docs => files.filter(file => docs.some(doc => doc.shareId === file.targetId)));
 assert.ok(!('ok' in result)); if ('ok' in result) return;
 assert.deepEqual([...result.docs.keys()], ['root', 'root-file', 'media-comment', 'reply-file', 'nested-media-comment']);
});
