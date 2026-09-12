import React, { useEffect, useRef, useState } from 'react';
import { TRANSFER_DIALOG_Z } from './transferLayers';
import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Text, Textarea } from '@chakra-ui/react';
import { useAttachmentUploads } from '~/components/Attachments/useAttachmentUploads';
import { useApi } from '~/hooks/useApi';
import { readTransferFiles, MAX_TRANSFER_BATCH } from '~/utils/thingTransfer/readFile';
import { readTransferClipboard, MAX_CLIPBOARD_BYTES } from '~/utils/thingTransfer/browser';
import { TRANSFER_LIMITS } from '~/utils/thingTransfer/format';
import type { TransferBundle } from '~/utils/thingTransfer/archive';
import { isTransferRecording, recordingTransferFile } from '~/utils/thingTransfer/recording';
import { isTransferEmoji, emojiTransferFile } from '~/utils/thingTransfer/emoji';

/** Mount only while open, keyed by account. Unmount cancels parsing/import
 * and delegates uncommitted file cleanup to the normal upload workflow. */
type ImportDialogProps = {
  ownerId: string;
  initialBundle?: TransferBundle | null;
  folderId: string | null;
  onClose: () => void;
  onImported: (destination: string | null) => void;
};

export const ThingImportDialog = (props: ImportDialogProps) => {
  const [queue, setQueue] = useState<TransferBundle[]>(props.initialBundle ? [props.initialBundle] : []);
  const [generation, setGeneration] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [running, setRunning] = useState(false);
  const [destination, setDestination] = useState(props.folderId);
  return <ThingImportStep {...props} key={generation} folderId={destination}
    initialBundle={queue[0]} batch={queue} completed={completed} running={running}
    onSelect={(bundles) => { setQueue(bundles); setCompleted(0); setGeneration(value => value + 1); }}
    onBegin={() => setRunning(true)}
    onFinished={(target) => {
      props.onImported(target);
      if (queue.length <= 1) { props.onClose(); return; }
      setDestination(target); setCompleted(value => value + 1);
      setQueue(value => value.slice(1)); setGeneration(value => value + 1);
    }} />;
};

