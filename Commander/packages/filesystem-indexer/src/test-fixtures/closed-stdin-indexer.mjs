import { closeSync, readSync, writeSync } from 'node:fs';

// Synchronous fd reads avoid libuv retaining a duplicate stdin handle on macOS.
// Close the only read end, acknowledge readiness, and stay alive until retired.
const byte = Buffer.alloc(1);
let line = '';
while (readSync(0, byte, 0, 1, null) && byte[0] !== 10) line += byte.toString();
const request = JSON.parse(line);
closeSync(0);
writeSync(1, `${JSON.stringify({
  id: request.id,
  ok: true,
  result: { schemaVersion: 1, totalRecords: process.pid, databaseSizeBytes: 0, kinds: [] },
})}\n`);
setInterval(() => {}, 1_000);
