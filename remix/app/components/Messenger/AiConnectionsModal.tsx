import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Link,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Progress,
  Spinner
} from '@chakra-ui/react';

import { useLopu } from '../Lopu/useLopu';
import {
  getElectronBridge,
  type ThingtimeAiDesktopSource,
  type ThingtimeAiSyncBatch
} from '~/utils/electronBridge';
import type { MessengerApi } from './useMessengerApi';

type Connection = {
  id: string;
  provider: 'chatgpt' | 'claude';
  sourceId: string;
  label: string;
  status: 'syncing' | 'connected' | 'error';
  groups: number;
  conversations: number;
  messages: number;
  lastSyncAt: string | null;
};

export const AiConnectionsModal = ({
  isOpen,
  onClose,
  api,
  onSynced
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  onSynced: () => void;
}) => {
  const lopu = useLopu();
  const [sources, setSources] = React.useState<ThingtimeAiDesktopSource[]>([]);
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busySource, setBusySource] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ completed: number; total: number; label: string } | null>(null);
  const bridge = getElectronBridge();

  const load = React.useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const [sourcePayload, connectionPayload] = await Promise.all([
        bridge?.discoverAiSources?.() || Promise.resolve({ sources: [] }),
        api.aiConnections()
      ]);
      setSources(sourcePayload.sources || []);
      setConnections(connectionPayload.connections || []);
    } catch (error: any) {
      lopu({ title: error?.error || error?.message || 'Could not inspect AI connections 😞', status: 'error' });
    }
    setLoading(false);
  }, [api, bridge, isOpen, lopu]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const runSync = async (source: ThingtimeAiDesktopSource, mode: 'local' | 'export') => {
    if (!bridge?.beginAiSync || !bridge.readAiSyncBatch || busySource) return;
    setBusySource(source.sourceId);
    setProgress({ completed: 0, total: 1, label: mode === 'local' ? 'Reading local conversations…' : 'Choose an official export…' });
    let syncId: string | null = null;
    try {
      const started = await bridge.beginAiSync({ sourceId: source.sourceId, mode });
      if ('cancelled' in started) {
        setProgress(null);
        setBusySource(null);
        return;
      }
      syncId = started.syncId;
      for (;;) {
        const batch: ThingtimeAiSyncBatch = await bridge.readAiSyncBatch({ syncId });
        setProgress({
          completed: batch.progress.completed,
          total: Math.max(1, batch.progress.total),
          label: `Importing ${batch.progress.completed.toLocaleString()} of ${batch.progress.total.toLocaleString()} records…`
        });
        await api.syncAiConnections({
          source: batch.source,
          groups: batch.groups,
          conversations: batch.conversations,
          messages: batch.messages,
          final: batch.final,
          totals: batch.totals
        });
        if (batch.final) break;
      }
      lopu({
        title: `${source.label} is connected — its chats are in Messenger ✨`,
        status: 'success',
        duration: 7000
      });
      await load();
      onSynced();
    } catch (error: any) {
      lopu({ title: error?.error || error?.message || `${source.label} did not sync 😞`, status: 'error', duration: 8000 });
    } finally {
      if (syncId) await bridge.cancelAiSync?.({ syncId }).catch(() => undefined);
      setBusySource(null);
      setProgress(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={busySource ? () => {} : onClose} isCentered scrollBehavior="inside" size="lg">
      <ModalOverlay zIndex={10240} />
      <ModalContent
        containerProps={{ zIndex: 10250 }}
        background="var(--tt-card, #ffffff)"
        color="var(--tt-ink, #17171c)"
        borderRadius="var(--tt-radius-lg, 16px)"
        marginX={4}
        maxHeight="min(760px, calc(100dvh - 32px))"
      >
        <ModalHeader fontSize="17px">Connect AI apps</ModalHeader>
        <ModalCloseButton isDisabled={!!busySource} />
        <ModalBody paddingBottom={5}>
          <Flex direction="column" gap={4}>
            <Box fontSize="13px" color="var(--tt-muted, #777782)" whiteSpace="normal">
              Thingtime reads only the sources you choose. Local Work/Codex and Claude sessions sync directly;
              full cloud chat history comes from each provider’s official export. Credentials, cookies, hidden
              reasoning, tool traffic and local paths never leave your Mac.
            </Box>

            {!bridge?.discoverAiSources ? (
              <Box
                padding={4}
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="var(--tt-radius-md, 10px)"
                fontSize="13px"
                whiteSpace="normal"
              >
                Open this page in the Thingtime desktop app to discover ChatGPT, Claude and Claude Thingtime on
                this Mac. The browser cannot read desktop app data.
              </Box>
            ) : loading ? (
              <Flex justify="center" paddingY={8}>
                <Spinner size="sm" />
              </Flex>
            ) : (
              sources.map((source) => {
                const connected = connections.find((entry) => entry.sourceId === source.sourceId) || null;
                const busy = busySource === source.sourceId;
                return (
                  <Box
                    key={source.sourceId}
                    padding={3}
                    border="1px solid var(--tt-border, #ececef)"
                    borderRadius="var(--tt-radius-md, 10px)"
                  >
                    <Flex align="flex-start" justify="space-between" gap={3}>
                      <Box minWidth={0}>
                        <Flex align="center" gap={2} wrap="wrap">
                          <Box fontWeight={700} fontSize="14px">
                            {source.provider === 'chatgpt' ? '◎' : '✦'} {source.label}
                          </Box>
                          <Badge colorScheme={connected?.status === 'connected' ? 'green' : source.installed ? 'gray' : 'orange'}>
                            {connected?.status === 'connected' ? 'Connected' : source.installed ? 'Found' : 'App not found'}
                          </Badge>
                        </Flex>
                        <Box fontSize="12px" color="var(--tt-muted, #777782)" whiteSpace="normal" marginTop={1}>
                          {source.description}
                        </Box>
                        {connected ? (
                          <Box fontSize="11px" color="var(--tt-faint, #9a9aa6)" marginTop={1} whiteSpace="normal">
                            {connected.conversations.toLocaleString()} chats · {connected.messages.toLocaleString()} messages
                            {connected.groups ? ` · ${connected.groups.toLocaleString()} projects` : ''}
                            {connected.lastSyncAt ? ` · synced ${new Date(connected.lastSyncAt).toLocaleString()}` : ''}
                          </Box>
                        ) : null}
                      </Box>
                    </Flex>
                    <Flex gap={2} marginTop={3} wrap="wrap">
                      <Button
                        size="xs"
                        borderRadius="var(--tt-radius-pill, 999px)"
                        onClick={() => void runSync(source, 'local')}
                        isDisabled={!source.localAvailable || !!busySource}
                        isLoading={busy}
                      >
                        {connected ? 'Sync local again' : 'Sync local chats'}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        borderRadius="var(--tt-radius-pill, 999px)"
                        onClick={() => void runSync(source, 'export')}
                        isDisabled={!source.exportSupported || !!busySource}
                      >
                        Import full export…
                      </Button>
                    </Flex>
                  </Box>
                );
              })
            )}

            {progress ? (
              <Box>
                <Box fontSize="12px" marginBottom={1} whiteSpace="normal">
                  {progress.label}
                </Box>
                <Progress
                  size="sm"
                  borderRadius="full"
                  value={Math.min(100, (progress.completed / Math.max(1, progress.total)) * 100)}
                  isAnimated
                />
              </Box>
            ) : null}

            <Box fontSize="12px" color="var(--tt-muted, #777782)" whiteSpace="normal">
              Imported provider messages are read-only. You can react, thread and add replies in Thingtime; those
              replies do not post back to ChatGPT or Claude. Need the full cloud archive?{' '}
              <Link
                href="https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data"
                isExternal
                textDecoration="underline"
              >
                Export ChatGPT
              </Link>{' '}
              ·{' '}
              <Link
                href="https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-data"
                isExternal
                textDecoration="underline"
              >
                Export Claude
              </Link>
            </Box>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
