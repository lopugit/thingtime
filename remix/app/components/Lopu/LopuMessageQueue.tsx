import { ReorderableList } from '../Nav/Drawer/ReorderableList';
import React from 'react';
import { Box, Button, Checkbox, Flex, IconButton, Text } from '@chakra-ui/react';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { editLopuQueue, pauseLopuQueue, reorderLopuQueue, type QueuedLopuMessage } from './lopuQueueStore';
import { LOPU_UI } from './lopuTheme';
export const LopuMessageQueue = ({
	items,
	paused,
	error,
	lockedIds = []
}: {
	items: QueuedLopuMessage[];
	paused: boolean;
	error: string | null;
	lockedIds?: string[];
}) => {
	if (!items.length) return null;
	return (
		<Box border={LOPU_UI.border} borderRadius="14px" p={3} mb={2} bg={LOPU_UI.card}>
			<Flex align="center" justify="space-between" gap={2}>
				<Text fontSize="sm" fontWeight="600">
					Queued messages · {items.length}
				</Text>
				<Button size="xs" onClick={() => pauseLopuQueue(!paused)}>
					{paused ? 'Resume queue' : 'Pause queue'}
				</Button>
			</Flex>
			<Text fontSize="xs" color={LOPU_UI.muted} mt={1}>
				Checked messages with the same context send together after the current reply. Queue stays in this tab; after reload, press Resume.
			</Text>
			{error && (
				<Text role="alert" fontSize="sm" mt={2}>
					{error}
				</Text>
			)}
			<Box maxH="180px" overflowY="auto" mt={2}>
				<ReorderableList
					handleOnly
					disabled={lockedIds.length > 0}
					onReorder={(ids) => reorderLopuQueue(items[0].chatId, ids)}
					items={items.map((item, index) => {
						const locked = lockedIds.includes(item.id);
						return {
							id: item.id,
							node: (
								<Flex align="center" gap={2} py={2} borderTop={index ? LOPU_UI.border : undefined}>
									<Box
										as="button"
										type="button"
										data-reorder-handle
										disabled={locked}
										aria-label={`Drag queued message ${index + 1}`}
										title="Hold, then drag to reorder"
										cursor="grab"
										sx={{ touchAction: 'none' }}
										p={1}
									>
										<GripVertical size={16} />
									</Box>
									<Box flex="1" minW={0}>
										<Text fontSize="sm" whiteSpace="pre-wrap" overflowWrap="anywhere" noOfLines={3}>
											{item.text}
										</Text>
										<Checkbox
											size="sm"
											mt={1}
											isChecked={item.together}
											isDisabled={locked}
											onChange={(event) => editLopuQueue(item.id, { together: event.target.checked })}
										>
											Send together
										</Checkbox>
									</Box>
									<Flex flexShrink={0} gap={1}>
										<IconButton
											size="sm"
											minW="32px"
											aria-label={`Move queued message ${index + 1} up`}
											icon={<ArrowUp size={15} />}
											isDisabled={locked || index === 0}
											onClick={() => editLopuQueue(item.id, { direction: -1 })}
										/>
										<IconButton
											size="sm"
											minW="32px"
											aria-label={`Move queued message ${index + 1} down`}
											icon={<ArrowDown size={15} />}
											isDisabled={locked || index === items.length - 1}
											onClick={() => editLopuQueue(item.id, { direction: 1 })}
										/>
										<IconButton
											size="sm"
											minW="32px"
											aria-label={`Remove queued message ${index + 1}`}
											icon={<X size={15} />}
											isDisabled={locked}
											onClick={() => editLopuQueue(item.id, { remove: true })}
										/>
									</Flex>
								</Flex>
							)
						};
					})}
				/>
			</Box>
		</Box>
	);
};
