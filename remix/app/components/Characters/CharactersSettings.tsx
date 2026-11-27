import React from 'react';
import { Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';
import { useCharacters, invalidateCharacters } from './useCharacters';
import { characterRequest } from './characterClient';
import { normalizeCharacterUsername } from '~/api/utils/auth/characterCore';
import { useLopu } from '~/components/Lopu/useLopu';

export function CharactersSettings() {
  const { roster, error, refresh } = useCharacters();
  const lopu = useLopu();
  const [displayName, setDisplayName] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [usernameError, setUsernameError] = React.useState('');
  const [createError, setCreateError] = React.useState('');
  const [loginMode, setLoginMode] = React.useState('switch');
  const [password, setPassword] = React.useState('');
  const [requestId, setRequestId] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [inspectId, setInspectId] = React.useState('');
  const inspectionGeneration = React.useRef(0);
  const [inspection, setInspection] = React.useState<{ characterId: string; ownerId: string } | null>(null);
  const run = async (input: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    if (input.operation === 'create') setCreateError('');
    try {
      const result = await characterRequest(input);
      if (input.operation === 'select') { window.location.reload(); return; }
      if (input.operation === 'create') { setPassword(''); setDisplayName(''); setUsername(''); setUsernameError(''); setRequestId(crypto.randomUUID()); }
      invalidateCharacters(); lopu({ title: input.operation === 'create' ? 'Character created' : 'Character updated', status: 'success' });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Please try again';
      if (input.operation === 'create') setCreateError(message);
      else lopu({ title: 'Character change failed', description: message, status: 'error' });
    }
    finally { setBusy(false); }
  };
  return <Box minW={0}>
    <Text mb={3}>Characters have their own public identity. Your ownership link is private to you and Thingtime administrators.</Text>
    <Text fontSize="sm" mb={4}>Each Character inherits your tier and keeps its own posts, storage usage and subspace memberships. Use a separate password for an agent; sharing your own password also grants access to your main account.</Text>
    {error && <Flex gap={2} mb={3}><Text>{error}</Text><Button onClick={refresh} size="sm">Retry</Button></Flex>}
    {roster?.activeCharacterId && <Button mb={4} maxW="100%" whiteSpace="normal" height="auto" py={2} overflowWrap="anywhere" isDisabled={busy} onClick={() => run({ operation: 'select', characterId: null })}>Return this session to {roster.principal.displayName || roster.principal.username}</Button>}
    {roster && !roster.canManage && <Text>Sign in to your owning account to create or manage Characters. This login can act only as {roster.principal.displayName || roster.principal.username}.</Text>}
    {roster?.canManage && <>
      <Box as="form" border="1px solid var(--tt-border, #ececef)" borderRadius="12px" p={4} mb={5} onSubmit={event => { event.preventDefault(); void run({ operation: 'create', requestId, displayName, username, loginMode, ...(loginMode === 'password' ? { password } : {}) }); }}>
        <Text fontWeight={600} mb={3}>Create a Character</Text>
        <Text as="label" htmlFor="character-display-name" fontSize="sm">Display name</Text>
        <Input id="character-display-name" value={displayName} onChange={e => setDisplayName(e.target.value)} mb={3} required isDisabled={busy} />
        <Text as="label" htmlFor="character-username" fontSize="sm">Username (optional)</Text>
        <Input id="character-username" value={username} autoCapitalize="none" autoCorrect="off" spellCheck={false} isDisabled={busy}
          aria-describedby={`character-username-help${usernameError ? ' character-username-error' : ''}`} aria-invalid={!!usernameError}
          onChange={event => { setUsername(event.target.value); setUsernameError(''); }}
          onBlur={() => setUsernameError(normalizeCharacterUsername(username) === null ? 'Start with a letter or number; use letters, numbers, dots, underscores or hyphens.' : '')} />
        <Text id="character-username-help" fontSize="sm" mt={1} mb={3}>Choose a public login ID, such as thingtime-platform. Leave blank to generate one. Uppercase letters become lowercase.</Text>
        {usernameError && <Text id="character-username-error" role="alert" color="var(--tt-error, #b42318)" fontSize="sm" mb={3}>{usernameError}</Text>}
        <Text as="label" htmlFor="character-login-mode" fontSize="sm">Sign-in method</Text>
        <Select id="character-login-mode" isDisabled={busy} value={loginMode} onChange={e => setLoginMode(e.target.value)} mb={3}>
          <option value="switch">Switch only — no password login</option>
          <option value="inherit">Use my current account password</option>
          <option value="password">Separate password — suitable for an agent</option>
        </Select>
        {loginMode === 'password' && <><Text as="label" htmlFor="character-password" fontSize="sm">Character password</Text><Input id="character-password" isDisabled={busy} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required mb={3} /></>}
        {createError && <Text role="alert" mb={3} color="var(--tt-error, #b42318)" overflowWrap="anywhere">{createError}</Text>}
        <Button type="submit" isLoading={busy} isDisabled={!displayName.trim() || normalizeCharacterUsername(username) === null}>Create Character</Button>
      </Box>
      <Flex direction="column" gap={3}>
        {roster.characters.map(character => <CharacterRow key={character.user.id} character={character} busy={busy} run={run} />)}
        {!roster.characters.length && <Text color="var(--tt-muted)">No Characters yet.</Text>}
      </Flex>
      <Text mt={4} fontSize="sm">To use a private subspace, add the Character’s login ID through that subspace’s member controls. Selecting “Use for this session” changes the default identity across this browser session; the Post as menu can choose a different identity for a single composer.</Text>
    </>}
    {roster?.principal.isAdmin && <Box mt={6}>
      <Text fontWeight={600}>Administrator ownership lookup</Text>
      <Flex gap={2} mt={2} flexWrap="wrap"><Input aria-label="Character ID to inspect" value={inspectId} onChange={e => { inspectionGeneration.current++; setInspectId(e.target.value); setInspection(null); }} flex="1" minW="160px" /><Button onClick={async () => {
        const generation = ++inspectionGeneration.current;
        try { const result = await characterRequest(undefined, { inspect: inspectId }); if (generation === inspectionGeneration.current) setInspection(result); }
        catch (err) { lopu({ title: 'Lookup failed', description: err instanceof Error ? err.message : 'Try again', status: 'error' }); }
      }}>Look up owner</Button></Flex>
      {inspection && <Text mt={2} wordBreak="break-all">Owner ID: {inspection.ownerId}</Text>}
    </Box>}
  </Box>;
}
function CharacterRow({ character, busy, run }: { character: any; busy: boolean; run: (input: Record<string, unknown>) => Promise<unknown> }) {
  const [name, setName] = React.useState(character.user.displayName || '');
  return <Box border="1px solid var(--tt-border, #ececef)" borderRadius="12px" p={4} minW={0}>
    <Flex gap={2} flexWrap="wrap"><Input aria-label={`Display name for ${character.user.username}`} value={name} onChange={e => setName(e.target.value)} flex="1" minW="150px" /><Button isDisabled={busy || !name.trim()} onClick={() => run({ operation: 'rename', characterId: character.user.id, displayName: name })}>Save name</Button></Flex>
    <Text mt={2} fontSize="xs" wordBreak="break-all">Login ID: {character.user.username}</Text>
    <Text fontSize="xs" wordBreak="break-all">User ID: {character.user.id}</Text>
    <Text my={2} fontSize="sm">{character.disabled ? 'Disabled' : character.loginMode === 'switch' ? 'Switch only' : character.loginMode === 'inherit' ? 'Uses your current password' : 'Separate password'}</Text>
    <Flex gap={2} flexWrap="wrap"><Button size="sm" isDisabled={busy || character.disabled} onClick={() => run({ operation: 'select', characterId: character.user.id })}>Use for this session</Button><Button size="sm" isDisabled={busy} onClick={() => run({ operation: character.disabled ? 'enable' : 'disable', characterId: character.user.id })}>{character.disabled ? 'Enable' : 'Disable and revoke sessions'}</Button></Flex>
  </Box>;
}
