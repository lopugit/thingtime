import { timingSafeEqual } from 'node:crypto';
import type { CollectionProvider } from './collectionContract';
import { createNativeAccountCreationRepositories } from './nativeAccountCreation';
import { createNativeRosterRepository } from './nativeRosters';
import { createNativeEmailVerificationRepository } from './nativeSingleUseTokens';
import { createNativeSubscriptionRepository } from './nativeSubscriptions';
import { createNativeEmailRepository } from './nativeEmailRepository';
import { createNativeNotificationRepository } from './nativeNotifications';
import { createNativeRateLimitRepository } from './nativeRateLimits';
import { withHomeRosterRepository } from '../auth/rosterRepository';
import { withHomeEmailVerificationRepository } from '../auth/singleUseTokenRepository';
import { withHomeSubscriptionRepository } from '../subscriptions/subscriptionRepository';
import { withHomeEmailRepository } from '../email/repository';
import { withHomeNotificationRepository } from '../notifications/repository';
import { withHomeRateLimitRepository } from '../rateLimit/repository';
import { createNativeThingsPersistenceContext } from '../things/persistenceContext';
import { createNativeFoundPostRepository } from './nativeFoundPosts';
import { withHomeFoundPostRepository } from '../things/foundPostRepository';

const supportedOperations = Object.freeze([
 ['GET', 'root-data'],
 ['POST', 'v1/auth/register'], ['POST', 'v1/login'], ['POST', 'v1/auth/logout'],
 ['GET', 'v1/auth/me'], ['GET', 'v1/auth/accounts'], ['GET', 'v1/auth/verify-email'],
 ['GET', 'v1/tokens'], ['POST', 'v1/tokens'], ['POST', 'v1/tokens/revoke'], ['GET', 'v1/tokens/self'],
 ['GET', 'v1/notifications'], ['POST', 'v1/notifications/read']
].map(([method, path]) => Object.freeze({ method, path })));

/** Called only by the protected native host bootstrap. Opens no store and
 * selects no provider from HTTP, environment fallbacks, or remote responses.
 * Availability is explicit per operation: generic Things/OTP and
 * external message delivery remain unsupported until their real adapters exist. */
export async function createNativeAccountHttpHome(input: {
 provider: CollectionProvider; homePlaneId: string; publicDataPlane?: string; keyId: string;
 vaultKey: Uint8Array; outboxKey: Uint8Array;
}) {
 if (!input.homePlaneId || !input.keyId || !(input.vaultKey instanceof Uint8Array) || input.vaultKey.length !== 32 ||
  !(input.outboxKey instanceof Uint8Array) || input.outboxKey.length !== 32) throw new Error('Protected native account keys are unavailable');
 const vault = Buffer.from(input.vaultKey), outbox = Buffer.from(input.outboxKey);
 let closed = false;
 const check = () => {
  const configured = Buffer.from(process.env.THINGTIME_USER_VAULT_KEY || '', 'base64url');
  try {
   if (closed || process.env.THINGTIME_ADMIN_VAULT_KEY || configured.length !== vault.length || !timingSafeEqual(configured, vault))
    throw new Error('Protected native account key binding is unavailable');
  } finally { configured.fill(0); }
 };
 try {
  check();
  const { provider, homePlaneId, keyId } = input;
  const auth = await createNativeAccountCreationRepositories(provider, homePlaneId);
  const things = createNativeThingsPersistenceContext(provider, homePlaneId, input.publicDataPlane);
  const roster = await createNativeRosterRepository(provider, homePlaneId);
  const verification = await createNativeEmailVerificationRepository(provider, homePlaneId);
  const subscriptions = await createNativeSubscriptionRepository(provider, homePlaneId);
  const notifications = await createNativeNotificationRepository(provider, homePlaneId);
  const discoveries = await createNativeFoundPostRepository(provider, homePlaneId);
  const limiter = await createNativeRateLimitRepository(provider, homePlaneId);
  const email = await createNativeEmailRepository(provider, homePlaneId, {
   homePlaneId, keyId, withKey<T>(work: (key: Uint8Array) => T): T { check(); return work(outbox); }
  });
  return Object.freeze({
   supportedOperations,
   run<T>(work: () => T | Promise<T>): Promise<T> {
    check();
    return auth.run(() => things.run(() => withHomeSubscriptionRepository(subscriptions, () =>
     withHomeRosterRepository(roster, homePlaneId, () => withHomeEmailVerificationRepository(verification, homePlaneId, () =>
      withHomeEmailRepository(email, homePlaneId, () => withHomeNotificationRepository(notifications, () =>
       withHomeRateLimitRepository(limiter, () => withHomeFoundPostRepository(discoveries, work)))))))));
   },
   close() { closed = true; things.close(); vault.fill(0); outbox.fill(0); }
  });
 } catch (error) { vault.fill(0); outbox.fill(0); throw error; }
}
