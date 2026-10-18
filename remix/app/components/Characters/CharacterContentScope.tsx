import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { useWorkspaceUser } from '../../hooks/useWorkspaceUser';
import { CharacterScope } from './CharacterScope';
import { useCharacters } from './useCharacters';
import { AccountSyncStatus } from '../../local-workspace/AccountSyncStatus';

/** A local content link may select a retained Character label, never an account
 * session or remote grant. Every remote operation still authorizes delegation. */
export function CharacterContentScope({ actorId, showSync = false, children }: { actorId: string | null; showSync?: boolean; children: React.ReactNode }) {
 const current = useWorkspaceUser();
 if (!actorId || actorId === current?.id) return <>{children}</>;
 if (current?.localOnly) return <Box p={6} pt="calc(var(--tt-nav-clearance, 54px) + 24px)"><Text role="status">This Character is unavailable in this workspace.</Text></Box>;
 return <SelectedCharacterContent actorId={actorId} showSync={showSync}>{children}</SelectedCharacterContent>;
}

function SelectedCharacterContent({ actorId, showSync, children }: { actorId: string; showSync: boolean; children: React.ReactNode }) {
 const { roster, error } = useCharacters();
 const actor = roster?.characters.find(row => row.user.id === actorId && !row.disabled)?.user;
 if (!actor) return <Box p={6} pt="calc(var(--tt-nav-clearance, 54px) + 24px)"><Text role="status">
  {error || (roster ? 'This Character is unavailable in this workspace.' : 'Opening the saved Character workspace…')}
 </Text></Box>;
 return <CharacterScope.Provider value={actor}>{showSync ? <AccountSyncStatus actorId={actor.id}/> : null}{children}</CharacterScope.Provider>;
}

export const characterContentPath = (path: string, actorId: string) => `${path}?${new URLSearchParams({ character: actorId })}`;
