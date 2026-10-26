import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { useRouteLoaderData } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useCharacterScope } from '../Characters/CharacterScope';
import { useDataPlane } from '~/hooks/useDataPlane';
import { HtmlThingRenderer, type HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { ChakraThingRenderer, isChakraThingNode, type ChakraThingNode } from '../Kinds/ChakraThingRenderer';
import { NativeControlsEnabled, ComponentLocalControl, ComponentDisplayOnly } from '../Builder/NativeComponentControls';
import { ComponentUploadEnabled } from '../Builder/ComponentUpload';
import { ComponentDataScope } from '../Builder/ComponentSelect';
import { renderComponentDeclaration, referencedRenderComponent, renderComponentNode, renderComponentScope, renderComponentReadOptions } from './renderComponentCore';

export function ThingRenderComponent({ thing }: { thing: unknown }) {
  const api = useApi();
  const apiRef = React.useRef(api); apiRef.current = api;
  const actor = useCurrentUser();
  const character = useCharacterScope();
  const root = useRouteLoaderData('root') as { user?: { id?: string } } | undefined;
  const plane = useDataPlane();
  const declaration = renderComponentDeclaration(thing);
  const reference = declaration?.kind === 'reference' ? declaration.id : null;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const identity = JSON.stringify([origin, root?.user?.id, actor?.id, character?.id, plane, reference]);
  const [loaded, setLoaded] = React.useState<{ identity: string; component: Record<string, unknown> | null } | null>(null);
  React.useEffect(() => {
    if (!reference) return;
    let disposed = false;
    let generation = 0;
    let controller: AbortController | null = null;
    const refresh = async () => {
      const request = ++generation;
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await apiRef.current.v1.things.get({ id: reference }, renderComponentReadOptions({ actor: actor?.id, character: character?.id, plane, origin }, controller.signal));
        if (!disposed && request === generation) setLoaded({ identity, component: referencedRenderComponent(result?.thing, reference) });
      } catch {
        // A refused or failed refresh must not retain an old private renderer.
        if (!disposed && request === generation) setLoaded({ identity, component: null });
      }
    };
    void refresh();
    const focus = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; controller?.abort();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [identity, reference, plane, actor?.id, character?.id, origin]);
  const current = loaded?.identity === identity ? loaded : null;
  const component = declaration?.kind === 'embedded' ? declaration.component : current?.component;
  if (!component) return <Text role="status" fontSize="sm" color="var(--tt-muted)">{reference && !current ? 'Opening render Component…' : 'This render Component is unavailable or invalid. Open the data view to inspect this Thing.'}</Text>;
  const node = renderComponentNode(component, thing);
  // Both canonical Component renderers are inert by default. No source hooks,
  // action runtime or visitor authority is installed for a display template.
  return <ComponentDisplayOnly.Provider value={true}><ComponentUploadEnabled.Provider value={false}><ComponentDataScope.Provider value={renderComponentScope(component, thing)}><NativeControlsEnabled.Provider value={false}><ComponentLocalControl.Provider value={null}>
    <Box minW={0} maxW="100%" overflowWrap="anywhere" onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); event.stopPropagation(); }}>
      {isChakraThingNode(node) ? <ChakraThingRenderer node={node as ChakraThingNode} /> : <HtmlThingRenderer node={node as HtmlThingNode} />}
    </Box>
  </ComponentLocalControl.Provider></NativeControlsEnabled.Provider></ComponentDataScope.Provider></ComponentUploadEnabled.Provider></ComponentDisplayOnly.Provider>;
}
