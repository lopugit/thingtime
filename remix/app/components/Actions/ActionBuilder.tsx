import React from 'react';
import { Box, Button, Checkbox, Flex, Input, Select, Stack, Text, Textarea } from '@chakra-ui/react';
import { Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { CARD_STYLES } from '~/theme/card';
import { ACTION_INPUT_TYPES, ACTION_STEP_OPS } from '~/schemas/registry';
import { ActionChip } from './ActionChip';
import { coerceInputDefault, coerceValueText, deriveRequiredCapabilities, displayRef } from './actionInspect';

// Form-driven action authoring. The design rule that matters: capabilities
// are DERIVED from the steps (deriveRequiredCapabilities) and shown for
// review, never hand-typed — a UI-authored action cannot declare less than
// it does. Optional scope narrowing edits the derived entries; the save-time
// coverage check in registry.ts remains the real gate and its error message
// surfaces verbatim through the Lopu toast when a narrowed scope no longer
// covers a step.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const monoLabel = {
	color: MUTED,
	fontFamily: 'var(--tt-font-mono, monospace)',
	fontSize: '11px',
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const
};

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);

type InputRow = { name: string; type: string; required: boolean; default: string };
type ValueRow = { key: string; value: string };
type StepRow = { op: string; schema: string; id: string; action: string; limit: string; values: ValueRow[] };

const emptyStep = (op = 'things.create'): StepRow => ({ op, schema: '', id: '', action: '', limit: '', values: [{ key: '', value: '' }] });

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
	<Text color="var(--tt-text, #33333c)" fontSize="xs" fontWeight="600" mb={1}>
		{children}
	</Text>
);

const rowInput = { size: 'sm' as const, background: 'var(--tt-card, #ffffff)' };

