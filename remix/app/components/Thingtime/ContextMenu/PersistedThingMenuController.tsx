import React from 'react';
import { rootIdentity } from '~/utils/rootIdentity';
import { useApi } from '~/hooks/useApi';
import { ThingtimeApiError } from '~/hooks/apiFailure';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useLopu } from '~/components/Lopu/useLopu';
import type { PersistedThingControllerProps } from './PersistedThingContextMenu';
import { thingArchiveMenu } from './thingEntityMenu';

import { THING_ARCHIVE_CHANGED, type ThingArchiveChanged } from './thingArchiveEvents';

type Availability = {
  id: string;
  availableActions: string[];
  libraryArchived: boolean;
};

// The renderer stays presentation-only. Every persisted menu resolves the same
// small server permission contract on open, including protected content roots.
export default function PersistedThingMenuController(props: PersistedThingControllerProps) {
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  const identity = JSON.stringify([user?.id, dataPlane, props.model.subjectId]);
  return <ScopedPersistedThingContextMenu key={identity} {...props} />;
}

function ScopedPersistedThingContextMenu(props: PersistedThingControllerProps) {
  const api = useApi();
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  const lopu = useLopu();
  const id = props.model.subjectId;
  const suppliedArchive = props.model.sections.some(section =>
    section.actions.some(action => action.command === 'archive' || action.command === 'restore'));
  const scope = user?.id && !user.temporary && dataPlane === 'home'
    ? { expectedActor: user.id, expectedApiOrigin: window.location.origin, expectedDataPlane: 'home' as const }
    : null;
  const identity = JSON.stringify([scope?.expectedActor, scope?.expectedApiOrigin, dataPlane, id]);
  const visit = React.useRef({ identity, open: false, version: 0 });
  if (visit.current.identity !== identity || (props.open && !visit.current.open))
    visit.current = { identity, open: props.open, version: visit.current.version + 1 };
  else visit.current.open = props.open;
  const version = visit.current.version;
  const current = React.useRef(identity);
  current.current = identity;
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const [availability, setAvailability] = React.useState<{ identity: string; version: number; value: Availability } | null>(null);
  const [loading, setLoading] = React.useState(!!props.open && !!id && !!scope && !suppliedArchive);
  const [writing, setWriting] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const writingRef = React.useRef(false);
  React.useEffect(() => {
    if (!props.open || !id || !scope || suppliedArchive) return;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void apiRef.current.v1.things.describeActions({ id }, { ...scope, signal: controller.signal }).then(result => {
      if (controller.signal.aborted || current.current !== identity) return;
      if (!result?.ok || result.id !== id || result.ownerId !== scope.expectedActor ||
          !Array.isArray(result.availableActions)) throw new Error('Action permissions are unavailable.');
      setAvailability({ identity, version, value: result });
    }).catch(error => {
      if (!controller.signal.aborted && current.current === identity) {
        setAvailability(null);
        // Permission and existence refusals are a settled unavailable state.
        setFailed(!(error instanceof ThingtimeApiError && [401, 403, 404, 409].includes(error.status || 0)));
      }
    }).finally(() => {
      if (!controller.signal.aborted && current.current === identity) setLoading(false);
    });
    return () => controller.abort();
  }, [props.open, id, identity, version, suppliedArchive, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => { current.current = ''; }, []);
  const resolved = availability?.identity === identity && availability.version === version && !failed ? availability.value : null;
  const command = resolved?.availableActions.includes('restore') ? 'restore'
    : resolved?.availableActions.includes('archive') ? 'archive' : null;
  const model = React.useMemo(() => !suppliedArchive && command
    ? thingArchiveMenu(props.model, command, writing || loading)
    : props.model, [suppliedArchive, command, props.model, writing, loading]);
  const retryModel = React.useMemo(() => failed ? {
    ...model,
    sections: [...model.sections, { id: 'action-retry', actions: [{
      id: 'retry-thing-actions', command: 'retry-thing-actions', label: 'Retry action availability',
      icon: '🔄', lucide: 'refresh-cw'
    }] }]
  } : model, [failed, model]);
  const run = async (action: 'archive' | 'restore') => {
    if (!id || !scope || writingRef.current || resolved?.availableActions.includes(action) !== true) return;
    const generation = rootIdentity.read().generation;
    if (rootIdentity.read().pending) return;
    writingRef.current = true;
    setWriting(true);
    try {
      const result = await apiRef.current.v1.things.runAction({ id, action }, scope);
      if (!result?.ok || result.id !== id || result.ownerId !== scope.expectedActor ||
          result.libraryArchived !== (action === 'archive')) throw new Error(result?.error || 'The action could not be confirmed.');
      const activeIdentity = rootIdentity.read();
      if (activeIdentity.pending || activeIdentity.generation !== generation ||
          window.location.origin !== scope.expectedApiOrigin) return;
      const detail: ThingArchiveChanged = { origin: scope.expectedApiOrigin, ownerId: scope.expectedActor,
        dataPlane: 'home', ids: [id], archived: result.libraryArchived };
      window.dispatchEvent(new CustomEvent(THING_ARCHIVE_CHANGED, { detail }));
      if (current.current !== identity) return;
      if (visit.current.version !== version) { setRetry(value => value + 1); return; }
      setAvailability({ identity, version, value: { id, libraryArchived: result.libraryArchived,
        availableActions: [action === 'archive' ? 'restore' : 'archive'] } });
      lopu({ title: action === 'archive' ? 'Archived in your Things library' : 'Restored to your Things library',
        description: action === 'archive' ? 'Published content keeps its current audience.' : undefined,
        status: 'success', link: { label: action === 'archive' ? 'Archived Things' : 'Active Things',
          href: action === 'archive' ? '/things?libraryArchive=1' : '/things' } });
      props.onClose?.();
    } catch (error) {
      if (current.current === identity && visit.current.version === version) lopu({ title: action === 'archive' ? 'Could not archive' : 'Could not restore',
        description: error instanceof Error ? error.message : 'Refresh the menu and retry.', status: 'error' });
    } finally {
      writingRef.current = false;
      if (current.current === identity) setWriting(false);
    }
  };
  React.useLayoutEffect(() => {
    props.onPresentation({ model: retryModel,
      busyLabel: id && scope && !suppliedArchive && loading ? 'Checking Thing actions' : writing ? 'Updating Thing archive' : undefined,
      onAction: event => {
        if (event.action.command === 'retry-thing-actions') { setRetry(value => value + 1); return; }
        if (!suppliedArchive && (event.action.command === 'archive' || event.action.command === 'restore')) {
          void run(event.action.command);
        } else props.onAction?.(event);
      }
    });
  });
  return null;
}
