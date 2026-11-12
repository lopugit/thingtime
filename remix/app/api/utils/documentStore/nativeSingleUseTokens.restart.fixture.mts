import { createEmailVerification, consumeEmailVerification } from '../auth/emailVerifications';
import { withHomeEmailVerificationRepository } from '../auth/singleUseTokenRepository';
import { createNativeEmailVerificationRepository } from './nativeSingleUseTokens';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
let input='';for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input);
const provider=createCollectionProvider(await openSqliteDocumentStore(request.file));
try {
 const repository=await createNativeEmailVerificationRepository(provider,'restart-home');
 const result=await withHomeEmailVerificationRepository(repository,'restart-home',()=>request.mode==='issue'
  ? createEmailVerification({userId:'restart-account',email:'restart@example.invalid'})
  : consumeEmailVerification(request.token));
 process.stdout.write(JSON.stringify(result)); // Protected child pipe, never test/receipt logging.
} finally { await provider.close(); }
