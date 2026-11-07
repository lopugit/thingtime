import assert from 'node:assert/strict';
import test from 'node:test';
import { previewBuildTime, previewBuiltLabel, deploymentBuiltAt, syncPreviewLabels } from './preview-labels.mjs';

const sha = 'a'.repeat(40), builtAt = Date.parse('2026-09-05T07:25:00Z');
const input = { repository: 'example/project', number: 596, sha, lane: 'develop', status: 'ready', builtAt };
function fixture() {
  const labels = new Map([['human', { name: 'human', description: 'keep me' }]]);
  const pr = { number: 596, state: 'open', head: { sha }, labels: [labels.get('human')] };
  const writes = [];
  let otherUse = false;
  const request = async (path, init = {}) => {
    if (init.method) writes.push({ path, ...init });
    if (path.endsWith('/pulls/596')) return structuredClone(pr);
    if (path.includes('/issues?')) return [{ number: 596 }, ...(otherUse ? [{ number: 597 }] : [])];
    if (path.endsWith('/issues/596/labels')) {
      for (const name of init.body.labels) if (!pr.labels.some((label) => label.name === name)) pr.labels.push(labels.get(name));
      return structuredClone(pr.labels);
    }
    if (path.includes('/issues/596/labels/')) {
      pr.labels = pr.labels.filter((label) => label.name !== decodeURIComponent(path.split('/labels/')[1]));
      return pr.labels;
    }
    if (path.endsWith('/labels')) {
      labels.set(init.body.name, structuredClone(init.body));
      return labels.get(init.body.name);
    }
    const name = decodeURIComponent(path.split('/labels/')[1]);
    const label = labels.get(name);
    if (!label) throw Object.assign(new Error('not found'), { status: 404 });
    if (init.method === 'PATCH') {
      labels.delete(name);
      Object.assign(label, { name: init.body.new_name, color: init.body.color, description: init.body.description });
      labels.set(label.name, label);
    }
    return structuredClone(label);
  };
  return { request, pr, labels, writes, useElsewhere: () => { otherUse = true; } };
}

test('Melbourne timestamp labels handle midnight and daylight saving explicitly', () => {
  assert.equal(previewBuildTime(builtAt), '05/09 17:25 AEST');
  assert.equal(previewBuildTime('2026-01-05T13:05:00Z'), '06/01 00:05 AEDT');
  assert.equal(previewBuiltLabel(input).name, 'last preview built 05/09 17:25 AEST #596');
  for (const lane of ['develop', 'admin-develop', 'production']) assert.ok(previewBuiltLabel({ ...input, lane }).description.length <= 100);
  assert.throws(() => previewBuiltLabel({ ...input, sha: 'bad' }));
  assert.throws(() => previewBuildTime('invalid'));
});

test('deployment completion time is preserved on reuse, never replaced with the reconciliation time', () => {
  assert.equal(deploymentBuiltAt({ ready: builtAt }), builtAt);
  assert.equal(deploymentBuiltAt({ readyAt: new Date(builtAt).toISOString() }), builtAt);
  assert.throws(() => deploymentBuiltAt({ createdAt: builtAt }), /completion timestamp/);
});

test('one successful timestamp label is reused while unrelated labels remain untouched', async () => {
  const api = fixture();
  await syncPreviewLabels({ ...input, request: api.request });
  assert.equal(api.pr.labels.length, 3);
  const count = api.writes.length;
  await syncPreviewLabels({ ...input, request: api.request });
  assert.equal(api.writes.length, count, 'same receipt is a read-only no-op');
  await syncPreviewLabels({ ...input, builtAt: builtAt + 60_000, request: api.request });
  assert.equal(api.pr.labels.length, 3);
  assert.ok(api.pr.labels.some((label) => label.name === 'human'));
  assert.ok(api.pr.labels.some((label) => label.name.includes('17:26')));
  assert.equal([...api.labels.values()].filter((label) => label.name.startsWith('last preview')).length, 1);
});

