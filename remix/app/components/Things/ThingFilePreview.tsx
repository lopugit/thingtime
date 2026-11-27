import { rootIdentity } from '~/utils/rootIdentity';
import React from 'react';
import { Box, Button, Spinner, Text } from '@chakra-ui/react';
import { useRouteLoaderData } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCharacterScope } from '../Characters/CharacterScope';
import { ThingRenderComponent } from '../Thingtime/ThingRenderComponent';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { renderComponentReadOptions } from '../Thingtime/renderComponentCore';
import { fileMediaAttachment, fileMediaPresentation, fileMediaReference, type MediaThing } from './fileMediaPresentation';
import type { PublicAttachment } from '../Attachments/attachmentTypes';
import { useSharedAccess, SharedMediaProvider } from '../Sharing/SharedMedia';

export function ThingFilePreview({ thing, thumbnail = false, fallback = null }: { thing: MediaThing; thumbnail?: boolean; fallback?: React.ReactNode }) {
  const api = useApi(), apiRef = React.useRef(api); apiRef.current = api;
  const actor = useCurrentUser(), character = useCharacterScope(), plane = useDataPlane();
  const root = useRouteLoaderData('root') as { user?: { id?: string } } | undefined;
  const access = useSharedAccess(), ref = fileMediaReference(thing);
  const generation = React.useSyncExternalStore(rootIdentity.subscribe, () => rootIdentity.read().generation, () => 0);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const identity = JSON.stringify([origin, generation, root?.user?.id, actor?.id, character?.id, plane, thing.id, ref, access]);
  const [state, setState] = React.useState<{ identity: string; attachment: PublicAttachment | null; error: boolean }>();
  const [retry, setRetry] = React.useState(0), [visible, setVisible] = React.useState(!thumbnail);
  const host = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (visible || !host.current) return;
    if (!globalThis.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [visible]);
  const requestRef = React.useRef({ ref, thing, access, actorId: actor?.id, characterId: character?.id, plane, origin });
  requestRef.current = { ref, thing, access, actorId: actor?.id, characterId: character?.id, plane, origin };
  React.useEffect(() => {
    const { ref, thing, access, actorId, characterId, plane, origin } = requestRef.current;
    if (!ref || !visible || thing.executionHeld) return;
    let disposed = false;
    const controller = new AbortController();
    void requireThingtimeCapability('api.things', '1.42.0').then(() => apiRef.current.v1.things.get({ id: ref.attachmentId, ...(access.key ? { key: access.key } : {}), ...(access.sharedRoot ? { sharedRoot: access.sharedRoot } : {}) }, renderComponentReadOptions({ actor: actorId, character: characterId, plane, origin }, controller.signal)))
      .then((result: any) => { if (!disposed) { const attachment = fileMediaAttachment(thing, result?.thing); setState({ identity, attachment, error: !attachment }); } })
      .catch(() => { if (!disposed) setState({ identity, attachment: null, error: true }); });
    return () => { disposed = true; controller.abort(); };
  }, [identity, retry, visible, thing.executionHeld]);
  const current = state?.identity === identity ? state : null;
  if (!ref || thing.executionHeld) return <>{fallback}</>;
  const attachment = current?.attachment;
  const thumbnailMedia = attachment && (attachment.mediaKind === 'image' || attachment.mediaKind === 'video');
  return <Box ref={host} minW={0} width="100%" minH={thumbnail ? '34px' : '80px'} pointerEvents={thumbnail ? "none" : undefined} data-file-media={thing.id}>
    {attachment && (!thumbnail || thumbnailMedia) ? <SharedMediaProvider><ThingRenderComponent key={identity} thing={fileMediaPresentation(attachment, thumbnail, ref.version)} /></SharedMediaProvider>
      : current?.error ? thumbnail ? fallback : <Text role="alert" fontSize="sm">This file preview is unavailable. <Button size="sm" variant="link" onClick={() => setRetry(n => n + 1)}>Retry preview</Button></Text>
      : current ? fallback : <>{fallback}{!thumbnail ? <Spinner size="xs" label="Opening file preview" ml={2} /> : null}</>}
  </Box>;
}
