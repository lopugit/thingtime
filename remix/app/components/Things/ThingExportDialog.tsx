import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Text } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { bundleFromPlan, downloadTransfer } from '~/utils/thingTransfer/browser';

export const ThingExportDialog = ({ ids, linkKey, onClose }: { ids: string[]; linkKey?: string; onClose: () => void }) => {
  const api = useApi();
  const lopu = useLopu();
  const [format, setFormat] = useState<'zip' | 'json'>('zip');
  const [children, setChildren] = useState(true);
  const [dependencies, setDependencies] = useState(true);
  const [files, setFiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const download = async () => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller; setBusy(true); setError('');
    try {
      const result = await api.v1.things.export({ ids, key: linkKey, includeChildren: children, includeDependencies: dependencies, includeFiles: format === 'zip' && files }, { signal: controller.signal });
      if (!result?.ok) throw new Error(result?.error || 'Export failed');
      const bundle = await bundleFromPlan(result.plan, { key: linkKey, signal: controller.signal });
      controller.signal.throwIfAborted();
      await downloadTransfer(bundle, format, 'thingtime', controller.signal);
      if (!controller.signal.aborted) { lopu({ title: 'Download ready', description: 'Import this file to create new private copies.', status: 'success' }); onClose(); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Export failed');
    } finally { if (!controller.signal.aborted) { setBusy(false); operation.current = null; } }
  };
  return <Modal isOpen onClose={onClose} size="lg" scrollBehavior="inside">
    <ModalOverlay />
    <ModalContent width="calc(100% - 48px)" marginX={0} maxHeight="calc(100dvh - 48px)">
      <ModalHeader>Download {ids.length === 1 ? 'Thing' : `${ids.length} Things`}</ModalHeader>
      <ModalCloseButton />
      <ModalBody><Flex direction="column" gap={4}>
        <Text fontSize="sm">Downloads contain portable content, not account credentials or sharing permissions. Importing creates new private copies.</Text>
        <Select aria-label="Download format" value={format} isDisabled={busy} onChange={(event) => setFormat(event.target.value as 'zip' | 'json')}>
          <option value="zip">ZIP — content and included files</option>
          <option value="json">JSON — content only, no attached files</option>
        </Select>
        <Checkbox isChecked={children} isDisabled={busy} onChange={(event) => setChildren(event.target.checked)}>Include folder contents</Checkbox>
        <Checkbox isChecked={dependencies} isDisabled={busy} onChange={(event) => setDependencies(event.target.checked)}>Include app components, actions and schemas</Checkbox>
        <Checkbox isChecked={format === 'zip' && files} isDisabled={busy || format === 'json'} onChange={(event) => setFiles(event.target.checked)}>Include attached files</Checkbox>
        {(!dependencies || format === 'json' || !files) && <Text fontSize="sm">Excluded dependencies or files may leave references to the original content. Choose ZIP with all options for a complete copy.</Text>}
        {busy && <Text role="status">Preparing authorized content and file bytes…</Text>}
        {error && <Text role="alert" color="red.500" overflowWrap="anywhere">{error}</Text>}
      </Flex></ModalBody>
      <ModalFooter gap={2}>
        <Button onClick={onClose} variant="ghost">{busy ? 'Cancel' : 'Close'}</Button>
        <Button onClick={() => { void download(); }} isDisabled={busy} colorScheme="pink">Download</Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
};
