import { currentAccountCreationRepository } from './accountCreationRepository';
import { currentUserIdentityRepository } from './userIdentityRepository';
import { assertSameHomeRepositoryProvider } from './homeRepositoryScope';
import { currentRosterRepository } from './rosterRepository';
import { currentEmailVerificationRepository } from './singleUseTokenRepository';
import { currentEmailRepository } from '../email/repository';
import { currentNotificationRepository } from '../notifications/repository';
import { currentSubscriptionRepository } from '../subscriptions/subscriptionRepository';
import { currentRateLimitRepository } from '../rateLimit/repository';
import { ownerVaultConfigured } from './vaultCipher';

/** Partial native repository scopes must not create an account whose required
 * completion steps would later borrow hosted persistence. The trusted runtime
 * separately pins the protected JWT/vault/outbox keys before activating HTTP. */
export function nativeAccountCompletionAvailable(): boolean {
 try {
  const identity = currentUserIdentityRepository();
  if (!identity || !ownerVaultConfigured()) return false;
  const repositories = [currentAccountCreationRepository(), currentRosterRepository(),
   currentEmailVerificationRepository(), currentEmailRepository(), currentNotificationRepository(),
   currentSubscriptionRepository(), currentRateLimitRepository()];
  for (const repository of repositories) {
   if (!repository || repository.homePlaneId !== identity.homePlaneId) return false;
   assertSameHomeRepositoryProvider(identity, repository);
  }
  return true;
 } catch { return false; }
}
