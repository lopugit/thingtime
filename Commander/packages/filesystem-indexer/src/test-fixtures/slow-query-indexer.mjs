import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin });
const requests = [];
let processing = false;

input.on('line', (line) => {
  requests.push(JSON.parse(line));
  void processNext();
});

async function processNext() {
  if (processing) return;
  const request = requests.shift();
  if (!request) return;
  processing = true;
  if (request.operation === 'query') {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const result =
    request.operation === 'query'
      ? {
          request: request.request,
          records: [
            {
              path: `/tmp/${request.request.query}.txt`,
              name: `${request.request.query}.txt`,
              parent: '/tmp',
              kind: 'file',
              score: 60_000,
            },
          ],
        }
      : { schemaVersion: 1, totalRecords: 3, databaseSizeBytes: 4_096, kinds: [] };
  process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  processing = false;
  void processNext();
}
