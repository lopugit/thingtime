import { describe, expect, it } from 'vitest';
import { decodeIndexedItemId, indexedItemId, indexRecordToSearchItem, indexTimeoutMs } from './indexing.js';

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
        { id: 'open', title: 'Open', shortcut: '↵' },
        { id: 'show-in-finder', title: 'Show in Finder', shortcut: '⇧⌘R' },
        { id: 'copy-file', title: 'Copy', shortcut: '⌘C' },
        { id: 'copy-path', title: 'Copy Path', shortcut: '⇧⌘C' },
        { id: 'copy-name', title: 'Copy Name' },
        { id: 'move-to-trash', title: 'Move to Trash', shortcut: '⌘⌫', destructive: true },
        {
          id: 'delete',
          title: 'Delete Immediately…',
          shortcut: '⌥⌘⌫',
          destructive: true,
        },
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

describe('filesystem index resource scheduling', () => {
  it('extends the isolated writer timeout for deliberately CPU-constrained scans', () => {
    expect(indexTimeoutMs(100)).toBe(90_000);
    expect(indexTimeoutMs(60)).toBe(90_000);
    expect(indexTimeoutMs(20)).toBe(112_500);
    expect(indexTimeoutMs(5)).toBe(450_000);
  });

  it('allows an unlimited whole-home scan to run for the full bounded indexing window', () => {
    expect(indexTimeoutMs(100, true)).toBe(15 * 60_000);
    expect(indexTimeoutMs(5, true)).toBe(15 * 60_000);
  });
});
