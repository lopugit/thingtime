// Disposable multi-process contention fixture; no account rows, credentials or
// network listeners. Each process opens the same test-owned SQLite file.
import { createCollectionProvider } from './collectionProvider.ts';
import { openSqliteDocumentStore } from './sqliteStore.ts';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities.ts';
import { createNativeRateLimitRepository } from './nativeRateLimits.ts';
import { withHomeRateLimitRepository } from '../rateLimit/repository.ts';
import { enforceFixedRateLimit } from '../rateLimit/enforce.ts';
const provider = createCollectionProvider(await openSqliteDocumentStore(process.argv[2]));
try {
 const auth = await createNativeHomeAuthRepositories(provider, 'home'), repository = await createNativeRateLimitRepository(provider, 'home');
 const start = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(Error('Fixture start deadline')), 15000);
  process.once('message', message => { clearTimeout(timeout); if (message !== 'go') reject(Error('Invalid fixture start')); else resolve(); });
 });
 process.send!('ready'); await start;
 const allowed = await auth.run(() => withHomeRateLimitRepository(repository, async () => {
  let admitted = 0;
  for (let i = 0; i < 20; i++) {
   const result = await enforceFixedRateLimit(new Request('http://127.0.0.1:17873/api/v1/auth/login'), 'process-contention', 'shared', { limit: 9, windowMs: 60000 });
   if (result.unavailable) throw Error('Unexpected persistence failure');
   if (result.allowed) admitted++;
  }
  return admitted;
 }));
 process.send!({ allowed });
} finally { await provider.close(); process.disconnect(); }
