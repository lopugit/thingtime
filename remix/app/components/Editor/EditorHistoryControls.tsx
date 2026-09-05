import React from 'react';
import { Box, Button, Checkbox, HStack, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import type { EditorHistory } from './editorHistory';
import type { EditorJsDoc } from './editorJsValue';
import { STYLE_CARRY_PROPERTIES, type StyleCarryPreferences } from './editorStyleCarry';

export type HistoryAction =
	| { type: 'select'; id: number }
	| { type: 'patch'; id: number; direction: 'revert' | 'reapply' }
	| { type: 'undo' | 'redo' };
export type EditorHistoryHandle = { restore: (doc: EditorJsDoc) => Promise<void>; flush: () => Promise<void> };

export function EditorHistoryControls({
	history,
	act,
	preferences,
	onPreferences
}: {
	history: EditorHistory;
	act: (action: HistoryAction) => Promise<void>;
	preferences: StyleCarryPreferences;
	onPreferences: (next: StyleCarryPreferences) => void;
}) {
	React.useSyncExternalStore(history.subscribe, history.getVersion, history.getVersion);
	const [open, setOpen] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const [page, setPage] = React.useState(0);
	const pageCount = Math.max(1, Math.ceil(history.events.length / 100));
	const start = Math.max(0, history.events.length - (page + 1) * 100),
		end = history.events.length - page * 100;
	const run = async (action: HistoryAction) => {
		setBusy(true);
		try {
			await act(action);
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<HStack className="tt-editor-history-controls" aria-label="Editor history" spacing={1}>
				<Button
					size="xs"
					aria-label="Undo"
					title="Undo (⌘/Ctrl Z)"
					isDisabled={busy || history.undoId === null}
					onClick={() => void run({ type: 'undo' })}
				>
					↶
				</Button>
				<Button
					size="xs"
					aria-label="Redo"
					title="Redo (⌘/Ctrl Shift Z)"
					isDisabled={busy || history.redoId === null}
					onClick={() => void run({ type: 'redo' })}
				>
					↷
				</Button>
				<Button
					size="xs"
					onClick={() => {
						setPage(0);
						setOpen(true);
					}}
				>
					Changes
				</Button>
			</HStack>
			<Modal isOpen={open} onClose={() => setOpen(false)} size="2xl" scrollBehavior="inside">
				<ModalOverlay zIndex={20000} />
				<ModalContent containerProps={{ zIndex: 20001 }} width="min(672px,calc(100vw - 24px))" maxH="calc(100dvh - 24px)" my="12px">
					<ModalHeader>Editor changes</ModalHeader>
					<ModalCloseButton />
					<ModalBody pb={5}>
						<Text fontSize="sm" mb={3}>
							This editing session keeps every branch. Restore a point, or revert/reapply just one change without discarding other events.
						</Text>
						<Box as="fieldset" border="1px solid" borderColor="gray.200" borderRadius="md" p={3} mb={4}>
							<Box as="legend" fontSize="sm">
								Carry whole-block styles when changing type
							</Box>
							<HStack flexWrap="wrap" gap={2}>
								{STYLE_CARRY_PROPERTIES.map(([key, label]) => (
									<Checkbox
										key={key}
										size="sm"
										isChecked={preferences[key] !== false}
										onChange={(e) => onPreferences({ ...preferences, [key]: e.target.checked })}
									>
										{label}
									</Checkbox>
								))}
							</HStack>
						</Box>
						<HStack justify="space-between" mb={3}>
							<Button size="xs" isDisabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
								Earlier changes
							</Button>
							<Text fontSize="xs">
								{start + 1}–{end} of {history.events.length}
							</Text>
							<Button size="xs" isDisabled={page === 0} onClick={() => setPage(page - 1)}>
								Newer changes
							</Button>
						</HStack>
						<Box as="ol" listStyleType="none" m={0} p={0}>
							{history.events.slice(start, end).map((event) => (
								<Box
									as="li"
									key={event.id}
									borderLeft="3px solid"
									borderColor={history.cursor === event.id ? 'pink.400' : 'gray.200'}
									pl={3}
									py={3}
									mb={2}
								>
									<Text fontWeight="600">
										{event.id}. {event.label}
										{history.cursor === event.id ? ' · Current' : ''}
									</Text>
									<Text fontSize="xs" color="gray.500">
										{new Date(event.time).toLocaleTimeString()} · {event.parentId === null ? 'Start' : `From change ${event.parentId}`} ·{' '}
										{event.changes.filter((c) => c.blockId).length} updated fields
									</Text>
									{event.changes.length ? (
										<Box as="details" fontSize="xs" mt={1}>
											<Box as="summary" cursor="pointer">
												Changed properties
											</Box>
											{event.changes.map((change, index) => (
												<Text key={index} overflowWrap="anywhere" my={1}>
													{change.path.join(' › ') || 'Block'}: {JSON.stringify(change.before)?.slice(0, 220) ?? '(unset)'} →{' '}
													{JSON.stringify(change.after)?.slice(0, 220) ?? '(unset)'}
												</Text>
											))}
										</Box>
									) : null}
									<HStack mt={2} flexWrap="wrap">
										<Button size="xs" isDisabled={busy || history.cursor === event.id} onClick={() => void run({ type: 'select', id: event.id })}>
											Restore point
										</Button>
										{event.parentId !== null ? (
											<>
												<Button size="xs" isDisabled={busy} onClick={() => void run({ type: 'patch', id: event.id, direction: 'revert' })}>
													Revert change
												</Button>
												<Button size="xs" isDisabled={busy} onClick={() => void run({ type: 'patch', id: event.id, direction: 'reapply' })}>
													Reapply change
												</Button>
											</>
										) : null}
									</HStack>
								</Box>
							))}
						</Box>
					</ModalBody>
				</ModalContent>
			</Modal>
		</>
	);
}
