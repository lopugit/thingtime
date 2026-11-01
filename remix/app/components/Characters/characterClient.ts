import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import type { CurrentUser } from '~/hooks/useCurrentUser';
export type Character = { user: NonNullable<CurrentUser>; loginMode: 'switch' | 'inherit' | 'password'; disabled: boolean };
export type CharacterRoster = { canManage: boolean; principal: NonNullable<CurrentUser>; activeCharacterId: string | null; characters: Character[]; nextCursor: string | null };
export async function characterRequest(input?: Record<string, unknown>, query?: Record<string, string>, signal?: AbortSignal) {
  await requireThingtimeCapability('api.auth-characters', '1.0.0');
  // Credentials deliberately bypass the general request history/diagnostics.
  const response = await fetch(`/api/v1/auth/characters${query ? `?${new URLSearchParams(query)}` : ''}`, {
    method: input ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {})
  });
  const data = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Characters are unavailable');
  return data;
}
