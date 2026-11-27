import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));
import { FileSystemIndexerClient } from './index.js';

function worker(): ChildProcessWithoutNullStreams & { stdin: PassThrough; stdout: PassThrough } {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams & { stdin: PassThrough; stdout: PassThrough };
}

afterEach(() => spawnMock.mockReset());

it('isolates replacement requests from retired worker pipe, exit and buffered stdout events', async () => {
  const old = worker();
  const replacement = worker();
  spawnMock.mockReturnValueOnce(old).mockReturnValueOnce(replacement);
  const client = new FileSystemIndexerClient({
    binaryPath: '/test/indexer',
    databasePath: '/tmp/test.sqlite3',
  });
  try {
    const first = client.status();
    const rejected = expect(first).rejects.toThrow('write EPIPE');
    const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    old.stdin.emit('error', error);
    await rejected;
    const next = client.status();
    const request = JSON.parse(replacement.stdin.read().toString());
    // Even a matching ID or malformed old reply must not touch the new request.
    old.stdout.write('invalid retired JSON\n');
    old.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result: { totalRecords: -1 } })}\n`);
    old.stdin.emit('error', error);
    old.emit('exit', 1, null);
    replacement.stdout.write(
      `${JSON.stringify({ id: request.id, ok: true, result: { totalRecords: 7 } })}\n`,
    );
    await expect(next).resolves.toEqual({ totalRecords: 7 });
    expect(old.kill).toHaveBeenCalledTimes(1);
    expect(replacement.kill).not.toHaveBeenCalled();
  } finally {
    // No actual subprocess exists in this test, so close need not wait on exit.
    Object.assign(replacement, { exitCode: 0 });
    await client.close();
  }
});
