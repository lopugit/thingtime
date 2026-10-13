import { PostInteractiveThing } from './PostInteractiveThing';
import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { ThingView } from '~/components/Thingtime/ThingView';
import type { PollRenderPollContext } from '~/components/Kinds';
import { thingDisplayName, thingLink } from '~/components/Things/thingsCore';
import { postThingDraft, postThingReferences } from './postThingReferences';
import type { PublicPost } from './feedTypes';

export function PostLinkedThings({ value, linkedThings, compact, poll }: { value: unknown; linkedThings?: PublicPost['linkedThings']; compact?: boolean; poll?: PollRenderPollContext }) {
  const references = postThingReferences(value);
  if (!references.length) return <ThingView thing={value} compact={compact} poll={poll} />;
  const byId = new Map((linkedThings || []).map(entry => [entry.id, entry]));
  const draft = postThingDraft(value);
  return <Flex direction="column" gap={3} minW={0}>
    {draft && <ThingView thing={draft} compact={compact} />}
    {references.map(reference => {
      const thing = byId.get(reference.id)?.thing;
      return <Box key={`${reference.id}:${reference.mode}`} border="1px solid var(--tt-border)" borderRadius="12px" p={3} minW={0} overflow="hidden">
        {thing ? <>
          <Flex gap={2} mb={2} align="center"><Text as={Link} to={thingLink(thing)} fontWeight={600} fontSize="sm" overflowWrap="anywhere">{thingDisplayName(thing)}</Text><Text ml="auto" flexShrink={0} fontSize="xs" color="var(--tt-muted)">{reference.mode === 'data' ? 'Data' : 'Interactive'}</Text></Flex>
          {reference.mode === 'data' ? <ThingView thing={thing.crystal} initialMode="data" compact={compact} /> : <PostInteractiveThing thing={thing} compact={compact} />}
        </> : <Text fontSize="sm" color="var(--tt-muted)">This attached Thing is unavailable or private.</Text>}
      </Box>;
    })}
  </Flex>;
}
