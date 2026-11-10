import { createContext, useContext } from 'react';
import { characterContentPath } from './characterContentPath';
import type { CurrentUser } from '~/hooks/useCurrentUser';
export const CharacterScope = createContext<CurrentUser | undefined>(undefined);
export const useCharacterScope = () => useContext(CharacterScope);
export const CHARACTER_HEADER = 'X-Thingtime-Character';

export function useCharacterContentPath() {
 const actor = useCharacterScope();
 return (path:string) => characterContentPath(path, actor?.id);
}
