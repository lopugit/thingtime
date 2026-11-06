import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import { getLiveSession } from './sessions';
import { sessionPurposeCanActAsAccount } from './credentialPurpose';
import { findUserById } from './users';
import { characterIdentity, characterSelectionAllowed } from './characterCore';

export const CHARACTER_HEADER = 'X-Thingtime-Character';

// The authenticated principal is deliberately distinct from the acting user.
// Only full account sessions can select identities; PAT/app/device credentials
// cannot turn an owner id or header into account authority.
export async function characterPrincipal(request: Request) {
  const token = await getAuthToken(request);
  const claims = token ? await verifyJwt(token) : null;
  if (!claims) return null;
  const session = await getLiveSession(claims.jti);
  if (!session || String(session.userId) !== claims.sub || !sessionPurposeCanActAsAccount(session.purpose)) return null;
  const user = await findUserById(claims.sub);
  if (!user || user.accountKind === 'service' || user.meta?.temporary === true || !(await characterAccountLive(user))) return null;
  return { user, session, claims };
}

export async function characterAccountLive(user: any): Promise<boolean> {
  const identity = characterIdentity(user);
  if (!identity) return !user?.meta?.character;
  if (identity.disabled) return false;
  const owner = await findUserById(identity.ownerId);
  return !!owner && !owner.meta?.character && owner.accountKind !== 'service' && owner.meta?.temporary !== true;
}

export async function sessionActingUser(principal: any, session: any, requestedId?: string | null) {
  if (!(await characterAccountLive(principal))) return null;
  const selected = requestedId ?? session.meta?.activeCharacterId;
  if (selected === undefined || selected === null) return principal;
  if (typeof selected !== 'string' || !selected) return null;
  const target = String(principal._id) === selected ? principal : await findUserById(selected);
  return characterSelectionAllowed(principal, target) ? target : null;
}
