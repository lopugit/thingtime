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
