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
	Select,
  Spinner
} from '@chakra-ui/react';

import { useLopu } from '../Lopu/useLopu';
import { getElectronBridge, type ThingtimeAiDesktopSource, type ThingtimeAiSyncBatch } from '~/utils/electronBridge';
import type { MessengerApi } from './useMessengerApi';
import { useDeviceApi, type PublicDevice } from '~/components/Devices/useDeviceApi';
import { hasUnknownMutationOutcome } from '~/hooks/apiFailure';
import { projectsForLiveConnector, selectedLiveConnectorProject } from './liveConnectorProjects';
import { runPagedLiveSessionList, waitForLiveDeviceCommand } from './liveSessionDiscovery';
import { isLiveAiSource, type ChatSummary } from './messengerTypes';

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
	chats,
  onSynced
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
	chats: ChatSummary[];
  onSynced: () => void | Promise<void>;
}) => {
  const lopu = useLopu();
  const [sources, setSources] = React.useState<ThingtimeAiDesktopSource[]>([]);
  const [connections, setConnections] = React.useState<Connection[]>([]);
	const [devices, setDevices] = React.useState<PublicDevice[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busySource, setBusySource] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ completed: number; total: number; label: string } | null>(null);
	const [busyLive, setBusyLive] = React.useState<string | null>(null);
	const [selectedProjects, setSelectedProjects] = React.useState<Record<string, string>>({});
	const liveRequestIds = React.useRef(new Map<string, string>());
	const liveCommandController = React.useRef<AbortController | null>(null);
  const bridge = getElectronBridge();
	const deviceApi = useDeviceApi();

  const load = React.useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
			const [sourcePayload, connectionPayload, devicePayload] = await Promise.all([
        bridge?.discoverAiSources?.() || Promise.resolve({ sources: [] }),
				api.aiConnections(),
				deviceApi.listDevices()
      ]);
      setSources(sourcePayload.sources || []);
      setConnections(connectionPayload.connections || []);
			setDevices(devicePayload.devices || []);
    } catch (error: any) {
      lopu({ title: error?.error || error?.message || 'Could not inspect AI connections 😞', status: 'error' });
    }
    setLoading(false);
	}, [api, bridge, deviceApi, isOpen, lopu]);

  React.useEffect(() => {
    void load();
  }, [load]);

	React.useEffect(() => {
		if (isOpen) return;
		liveCommandController.current?.abort();
	}, [isOpen]);

	React.useEffect(
		() => () => {
			liveCommandController.current?.abort();
		},
		[]
	);

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

	const liveChats = chats.filter((chat) => isLiveAiSource(chat.externalSource));
	const hasConnectorCapability = (capabilities: string[], ...ids: string[]) => ids.some((id) => capabilities.includes(id));

	const queueLiveCommand = async (key: string, body: Omit<Parameters<typeof deviceApi.createCommand>[0], 'requestId'>, successMessage: string) => {
		if (busyLive) return;
		const requestId = liveRequestIds.current.get(key) || crypto.randomUUID();
		liveRequestIds.current.set(key, requestId);
		const controller = new AbortController();
		liveCommandController.current = controller;
		setBusyLive(key);
		let outcomeUncertain = false;
		try {
			let pageLimitReached = false;
			if (body.kind === 'session.list') {
				const connectorId = typeof body.input.connectorId === 'string' ? body.input.connectorId : '';
				if (!connectorId) throw new Error('The desktop connector id is unavailable.');
				const result = await runPagedLiveSessionList({
					deviceId: body.deviceId,
					connectorId,
					requestId,
					requiresApproval: body.requiresApproval === true,
					createCommand: (request, signal) => deviceApi.createCommand(request, signal),
					loadCommands: async (signal) => (await deviceApi.listCommands(body.deviceId, signal)).commands,
					signal: controller.signal
				});
				if (result.status === 'aborted') return;
				if (result.status === 'timed-out') {
					outcomeUncertain = true;
					throw new Error('Thingtime is still waiting for that desktop command. Reopening this panel will safely reconcile it.');
				}
				if (result.status === 'page-limit') {
					pageLimitReached = true;
				} else if (result.status !== 'succeeded') {
					throw new Error(
						result.command?.error ||
							(result.status === 'needs-review'
								? 'The desktop command needs review before it can be retried.'
								: 'The desktop session refresh did not complete.')
					);
				}
			} else {
				const created = await deviceApi.createCommand({ ...body, requestId }, controller.signal);
				const result = await waitForLiveDeviceCommand({
					command: created.command,
					loadCommands: async (signal) => (await deviceApi.listCommands(body.deviceId, signal)).commands,
					signal: controller.signal
				});
				if (result.status === 'aborted') return;
				if (result.status === 'timed-out') {
					outcomeUncertain = true;
					throw new Error('Thingtime is still waiting for that desktop command. Reopening this panel will safely reconcile it.');
				}
				if (result.status !== 'succeeded') {
					throw new Error(
						result.command.error ||
							(result.status === 'needs-review'
								? 'The desktop command needs review before it can be retried.'
								: 'The desktop command did not complete.')
					);
				}
			}
			if (controller.signal.aborted) return;
			liveRequestIds.current.delete(key);
			await onSynced();
			if (!controller.signal.aborted) await load();
			lopu({
				title: pageLimitReached ? `${successMessage} Refreshed the first 2,000 chats.` : successMessage,
				status: 'success',
				duration: 6000
			});
		} catch (error: any) {
			if (controller.signal.aborted || error?.name === 'AbortError') return;
			const unknownOutcome = outcomeUncertain || hasUnknownMutationOutcome(error);
			if (!unknownOutcome) liveRequestIds.current.delete(key);
			lopu({
				title: error?.error || error?.message || 'The desktop command could not be queued.',
				status: unknownOutcome ? 'info' : 'error'
			});
		} finally {
			if (liveCommandController.current === controller) liveCommandController.current = null;
			setBusyLive(null);
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
							Thingtime reads only the sources you choose. Local Work/Codex and Claude sessions sync directly; full cloud chat history comes from each
							provider’s official export. Credentials, cookies, hidden reasoning, tool traffic and local paths never leave your Mac.
						</Box>

						<Box>
							<Flex align="center" justify="space-between" gap={2} marginBottom={2}>
								<Box fontWeight={700} fontSize="14px">
									Live desktop sessions
								</Box>
								<Badge borderRadius="full" colorScheme={devices.some((device) => device.online) ? 'green' : 'gray'}>
									{devices.filter((device) => device.online).length} online
								</Badge>
							</Flex>
							{!devices.length ? (
								<Box
									padding={3}
									border="1px solid var(--tt-border, #ececef)"
									borderRadius="var(--tt-radius-md, 10px)"
									fontSize="12px"
									whiteSpace="normal"
								>
									Pair a computer from <b>/things</b> to open, refresh and create desktop AI sessions from anywhere.
								</Box>
							) : (
								<Flex direction="column" gap={2}>
									{devices.flatMap((device) =>
					device.connectors.map((connector) => {
											const connectorKey = `${device.id}:${connector.id}`;
											const projects = projectsForLiveConnector({
												advertised: connector.projects,
												chats,
												deviceId: device.id,
												connectorId: connector.id
											});
											const selectedProject = selectedLiveConnectorProject(projects, selectedProjects[connectorKey]);
											const projectRequired = connector.id === 'codex-app-server' || connector.kind.toLowerCase().includes('codex');
											const canCreate = hasConnectorCapability(
												connector.capabilities,
												'create-session',
												'session.create',
												'ai.session.create'
											);
											const canRead = hasConnectorCapability(
												connector.capabilities,
												'read-history',
												'session.list',
												'ai.session.read'
											);
											return (
												<Box key={connectorKey} padding={3} border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 10px)">
													<Flex align="center" justify="space-between" gap={2} wrap="wrap">
														<Box minWidth={0}>
															<Box fontSize="13px" fontWeight={700}>
																{connector.label} · {device.name}
															</Box>
															<Box fontSize="11px" color="var(--tt-muted, #777782)">
																{connector.status} ·{' '}
																{
																	liveChats.filter((chat) => {
																		const source = isLiveAiSource(chat.externalSource) ? chat.externalSource : null;
																		return source?.deviceId === device.id && source.connectorId === connector.id;
																	}).length
																}{' '}
																mirrored chats
															</Box>
														</Box>
														<Badge colorScheme={device.online && connector.status === 'connected' ? 'green' : 'gray'}>
															{device.online ? connector.status : 'offline'}
														</Badge>
													</Flex>
													{projects.length ? (
														<Select
															size="sm"
															marginTop={3}
															value={selectedProject}
															onChange={(event) =>
																setSelectedProjects((current) => ({
																	...current,
																	[connectorKey]: event.target.value
																}))
															}
															aria-label={`Project for ${connector.label} on ${device.name}`}
														>
													{projects.map((project) => (
														<option key={project.projectId} value={project.projectId}>
															{project.projectLabel}
														</option>
													))}
												</Select>
										) : projectRequired ? (
											<Box fontSize="11px" color="var(--tt-muted, #777782)" marginTop={3} whiteSpace="normal">
												No local Codex projects are available yet. Add one from this Mac’s Thingtime Node setup or refresh existing Codex chats.
											</Box>
											) : null}
													<Flex gap={2} marginTop={3} wrap="wrap">
														<Button
															size="xs"
															variant="outline"
															isDisabled={!canRead || !!busyLive}
															isLoading={busyLive === `${connectorKey}:refresh`}
															onClick={() =>
																void queueLiveCommand(
																	`${connectorKey}:refresh`,
																	{
																		deviceId: device.id,
																		kind: 'session.list',
																		input: { connectorId: connector.id, limit: 100 },
																		requiresApproval: false
																	},
																	`Refreshing ${connector.label} chats on ${device.name}…`
																)
															}
														>
															Refresh chats
														</Button>
														<Button
															size="xs"
													isDisabled={!canCreate || !!busyLive || (projectRequired && !selectedProject)}
															isLoading={busyLive === `${connectorKey}:create:${selectedProject || 'default'}`}
															onClick={() =>
																void queueLiveCommand(
																	`${connectorKey}:create:${selectedProject || 'default'}`,
																	{
																		deviceId: device.id,
																		kind: 'session.create',
																		input: {
																			connectorId: connector.id,
																			...(selectedProject ? { projectId: selectedProject } : {})
																		},
																		requiresApproval: connector.capabilities.includes('explicit-approval')
																	},
																	`Creating a new ${connector.label} chat on ${device.name}…`
																)
															}
														>
													New chat
													{selectedProject
														? ` in ${projects.find((project) => project.projectId === selectedProject)?.projectLabel || 'project'}`
														: ''}
														</Button>
													</Flex>
												</Box>
											);
										})
									)}
								</Flex>
							)}
            </Box>

            {!bridge?.discoverAiSources ? (
              <Box
                padding={4}
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="var(--tt-radius-md, 10px)"
                fontSize="13px"
                whiteSpace="normal"
              >
								Open this page in the Thingtime desktop app to discover ChatGPT, Claude and Claude Thingtime on this Mac. The browser cannot read
								desktop app data.
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
									<Box key={source.sourceId} padding={3} border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 10px)">
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
								<Progress size="sm" borderRadius="full" value={Math.min(100, (progress.completed / Math.max(1, progress.total)) * 100)} isAnimated />
              </Box>
            ) : null}

            <Box fontSize="12px" color="var(--tt-muted, #777782)" whiteSpace="normal">
							Live desktop sessions can send, queue, steer and stop work when the connector advertises those capabilities. Export imports remain
							read-only; Thingtime reactions and threads on those imports do not post back to ChatGPT or Claude. Need the full cloud archive?{' '}
              <Link
                href="https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data"
                isExternal
                textDecoration="underline"
              >
                Export ChatGPT
              </Link>{' '}
              ·{' '}
							<Link href="https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-data" isExternal textDecoration="underline">
                Export Claude
              </Link>
            </Box>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
