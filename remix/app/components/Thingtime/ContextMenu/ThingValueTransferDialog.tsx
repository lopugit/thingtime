import React from 'react';
import { Button, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Text } from '@chakra-ui/react';
import { TRANSFER_DIALOG_Z } from '~/components/Things/transferLayers';
import { downloadTransfer } from '~/utils/thingTransfer/browser';
import { bundleFromValue, readValueTransferFile } from '~/utils/thingTransfer/value';
import type { JsonValue } from '~/utils/thingTransfer/format';

export const ThingValueTransferDialog = ({ mode, value, name, onClose, onApply }: {
  mode: 'download' | 'import'; value: unknown; name: string;
  onClose: () => void; onApply: (value: JsonValue) => void;
}) => {
  const [format, setFormat] = React.useState<'json' | 'zip'>('json');
  const [selected, setSelected] = React.useState<{ value: JsonValue } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const operation = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => operation.current?.abort(), []);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError('');
    try { await action(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Transfer failed'); }
    finally { if (!controller.signal.aborted) { setBusy(false); operation.current = null; } }
  };
  return <Modal isOpen onClose={onClose} size="lg" scrollBehavior="inside">
    <ModalOverlay zIndex={TRANSFER_DIALOG_Z - 1} />
    <ModalContent containerProps={{ zIndex: TRANSFER_DIALOG_Z }} width="calc(100% - 48px)" marginX={0} maxHeight="calc(100dvh - 48px)">
      <ModalHeader>{mode === 'download' ? 'Download value' : 'Import value'}</ModalHeader><ModalCloseButton />
      <ModalBody>
        <Text fontSize="sm" mb={3} overflowWrap="anywhere">{name}</Text>
        {mode === 'download' ? <>
          <Text fontSize="sm" mb={3}>Includes this value and all nested content. Import it back here, or into My Things as a new private data Thing. Linked URLs remain links; this is not an app/file archive.</Text>
          <Select aria-label="Value download format" value={format} onChange={event => setFormat(event.target.value as 'json' | 'zip')} isDisabled={busy}>
            <option value="json">JSON — portable value</option><option value="zip">ZIP — portable value archive</option>
          </Select>
        </> : <>
          <Text fontSize="sm" mb={3}>Choose JSON or an exported value ZIP. Review it before replacing this value. Use Import in My Things for saved apps, folders or attached files.</Text>
          <Input type="file" aria-label="Thingtime value file" accept=".json,.zip,application/json,application/zip" padding={1} height="auto" onChange={event => {
            const file = event.target.files?.[0]; if (!file) return;
            setSelected(null);
            void run(async signal => { const next = await readValueTransferFile(file, signal); signal.throwIfAborted(); setSelected({ value: next }); });
          }} />
          {selected && <Text as="pre" fontSize="xs" whiteSpace="pre-wrap" overflowWrap="anywhere" mt={3} maxHeight="200px" overflowY="auto">{JSON.stringify(selected.value, null, 2).slice(0,4000)}</Text>}
        </>}
        {error && <Text role="alert" mt={3} color="red.500">{error}</Text>}
      </ModalBody>
      <ModalFooter gap={2} flexWrap="wrap">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button isLoading={busy} isDisabled={mode === 'import' && !selected} onClick={() => {
          if (mode === 'download') void run(async signal => { await downloadTransfer(bundleFromValue(value, name), format, name, signal); signal.throwIfAborted(); onClose(); });
          else if (selected) { try { onApply(selected.value); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not replace value'); } }
        }}>{mode === 'download' ? 'Download' : 'Replace this value'}</Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
};
