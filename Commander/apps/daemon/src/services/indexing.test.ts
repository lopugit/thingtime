import { describe, expect, it } from 'vitest';
import { decodeIndexedItemId, indexedItemId, indexRecordToSearchItem } from './indexing.js';

describe('filesystem index search item bridge', () => {
  it('maps a persistent file record to native open, reveal, copy, icon, and drag metadata', () => {
    const item = indexRecordToSearchItem({
      path: '/Users/test/Documents/report.pdf',
      name: 'report.pdf',
      parent: '/Users/test/Documents',
      kind: 'file',
      size: 42,
      score: 60_000,
    });
    expect(item).toMatchObject({
      title: 'report.pdf',
      subtitle: '/Users/test/Documents/report.pdf',
      kind: 'file',
      icon: 'file',
      path: '/Users/test/Documents/report.pdf',
      actions: [
        { id: 'open', title: 'Open' },
        { id: 'show-in-finder', title: 'Show in Finder' },
        { id: 'copy-path', title: 'Copy Path' },
      ],
    });
    expect(decodeIndexedItemId(item.id)).toEqual({
      kind: 'file',
      path: '/Users/test/Documents/report.pdf',
    });
  });

  it('uses a stable opaque ID and rejects malformed or relative paths', () => {
    expect(indexedItemId('directory', '/Users/test/Documents')).toBe(
      indexedItemId('directory', '/Users/test/Documents'),
    );
    expect(decodeIndexedItemId('index:file:bm90LXJlYWxseS1hYnNvbHV0ZQ')).toBeUndefined();
    expect(decodeIndexedItemId('index:unknown:abcd')).toBeUndefined();
  });
});
