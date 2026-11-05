import React from 'react';
import { Box, Flex, Select, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';
import { useWorkspaceUser } from '../../hooks/useWorkspaceUser';
import { CharacterScope } from './CharacterScope';
import { useCharacters } from './useCharacters';
import { AccountSyncStatus } from '../../local-workspace/AccountSyncStatus';
import { useWorkspaceScope } from '../../hooks/useWorkspaceScope';
import { TimelineProvider } from '../../timeline/TimelineProvider';
import { LocalMediaDiagnostics } from '../../local-workspace/media.client';
import { characterContentPath, isCharacterContentPath } from './characterContentPath';
export { characterContentPath } from './characterContentPath';

export function CharacterContentRoute({children}: {children:React.ReactNode}) {
 const location = useLocation(), params = new URLSearchParams(location.search);
 if (!isCharacterContentPath(location.pathname) || !params.has('character')) return <>{children}</>;
 if (params.getAll('character').length !== 1 || !params.get('character')) return <Box p={6} pt="100px"><Text role="alert">This Character workspace link is invalid.</Text></Box>;
 return <CharacterContentScope actorId={params.get('character')} showSync><TimelineProvider>{children}</TimelineProvider></CharacterContentScope>;
}

export function CharacterWorkspacePicker() {
 const current = useWorkspaceUser(), {roster,error} = useCharacters(), navigate = useNavigate(), id = React.useId();
 if (!current || current.localOnly || !roster?.characters.length) return null;
 const choices = [roster.principal, ...roster.characters.filter(row=>!row.disabled).map(row=>row.user)];
 return <Flex gap={2} align="center" wrap="wrap" width="100%">
  <Text as="label" htmlFor={id}>Workspace</Text>
  <Select id={id} aria-label="Workspace" width="auto" maxW="100%" value={current.id} onChange={event=>{
   const actor=choices.find(choice=>choice.id===event.target.value);if(!actor)return;
   navigate(actor.id===roster.principal.id ? '/things' : characterContentPath('/things',actor.id));
  }}>{choices.map(actor=><option key={actor.id} value={actor.id}>{actor.displayName || actor.username}</option>)}</Select>
  {error ? <Text role="status" fontSize="sm">{error}</Text> : null}
 </Flex>;
}

/** A local content link may select a retained Character label, never an account
 * session or remote grant. Every remote operation still authorizes delegation. */
export function CharacterContentScope({ actorId, showSync = false, children }: { actorId: string | null; showSync?: boolean; children: React.ReactNode }) {
 const current = useWorkspaceUser();
 const workspace = useWorkspaceScope();
 if (!actorId || actorId === current?.id) return <>{children}</>;
 if (current?.localOnly) return <Box p={6} pt="calc(var(--tt-nav-clearance, 54px) + 24px)"><Text role="status">This Character is unavailable in this workspace.</Text></Box>;
 return <SelectedCharacterContent key={`${workspace}:${actorId}`} actorId={actorId} showSync={showSync}>{children}</SelectedCharacterContent>;
}

function SelectedCharacterContent({ actorId, showSync, children }: { actorId: string; showSync: boolean; children: React.ReactNode }) {
 const { roster, error } = useCharacters();
 const actor = roster?.characters.find(row => row.user.id === actorId && !row.disabled)?.user;
 if (!actor) return <Box p={6} pt="calc(var(--tt-nav-clearance, 54px) + 24px)"><Text role="status">
  {error || (roster ? 'This Character is unavailable in this workspace.' : 'Opening the saved Character workspace…')}
 </Text></Box>;
 return <CharacterScope.Provider value={actor}>{showSync ? <><AccountSyncStatus actorId={actor.id}/><LocalMediaDiagnostics /></> : null}{children}</CharacterScope.Provider>;
}
