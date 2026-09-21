import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { ThingView } from '~/components/Thingtime/ThingView';
import { LiveTemplate, useComponentArgValues, useThingSource } from '~/components/Builder/liveComponent';
import { WebpageRuntimeProvider } from '~/components/Builder/webpageRuntime';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { useWebpageDraft } from '~/components/Builder/useWebpage';
import { useActionRunConfirm } from '~/components/Actions/ActionRunConfirm';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import type { ThingsThing } from '~/components/Things/thingsCore';

function LinkedComponent({ thing }: { thing: ThingsThing }) {
  const { argValues } = useComponentArgValues(thing.crystal, null);
  // An attached reference never smuggles a source action that runs on mount.
  const { scope } = useThingSource({ source: null, cacheId: thing.id, argValues, interactive: true });
  const { confirm, dialog } = useActionRunConfirm({ enabled: true });
  return <>{thing.crystal.render ? <LiveTemplate render={thing.crystal.render} scope={{ ...argValues, ...scope }} interactive confirm={confirm} /> : <ThingView thing={thing.crystal} />}{dialog}</>;
}
function LinkedPage({ thing }: { thing: ThingsThing }) {
  const target = React.useMemo(() => ({ kind: 'id' as const, id: thing.id }), [thing.id]);
  const page = useWebpageDraft(target);
  return page.resolved ? <WebpageBlocksRenderer blocks={page.blocks} componentsByRef={page.componentsByRef} interactive /> : <Text fontSize="sm" color="var(--tt-muted)">{page.loading ? 'Opening page…' : 'Open this page to view its content.'}</Text>;
}
export function PostInteractiveThing({ thing, compact }: { thing: ThingsThing; compact?: boolean }) {
  const user = useCurrentUser();
  const owner = !!user?.id && thing.author?.id === user.id;
  const component = thing.thingtime.includes('component');
  const webpage = thing.thingtime.includes('webpage');
  if (!component && !webpage) return <ThingView thing={thing.crystal.thing || thing.crystal} compact={compact} />;
  // Reuse the canonical runtime: visitors execute only the shared read-only
  // composition, and owner mutations still go through the action confirmation.
  return <WebpageRuntimeProvider key={`${user?.id || 'anonymous'}:${thing.id}`} pageId={thing.id} pageKey={typeof thing.crystal.pageKey === 'string' ? thing.crystal.pageKey : null} suiteKey={null} source={owner ? 'user' : 'system'} shared={!owner}>
    <Box minW={0}>{component ? <LinkedComponent thing={thing} /> : <LinkedPage thing={thing} />}</Box>
  </WebpageRuntimeProvider>;
}
