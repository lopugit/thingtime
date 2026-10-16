import { RenameDialog } from '~/components/Things/ThingsDialogs';
import { ThingExportDialog } from '~/components/Things/ThingExportDialog';
import { openThingHistory } from '~/components/Timeline/TimelineHost';
import { thingRenameCrystal, isManagedLibraryThing, type ThingsThing } from '~/components/Things/thingsCore';
import { useSharedAccess, useSharedThingPath } from '~/components/Sharing/SharedMedia';
import React from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useWorkspaceUser } from '~/hooks/useWorkspaceUser';
import { useWorkspaceScope } from '~/hooks/useWorkspaceScope';
import { useLopu } from '~/components/Lopu/useLopu';
import { canOfferRecordingHandoff, sendRecordingThingToLopu, type RecordingThingIdentity } from '~/components/Lopu/recordingThingHandoff';
import type { ThingActionId } from '~/schemas/thingActions';
import type { ThingContextMenuAction } from './ThingContextMenu';
import type { ThingContextSection, ThingContextAction } from './contextMenuModel';
import { buildThingEntityMenu } from './thingEntityMenu';
import { ThingActionMenuButton } from './ThingActionMenuButton';
import { thingEntityLink } from './thingEntityLink';

type MenuThing = RecordingThingIdentity & { linkKey?: string };
export function PersistedThingMenu({ id, initialThing, label, extensions = [], capabilities = {}, onAction, onOpen, openHref, onChanged, onRenamed, handoffDisabled = false }: {
  id: string; initialThing?: MenuThing; label?: string; openHref?: string;
  extensions?: ThingContextSection[];
  capabilities?: Partial<Record<ThingActionId, boolean | Partial<ThingContextAction>>>;
  onAction?: (event: ThingContextMenuAction) => void;
  onOpen?: () => void; onChanged?: () => void; onRenamed?: (title: string) => void; handoffDisabled?: boolean;
}) {
  const api = useApi();
  const sharedAccess = useSharedAccess();
  const sharedPath = useSharedThingPath();
  const accountUser = useCurrentUser(), workspace = useWorkspaceUser();
  // Workspace identity chooses the local adapter; the resolved author below
  // still determines whether this Thing offers owner actions.
  const localIdentity = workspace?.localOnly || workspace?.offline;
  const user = localIdentity ? workspace : accountUser;
  const scope = useWorkspaceScope();
  const navigate = useNavigate();
  const lopu = useLopu();
  const identity = `${scope}:${user?.id || ''}:${id}`;
  const currentIdentity = React.useRef(identity);
  const owner = React.useRef(user?.id);
  currentIdentity.current = identity;
  owner.current = user?.id;
  React.useEffect(() => {
    currentIdentity.current = identity;
    return () => { currentIdentity.current = ''; };
  }, [identity]);
  const [resolved, setResolved] = React.useState<{ identity: string; thing: MenuThing } | null>(null);
  const busy = React.useRef(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [downloadContext, setDownloadContext] = React.useState<{ identity: string; linkKey?: string } | null>(null);
  const [sending, setSending] = React.useState(false);
  React.useEffect(() => { setRenameOpen(false); setDownloadContext(null); }, [identity, sharedAccess.key]);
  const fetched = resolved?.identity === identity ? resolved.thing : undefined;
  // Live card projections win over an earlier menu read (e.g. privacy changed).
  const thing = initialThing ? { ...fetched, ...initialThing } : fetched;
  const inspectHref = sharedPath(`/thing/${encodeURIComponent(id)}`);
  const href = openHref || inspectHref;
  // Only fetch the opened Thing. No per-card queries during list rendering.
  const resolve = async () => {
    onOpen?.();
    try {
      const result = await api.v1.things.get({ id, ...sharedAccess });
      const next = result?.thing || result?.things?.[0];
      if (currentIdentity.current === identity && next?.id === id) setResolved({ identity, thing: next });
    } catch { /* Keep last-known presentation; all writes reauthorize server-side. */ }
  };
  const send = async () => {
    if (!thing || !accountUser?.id || busy.current || handoffDisabled) return;
    busy.current = true;
    setSending(true);
    try {
      const sent = await sendRecordingThingToLopu(thing, accountUser.id, {
        origin: window.location.origin, activeOwner: () => currentIdentity.current === identity ? owner.current : undefined,
        confirm: message => window.confirm(message), fetch: window.fetch.bind(window)
      });
      if (currentIdentity.current !== identity) return;
      if (sent) { lopu({ title: 'Queued for Lopu', description: 'Follow progress in Recording activity.', status: 'success' }); onChanged?.(); }
    } catch (error) {
      if (currentIdentity.current === identity) lopu({ title: 'Could not send to Lopu', description: error instanceof Error ? error.message : 'Check Recording activity before retrying.', status: 'error' });
    } finally { busy.current = false; setSending(false); }
  };
  const model = id.startsWith('timeline-folder-') ? buildThingEntityMenu({ open: { href }, 'copy-link': true }) : buildThingEntityMenu({ history: !!accountUser?.id && thing?.author?.id === accountUser.id, rename: !!user?.id && !!thing && thing.author?.id === user.id, open: { href }, inspect: { href: inspectHref }, 'copy-link': true, download: true, ...capabilities,
    'send-to-lopu': !!thing && canOfferRecordingHandoff(thing, accountUser?.id) ? { disabled: sending || handoffDisabled } : false
  }, extensions);
  return <><ThingActionMenuButton identity={identity} label={label} model={model} onOpen={() => void resolve()}
    onAction={event => {
      switch (event.action.command) {
        case 'open': navigate(href); break;
        case 'inspect': navigate(inspectHref); break;
        case 'history': openThingHistory(id, thing?.thingtime); break;
        case 'download': setDownloadContext({ identity, linkKey: sharedAccess.key }); break;
        case 'copy-link': {
          const url = thingEntityLink(href, window.location.origin, thing, user?.id, sharedAccess.key);
          void navigator.clipboard.writeText(url.href).then(() => lopu({ title: 'Link copied',
            description: url.searchParams.has('key') ? 'Anyone holding this exact hidden link can view the Thing. Share it deliberately.' : undefined, status: 'success' }))
            .catch(() => lopu({ title: 'Could not copy link', status: 'error' }));
          break;
        }
        case 'send-to-lopu': void send(); break;
        case 'rename': setRenameOpen(true); break;
        default: onAction?.(event);
      }
    }} />
    {downloadContext?.identity === identity && downloadContext.linkKey === sharedAccess.key && <ThingExportDialog key={identity} ids={[id]} linkKey={downloadContext.linkKey} onClose={() => setDownloadContext(null)} />}
    <RenameDialog thing={renameOpen && thing ? thing as ThingsThing : null} onClose={() => setRenameOpen(false)} onRename={async (target, title) => {
      try {
        // The selected adapter owns capability negotiation. Local writes must
        // not wait on a remote manifest; remote methods still negotiate it.
        const response = isManagedLibraryThing(target)
          ? await api.v1.things.renameLibrary({ id, displayTitle: title, expectedUpdatedAt: target.updatedAt })
          : target.thingtime.includes('attachment')
          ? await api.v1.attachments.annotate({ id, title })
          : await api.v1.things.update({ id, crystal: thingRenameCrystal(target, title) });
        if (response?.ok === false) throw new Error(response.error || 'Rename failed.');
        if (currentIdentity.current !== identity) return false;
        setResolved({ identity, thing: { ...target, crystal: { ...target.crystal, ...thingRenameCrystal(target, title) } } });
        lopu({ title: 'Renamed', status: 'success' }); onRenamed?.(title); onChanged?.();
        if (!localIdentity) window.dispatchEvent(new Event('thingtime:root-data-refresh'));
        return true;
      } catch (error) {
        if (currentIdentity.current === identity) lopu({ title: 'Could not rename', description: error instanceof Error ? error.message : 'Please try again.', status: 'error' });
        return false;
      }
    }} />
  </>;
}
