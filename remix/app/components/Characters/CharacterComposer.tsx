import React from 'react';
import { Box, Flex, Select, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CharacterScope } from './CharacterScope';
import { useCharacters } from './useCharacters';
export function CharacterComposer({ children }: { children: React.ReactNode }) {
  const selectId = React.useId();
  const current = useCurrentUser();
  const { roster, error } = useCharacters();
  const [selected, setSelected] = React.useState(current?.id || '');
  React.useEffect(() => setSelected(current?.id || ''), [current?.id]);
  const choices = roster ? [roster.principal, ...roster.characters.filter(c => !c.disabled).map(c => c.user)] : current ? [current] : [];
  const actor = choices.find(user => user.id === selected);
  if (!current) return <>{children}</>;
  return <Box minW={0}>
    <Flex gap={2} align="center" mb={2} flexWrap="wrap">
      <Text as="label" htmlFor={selectId} fontSize="xs">Post as</Text>
      <Select id={selectId} aria-label="Post as" size="sm" width="auto" maxW="100%" value={selected} onChange={event => setSelected(event.target.value)}>
        {choices.map(user => <option key={user.id} value={user.id}>{user.displayName || user.username}</option>)}
      </Select>
      {error && <Text fontSize="xs">Character choices unavailable. Retry in Settings → Characters.</Text>}
    </Flex>
    {actor ? <CharacterScope.Provider key={actor.id} value={actor}>{children}</CharacterScope.Provider> : <Text>That Character is unavailable. Choose another identity.</Text>}
  </Box>;
}
