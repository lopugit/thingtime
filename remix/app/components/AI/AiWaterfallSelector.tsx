import React from 'react';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import type { SavedAiWaterfall } from '~/api/utils/ai/savedWaterfallCore';
import {
	Box,
	Button,
	Flex,
	FormControl,
	FormLabel,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	Text
} from '@chakra-ui/react';
import {
	AI_WATERFALL_MAX_ENTRIES,
	moveAiWaterfallEntry,
	validateAiWaterfallSelection,
	type AiWaterfallConfig,
	type AiWaterfallEndpoint,
	type AiWaterfallEntry
} from '~/api/utils/ai/waterfallConfig';

export type AiWaterfallSelectorProps = {
	isOpen: boolean;
	value: AiWaterfallConfig | null;
	endpoints: readonly AiWaterfallEndpoint[];
	onApply: (config: AiWaterfallConfig | null) => void;
	onClose: () => void;
	allowInherit?: boolean;
	title?: string;
	maxEntries?: number;
	initialSaved?: SavedAiWaterfall;
	applyLabel?: string;
	library?: {
		items: SavedAiWaterfall[];
		error?: string;
		save: (input: { id?: string; updatedAt?: string; name: string; config: AiWaterfallConfig }) => Promise<SavedAiWaterfall>;
	};
};

