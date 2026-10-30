import readline from 'node:readline';
let policy = null;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.operation === 'query' && request.request.query === 'force-timeout') return;
  if (request.operation === 'readPolicy') policy = request.configuration;
  const name = policy ? 'eligible.txt' : 'unfiltered-private.txt';
  const result =
    request.operation === 'query'
      ? { records: [{ path: `/tmp/${name}`, name, parent: '/tmp', kind: 'file', score: 0 }] }
      : null;
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
});