export const ActionBuilder = ({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string) => void }) => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const lopuRef = React.useRef(lopu);
	lopuRef.current = lopu;
	const navigate = useNavigate();

	const [name, setName] = React.useState('');
	const [keyTouched, setKeyTouched] = React.useState(false);
	const [actionKey, setActionKey] = React.useState('');
	const [description, setDescription] = React.useState('');
	const [category, setCategory] = React.useState('');
	const [inputs, setInputs] = React.useState<InputRow[]>([]);
	const [steps, setSteps] = React.useState<StepRow[]>([emptyStep()]);
	const [addReturn, setAddReturn] = React.useState(true);
	const [scopeEdits, setScopeEdits] = React.useState<Record<string, string>>({});
	const [saving, setSaving] = React.useState(false);
	const [schemaNames, setSchemaNames] = React.useState<Record<string, string>>({});
	const [ownSchemas, setOwnSchemas] = React.useState<{ id: string; name: string }[]>([]);

	// schema datalist: the author's own schema things (id + name), one fetch
	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response = await apiRef.current.v1.things.list({ thingtime: 'schema', limit: 100 });
				if (cancelled) return;
				const list = (response?.things || [])
					.map((thing: { id: string; crystal?: { name?: string } }) => ({ id: thing.id, name: String(thing.crystal?.name || '') }))
					.filter((entry: { name: string }) => entry.name);
				setOwnSchemas(list);
				setSchemaNames(Object.fromEntries(list.map((entry: { id: string; name: string }) => [entry.id, entry.name])));
			} catch {}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// assemble the crystal steps from the form rows (shared by preview + save)
	const builtSteps = React.useMemo(() => {
		const assembled: Record<string, unknown>[] = [];
		for (const row of steps) {
			const step: Record<string, unknown> = { op: row.op };
			if (row.op === 'things.create' || row.op === 'things.search') {
				if (row.schema.trim()) step.schema = row.schema.trim();
			}
			if (row.op === 'things.get' || row.op === 'things.update') {
				if (row.id.trim()) step.id = row.id.trim();
			}
			if (row.op === 'actions.invoke' && row.action.trim()) step.action = row.action.trim();
			if (row.op === 'things.search' && row.limit.trim()) step.limit = Number(row.limit);
			if (row.op === 'things.create' || row.op === 'things.update' || row.op === 'actions.invoke') {
				const values: Record<string, unknown> = {};
				for (const pair of row.values) {
					if (pair.key.trim()) values[pair.key.trim()] = coerceValueText(pair.value);
				}
				if (row.op === 'actions.invoke') {
					if (Object.keys(values).length) step.inputs = values;
				} else {
					step.values = values;
				}
			}
			assembled.push(step);
		}
		if (addReturn && assembled.length && assembled[assembled.length - 1].op !== 'return') {
			assembled.push({ op: 'return', value: `$step.${assembled.length}` });
		}
		return assembled;
	}, [steps, addReturn]);

	// derived capabilities + author narrowing (scope edits keyed by capability)
	const capabilities = React.useMemo(() => {
		const derived = deriveRequiredCapabilities(builtSteps);
		return derived.map((entry) => {
			const edit = scopeEdits[entry.capability];
			if (edit === undefined) return entry;
			const schemas = edit
				.split(',')
				.map((ref) => ref.trim())
				.filter(Boolean);
			return { ...entry, ...(schemas.length ? { schemas } : {}) };
		});
	}, [builtSteps, scopeEdits]);

	const save = React.useCallback(async () => {
		setSaving(true);
		try {
			const crystal: Record<string, unknown> = { name: name.trim() };
			if (description.trim()) crystal.description = description.trim();
			if (actionKey.trim()) crystal.actionKey = actionKey.trim();
			if (category.trim()) crystal.category = category.trim();
			const inputDescriptors = inputs
				.filter((row) => row.name.trim())
				.map((row) => ({
					name: row.name.trim(),
					type: row.type,
					...(row.required ? { required: true } : {}),
					...(row.default.trim() ? { default: coerceInputDefault(row.default, row.type) } : {})
				}));
			if (inputDescriptors.length) crystal.inputs = inputDescriptors;
			crystal.steps = builtSteps;
			if (capabilities.length) crystal.capabilities = capabilities;
			const response = await apiRef.current.v1.things.create({ thingtime: ['action'], crystal });
			const id = response?.thing?.id;
			if (!id) throw response;
			lopuRef.current({ title: `⚡ ${crystal.name} created ✨`, status: 'success', duration: 6000 });
			onCreated?.(id);
			navigate(`/actions/${encodeURIComponent(id)}`);
		} catch (error: unknown) {
			const failure = error as { error?: string; message?: string };
			lopuRef.current({
				title: 'That action didn’t pass the program grammar 🧯',
				description: failure?.error || failure?.message || undefined,
				status: 'error'
			});
		} finally {
			setSaving(false);
		}
	}, [name, description, actionKey, category, inputs, builtSteps, capabilities, navigate, onCreated]);

	return (
		<Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
			<Flex align="center" justify="space-between" mb={4}>
				<Text {...monoLabel}>New action</Text>
				<Button leftIcon={<X size={13} />} onClick={onClose} size="xs" variant="ghost">
					Close
				</Button>
			</Flex>

			<Stack spacing={4}>
				<Flex gap={3} wrap="wrap">
					<Box flex="1" minW="220px">
						<FieldLabel>Name *</FieldLabel>
						<Input
							{...rowInput}
							onChange={(event) => {
								setName(event.target.value);
								if (!keyTouched) setActionKey(slugify(event.target.value));
							}}
							placeholder="Send invoice"
							value={name}
						/>
					</Box>
					<Box flex="1" minW="180px">
						<FieldLabel>Action key</FieldLabel>
						<Input
							{...rowInput}
							fontFamily="var(--tt-font-mono, monospace)"
							onChange={(event) => {
								setKeyTouched(true);
								setActionKey(slugify(event.target.value));
							}}
							placeholder="send-invoice"
							value={actionKey}
						/>
					</Box>
					<Box flex="1" minW="140px">
						<FieldLabel>Category</FieldLabel>
						<Input {...rowInput} onChange={(event) => setCategory(event.target.value)} placeholder="invoices" value={category} />
					</Box>
				</Flex>
				<Box>
					<FieldLabel>Description</FieldLabel>
					<Textarea
						{...rowInput}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="What this action does and when to run it."
						rows={2}
						value={description}
					/>
				</Box>

				<Box>
					<Flex align="center" justify="space-between" mb={2}>
						<Text {...monoLabel}>Takes (typed inputs)</Text>
						<Button
							leftIcon={<Plus size={12} />}
							onClick={() => setInputs((prior) => [...prior, { name: '', type: 'string', required: false, default: '' }])}
							size="xs"
							variant="ghost"
						>
							Input
						</Button>
					</Flex>
					<Stack spacing={2}>
						{inputs.map((row, index) => (
							<Flex align="center" gap={2} key={index} wrap="wrap">
								<Input
									{...rowInput}
									maxW="160px"
									onChange={(event) => setInputs((prior) => prior.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)))}
									placeholder="name"
									value={row.name}
								/>
								<Select
									{...rowInput}
									maxW="110px"
									onChange={(event) => setInputs((prior) => prior.map((entry, i) => (i === index ? { ...entry, type: event.target.value } : entry)))}
									value={row.type}
								>
									{ACTION_INPUT_TYPES.map((type) => (
										<option key={type} value={type}>
											{type}
										</option>
									))}
								</Select>
								<Input
									{...rowInput}
									maxW="160px"
									onChange={(event) => setInputs((prior) => prior.map((entry, i) => (i === index ? { ...entry, default: event.target.value } : entry)))}
									placeholder="default"
									value={row.default}
								/>
								<Checkbox
									isChecked={row.required}
									onChange={(event) => setInputs((prior) => prior.map((entry, i) => (i === index ? { ...entry, required: event.target.checked } : entry)))}
									size="sm"
								>
									<Text fontSize="xs">required</Text>
								</Checkbox>
								<Button aria-label="Remove input" onClick={() => setInputs((prior) => prior.filter((_, i) => i !== index))} size="xs" variant="ghost">
									<Trash2 size={12} />
								</Button>
							</Flex>
						))}
						{!inputs.length ? (
							<Text color={MUTED} fontSize="xs">
								No inputs — the action runs parameterless.
							</Text>
						) : null}
					</Stack>
				</Box>

				<Box>
					<Flex align="center" justify="space-between" mb={2}>
						<Text {...monoLabel}>Does (steps)</Text>
						<Button leftIcon={<Plus size={12} />} onClick={() => setSteps((prior) => [...prior, emptyStep()])} size="xs" variant="ghost">
							Step
						</Button>
					</Flex>
					<Stack spacing={3}>
						{steps.map((row, index) => (
							<Box background="var(--tt-surface-alt, #f5f5f7)" borderRadius="var(--tt-radius-md, 12px)" key={index} p={3}>
								<Flex align="center" gap={2} mb={2} wrap="wrap">
									<Text color={MUTED} fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" minW="20px">
										{index + 1}
									</Text>
									<Select
										{...rowInput}
										maxW="180px"
										onChange={(event) => setSteps((prior) => prior.map((entry, i) => (i === index ? { ...emptyStep(event.target.value), values: entry.values } : entry)))}
										value={row.op}
									>
										{ACTION_STEP_OPS.filter((op) => op !== 'return').map((op) => (
											<option key={op} value={op}>
												{op}
											</option>
										))}
									</Select>
									{(row.op === 'things.create' || row.op === 'things.search') ? (
										<>
											<Input
												{...rowInput}
												list="tt-action-builder-schemas"
												maxW="220px"
												onChange={(event) => setSteps((prior) => prior.map((entry, i) => (i === index ? { ...entry, schema: event.target.value } : entry)))}
												placeholder={row.op === 'things.create' ? 'schema (id or your schema name)' : 'schema (optional)'}
												value={row.schema}
											/>
											{row.schema && schemaNames[row.schema] ? (
												<ActionChip dot={false} size="sm">
													{schemaNames[row.schema]}
												</ActionChip>
											) : null}
										</>
									) : null}
									{(row.op === 'things.get' || row.op === 'things.update') ? (
										<Input
											{...rowInput}
											maxW="220px"
											onChange={(event) => setSteps((prior) => prior.map((entry, i) => (i === index ? { ...entry, id: event.target.value } : entry)))}
											placeholder="id ($input.x or $step.1.id)"
											value={row.id}
										/>
									) : null}
									{row.op === 'actions.invoke' ? (
										<Input
											{...rowInput}
											maxW="220px"
											onChange={(event) => setSteps((prior) => prior.map((entry, i) => (i === index ? { ...entry, action: event.target.value } : entry)))}
											placeholder="action key or id"
											value={row.action}
										/>
									) : null}
									{row.op === 'things.search' ? (
										<Input
											{...rowInput}
											maxW="90px"
											onChange={(event) => setSteps((prior) => prior.map((entry, i) => (i === index ? { ...entry, limit: event.target.value } : entry)))}
											placeholder="limit"
											type="number"
											value={row.limit}
										/>
									) : null}
									<Button
										aria-label="Remove step"
										ml="auto"
										onClick={() => setSteps((prior) => prior.filter((_, i) => i !== index))}
										size="xs"
										variant="ghost"
									>
										<Trash2 size={12} />
									</Button>
								</Flex>
								{row.op === 'things.create' || row.op === 'things.update' || row.op === 'actions.invoke' ? (
									<Stack spacing={1.5}>
										{row.values.map((pair, pairIndex) => (
											<Flex align="center" gap={2} key={pairIndex}>
												<Input
													{...rowInput}
													maxW="160px"
													onChange={(event) =>
														setSteps((prior) =>
															prior.map((entry, i) =>
																i === index
																	? { ...entry, values: entry.values.map((v, vi) => (vi === pairIndex ? { ...v, key: event.target.value } : v)) }
																	: entry
															)
														)
													}
													placeholder={row.op === 'actions.invoke' ? 'input name' : 'field'}
													value={pair.key}
												/>
												<Input
													{...rowInput}
													onChange={(event) =>
														setSteps((prior) =>
															prior.map((entry, i) =>
																i === index
																	? { ...entry, values: entry.values.map((v, vi) => (vi === pairIndex ? { ...v, value: event.target.value } : v)) }
																	: entry
															)
														)
													}
													placeholder="value, $input.name, $step.1.id, $now, or $$literal"
													value={pair.value}
												/>
											</Flex>
										))}
										<Button
											alignSelf="flex-start"
											leftIcon={<Plus size={11} />}
											onClick={() =>
												setSteps((prior) => prior.map((entry, i) => (i === index ? { ...entry, values: [...entry.values, { key: '', value: '' }] } : entry)))
											}
											size="xs"
											variant="ghost"
										>
											{row.op === 'actions.invoke' ? 'Input' : 'Field'}
										</Button>
									</Stack>
								) : null}
							</Box>
						))}
					</Stack>
					<datalist id="tt-action-builder-schemas">
						{ownSchemas.map((schema) => (
							<option key={schema.id} label={schema.name} value={schema.id} />
						))}
					</datalist>
					<Checkbox isChecked={addReturn} mt={2} onChange={(event) => setAddReturn(event.target.checked)} size="sm">
						<Text fontSize="xs">Return the last step’s result</Text>
					</Checkbox>
				</Box>

				<Box>
					<Text {...monoLabel} mb={2}>
						Can access (derived from the steps)
					</Text>
					<Stack spacing={2}>
						{capabilities.length ? (
							capabilities.map((entry) => (
								<Flex align="center" gap={2} key={entry.capability} wrap="wrap">
									<ActionChip size="md" tone="ok">
										{entry.capability}
										{entry.schemas?.length ? `: ${entry.schemas.map((ref) => displayRef(ref, schemaNames)).join(', ')}` : ''}
										{entry.actions?.length ? `: ${entry.actions.join(', ')}` : ''}
									</ActionChip>
									{entry.capability !== 'actions.invoke' ? (
										<Input
											{...rowInput}
											maxW="320px"
											onChange={(event) => setScopeEdits((prior) => ({ ...prior, [entry.capability]: event.target.value }))}
											placeholder="narrow to schemas (comma-separated ids/names)"
											value={scopeEdits[entry.capability] ?? (entry.schemas || []).join(', ')}
										/>
									) : null}
								</Flex>
							))
						) : (
							<Text color={MUTED} fontSize="xs">
								Nothing yet — add a step and its minimal capability appears here. The declaration always covers exactly what the steps do.
							</Text>
						)}
					</Stack>
				</Box>

				<Flex gap={2} justify="flex-end">
					<Button onClick={onClose} size="sm" variant="ghost">
						Cancel
					</Button>
					<Button colorScheme="pink" isDisabled={!name.trim() || !builtSteps.length} isLoading={saving} onClick={save} size="sm">
						Create action
					</Button>
				</Flex>
			</Stack>
		</Box>
	);
};