// Deliberately no fetch, persistence or feature-specific state. Mount on open
// so Cancel discards the draft and background refresh cannot overwrite edits.
export const AiWaterfallSelector = (props: AiWaterfallSelectorProps) => (props.isOpen ? <WaterfallDialog {...props} /> : null);
const WaterfallDialog = ({
	value,
	endpoints,
	onApply,
	onClose,
	allowInherit = true,
	maxEntries = AI_WATERFALL_MAX_ENTRIES,
	initialSaved,
	library,
	applyLabel = 'Apply waterfall',
	title = 'AI model & endpoint waterfall'
}: AiWaterfallSelectorProps) => {
	const [entries, setEntries] = React.useState<AiWaterfallEntry[]>(
		() =>
			value?.entries.map((entry) => ({ ...entry })) ??
			(!allowInherit && endpoints[0]?.models[0]
				? [{ endpointId: endpoints[0].id, modelId: endpoints[0].models[0].id, effort: null, speed: 'normal' }]
				: [])
	);
	const [inherit, setInherit] = React.useState(!value && allowInherit);
	const [error, setError] = React.useState('');
	const [selected, setSelected] = React.useState(initialSaved);
	const [name, setName] = React.useState(initialSaved?.name ?? '');
	const [saving, setSaving] = React.useState(false);
	const validated = () => {
		if (entries.length > maxEntries) throw new TypeError(`Choose up to ${maxEntries} AI attempts.`);
		return validateAiWaterfallSelection({ version: 1, entries }, endpoints);
	};
	const save = async (apply: boolean, copy = false) => {
		if (!library || saving || inherit) return;
		setSaving(true);
		setError('');
		try {
			const config = validated();
			const row = await library.save({ name, config, ...(!copy && selected ? { id: selected.id, updatedAt: selected.updatedAt } : {}) });
			setSelected(row);
			setName(row.name);
			if (apply) {
				onApply(config);
				onClose();
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not save waterfall.');
		} finally {
			setSaving(false);
		}
	};
	const change = (index: number, patch: Partial<AiWaterfallEntry>) =>
		setEntries((current) => current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
	const add = () => {
		const endpoint = endpoints[0];
		if (!endpoint) return;
		setEntries((current) => [...current, { endpointId: endpoint.id, modelId: endpoint.models[0]?.id ?? '', effort: null, speed: 'normal' }]);
	};
	return (
		<Modal
			isOpen
			onClose={() => {
				if (!saving) onClose();
			}}
			size="xl"
			scrollBehavior="inside"
		>
			<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
			<ModalContent containerProps={{ zIndex: DRAWER_MODAL_Z }} mx={{ base: 3, md: 6 }} maxH="calc(100dvh - 48px)" my={6}>
				<ModalHeader pr={12}>{title}</ModalHeader>
				<ModalCloseButton isDisabled={saving} />
				<ModalBody>
					<fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
						{library && (
							<Box mb={4}>
								<FormControl mb={2}>
									<FormLabel fontSize="sm">Saved waterfalls</FormLabel>
									<Select
										aria-label="Select saved waterfall"
										value={selected?.id ?? ''}
										onChange={(event) => {
											const row = library.items.find((item) => item.id === event.target.value);
											setSelected(row);
											if (row) {
												setEntries(row.config.entries.map((entry) => ({ ...entry })));
												setName(row.name);
												setInherit(false);
												setError('');
											} else setName('');
										}}
									>
										<option value="">Unsaved waterfall</option>
										{library.items.map((row) => (
											<option key={row.id} value={row.id}>
												{row.name}
											</option>
										))}
									</Select>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="sm">Waterfall name</FormLabel>
									<Input
										aria-label="Waterfall name"
										maxLength={80}
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder="e.g. Everyday coding"
									/>
								</FormControl>
								<Text role="status" fontSize="xs" mt={2}>
									{selected && name === selected.name && JSON.stringify(entries) === JSON.stringify(selected.config.entries)
										? 'Saved'
										: 'Unsaved changes'}
								</Text>
								{library.error && (
									<Text role="status" fontSize="sm" mt={2}>
										{library.error}
									</Text>
								)}
							</Box>
						)}
						<Text fontSize="sm" mb={4}>
							The first entry is preferred. If it is unavailable, try the next model and endpoint in order.
						</Text>
						{allowInherit && (
							<Select
								aria-label="AI selection mode"
								mb={4}
								value={inherit ? 'inherit' : 'custom'}
								onChange={(event) => {
									setInherit(event.target.value === 'inherit');
									if (event.target.value === 'custom' && !entries.length) add();
								}}
							>
								<option value="inherit">Use shared AI settings</option>
								<option value="custom">Choose a waterfall</option>
							</Select>
						)}
						{!inherit && (
							<>
								<Flex direction="column" gap={3} role="list" aria-label="AI waterfall order">
									{entries.map((entry, index) => {
										const endpoint = endpoints.find((item) => item.id === entry.endpointId);
										const model = endpoint?.models.find((item) => item.id === entry.modelId);
										return (
											<Box key={index} role="listitem" border="1px solid" borderColor="gray.200" borderRadius="md" p={3} minW={0}>
												<Flex align="center" gap={2} wrap="wrap" mb={2}>
													<Text fontWeight="600" flex="1">
														{index === 0 ? 'Preferred model' : `Fallback ${index}`}
													</Text>
													<Button
														size="xs"
														aria-label={`Move attempt ${index + 1} up`}
														isDisabled={index === 0}
														onClick={() => setEntries(moveAiWaterfallEntry(entries, index, index - 1))}
													>
														↑
													</Button>
													<Button
														size="xs"
														aria-label={`Move attempt ${index + 1} down`}
														isDisabled={index === entries.length - 1}
														onClick={() => setEntries(moveAiWaterfallEntry(entries, index, index + 1))}
													>
														↓
													</Button>
													<Button
														size="xs"
														aria-label={`Remove attempt ${index + 1}`}
														onClick={() => setEntries(entries.filter((_, position) => position !== index))}
													>
														Remove
													</Button>
												</Flex>
												<FormControl mb={2}>
													<FormLabel fontSize="xs">Endpoint</FormLabel>
													<Select
														size="sm"
														aria-label={`Endpoint for attempt ${index + 1}`}
														value={entry.endpointId}
														onChange={(event) => {
															const next = endpoints.find((item) => item.id === event.target.value)!;
															change(index, { endpointId: next.id, modelId: next.models[0]?.id ?? '', effort: null, speed: 'normal' });
														}}
													>
														{!endpoint && <option value={entry.endpointId}>Unavailable connection</option>}
														{endpoints.map((item) => (
															<option key={item.id} value={item.id}>
																{item.label}
															</option>
														))}
													</Select>
												</FormControl>
												<FormControl mb={2}>
													<FormLabel fontSize="xs">Model</FormLabel>
													{endpoint?.allowCustomModel ? (
														<Input
															size="sm"
															aria-label={`Model for attempt ${index + 1}`}
															value={entry.modelId}
															onChange={(event) => change(index, { modelId: event.target.value, effort: null, speed: 'normal' })}
														/>
													) : (
														<Select
															size="sm"
															aria-label={`Model for attempt ${index + 1}`}
															value={entry.modelId}
															onChange={(event) => change(index, { modelId: event.target.value, effort: null, speed: 'normal' })}
														>
															{!model && <option value={entry.modelId}>{entry.modelId || 'Choose a model'}</option>}
															{endpoint?.models.map((item) => (
																<option key={item.id} value={item.id}>
																	{item.label}
																</option>
															))}
														</Select>
													)}
												</FormControl>
												<Flex gap={2} wrap="wrap">
													{!!model?.efforts.length && (
														<Select
															flex="1"
															minW="140px"
															size="sm"
															aria-label={`Reasoning effort for attempt ${index + 1}`}
															value={entry.effort ?? ''}
															onChange={(event) => change(index, { effort: event.target.value || null })}
														>
															<option value="">Default effort</option>
															{model.efforts.map((effort) => (
																<option key={effort} value={effort}>
																	{effort}
																</option>
															))}
														</Select>
													)}
													{model?.speeds.includes('fast') && (
														<Select
															flex="1"
															minW="140px"
															size="sm"
															aria-label={`Speed for attempt ${index + 1}`}
															value={entry.speed}
															onChange={(event) => change(index, { speed: event.target.value as 'normal' | 'fast' })}
														>
															<option value="normal">Normal speed</option>
															<option value="fast">Fast speed</option>
														</Select>
													)}
												</Flex>
												{endpoint?.hint && (
													<Text fontSize="xs" mt={2}>
														{endpoint.hint}
													</Text>
												)}
											</Box>
										);
									})}
								</Flex>
								<Button mt={3} size="sm" onClick={add} isDisabled={!endpoints.length || entries.length >= maxEntries}>
									Add fallback
								</Button>
							</>
						)}
						{error && (
							<Text role="alert" color="red.600" mt={3}>
								{error}
							</Text>
						)}
					</fieldset>
				</ModalBody>
				<ModalFooter gap={2} flexDirection="column" alignItems="stretch">
					{library && !inherit && (
						<Flex gap={2} justify="flex-end" wrap="wrap">
							<Button size="sm" isDisabled={saving || !name.trim()} onClick={() => void save(false)}>
								Save waterfall
							</Button>
							{selected && (
								<Button size="sm" variant="outline" isDisabled={saving || !name.trim()} onClick={() => void save(false, true)}>
									Save as new
								</Button>
							)}
						</Flex>
					)}
					<Flex gap={2} justify="flex-end" wrap="wrap">
						<Button size="sm" variant="ghost" isDisabled={saving} onClick={onClose}>
							Cancel
						</Button>
						<Button
							size="sm"
							isDisabled={saving}
							onClick={() => {
								if (applyLabel !== 'Apply waterfall') {
									onClose();
									return;
								}
								try {
									if (!inherit && entries.length > maxEntries) throw new TypeError(`Choose up to ${maxEntries} AI attempts.`);
									const config = inherit ? null : validateAiWaterfallSelection({ version: 1, entries }, endpoints);
									onApply(config);
									onClose();
								} catch (cause) {
									setError(cause instanceof Error ? cause.message : 'Check your selection.');
								}
							}}
						>
							{applyLabel}
						</Button>
						{library && !inherit && applyLabel === 'Apply waterfall' && (
							<Button size="sm" colorScheme="purple" isDisabled={saving || !name.trim()} onClick={() => void save(true)}>
								Save &amp; apply
							</Button>
						)}
					</Flex>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
