import { createContext, useContext } from 'react';

// Only a caller holding the canonical persisted identity supplies this context.
// Local field names, paths, UUIDs and authored id-shaped values are not identities.
export const PersistedThingSubject = createContext<string | null>(null);
export const usePersistedThingSubject = () => useContext(PersistedThingSubject);
