import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// These fixtures own disposable SQLite files. An accidental Mongo fallback
// must fail against an unreachable fixture destination, never use a saved URI.
const tests = [
  'nativeOrdinaryService', 'persistenceContext', 'persistenceContext.transaction', 'contentDataPlane',
  'nativeAudienceReads', 'contentExecutionGate', 'contentExecutionGate.native',
  'mongoPersistence'
].map(name => `app/api/utils/things/${name}.test.ts`);
tests.push(
  'app/api/utils/actions/sharedComposition.native.test.ts',
  'app/api/utils/components/nativeCatalogReads.test.ts',
  'app/api/utils/serviceWorkspaces/nativeAccess.test.ts',
  'app/api/utils/things/nativeExternalAudienceReads.test.ts'
);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/native-things-no-mongo', MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:1/native-things-no-mongo' },
  // The workspace pagination fixture uses canonical account/content writes
  // for hundreds of records; retain a finite deadline without dropping it.
  stdio: 'inherit', timeout: 300_000
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
