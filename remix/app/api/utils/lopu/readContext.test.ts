import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectThingCrystal } from './thingInspection';
import { normalizeReadReferences, rememberReadReference, restoreReadContext, LOPU_READ_CONTEXT_PAGES } from './readContext';

const crystal = { render: { children: Array.from({ length: 70 }, (_, index) => ({ index, text: 'page '.repeat(80) })) } };
const call = (offset = 0) => ({ id: 'read', name: 'get_thing', input: { id: 'planner', path: '/render', offset } });
const page = (offset = 0) => ({ ok: true as const, summary: 'Read', data: { thing: { id: 'planner' }, crystalRead: inspectThingCrystal(crystal, { path: '/render', offset }) } });
const references = () => [0, 4000, 8000].reduce((refs, offset) => rememberReadReference(refs, call(offset), page(offset)), [] as ReturnType<typeof normalizeReadReferences>);

test('read locators retain exact pages without persisting JSON or caller grants', async () => {
  const refs = references();
  assert.equal(refs.length, 3);
  assert.doesNotMatch(JSON.stringify(refs), /children|page |grant|input/);
  const invoked: any[] = [];
  const ctx = { viewer: { id: 'current-viewer' } } as any;
  const restored = await restoreReadContext(refs, async (tool, context) => {
    assert.equal(context, ctx);
    invoked.push(tool);
    assert.equal(tool.name, 'get_thing');
    return page((tool.input as any).offset);
  }, ctx);
  assert.deepEqual(restored.references, refs);
  assert.deepEqual(invoked.map(tool => tool.input.offset), [0, 4000, 8000]);
  const data = JSON.parse(restored.text.split('\n').at(-1)!);
  assert.equal(data.pages.map((entry: any) => entry.crystalRead.json).join(''), JSON.stringify(crystal.render).slice(0, 12000));
});

test('one changed or inaccessible page discards the whole resource and all old JSON', async () => {
  for (const failure of ['revoked', 'changed', 'throws']) {
    const result = await restoreReadContext(references(), async tool => {
      if ((tool.input as any).offset === 4000) {
        if (failure === 'throws') throw new Error('private internal failure');
        if (failure === 'revoked') return { ok: false, error: 'secret error' };
        return { ...page(4000), data: { ...page(4000).data, crystalRead: { ...page(4000).data.crystalRead, revision: 'f'.repeat(64) } } };
      }
      return page((tool.input as any).offset);
    }, {} as any);
    assert.deepEqual(result.references, []);
    assert.doesNotMatch(result.text, /children|page |secret error|private internal failure/);
    assert.equal(JSON.parse(result.text.split('\n').at(-1)!).unavailable.length, 1);
  }
});

test('new revisions replace old pages and reference bounds reject injected operations', () => {
  const changed = { ...page(), data: { ...page().data, crystalRead: { ...page().data.crystalRead, revision: 'a'.repeat(64) } } };
  assert.equal(rememberReadReference(references(), call(), changed).length, 1);
  assert.deepEqual(rememberReadReference([], { ...call(), name: 'run_action' }, page()), []);
  assert.deepEqual(normalizeReadReferences([{ id: 'planner', path: '/render', offset: 3 }, { id: 'planner', path: '/bad~escape', offset: 0, revision: 'a'.repeat(64) }]), []);
  const many = Array.from({ length: 100 }, (_, offset) => ({ ...references()[0], offset, grant: 'not-carried', tool: 'delete_thing' }));
  const normalized = normalizeReadReferences(many);
  assert.equal(normalized.length, LOPU_READ_CONTEXT_PAGES);
  assert.doesNotMatch(JSON.stringify(normalized), /grant|delete/);
});

test('Stop prevents read restoration before any tool and after in-flight reads', async () => {
  const abort = new AbortController();
  let reads = 0;
  abort.abort();
  await assert.rejects(restoreReadContext(references(), async () => { reads++; return page(); }, { signal: abort.signal } as any));
  assert.equal(reads, 0);
  const active = new AbortController();
  await assert.rejects(restoreReadContext(references(), async tool => { active.abort(); return page((tool.input as any).offset); }, { signal: active.signal } as any));
});
