import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTemplate } from '../ComponentsLibrary/componentTemplate';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { findBlock } from '../Builder/webpageBlocks';
import { thingMetadataBlocks, thingMetadataRenderComponent } from './thingMetadataBlocks';
import { parseThingMetadataResponse, refreshThingMetadata } from './thingMetadataClient';
import { formatByteSize } from '../../utils/formatByteSize';
import type { ThingMetadata, ThingMetadataResponse } from '../../utils/thingMetadata';

const id = 'scan';
const refId = `thing-metadata-${'a'.repeat(64)}`;
const measurement: ThingMetadata = {
  id: null, targetId: id, sourceHash: 'f'.repeat(64), canonicalVersion: 1, jsonBytes: 821,
  attachmentCount: 1, unavailableAttachmentCount: 0, attachedBytes: 5632, knownAttachedBytes: 5632,
};
const payload = (metadata = measurement, canSave = true): ThingMetadataResponse => ({ ok: true, metadata, canSave });
const source = { id, origin: 'https://thingtime.example', actor: 'owner', character: 'character', plane: 'home', linkKey: 'link' };

test('Thing metadata keeps JSON separate from attachment bytes and displays unknown honestly', () => {
  assert.equal(formatByteSize(5632), '5.63 KB');
  assert.equal(formatByteSize(6_000_000_000), '6 GB');
  assert.equal(formatByteSize(1_500_000_000_000), '1.5 TB');
  assert.equal(formatByteSize(999_999), '1 MB');
  assert.equal(formatByteSize(821), '821 B');
  assert.equal(formatByteSize(null), 'Unavailable');
  const markup = (metadata: ThingMetadata) => JSON.stringify(resolveTemplate(thingMetadataRenderComponent.render, metadata));
  const complete = markup(measurement);
  assert.match(complete, /File data/);
  assert.match(complete, /5\.63 KB/);
  assert.match(complete, /Thing data/);
  assert.match(complete, /821 B/);
  assert.match(complete, /5,632/);
  const partial = markup({ ...measurement, attachmentCount: 2, unavailableAttachmentCount: 1, attachedBytes: null });
  assert.match(partial, /Unavailable/);
  assert.match(partial, /Known file bytes \(partial total\)/);
  assert.doesNotMatch(partial, /Exact file data size/);
  const noFiles = markup({ ...measurement, attachmentCount: 0, attachedBytes: 0, knownAttachedBytes: 0 });
  assert.match(noFiles, /No attached files/);
});

test('the settings validator preserves separate editable bindings and refresh controls', () => {
  const blocks = settingsDocumentBlocks(thingMetadataBlocks);
  const block = (name: string) => findBlock(blocks, `thing-metadata-${name}`);
  assert.equal(block('file-label')?.text, 'File data');
  assert.deepEqual(block('file-size')?.format, { kind: 'bytes', arg: 'attachedBytes' });
  assert.deepEqual(block('json-size')?.format, { kind: 'bytes', arg: 'jsonBytes' });
  assert.equal(block('reference')?.props?.href, '{metadataHref}');
  assert.equal(block('summary')?.tag, 'summary');
  assert.equal(block('hash-code')?.text, '{sourceHash}');
  assert.deepEqual(block('refresh')?.props?.['data-tt-action-inputs'], { operation: 'refresh' });
});

test('foreign, inconsistent, and unnegotiated metadata cannot seed the view', () => {
  for (const next of [
    { ...measurement, targetId: 'another' },
    { ...measurement, id: '/thing/another' },
    { ...measurement, sourceHash: 'changed' },
    { ...measurement, canonicalVersion: 2 },
    { ...measurement, unavailableAttachmentCount: 1, attachedBytes: 0 },
    { ...measurement, attachmentCount: 0 },
  ]) assert.throws(() => parseThingMetadataResponse({ ok: true, metadata: next, canSave: true }, id), /did not match/);
});

test('owner refresh negotiates then reads and rebuilds, with the original authority fenced', async () => {
  const steps: string[] = [];
  const seen: ThingMetadata[] = [];
  const signal = new AbortController().signal;
  await refreshThingMetadata(source, {
    signal, canPersist: true, onMeasured: value => seen.push(value), assertCurrent: () => {}, onIdentityChange: assert.fail,
  }, {
    requireCapability: async (feature, version, origin) => {
      steps.push(`${feature}@${version}`);
      assert.equal(origin, source.origin);
    },
    fetch: async (input, init) => {
      const url = new URL(String(input), source.origin);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-Thingtime-Expected-Actor'), source.actor);
      assert.equal(headers.get('X-Thingtime-Character'), source.character);
      assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), source.plane);
      assert.equal(url.searchParams.get('id'), id);
      assert.equal(init?.body, undefined);
      if (init?.method === 'GET') {
        steps.push('GET');
        assert.equal(url.searchParams.get('key'), 'link');
        return Response.json(payload());
      }
      steps.push('POST');
      assert.equal(url.searchParams.has('key'), false);
      assert.equal(seen.length, 1);
      return Response.json(payload({ ...measurement, id: refId }, false));
    },
  });
  assert.deepEqual(steps, ['api.things-metadata@1.0.0', 'api.things@1.54.0', 'GET', 'POST']);
  assert.deepEqual(seen.map(next => next.id), [null, refId]);
});

test('read-only and already-saved Things do not write; cancelled views do not rebuild', async () => {
  for (const state of ['read-only', 'already-saved', 'cancelled'] as const) {
    const controller = new AbortController();
    const calls: Array<string | undefined> = [];
    const job = refreshThingMetadata(source, {
      signal: controller.signal, canPersist: state !== 'read-only', assertCurrent: () => {}, onIdentityChange: assert.fail,
      onMeasured: () => { if (state === 'cancelled') controller.abort(); },
    }, {
      requireCapability: async () => {},
      fetch: async (_, init) => {
        calls.push(init?.method);
        return Response.json(state === 'already-saved' ? payload({ ...measurement, id: refId }, false) : payload());
      },
    });
    if (state === 'cancelled') await assert.rejects(job, { name: 'AbortError' });
    else await job;
    assert.deepEqual(calls, ['GET']);
  }
});
