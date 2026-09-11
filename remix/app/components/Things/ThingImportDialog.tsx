import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Text } from '@chakra-ui/react';
import { useAttachmentUploads } from '~/components/Attachments/useAttachmentUploads';
import { useApi } from '~/hooks/useApi';
import { readTransferFile } from '~/utils/thingTransfer/readFile';
import { TRANSFER_LIMITS } from '~/utils/thingTransfer/format';
import type { TransferBundle } from '~/utils/thingTransfer/archive';

/** Mount only while open, keyed by account. Unmount cancels parsing/import
 * and delegates uncommitted file cleanup to the normal upload workflow. */
export const ThingImportDialog = ({ ownerId, folderId, initialBundle, onClose, onImported }: {
  ownerId: string;
  initialBundle?: TransferBundle | null;
  folderId: string | null;
  onClose: () => void;
  onImported: (destination: string | null) => void;
}) => {
  const api = useApi();
  const [bundle, setBundle] = useState<TransferBundle | null>(initialBundle || null);
  const [destination, setDestination] = useState<string | null>(folderId);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [uploadStarted, setUploadStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const selection = useRef<AbortController | null>(null);
  const submission = useRef(false);
  const fileIds = useRef(new Map<File, string>());
  const uploads = useAttachmentUploads(ownerId, setError, setError, false, undefined,
    { maxFiles: TRANSFER_LIMITS.files, purpose: 'post', selectionScope: 'transfer' });
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => { controller.abort(); selection.current?.abort(); };
  }, []);

  const selectFile = async (file?: File) => {
    if (!file || uploadStarted || submission.current) return;
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setReading(true); setBundle(null); setError('');
    try {
      const next = await readTransferFile(file, controller.signal);
      if (!controller.signal.aborted) setBundle(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read this transfer');
    } finally { if (!controller.signal.aborted) setReading(false); }
  };
  const beginUploads = () => {
    if (!bundle || uploadStarted) return;
    setUploadStarted(true);
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
  const submit = async () => {
    if (!bundle || !filesReady || submission.current || lifetime.current?.signal.aborted) return;
    submission.current = true; setAttempted(true); setSubmitting(true); setError('');
    const controller = lifetime.current!;
    try {
      const files = Object.fromEntries(uploads.uploads.map((upload) => [fileIds.current.get(upload.file)!, upload.attachment!.id]));
      const result = await api.v1.things.import({ manifest: bundle.manifest, files, folderId: destination }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result?.ok !== true) throw new Error(result?.error || 'Import did not confirm success');
      uploads.markCommitted(Object.values(files));
      onImported(destination); onClose();
    } catch (cause) {
      if (!controller.signal.aborted) setError(`${cause instanceof Error ? cause.message : 'Import failed'}. Check your Things before trying again; if the response was lost, copies may already exist.`);
    } finally { if (!controller.signal.aborted) setSubmitting(false); }
  };

  return <Modal isOpen onClose={onClose} size="lg" scrollBehavior="inside" closeOnOverlayClick={!submitting} closeOnEsc={!submitting}>
    <ModalOverlay />
    <ModalContent width="calc(100% - 48px)" marginX={0} maxHeight="calc(100dvh - 48px)">
      <ModalHeader>Import Things</ModalHeader>
      {!submitting && <ModalCloseButton />}
      <ModalBody>
        <Flex direction="column" gap={4}>
          <Text fontSize="sm">Choose a Thingtime JSON file or complete ZIP. Imports create new private copies in your account; originals and their sharing settings are never changed.</Text>
          <Input aria-label="Thingtime transfer file" type="file" accept=".json,.zip,application/json,application/zip" padding={1} isDisabled={uploadStarted || attempted} onChange={(event) => { void selectFile(event.target.files?.[0]); }} />
          {reading && <Text role="status">Checking transfer contents…</Text>}
          {bundle && <>
            <Text>{bundle.manifest.things.length} Things · {bundle.manifest.files.length} files · {(bundle.manifest.files.reduce((total, file) => total + file.bytes, 0) / 1024 / 1024).toFixed(1)} MiB</Text>
            <Box>
              <Text as="label" htmlFor="thing-import-destination" fontSize="sm">Import destination</Text>
              <Select id="thing-import-destination" value={destination || ''} isDisabled={attempted} onChange={(event) => setDestination(event.target.value || null)}>
                <option value="">My Things (top level)</option>
                {folderId && <option value={folderId}>Current folder</option>}
              </Select>
            </Box>
            <Text fontSize="sm">Apps may contain actions. Importing does not run them. Only use content from sources you trust.</Text>
            {bundle.manifest.files.length > 0 && !uploadStarted && <Button onClick={beginUploads}>Upload {bundle.manifest.files.length} files</Button>}
            {uploads.uploads.length > 0 && <Box maxHeight="180px" overflowY="auto" aria-label="Import file uploads">
              {uploads.uploads.map((upload) => <Flex key={upload.localId} align="center" gap={2} py={1}>
                <Text flex={1} minWidth={0} overflowWrap="anywhere" fontSize="sm">{upload.file.name}: {upload.error || `${upload.status} ${Math.round(upload.progress)}%`}</Text>
                {upload.status === 'error' && !attempted && <Button size="xs" onClick={() => uploads.retry(upload.localId)}>Retry upload</Button>}
              </Flex>)}
            </Box>}
          </>}
          {error && <Text role="alert" color="red.500" overflowWrap="anywhere">{error}</Text>}
        </Flex>
      </ModalBody>
      <ModalFooter gap={2} flexWrap="wrap">
        <Button variant="ghost" onClick={onClose} isDisabled={submitting}>Close</Button>
        <Button colorScheme="pink" onClick={() => { void submit(); }} isDisabled={!filesReady || attempted || reading} isLoading={submitting}>Import private copies</Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
};