const ThingImportStep = ({ ownerId, folderId, initialBundle, onClose, batch, completed, running, onSelect, onBegin, onFinished }: ImportDialogProps & {
  batch: TransferBundle[]; completed: number; running: boolean;
  onSelect: (bundles: TransferBundle[]) => void;
  onBegin: () => void;
  onFinished: (destination: string | null) => void;
}) => {
  const api = useApi();
  const [bundle, setBundle] = useState<TransferBundle | null>(initialBundle || null);
  const [destination, setDestination] = useState<string | null>(folderId);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [uploadStarted, setUploadStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [clipboardText, setClipboardText] = useState('');
  const [dragging, setDragging] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const selection = useRef<AbortController | null>(null);
  const submission = useRef(false);
  const uploadDispatch = useRef(false);
  const fileIds = useRef(new Map<File, string>());
  const uploads = useAttachmentUploads(ownerId, setError, setError, false, undefined,
    { maxFiles: TRANSFER_LIMITS.files, purpose: 'post', selectionScope: 'transfer', purposeForFile: file => {
      const entry = bundle?.manifest.files.find(entry => entry.id === fileIds.current.get(file));
      if (bundle?.manifest.things.some(thing => thing.id === entry?.targetId && isTransferEmoji(thing))) return 'custom-emoji';
      return bundle?.manifest.things.some(thing => thing.id === entry?.targetId && isTransferRecording(thing)) ? 'recording-import' : 'post';
    } });
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => { controller.abort(); selection.current?.abort(); };
  }, []);

  const selectContent = async (read: (signal: AbortSignal) => Promise<TransferBundle[]>) => {
    if (running || uploadStarted || submission.current) return;
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setReading(true); setBundle(null); setError('');
    try {
      const next = await read(controller.signal);
      if (!controller.signal.aborted) onSelect(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read this transfer');
    } finally { if (!controller.signal.aborted) setReading(false); }
  };
  const selectFiles = (files: File[]) => { if (files.length) void selectContent(signal => readTransferFiles(files, signal)); };
  const pasteText = (text: string) => { void selectContent(async signal => [await readTransferClipboard(text, signal)]); };
  const pasteClipboard = () => {
    void selectContent(async signal => {
      let text: string;
      try { text = await navigator.clipboard.readText(); }
      catch { throw new Error('Clipboard access is unavailable. Press ⌘V / Ctrl+V here, or paste into the text box below.'); }
      return [await readTransferClipboard(text, signal)];
    });
  };
  const beginUploads = () => {
    if (!bundle || uploadDispatch.current) return;
    try {
      for (const thing of bundle.manifest.things.filter(isTransferRecording)) recordingTransferFile(thing, bundle.manifest);
      for (const thing of bundle.manifest.things.filter(isTransferEmoji)) emojiTransferFile(thing, bundle.manifest);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid recording transfer'); return; }
    uploadDispatch.current = true; setUploadStarted(true);
    const files = bundle.manifest.files.map((entry, index) => {
      // Distinct timestamps prevent the normal picker dedupe from dropping
      // two distinct archive entries with equal names and byte lengths.
      const file = new File([Uint8Array.from(bundle.files.get(entry.id)!)], entry.name, { type: entry.mime, lastModified: index + 1 });
      fileIds.current.set(file, entry.id);
      return file;
    });
    uploads.addFiles(files);
  };
  const filesReady = !!bundle && uploads.uploads.length === bundle.manifest.files.length &&
    uploads.uploads.every((upload) => upload.status === 'ready' && upload.attachment);
  const hasThemes = !!bundle?.manifest.things.some(thing => thing.thingtime.includes('theme') || thing.thingtime.includes('feed-algorithm'));
  const hasRecordings = !!bundle?.manifest.things.some(isTransferRecording);
  const submit = async () => {
    if (!bundle || !filesReady || submission.current || lifetime.current?.signal.aborted) return;
    submission.current = true; setAttempted(true); setSubmitting(true); setError('');
    const controller = lifetime.current!;
    try {
      const files = Object.fromEntries(uploads.uploads.map((upload) => [fileIds.current.get(upload.file)!, upload.attachment!.id]));
      // A lost response may hide a successful recording commit. From dispatch
      // onward, do not let dialog unmount delete those potentially durable
      // copies. Server compensation and normal draft expiry own cleanup.
      uploads.markCommitted(Object.values(files));
      const result = await api.v1.things.import({ manifest: bundle.manifest, files, folderId: destination }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result?.ok !== true) throw new Error(result?.error || 'Import did not confirm success');
      onFinished(destination);
    } catch (cause) {
      if (!controller.signal.aborted) setError(`${cause instanceof Error ? cause.message : 'Import failed'}. Check your Things before trying again; if the response was lost, copies may already exist.`);
    } finally { if (!controller.signal.aborted) setSubmitting(false); }
  };

  // One explicit confirmation starts a serial batch. Each mounted step owns
  // its uploads and one dispatch; a failure stops here, never replays prior work.
  useEffect(() => {
    if (!running || !bundle || error || attempted) return;
    // StrictMode replays mount effects: never dispatch a write from the
    // discarded mount and then abort it with an ambiguous server outcome.
    const timer = setTimeout(() => {
      if (bundle.manifest.files.length && !uploadStarted) beginUploads();
      else if (filesReady) void submit();
    }, 0);
    return () => clearTimeout(timer);
  });

  return <Modal isOpen onClose={onClose} size="lg" scrollBehavior="inside" closeOnOverlayClick={!submitting} closeOnEsc={!submitting}>
    <ModalOverlay zIndex={TRANSFER_DIALOG_Z - 1} />
    <ModalContent containerProps={{ zIndex: TRANSFER_DIALOG_Z }} width="calc(100% - 48px)" marginX={0} marginY={6} maxHeight={{ base: 'calc(100dvh - 120px)', md: 'calc(100dvh - 48px)' }}
      onPaste={(event) => {
        if (running || attempted) return;
        const files = Array.from(event.clipboardData.files);
        const text = event.clipboardData.getData('text/plain');
        if (!files.length && !text) return;
        event.preventDefault(); event.stopPropagation();
        if (files.length) selectFiles(files); else pasteText(text);
      }}>
      <ModalHeader>Import Things</ModalHeader>
      {!submitting && <ModalCloseButton />}
      <ModalBody>
        <Flex direction="column" gap={4}>
          <Text fontSize="sm">Paste copied Things, or choose or drop up to {MAX_TRANSFER_BATCH} Thingtime JSON / complete ZIP files. Imports create private copies; originals and sharing settings stay unchanged.</Text>
          {!running && !uploadStarted && !attempted && <Box as="details" open={bundle ? undefined : true}>
            <Box as="summary" cursor="pointer" fontSize="sm">{bundle ? 'Choose different files or paste content' : 'Paste or select transfer files'}</Box>
            <Box mt={2} borderWidth="1px" borderStyle="dashed" borderRadius="md" padding={4} background={dragging ? 'blackAlpha.100' : undefined}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); selectFiles(Array.from(event.dataTransfer.files)); }}>
            <Text fontSize="sm" mb={2}>Drop transfer files here, or paste with ⌘V / Ctrl+V.</Text>
            <Input aria-label="Thingtime transfer files" type="file" multiple accept=".json,.zip,application/json,application/zip" padding={1} onChange={(event) => { selectFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
            <Button mt={3} onClick={pasteClipboard}>Paste from clipboard</Button>
            {!bundle && <>
              <Textarea mt={3} aria-label="Copied Thingtime content" placeholder="Or paste copied Thingtime content here" value={clipboardText} maxLength={MAX_CLIPBOARD_BYTES} onChange={event => setClipboardText(event.target.value)} />
              <Button mt={2} isDisabled={!clipboardText.trim()} onClick={() => pasteText(clipboardText)}>Read pasted content</Button>
            </>}
          </Box></Box>}
          {!!batch.length && <Box role="status">
            <Text>{completed ? `${completed} imported · ` : ''}{batch.length} transfer{batch.length === 1 ? '' : 's'} {running ? 'remaining' : 'ready to import'}</Text>
            <Text fontSize="sm">{batch.reduce((total, item) => total + item.manifest.things.length, 0)} Things in this batch. Files import in order; a failure stops the batch without retrying completed imports.</Text>
          </Box>}
          {reading && <Text role="status">Checking transfer contents…</Text>}
          {bundle && <>
            <Text>{bundle.manifest.things.length} Things · {bundle.manifest.files.length} files · {bundle.manifest.links?.length || 0} links · {(bundle.manifest.files.reduce((total, file) => total + file.bytes, 0) / 1024 / 1024).toFixed(1)} MiB</Text>
            {!!bundle.manifest.links?.length && <Text fontSize="sm">Linked media stays on its original site. Import creates private gallery records; it does not download those external files.</Text>}
            {hasThemes && <Text fontSize="sm">Themes and algorithms retain included folders and also appear in their own libraries, without changing active selections. Algorithm files can contain private interest weights; share them only deliberately.</Text>}
            {bundle.manifest.things.some(isTransferEmoji) && <Text fontSize="sm">Custom emojis become personal-library copies with new names. Included folders are retained; community membership and existing emojis are never changed.</Text>}
            <Box>
              <Text as="label" htmlFor="thing-import-destination" fontSize="sm">Import destination</Text>
              <Select id="thing-import-destination" value={destination || ''} isDisabled={attempted || running} onChange={(event) => setDestination(event.target.value || null)}>
                <option value="">My Things (top level)</option>
                {folderId && <option value={folderId}>Current folder</option>}
              </Select>
            </Box>
            {hasRecordings && <Text fontSize="sm">Recordings stay private and retain included folders. Other recordings use the import destination.</Text>}
            <Text fontSize="sm">Apps may contain actions. Importing does not run them. Only use content from sources you trust.</Text>
            {bundle.manifest.files.length > 0 && !uploadStarted && <Button onClick={beginUploads}>Upload {bundle.manifest.files.length} files</Button>}
            {uploads.uploads.length > 0 && <Box maxHeight="180px" overflowY="auto" aria-label="Import file uploads">
              {uploads.uploads.map((upload) => <Flex key={upload.localId} align="center" gap={2} py={1}>
                <Text flex={1} minWidth={0} overflowWrap="anywhere" fontSize="sm">{upload.file.name}: {upload.error || `${upload.status} ${Math.round(upload.progress)}%`}</Text>
                {upload.status === 'error' && !attempted && <Button size="xs" onClick={() => { setError(''); uploads.retry(upload.localId); }}>Retry upload</Button>}
              </Flex>)}
            </Box>}
          </>}
          {error && <Text role="alert" color="red.500" overflowWrap="anywhere">{error}</Text>}
        </Flex>
      </ModalBody>
      <ModalFooter gap={2} flexWrap="wrap">
        <Button variant="ghost" onClick={onClose} isDisabled={submitting}>Close</Button>
        <Button colorScheme="pink" onClick={onBegin} isDisabled={!bundle || attempted || reading || running} isLoading={submitting}>{batch.length > 1 ? `Import all ${batch.length} transfers` : 'Import private copies'}</Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
};
