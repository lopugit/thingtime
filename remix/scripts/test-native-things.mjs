import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// These fixtures own disposable SQLite files. An accidental Mongo fallback
// must fail against an unreachable fixture destination, never use a saved URI.
const tests = [
  'nativeOrdinaryService', 'persistenceContext', 'persistenceContext.transaction',
  'nativeAudienceReads', 'contentExecutionGate', 'contentExecutionGate.native',
  'mongoPersistence'
].map(name => `app/api/utils/things/${name}.test.ts`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/native-things-no-mongo', MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:1/native-things-no-mongo' },
  stdio: 'inherit', timeout: 120_000
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
