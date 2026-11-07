import React from 'react';
import { Flex, Select, Text } from '@chakra-ui/react';
import type { CurrentUser } from '~/hooks/useCurrentUser';
import { useCharacters } from './useCharacters';
import { useWorkspaceScope } from '../../hooks/useWorkspaceScope';
/** A late selection callback cannot carry an actor into another workspace. */
export function usePostAsUser(user: CurrentUser) {
 const scope=useWorkspaceScope();
 const [selection,setSelection]=React.useState<{scope:string;user:NonNullable<CurrentUser>} | null>(null);
 return [selection?.scope===scope ? selection.user : user, (next:NonNullable<CurrentUser>)=>setSelection({scope,user:next})] as const;
}
export function PostAsSelect({ user, onChange }: { user: CurrentUser; onChange: (user: NonNullable<CurrentUser>) => void }) {
  const { roster } = useCharacters();
  const id = React.useId();
  const choices = roster ? [roster.principal, ...roster.characters.filter(c => !c.disabled).map(c => c.user)] : user ? [user] : [];
  return <Flex align="center" gap={2} minW={0} flexWrap="wrap"><Text as="label" htmlFor={id} fontSize="xs">Post as</Text><Select id={id} aria-label="Post as" size="xs" width="auto" maxW="100%" value={user?.id || ''} onChange={event => {
    const next = choices.find(choice => choice.id === event.target.value); if (next) onChange(next);
  }}>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.displayName || choice.username}</option>)}</Select></Flex>;
}
