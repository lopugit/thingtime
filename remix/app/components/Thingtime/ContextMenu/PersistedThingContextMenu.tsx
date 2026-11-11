import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { ThingContextMenu, type ThingContextMenuProps } from './ThingContextMenu';

export { THING_ARCHIVE_CHANGED, type ThingArchiveChanged } from './thingArchiveEvents';

export type ThingMenuPresentation = Pick<ThingContextMenuProps, 'model' | 'busyLabel' | 'onAction'>;
export type PersistedThingControllerProps = ThingContextMenuProps & { onPresentation: (value: ThingMenuPresentation) => void };
// The local JSON editor stays independent of the authenticated API graph.
export type PersistedThingMenuLoader = () => Promise<{ default: React.ComponentType<PersistedThingControllerProps> }>;
export const PersistedThingMenuLoaderContext = React.createContext<PersistedThingMenuLoader | null>(null);
const KEEP_OPEN = ['archive', 'restore', 'retry-thing-actions', 'retry-thing-controller'];

class ControllerBoundary extends React.Component<{
  children: React.ReactNode; onError: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function PersistedThingContextMenu(props: ThingContextMenuProps) {
  const loader = React.useContext(PersistedThingMenuLoaderContext);
  return loader ? <HostedThingContextMenu {...props} loader={loader} /> : <ThingContextMenu {...props} />;
}

function HostedThingContextMenu({ loader, ...props }: ThingContextMenuProps & { loader: PersistedThingMenuLoader }) {
  const user = useCurrentUser();
  const plane = useDataPlane();
  const identity = JSON.stringify([user?.id, plane, props.model.subjectId]);
  const current = React.useRef(identity);
  current.current = identity;
  const supplied = props.model.sections.some(section => section.actions.some(action =>
    action.command === 'archive' || action.command === 'restore'));
  const needed = !!props.model.subjectId && !supplied && !!loader;
  const [activated, setActivated] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const [presentation, setPresentation] = React.useState<(ThingMenuPresentation & { identity: string }) | null>(null);
  const handler = React.useRef<{ identity: string; action: ThingContextMenuProps['onAction'] } | null>(null);
  const receive = React.useCallback((value: ThingMenuPresentation) => {
    if (current.current !== identity) return;
    handler.current = { identity, action: value.onAction };
    setPresentation(previous => previous?.identity === identity && previous.model === value.model &&
      previous.busyLabel === value.busyLabel ? previous : { ...value, identity });
  }, [identity]);
  React.useEffect(() => { setFailed(false); }, [identity]);
  React.useLayoutEffect(() => {
    if (!needed) { setPresentation(null); handler.current = null; }
  }, [needed]);
  React.useEffect(() => {
    if (props.open && needed) setActivated(true);
  }, [props.open, needed]);
  const Controller = React.useMemo(() => loader ? React.lazy(loader) : null, [loader, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolved = needed && !failed && presentation?.identity === identity ? presentation : null;
  const model = failed && needed ? { ...props.model, sections: [...props.model.sections,
    { id: 'controller-retry', actions: [{ id: 'retry-thing-controller', command: 'retry-thing-controller',
      label: 'Retry Thing actions', icon: '🔄', lucide: 'refresh-cw' }] }
  ] } : resolved?.model || props.model;
  // One presentation instance preserves focus, submenu stack, scroll and position
  // within one identity while the controller chunk and its permission read settle independently.
  return <>
    <ThingContextMenu key={identity} {...props} model={model}
      busyLabel={resolved?.busyLabel || (needed && !failed && !resolved && props.open ? 'Checking Thing actions' : undefined)}
      keepOpenCommands={needed ? KEEP_OPEN : props.keepOpenCommands}
      onAction={event => {
        if (needed && event.action.command === 'retry-thing-controller') {
          setFailed(false); setPresentation(null); setRetry(value => value + 1);
        } else if (resolved && handler.current?.identity === identity) handler.current.action?.(event);
        else props.onAction?.(event);
      }} />
    {needed && activated && Controller && <ControllerBoundary key={`${identity}:${retry}`} onError={() => { if (current.current === identity) { setPresentation(null); setFailed(true); } }}>
      <React.Suspense fallback={null}><Controller {...props} onPresentation={receive} /></React.Suspense>
    </ControllerBoundary>}
  </>;
}
