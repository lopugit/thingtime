import { getSubscriptions } from '../subscriptions/subscriptions';
import { verifyPassword } from './passwords';
import { randomUUID } from 'node:crypto';
import { MAX_DISPLAY_NAME_CHARS } from '~/schemas/registry';
import { createAccountLink } from '../accounts/accountLinks';
import { getHomeThingsCollection, getSessionsCollection } from '../mongodb/collections';
import { createUserAccount } from './registerUser';
import { characterIdentity, characterSelectionAllowed } from './characterCore';
import { findUserById, findUserByUsername, findUsersByIds, setCharacterIdentity, toPublicUser, toPublicUserWithStorage, updateUserProfile } from './users';
import { revokedSessionPipeline } from './sessions';

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
export const canManageCharacters = (user: any) => !!user && !user.meta?.character && user.accountKind !== 'service' && user.meta?.temporary !== true;
const descriptor = async (user: any) => ({ user: await toPublicUserWithStorage(user), loginMode: characterIdentity(user)!.loginMode, disabled: characterIdentity(user)!.disabled });

// Page protected links through the existing (thingtime, ownerId, createdAt)
// index, then batch-resolve users. No owner field or new index on public users.
export async function listCharacters(ownerId: string, cursor?: string | null) {
  if (cursor && !/^account-link-[0-9a-f]{48}$/.test(cursor)) return fail(400, 'Invalid Character cursor');
  const links = await (await getHomeThingsCollection()).find({
    thingtime: 'account-link', ownerId, 'crystal.linkKind': 'character',
    ...(cursor ? { shareId: { $gt: cursor } } : {})
  }).sort({ shareId: 1 }).limit(51).toArray();
  const page = links.slice(0, 50);
  const users = await findUsersByIds(page.map((link: any) => String(link.crystal.targetId)));
  const owned = users.filter(user => characterIdentity(user)?.ownerId === ownerId);
  const subscriptions = await getSubscriptions('user', owned.map((user: any) => String(user._id)));
  const characters = owned.map((user: any) => ({ user: toPublicUser(user, subscriptions.get(String(user._id))), loginMode: characterIdentity(user)!.loginMode, disabled: characterIdentity(user)!.disabled }));
  return { ok: true as const, characters, nextCursor: links.length > 50 ? String(page[page.length - 1].shareId) : null };
}

export async function createCharacter(owner: any, input: any) {
  if (!canManageCharacters(owner)) return fail(403, 'Sign in to the owning account to create Characters');
  const ownerId = String(owner._id);
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) return fail(400, 'A stable UUID requestId is required');
  if (typeof input.displayName !== 'string' || !input.displayName.trim()) return fail(400, 'Display name is required');
  if (input.displayName.trim().length > MAX_DISPLAY_NAME_CHARS) return fail(400, `Display name is too long (max ${MAX_DISPLAY_NAME_CHARS})`);
  if (!['switch', 'inherit', 'password'].includes(input.loginMode)) return fail(400, 'Choose switch, inherit or password');
  if (input.loginMode === 'inherit' && !owner.passwordHash) return fail(400, 'Set an account password before choosing inherited login');
  const username = `character-${input.requestId.toLowerCase()}`;
  const existing = await findUserByUsername(username);
  if (existing) {
    if (characterIdentity(existing)?.ownerId !== ownerId) return fail(409, 'This Character creation ID is already in use');
    if (existing.displayName !== input.displayName.trim() || characterIdentity(existing)?.loginMode !== input.loginMode) return fail(409, 'This creation ID belongs to a different Character request');
    if (input.loginMode === 'password' && (typeof input.password !== 'string' || !(await verifyPassword(input.password, existing.passwordHash)))) return fail(409, 'This creation ID belongs to a different Character request');
    return { ok: true as const, character: await descriptor(existing) };
  }
  const created = await createUserAccount({
    username, displayName: input.displayName.trim(), email: '', emailOptional: true,
    password: input.loginMode === 'password' ? input.password : `${randomUUID()}-${randomUUID()}`,
    character: { ownerId, loginMode: input.loginMode, disabled: false },
    onCreated: async (user, session) => {
      const link = await createAccountLink({ linkKind: 'character', userId: ownerId, targetId: String(user._id), createdBy: ownerId, session });
      if (!link.ok) throw new Error('Character ownership could not be saved');
    }
  });
  if (created.ok === false) {
    // A concurrent retry may win the unique username insert. Resolve that
    // committed account with the same ownership/request checks above.
    if (created.status === 409 && await findUserByUsername(username)) return createCharacter(owner, input);
    return created;
  }
  return { ok: true as const, character: await descriptor(created.user) };
}

export async function updateCharacter(owner: any, input: any) {
  if (!canManageCharacters(owner)) return fail(403, 'Sign in to the owning account to manage Characters');
  const user = typeof input.characterId === 'string' ? await findUserById(input.characterId) : null;
  const identity = characterIdentity(user);
  if (!user || identity?.ownerId !== String(owner._id)) return fail(404, 'Character not found');
  if (input.operation === 'rename') {
    if (typeof input.displayName !== 'string' || !input.displayName.trim()) return fail(400, 'Display name is required');
    const updated = await updateUserProfile(String(user._id), { displayName: input.displayName });
    if (!updated.ok) return updated;
  } else if (input.operation === 'disable' || input.operation === 'enable') {
    await setCharacterIdentity(String(user._id), String(owner._id), { ...identity, disabled: input.operation === 'disable' });
    if (input.operation === 'disable') {
      await (await getSessionsCollection()).updateMany({ userId: String(user._id) }, revokedSessionPipeline(new Date()));
      // Owner sessions keep their principal; stop acting as the disabled Character.
      await (await getSessionsCollection()).updateMany({ userId: String(owner._id), 'meta.activeCharacterId': String(user._id) }, { $unset: { 'meta.activeCharacterId': '' } });
    }
  } else return fail(400, 'Unknown Character operation');
  return { ok: true as const, character: await descriptor(await findUserById(String(user._id))) };
}

export async function selectSessionCharacter(principal: any, session: any, characterId: unknown) {
  const id = characterId === null ? String(principal._id) : characterId;
  const target = typeof id === 'string' ? await findUserById(id) : null;
  if (!characterSelectionAllowed(principal, target)) return fail(403, 'That identity is not available to this session');
  const result = await (await getSessionsCollection()).updateOne({ jti: session.jti, userId: String(principal._id), revokedAt: null },
    id === String(principal._id) ? { $unset: { 'meta.activeCharacterId': '' } } : { $set: { 'meta.activeCharacterId': id } });
  if (!result.matchedCount) return fail(401, 'Session expired');
  return { ok: true as const, user: await toPublicUserWithStorage(target) };
}
