// Private account metadata. Never include this descriptor in public profiles.
export type CharacterLoginMode = 'switch' | 'inherit' | 'password';
export type CharacterIdentity = {
  ownerId: string;
  loginMode: CharacterLoginMode;
  disabled: boolean;
};
export const characterIdentity = (user: any): CharacterIdentity | null => {
  const value = user?.meta?.character;
  if (!value || typeof value.ownerId !== 'string' || !value.ownerId ||
      !['switch', 'inherit', 'password'].includes(value.loginMode)) return null;
  return { ownerId: value.ownerId, loginMode: value.loginMode, disabled: value.disabled === true };
};
export const characterSelectionAllowed = (principal: any, target: any): boolean => {
  if (!principal || !target) return false;
  const own = characterIdentity(principal);
  if (own?.disabled) return false;
  if (String(principal._id) === String(target._id)) return !characterIdentity(target)?.disabled;
  const character = characterIdentity(target);
  return !own && principal.accountKind !== 'service' && principal.meta?.temporary !== true &&
    !!character && !character.disabled && character.ownerId === String(principal._id);
};

// The optional public handle is also used in ACLs and profile path segments.
// Keep it unambiguous without imposing an arbitrary character-count ceiling.
export function normalizeCharacterUsername(value: unknown): string | null {
  if (value === undefined || (typeof value === 'string' && !value.trim())) return '';
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]*$/.test(username) ? username : null;
}
