import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { createThingtimeCapabilityChecker } from '~/api/utils/capabilities/requireCapability.client';
import { emptyCatalogProgress, MAX_CATALOG_FILE_BYTES, parseCatalogImport, publishCatalogImport, type CatalogImport } from './catalogImport';

// The parent mounts this only for admins and keys it by account identity.
// The server independently authorizes every batch through the existing seed API.
export function CatalogImporter({ onPublished }: { onPublished: () => void }) {
  const [catalog, setCatalog] = React.useState<CatalogImport | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [progress, setProgress] = React.useState(emptyCatalogProgress);
  const task = React.useRef<AbortController | null>(null);
  const readSequence = React.useRef(0);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; task.current?.abort(); };
  }, []);

  const selectFile = async (file?: File) => {
    const sequence = ++readSequence.current;
    setCatalog(null);
    setFileName('');
    setProgress(emptyCatalogProgress());
    setMessage('');
    if (!file) return;
    try {
      if (file.size > MAX_CATALOG_FILE_BYTES) throw new Error('Choose a catalog smaller than 32 MiB.');
      const text = await file.text();
      if (!mounted.current || sequence !== readSequence.current) return;
      const ready = parseCatalogImport(text);
      setCatalog(ready);
      setFileName(file.name);
      setMessage('Validated. Review the catalog before publishing.');
    } catch (error) {
      if (mounted.current && sequence === readSequence.current) setMessage(error instanceof Error ? error.message : 'Could not read this catalog.');
    }
  };

  const publish = async () => {
    if (!catalog || task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setProgress(emptyCatalogProgress());
    setMessage('Checking server compatibility…');
    try {
      const requireCapability = createThingtimeCapabilityChecker();
      await requireCapability('api.admin-components-seed', '1.0.0');
      await requireCapability('api.webpages-suites-install', '1.1.0');
      controller.signal.throwIfAborted();
      setMessage('Publishing catalog… Keep this page open.');
      await publishCatalogImport(catalog, {
        signal: controller.signal,
        send: async (body, signal) => {
          const response = await fetch('/api/v1/admin/components/seed', {
            method: 'POST', credentials: 'same-origin', redirect: 'error',
            headers: { 'Content-Type': 'application/json' }, body,
            signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          });
          const result = await response.json();
          if (!response.ok || result?.ok !== true) {
            throw new Error(response.status === 429 ? 'Import paused by the server rate limit. Wait a minute, then publish again.' : result?.error || `Import failed (${response.status}).`);
          }
          return result;
        },
        pause: signal => new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2500);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
        onProgress: next => { if (mounted.current) setProgress(next); }
      });
      if (mounted.current) { setMessage('Catalog published. Every component was checked and saved.'); onPublished(); }
    } catch (error) {
      if (mounted.current) setMessage(controller.signal.aborted
        ? 'Import stopped. Completed batches remain saved; publishing again safely checks existing entries.'
        : error instanceof Error ? error.message : 'Import failed. Publishing again safely checks existing entries.');
    } finally {
      task.current = null;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Box as="details" border="1px solid var(--tt-border, #ddd)" borderRadius="12px" p={4} minWidth={0}>
      <Box as="summary" cursor="pointer" fontWeight={600}>Import component catalog · Admin</Box>
      <Flex direction="column" gap={3} mt={4} minWidth={0}>
        <Text fontSize="sm">Publish component definitions to the public platform library. Matching system components are updated; user-owned components are preserved.</Text>
        <label>
          <Text as="span" display="block" fontSize="sm" mb={2}>Catalog JSON file</Text>
          <input aria-label="Catalog JSON file" type="file" accept=".json,application/json" disabled={busy}
            style={{ width: '100%', maxWidth: '100%' }} onChange={event => void selectFile(event.target.files?.[0])} />
        </label>
        {catalog && <Text fontSize="sm" overflowWrap="anywhere">{fileName}: {catalog.definitions.length.toLocaleString()} components · {catalog.libraries.join(', ')} · {catalog.batches.length} batches</Text>}
        <Text role="status" aria-live="polite" fontSize="sm" overflowWrap="anywhere">{message}</Text>
        {(busy || progress.processed > 0) && <Text fontSize="sm">{progress.processed.toLocaleString()} / {catalog?.definitions.length.toLocaleString()} checked · {progress.created} created · {progress.refreshed} updated · {progress.unchanged} unchanged · {progress.skipped} skipped</Text>}
        <Flex gap={2} wrap="wrap">
          <Button onClick={() => void publish()} isDisabled={!catalog || busy} size="sm">Publish catalog</Button>
          {busy && <Button onClick={() => task.current?.abort()} variant="outline" size="sm">Stop import</Button>}
        </Flex>
      </Flex>
    </Box>
  );
}