test('building and failed attempts retain the last success but change the current status', async () => {
  const api = fixture();
  await syncPreviewLabels({ ...input, request: api.request });
  for (const status of ['building', 'failed']) {
    await syncPreviewLabels({ ...input, status, builtAt: undefined, request: api.request });
    assert.ok(api.pr.labels.some((label) => label.name === previewBuiltLabel(input).name));
    assert.deepEqual(api.pr.labels.filter((label) => label.name.startsWith('preview:')).map((label) => label.name), [`preview: develop ${status}`]);
  }
});

test('stale heads, foreign label ownership, and cross-PR label reuse fail safely', async () => {
  const api = fixture();
  assert.deepEqual(await syncPreviewLabels({ ...input, sha: 'b'.repeat(40), request: api.request }), { stale: true });
  assert.equal(api.writes.length, 0);
  await syncPreviewLabels({ ...input, request: api.request });
  api.useElsewhere();
  await assert.rejects(syncPreviewLabels({ ...input, builtAt: builtAt + 60_000, request: api.request }), /used elsewhere/);
  const foreign = fixture(), desired = previewBuiltLabel(input);
  foreign.labels.set(desired.name, { ...desired, description: 'human owned' });
  await assert.rejects(syncPreviewLabels({ ...input, request: foreign.request }), /different metadata/);
});

test('multiple selected environments have independent timestamps and status', async () => {
  const api = fixture();
  for (const lane of ['admin-develop', 'production']) await syncPreviewLabels({ ...input, lane, request: api.request });
  await syncPreviewLabels({ ...input, lane: 'production', status: 'failed', request: api.request });
  assert.ok(api.pr.labels.some((label) => label.name === 'preview: admin-develop ready'));
  assert.ok(api.pr.labels.some((label) => label.name === 'preview: production failed'));
  assert.equal(api.pr.labels.filter((label) => label.name.startsWith('last preview')).length, 2);
});

test('reusing an older deployment keeps the newest historical timestamp but repairs current status', async () => {
  const api = fixture();
  await syncPreviewLabels({ ...input, request: api.request });
  await syncPreviewLabels({ ...input, status: 'building', request: api.request });
  await syncPreviewLabels({ ...input, builtAt: builtAt - 60_000, request: api.request });
  assert.ok(api.pr.labels.some((label) => label.name === previewBuiltLabel(input).name));
  assert.ok(api.pr.labels.some((label) => label.name === 'preview: develop ready'));
  assert.ok(!api.pr.labels.some((label) => label.name === 'preview: develop building'));
});

test('cleanup preserves build history, removes ready status, and never labels an unrelated PR', async () => {
  const api = fixture();
  assert.deepEqual(await syncPreviewLabels({ ...input, status: 'removed', request: api.request }), { absent: true });
  assert.equal(api.writes.length, 0);
  await syncPreviewLabels({ ...input, request: api.request });
  api.pr.state = 'closed';
  await syncPreviewLabels({ ...input, status: 'removed', request: api.request });
  assert.ok(api.pr.labels.some((label) => label.name === previewBuiltLabel(input).name));
  assert.ok(api.pr.labels.some((label) => label.name === 'preview: develop removed'));
  assert.ok(!api.pr.labels.some((label) => label.name === 'preview: develop ready'));
});

test('an accepted rename with a lost response is reconciled without duplicate history or skipped status', async () => {
  const api = fixture();
  await syncPreviewLabels({ ...input, request: api.request });
  await syncPreviewLabels({ ...input, status: 'building', request: api.request });
  let patches = 0;
  await syncPreviewLabels({ ...input, builtAt: builtAt + 60_000, pause: async () => {}, request: async (path, init) => {
    const result = await api.request(path, init);
    if (init?.method === 'PATCH' && ++patches === 1) throw Object.assign(new Error('lost response'), { status: 502 });
    return result;
  } });
  assert.equal(patches, 1);
  assert.equal(api.pr.labels.filter((label) => label.name.startsWith('last preview')).length, 1);
  assert.ok(api.pr.labels.some((label) => label.name === 'preview: develop ready'));
});
