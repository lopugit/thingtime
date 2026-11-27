import React from 'react';
import { useCharacterScope } from '../Characters/CharacterScope';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useDataPlane } from '../../hooks/useDataPlane';
import { ThingtimeApiError } from '../../hooks/apiFailure';
import { rootIdentity } from '../../utils/rootIdentity';
import type { ThingMetadata } from '../../utils/thingMetadata';
import { canKeepThingAfterReadFailure } from './thingDetailSectionsCore';
import { refreshThingMetadata } from './thingMetadataClient';
import { thingMetadataBlocks } from './thingMetadataBlocks';

type PanelProps = {
  id: string;
  /** Observe the currently rendered source revision, not the generated reference. */
  revision?: string;
  sourceVerified: boolean;
  sourceLoading?: boolean;
  linkKey?: string;
  archive?: boolean;
  unavailable?: string;
  storageHref?: string;
};

export function ThingMetadataPanel(props: PanelProps) {
  const user = useCurrentUser();
  const character = useCharacterScope();
  const plane = useDataPlane();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const scopeKey = JSON.stringify([origin, user?.id, character?.id, plane, identity.generation, props.id, props.linkKey]);
  if (identity.pending) return null;
  return <MetadataSession key={scopeKey} {...props} scopeKey={scopeKey} origin={origin} actor={user?.id}
    character={character?.id} plane={plane} generation={identity.generation} canEdit={!!user?.id && !user.temporary && !!plane} />;
}

function MetadataSession({
  id, revision, sourceVerified, sourceLoading = false, archive = false, linkKey = '', unavailable, storageHref, scopeKey, origin, actor, character, plane, generation, canEdit,
}: PanelProps & { scopeKey: string; origin: string; actor?: string; character?: string; plane: string | null; generation: number; canEdit: boolean }) {
  const [metadata, setMetadata] = React.useState<ThingMetadata | null>(null);
  const [busy, setBusy] = React.useState(!unavailable);
  const [hasFailed, setHasFailed] = React.useState(false);
  const [error, setError] = React.useState('');
  const active = React.useRef<AbortController | null>(null);
  const refresh = React.useCallback(async () => {
    if (unavailable || !origin || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    let measured = false;
    const assertCurrent = () => {
      const identity = rootIdentity.read();
      if (identity.pending || identity.generation !== generation || window.location.origin !== origin) {
        controller.abort();
        controller.signal.throwIfAborted();
      }
    };
    try {
      await refreshThingMetadata({ id, linkKey, origin, actor, character, plane }, {
        signal: controller.signal, canPersist: canEdit && sourceVerified, assertCurrent,
        onIdentityChange: () => { rootIdentity.changed(); window.dispatchEvent(new Event('thingtime:root-data-refresh')); },
        onMeasured: (next) => { measured = true; setMetadata(next); },
      });
    } catch (cause) {
      if (controller.signal.aborted || rootIdentity.read().generation !== generation) return;
      const status = cause instanceof ThingtimeApiError ? cause.status : null;
      const refused = status === 401 || status === 403 || status === 404 || status === 409 || status === 410;
      if (refused || (!measured && !canKeepThingAfterReadFailure(cause))) setMetadata(null);
      setHasFailed(true);
      setError(refused ? 'Metadata is unavailable with the current access.' : measured ?
        'Measured sizes are shown. The metadata reference could not be refreshed.' :
        'Could not refresh Thing metadata. Try again.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }, [unavailable, origin, generation, id, linkKey, actor, character, plane, canEdit, sourceVerified]);

  React.useLayoutEffect(() => {
    if (sourceLoading) return;
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      active.current?.abort();
      active.current = null;
    };
  }, [refresh, revision, sourceLoading]);

  const linkParams = new URLSearchParams();
  if (plane) linkParams.set('dataPlane', plane);
  if (linkKey) linkParams.set('key', linkKey);
  if (archive) linkParams.set('archiveSource', 'true');
  const metadataHref = metadata?.id
    ? `/thing/${encodeURIComponent(metadata.id)}${linkParams.size ? `?${linkParams}` : ''}`
    : '';
  const scope = {
    ...(metadata ?? {}), ready: metadata !== null, reserveSpace: metadata === null && busy, metadataHref, busy,
    error, storageHref, unavailable: unavailable ?? '', showActions: !unavailable && (metadata !== null || hasFailed || !!storageHref),
    canRefreshMetadata: metadata !== null || hasFailed,
    refreshLabel: error ? 'Retry' : 'Refresh metadata',
    referenceStatus: metadataHref ? 'Saved metadata reference available' : 'Live measurements',
  };

  return <SettingsDocumentHost documentKey="thing-metadata" defaultDocument={thingMetadataBlocks} scopeKey={scopeKey}
    title="Thing metadata layout" editLayoutLabel="Edit metadata layout" showLayoutControls={canEdit && !unavailable}>
    {({ blocks, chrome, editing }) => <TransientBlockHost enabled={!editing} scopeKey={scopeKey}
      scope={scope} actions={{ refresh }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
