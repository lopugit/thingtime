import React, { useEffect, useRef, useState } from 'react';
import { Button, Menu, MenuButton, MenuItem, MenuList, Portal, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { bundleFromPlan, writeTransferClipboard } from '~/utils/thingTransfer/browser';
import { transferChecksum } from '~/utils/thingTransfer/archive';
import { ThingExportDialog } from './ThingExportDialog';
import { ThingImportDialog } from './ThingImportDialog';
import { TRANSFER_MENU_Z } from './transferLayers';
import { transferIntent } from '~/utils/thingTransfer/intent';

type Props = { id?: string | null; linkKey?: string; disabledReason?: string; onImported?: () => void; canCut?: boolean; menuContainerRef?: React.RefObject<HTMLElement | null> };

/** Shared persisted-Thing entry point. Account, source or key changes tear down
 * every pending transfer before another context can receive its result. */
export const ThingTransferControls = (props: Props) => {
  const user = useCurrentUser();
  return <TransferControls key={`${user?.id || 'anonymous'}:${props.id || ''}:${props.linkKey || ''}`}
    {...props} ownerId={user?.id} />;
};

const TransferControls = ({ id, linkKey, disabledReason, ownerId, onImported, canCut, menuContainerRef }: Props & { ownerId?: string }) => {
  const api = useApi();
  const lopu = useLopu();
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const copy = (cut = false) => {
    if (!id || disabledReason || copying) return;
    if (cut && (!canCut || !ownerId)) return;
    const ticket = transferIntent.ticket(ownerId);
    const controller = new AbortController();
    operation.current?.abort(); operation.current = controller; setCopying(true);
    const bundle = api.v1.things.export({ ids: [id], key: linkKey }, { signal: controller.signal }).then(result => {
      if (!result?.ok) throw new Error(result?.error || 'Could not export this Thing');
      return bundleFromPlan(result.plan, { key: linkKey, signal: controller.signal });
    });
    // Invoke within the click, retaining activation while the bundle loads.
    void writeTransferClipboard(bundle, controller.signal).then(async text => {
      const digest = cut ? await transferChecksum(new TextEncoder().encode(text)) : '';
      if (controller.signal.aborted) return;
      if (cut) { if (!transferIntent.record(ticket, digest, [id])) return; }
      else transferIntent.clear();
      lopu({ title: cut ? 'Cut to clipboard' : 'Copied to clipboard', description: cut ? 'Paste in Things to move within this account.' : 'Paste in Things to import a private copy.', status: 'success' });
    }).catch(error => {
      if (!controller.signal.aborted) lopu({ title: 'Could not copy', description: error instanceof Error ? error.message : 'Try Download instead.', status: 'error' });
      controller.abort();
    }).finally(() => { if (operation.current === controller) { operation.current = null; setCopying(false); } });
  };
  return <>
    {/* The inspector is fixed: an absolute portal can scroll/move on focus
        between pointer-down and pointer-up, losing the menu item's click. */}
    <Menu isLazy strategy="fixed" placement="bottom-end">
      <MenuButton as={Button} size="xs" variant="outline" data-testid="thing-transfer-menu">{copying ? 'Copying…' : 'Transfer'}</MenuButton>
      <Portal containerRef={menuContainerRef}><MenuList zIndex={TRANSFER_MENU_Z} maxWidth="calc(100vw - 32px)" minWidth="min(240px, calc(100vw - 32px))">
        <MenuItem onClick={() => copy()} isDisabled={!id || !!disabledReason || copying}>Copy to clipboard</MenuItem>
        {canCut && ownerId && <MenuItem onClick={() => copy(true)} isDisabled={!id || !!disabledReason || copying}>Cut to clipboard</MenuItem>}
        <MenuItem onClick={() => setExportOpen(true)} isDisabled={!id || !!disabledReason}>Download…</MenuItem>
        {disabledReason && <Text fontSize="xs" px={3} py={2} whiteSpace="normal">{disabledReason}</Text>}
        {ownerId ? <MenuItem onClick={() => setImportOpen(true)}>Import into my Things…</MenuItem>
          : <MenuItem as={Link} to="/login">Sign in to import</MenuItem>}
      </MenuList></Portal>
    </Menu>
    {exportOpen && id && <ThingExportDialog ids={[id]} linkKey={linkKey} onClose={() => setExportOpen(false)} />}
    {importOpen && ownerId && <ThingImportDialog ownerId={ownerId} folderId={null} onClose={() => setImportOpen(false)}
      onImported={() => { onImported?.(); lopu({ title: 'Private copies imported', description: 'Themes and algorithms appear in their own libraries; other content appears in My Things.', status: 'success' }); }} />}
  </>;
};
