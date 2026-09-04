import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.operation === 'index' && request.configuration?.sources?.[0]?.id === 'hang') return;
  if (request.operation === 'index') {
    process.stdout.write(
      `${JSON.stringify({
        id: request.id,
        event: 'progress',
        progress: {
          sourceId: request.configuration?.sources?.[0]?.id ?? 'unknown',
          root: request.configuration?.sources?.[0]?.root ?? '/tmp',
          processed: 12,
          indexed: 10,
          skipped: 2,
          errors: 0,
        },
      })}\n`,
    );
  }
  const result =
    request.operation === 'status'
      ? { schemaVersion: 1, totalRecords: 3, databaseSizeBytes: 4096, kinds: [] }
      : request.operation === 'query'
        ? {
            records: [
              {
                path: '/tmp/note.txt',
                name: 'note.txt',
                parent: '/tmp',
                kind: 'file',
                score: 60000,
              },
            ],
          }
        : request.operation === 'index'
          ? { configuration: request.configuration }
          : null;
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
});
