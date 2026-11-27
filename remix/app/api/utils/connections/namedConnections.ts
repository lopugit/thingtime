import { createHash, randomUUID } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { connectionVaultConfigured, packConnectionTokens } from './tokenVault';
import { fail } from './shared';
import { namedAccess, parseNamedConnectionInput, verifiedNamedScope, type NamedConnectionInput } from '../../../connections/namedAccess';
import type { ConnectionProvider, OAuthTokens, ResolvedExternalAccount } from './providers';
import { EXTERNAL_ACCOUNT_KIND, externalAccountShareId, toPublicConnection } from './connections';

export const NAMED_CONNECTION_KIND = 'external-auth-connection';

type Owner = { id: string };
export type NamedIntent = NamedConnectionInput & { expectedAccountId?: string; expectedRevision?: string };

const profileId = (ownerId: string, provider: string, requestId: string) =>
  'ext-auth-' + createHash('sha256').update(JSON.stringify([ownerId, provider, requestId])).digest('hex').slice(0, 48);

export async function prepareNamedIntent(owner: Owner, provider: ConnectionProvider, raw: unknown, origin: string) {
  const input = parseNamedConnectionInput(provider.id, raw);
  if (!input || provider.auth === 'none') return fail(400, 'Choose a name and supported access for an authenticated connection.');
  if (!input.reconnectId) return { ok: true as const, intent: input };
  const existing = await (await getHomeThingsCollection()).findOne({
    shareId: input.reconnectId, thingtime: NAMED_CONNECTION_KIND, ownerId: owner.id,
    'crystal.provider': provider.id, 'crystal.origin': origin
  });
  if (!existing?.parentId || typeof existing.crystal?.credentialVersion !== 'string') return fail(404, 'Connection not found on this origin.');
  return { ok: true as const, intent: { ...input, expectedAccountId: existing.parentId, expectedRevision: existing.crystal.credentialVersion } };
}

export async function saveNamedConnection(
  owner: Owner, provider: ConnectionProvider, account: ResolvedExternalAccount, tokens: OAuthTokens | null,
  intent: NamedIntent, requestedScopes: string[], origin: string, environment: string
) {
  if (!(tokens?.accessToken || tokens?.idToken) || !connectionVaultConfigured()) return fail(503, 'Secure account storage is unavailable.');
  const grantedScopes = tokens.confirmedScopes ?? null;
  if ((intent.requestedScopes || []).some(scope => !verifiedNamedScope(grantedScopes || [], scope)) || intent.allowedOperations.some(operation => {
    const scope = namedAccess[operation].scope;
    return scope && (!grantedScopes || !verifiedNamedScope(grantedScopes, scope));
  })) return fail(403, 'The provider did not confirm all selected permissions.');

  const accountId = externalAccountShareId(provider.id, account.providerAccountId, owner.id);
  if (intent.reconnectId && (intent.expectedAccountId !== accountId || !intent.expectedRevision)) {
    return fail(409, 'Choose the same external account to reconnect this connection.');
  }
  const id = intent.reconnectId || profileId(owner.id, provider.id, intent.requestId);
  const collection = await getHomeThingsCollection();
  const identity = { shareId: id, thingtime: NAMED_CONNECTION_KIND, ownerId: owner.id, parentId: accountId,
    'crystal.provider': provider.id, 'crystal.origin': origin, 'crystal.environment': environment };
  const accountIdentity = { shareId: accountId, thingtime: EXTERNAL_ACCOUNT_KIND, ownerId: owner.id };
  const persist = () => withHomeMongoTransaction(async session => {
    const existing = await collection.findOne({ shareId: id, thingtime: NAMED_CONNECTION_KIND, ownerId: owner.id }, { session });
    if (existing && (!intent.reconnectId || existing.crystal?.grantRevision === intent.requestId)) {
      if (existing.parentId !== accountId || existing.crystal?.origin !== origin ||
          existing.crystal?.environment !== environment || existing.crystal?.name !== intent.name ||
          JSON.stringify(existing.crystal?.allowedOperations) !== JSON.stringify(intent.allowedOperations) ||
          JSON.stringify(existing.crystal?.requestedScopes) !== JSON.stringify(requestedScopes))
        return fail(409, 'This connection request was already used. Start a new connection.');
      const currentAccount = await collection.findOne(accountIdentity, { session });
      if (!currentAccount) return fail(409, 'The original account is no longer available.');
      return { ok: true as const, connection: toPublicConnection(existing, currentAccount, provider), alreadyLinked: true };
    }
    const now = new Date();
    const fields = {
      secure: await packConnectionTokens(owner.id, id, tokens),
      'crystal.name': intent.name, 'crystal.grantRevision': intent.requestId, 'crystal.credentialVersion': randomUUID(), 'crystal.requestedScopes': requestedScopes,
      'crystal.grantedScopes': grantedScopes, 'crystal.allowedOperations': intent.allowedOperations,
      'crystal.expiresAt': tokens.expiresAt || null, updatedAt: now
    };
    // Update the selected credential only. A newer reconnect, removal, or
    // refresh of the original must never re-create or silently replace it.
    if (intent.reconnectId) {
      const updated = await collection.updateOne(
        { ...identity, 'crystal.credentialVersion': intent.expectedRevision },
        { $set: fields }, { session }
      );
      if (!updated.matchedCount) return fail(409, 'This connection changed. Start reconnecting again.');
    } else {
      await collection.updateOne(identity, { $set: fields, $setOnInsert: {
        schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, shareId: id, thingtime: [NAMED_CONNECTION_KIND],
        ownerId: owner.id, parentId: accountId, targetId: null, tags: [], acl: [], storageClass: 'control', createdAt: now,
        'crystal.provider': provider.id, 'crystal.accountId': accountId, 'crystal.origin': origin, 'crystal.environment': environment
      } }, { session, upsert: true });
    }
    // Keep the legacy account identity and grant untouched when it already
    // exists. Named consent writes its own row and never reads sibling tokens.
    await collection.updateOne(accountIdentity, { $inc: { connectionRevision: 1 }, $setOnInsert: {
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, shareId: accountId, thingtime: [EXTERNAL_ACCOUNT_KIND],
      ownerId: owner.id, targetId: null, tags: [], acl: [], storageClass: 'control', createdAt: now, updatedAt: now,
      crystal: { provider: provider.id, providerAccountId: account.providerAccountId,
        displayName: account.displayName, handle: account.handle, avatarUrl: account.avatarUrl,
        profileUrl: account.profileUrl, config: account.config }
    } }, { session, upsert: true });
    const saved = await collection.findOne(identity, { session });
    const savedAccount = await collection.findOne(accountIdentity, { session });
    return { ok: true as const, connection: toPublicConnection(saved, savedAccount, provider), alreadyLinked: false };
  });
  try { return await persist(); }
  catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
    return persist();
  }
}
