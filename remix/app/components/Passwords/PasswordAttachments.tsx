import React from 'react';
import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import type { PasswordStorage, SavedPasswordFile } from '~/passwords/storage';
import { newPasswordFile } from '~/passwords/fileCrypto';
export function PasswordAttachments({ storage, entryId, readOnly = false, sourceItem }: { storage: PasswordStorage; entryId: string; readOnly?: boolean; sourceItem?: string }) {
  const [showAll, setShowAll] = React.useState(false);
  const [files, setFiles] = React.useState<SavedPasswordFile[]>([]), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const controller = React.useRef(new AbortController());
  const pending = React.useRef<{ file: File; metadata: ReturnType<typeof newPasswordFile> } | null>(null);
  const refresh = React.useCallback(async () => { const active = controller.current; const result = await storage.listFiles([entryId], active.signal); if (!active.signal.aborted) setFiles(result); }, [storage, entryId]);
  React.useEffect(() => { const active = new AbortController(); controller.current = active; refresh().catch(() => { if (!active.signal.aborted) setError('Files could not be loaded.'); }); return () => active.abort(); }, [refresh]);
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await work(); } catch (error) { if (!controller.current.signal.aborted) setError(error instanceof Error ? error.message : 'File unavailable.'); } finally { if (!controller.current.signal.aborted) setBusy(false); } };
  const upload = () => run(async () => { if (!pending.current) return; const { file, metadata } = pending.current; await storage.uploadFile(entryId, metadata, () => file.stream(), controller.current.signal); pending.current = null; await refresh(); });
  const displayed = !readOnly || !sourceItem || showAll ? files : files.filter(file => { const name = file.metadata.archivePath?.split('/').at(-1); const id = name?.split('___')[0]; return id && sourceItem.includes(id); });
  return <Box mt={5}><Text fontWeight={600}>{readOnly ? 'Related source documents and icons' : 'Attachments'}</Text>
    {!readOnly && <Button as="label" size="sm" mt={2} cursor="pointer" isDisabled={busy}>Add attachment<Input type="file" display="none" disabled={busy} aria-label="Add password attachment" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) { pending.current = { file, metadata: newPasswordFile(file.name, file.size) }; upload(); } }} /></Button>}
    {displayed.map(file => <Flex key={file.id} gap={2} mt={2} alignItems="center" flexWrap="wrap"><Text flex="1 1 150px" fontSize="sm" overflowWrap="anywhere">{file.metadata.archivePath || file.metadata.name} · {file.metadata.size.toLocaleString()} bytes</Text><Button size="xs" isDisabled={busy} onClick={() => run(async () => {
      const opened = await storage.openFile(entryId, file.id, controller.current.signal);
      const blob = await new Response(opened.stream).blob(); controller.current.signal.throwIfAborted();
      const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = opened.metadata.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    })}>Download</Button>{!readOnly && <Button size="xs" isDisabled={busy} onClick={() => run(async () => { await storage.removeFile(entryId, file.id, controller.current.signal); await refresh(); })}>Remove</Button>}</Flex>)}
    {readOnly && sourceItem && <Button mt={2} size="xs" variant="ghost" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show related files' : `Show all ${files.length} original archive files`}</Button>}
    {error && <Text role="alert" mt={2} color="red.600">{error}</Text>}{pending.current && error && <Button size="sm" mt={2} onClick={upload}>Retry attachment</Button>}
  </Box>;
}
