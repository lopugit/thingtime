import React from 'react';
import { Box, Button, Flex, Heading, Input, Select, Text } from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { VaultReveal } from '~/components/Settings/VaultReveal';
import type { EnvironmentEntry } from '~/api/utils/admin/systemEnvironment';

type Snapshot = { configured: boolean; entries: EnvironmentEntry[] };
export const SystemEnvironment = () => {
	const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
	const [key, setKey] = React.useState('');
	const [value, setValue] = React.useState('');
	const [target, setTarget] = React.useState('preview');
	const [editing, setEditing] = React.useState<string | null>(null);
	const [replacement, setReplacement] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [message, setMessage] = React.useState('');
	const [error, setError] = React.useState('');
	const request = React.useCallback(async (body?: Record<string, unknown>, signal?: AbortSignal) => {
		await requireThingtimeCapability('api.admin-system-environment', '1.0.0');
		const response = await fetch('/api/v1/admin/system/environment', {
			method: body ? 'POST' : 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			signal,
			...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
		});
		const result = await response.json();
		if (!response.ok || !result.ok) throw new Error('Environment request failed. Refresh to check the current state before retrying.');
		return result;
	}, []);
	React.useEffect(() => {
		const controller = new AbortController();
		request(undefined, controller.signal)
			.then((result) => {
				if (!controller.signal.aborted) setSnapshot(result);
			})
			.catch(() => {
				if (!controller.signal.aborted) setError('Could not load deployment environment metadata.');
			});
		return () => controller.abort();
	}, [request]);
	const mutate = async (body: Record<string, unknown>) => {
		if (busy) return;
		setBusy(true);
		setError('');
		setMessage('');
		try {
			setSnapshot(await request(body));
			setValue('');
			setReplacement('');
			setEditing(null);
			setKey('');
			setMessage('Saved. Redeploy the affected environment to apply this change.');
		} catch {
			setError('Environment change could not be confirmed. Refresh before retrying.');
		} finally {
			setBusy(false);
		}
	};
	return (
		<Box border="1px solid var(--tt-border, #e7e7eb)" borderRadius="12px" p={4} mt={4}>
			<Heading size="sm">Deployment environment variables</Heading>
			<Text fontSize="sm" opacity={0.65} mt={2}>
				Thingtime’s Vercel project, including production, preview and development. Changes apply on the next deployment. Values marked sensitive by
				Vercel can be replaced but cannot be shown.
			</Text>
			{snapshot?.configured === false ? (
				<Text mt={3}>Connect Vercel in the platform credentials above and configure this server’s Vercel project to manage its variables here.</Text>
			) : null}
			{error ? (
				<Text role="alert" color="red.600" mt={3}>
					{error}
				</Text>
			) : null}
			{message ? (
				<Text role="status" mt={3}>
					{message}
				</Text>
			) : null}
			<Button
				size="sm"
				variant="ghost"
				mt={2}
				isDisabled={busy}
				onClick={async () => {
					try {
						setSnapshot(await request());
						setError('');
					} catch {
						setError('Could not refresh environment metadata.');
					}
				}}
			>
				Refresh variables
			</Button>
			<Flex direction="column" gap={2} mt={3}>
				{(snapshot?.entries || []).map((entry) => (
					<Box key={entry.id} p={3} border="1px solid var(--tt-border, #e7e7eb)" borderRadius="8px">
						<Flex gap={2} align="center" wrap="wrap">
							<Box flex={{ base: '1 0 100%', md: '1' }} minW={0} overflowWrap="anywhere">
								<Text fontWeight={600} fontSize="sm">
									{entry.key}
								</Text>
								<Text fontSize="xs" opacity={0.6}>
									{entry.target.join(', ')}
									{entry.gitBranch ? ` · ${entry.gitBranch}` : ''} · {entry.type}
								</Text>
							</Box>
							<Flex gap={1} wrap="wrap">
								{entry.revealable ? (
									<VaultReveal vault="deployment" id={entry.id} label={entry.key} />
								) : (
									<Text fontSize="xs" alignSelf="center">
										Write-only
									</Text>
								)}
								<Button
									size="sm"
									variant="ghost"
									isDisabled={busy}
									onClick={() => {
										setEditing(editing === entry.id ? null : entry.id);
										setReplacement('');
									}}
								>
									Replace
								</Button>
								<Button
									size="sm"
									variant="ghost"
									isDisabled={busy}
									onClick={() => {
										if (
											window.confirm(
												`Delete ${entry.key} from ${entry.target.join(', ')}${
													entry.gitBranch ? ` (${entry.gitBranch})` : ''
												}? This takes effect after redeployment.`
											)
										)
											void mutate({ action: 'delete', id: entry.id });
									}}
								>
									Delete
								</Button>
							</Flex>
						</Flex>
						{editing === entry.id ? (
							<Flex mt={3} gap={2} wrap="wrap">
								<Input
									flex="1"
									minW="160px"
									type="password"
									autoComplete="new-password"
									aria-label={`Replacement for ${entry.key}`}
									value={replacement}
									onChange={(event) => setReplacement(event.target.value)}
								/>
								<Button isDisabled={busy} onClick={() => void mutate({ action: 'rotate', id: entry.id, value: replacement })}>
									Save replacement
								</Button>
							</Flex>
						) : null}
					</Box>
				))}
			</Flex>
			<Flex direction={{ base: 'column', md: 'row' }} gap={2} mt={4}>
				<Input aria-label="Environment key" placeholder="SERVICE_TOKEN" value={key} onChange={(event) => setKey(event.target.value)} />
				<Input
					aria-label="Environment value"
					type="password"
					autoComplete="new-password"
					placeholder="Value"
					value={value}
					onChange={(event) => setValue(event.target.value)}
				/>
				<Select aria-label="Deployment environment" value={target} onChange={(event) => setTarget(event.target.value)}>
					<option value="preview">Preview</option>
					<option value="production">Production</option>
					<option value="development">Development</option>
				</Select>
				<Button
					flexShrink={0}
					isDisabled={!snapshot?.configured || !key.trim() || busy}
					onClick={() => void mutate({ action: 'create', key: key.trim(), value, target })}
				>
					Add variable
				</Button>
			</Flex>
		</Box>
	);
};
