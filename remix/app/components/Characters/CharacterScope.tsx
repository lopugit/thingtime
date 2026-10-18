import { createContext, useContext } from 'react';
import type { CurrentUser } from '~/hooks/useCurrentUser';
export const CharacterScope = createContext<CurrentUser | undefined>(undefined);
export const useCharacterScope = () => useContext(CharacterScope);
export const CHARACTER_HEADER = 'X-Thingtime-Character';
