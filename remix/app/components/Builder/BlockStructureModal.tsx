import React from 'react';
import { Modal, ModalBody, ModalCloseButton, ModalContent, ModalOverlay } from '@chakra-ui/react';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '../Nav/Drawer/useDrawer';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from './TransientBlockHost';
import { WebpageBlocksRenderer } from './WebpageBlocksRenderer';
import { findBlock, type WebpageBlock } from './webpageBlocks';
import { blockStructureBlocks, blockStructureData, type BlockStructureScope } from './blockStructure';
import { BuilderOverlayHost } from './BuilderOverlayHost';

export function BlockStructureModal({ blocks, anchorId, initialScope, selectedId, pageId, onSelect, onClose }: {
 blocks: WebpageBlock[]; anchorId: string; initialScope: BlockStructureScope; selectedId: string | null;
 pageId: string; onSelect: (id: string) => void; onClose: () => void;
}) {
 const [scope, setScope] = React.useState(initialScope);
 const overlayHost = React.useRef<HTMLDivElement>(null);
 const structure = React.useMemo(() => blockStructureData(blocks, anchorId, scope, selectedId), [blocks, anchorId, scope, selectedId]);
 return <BuilderOverlayHost.Provider value={overlayHost}><Modal isOpen onClose={onClose} size="3xl" scrollBehavior="inside" isCentered>
  <ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
  <ModalContent ref={overlayHost} data-testid="block-structure-modal" aria-label="Block structure" containerProps={{ zIndex: DRAWER_MODAL_Z }}
   width="min(800px, calc(100vw - 24px))" maxW="calc(100vw - 24px)" maxH="calc(100dvh - 24px)" margin="12px">
   <ModalCloseButton aria-label="Close block structure" />
   <ModalBody padding={{ base: '20px 16px', md: '28px' }} paddingTop="48px" minW={0} sx={{
    '#block-structure-component button:focus-visible': { outline: '2px solid var(--tt-accent, #e84c9e)', outlineOffset: '3px' },
    '#block-structure-component button:hover': { boxShadow: '0 0 0 1px var(--tt-accent, #e84c9e)' },
    '#block-structure-component nav button[aria-pressed="true"]': { background: 'var(--tt-accent-tint, #fff5fa)', borderColor: 'var(--tt-accent, #e84c9e)' }
   }}>
    <SettingsDocumentHost documentKey="builder-block-structure" defaultDocument={blockStructureBlocks} scopeKey={pageId} title="Block structure layout">
     {({ blocks: layout, chrome, editing }) => <TransientBlockHost enabled={!editing} scopeKey={pageId} scope={{ structure }} actions={{
      scope: ({ inputs }) => { if (['page', 'parent', 'block'].includes(String(inputs.scope))) setScope(inputs.scope as BlockStructureScope); },
      select: ({ inputs }) => { const id = String(inputs.blockId || ''); if (findBlock(blocks, id)) onSelect(id); },
      close: onClose
     }}>
      <WebpageBlocksRenderer blocks={layout} componentsByRef={{}} chrome={chrome} />
     </TransientBlockHost>}
    </SettingsDocumentHost>
   </ModalBody>
  </ModalContent>
 </Modal></BuilderOverlayHost.Provider>;
}
