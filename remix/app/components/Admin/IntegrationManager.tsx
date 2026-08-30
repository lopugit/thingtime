import React from 'react';
import { Badge, Box, Button, Checkbox, Divider, Flex, Input, Select, Spinner, Text } from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';

type SecretRow = { id: string; label: string; createdAt: string };
type EndpointRow = {
	id: string;
	label: string;
	provider: 'vercel' | 'generic';
	origin: string;
	secretId: string;
	allowedPathPrefixes: string[];
	allowRead: boolean;
	writeMode: 'none' | 'create-only' | 'write';
};
type AuditRow = { id: string; endpointId: string; operation: string; path: string; status: number; outcome: string; createdAt: string };
type VercelEnvironmentDraft = {
	endpointId: string;
	project: string;
	key: string;
	value: string;
	target: 'production' | 'preview' | 'development';
	teamId: string;
};

const eyebrow = {
	fontSize: '10px',
	fontWeight: 600,
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const,
	opacity: 0.45
};

const emptyEndpoint = (): Omit<EndpointRow, 'id'> => ({
	label: '',
	provider: 'vercel',
	origin: 'https://api.vercel.com',
	secretId: '',
	allowedPathPrefixes: ['/v9/projects', '/v10/projects'],
	allowRead: true,
	writeMode: 'create-only'
});

// Values are intentionally held in this one local input only until the
// write-only create request resolves. They are never loaded from API state.
export const IntegrationManager = () => {
	const api = useApi();
	const lopu = useLopu();
	const [vaultConfigured, setVaultConfigured] = React.useState<boolean | null>(null);
	const [secrets, setSecrets] = React.useState<SecretRow[]>([]);
	const [endpoints, setEndpoints] = React.useState<EndpointRow[]>([]);
	const [audit, setAudit] = React.useState<AuditRow[]>([]);
	const [secretLabel, setSecretLabel] = React.useState('');
	const [secretValue, setSecretValue] = React.useState('');
	const [draft, setDraft] = React.useState<Omit<EndpointRow, 'id'>>(emptyEndpoint);
	const [editingId, setEditingId] = React.useState<string | null>(null);
	const [vercelEnvironment, setVercelEnvironment] = React.useState<VercelEnvironmentDraft>({
		endpointId: '',
		project: '',
		key: '',
		value: '',
		target: 'production',
		teamId: ''
	});
	const [busy, setBusy] = React.useState<string | null>(null);
	const apiRef = React.useRef(api);
	apiRef.current = api;

	const refresh = React.useCallback(async () => {
		try {
			const response: any = await apiRef.current.v1.admin.integrations();
			if (!response?.ok) return;
			setVaultConfigured(response.vaultConfigured === true);
			setSecrets(response.secrets || []);
			setEndpoints(response.endpoints || []);
			setAudit(response.audit || []);
		} catch {
			// Preserve the last known safe metadata if the admin request fails.
		}
	}, []);

	React.useEffect(() => {
		refresh();
	}, [refresh]);

	const action = async (key: string, payload: Record<string, unknown>, success: string) => {
		setBusy(key);
		try {
			const response: any = await apiRef.current.v1.admin.integrationAction(payload);
			if (!response?.ok) throw new Error(response?.error || 'Integration action failed.');
			lopu({ title: success, status: 'success', duration: 4500 });
			await refresh();
			return response;
		} catch (error: any) {
			lopu({ title: 'Could not update integration policy', description: error?.error || error?.message, status: 'error' });
			return null;
		} finally {
			setBusy(null);
		}
	};

	const createSecret = async () => {
		const response = await action('secret', { action: 'create-secret', label: secretLabel, value: secretValue }, 'Write-only secret saved ✨');
		if (response) {
			setSecretLabel('');
			setSecretValue('');
		}
	};

	const saveEndpoint = async () => {
		const response = await action(
			'endpoint',
			{ action: 'save-endpoint', endpoint: editingId ? { ...draft, id: editingId } : draft },
			editingId ? 'Endpoint policy updated ✨' : 'Endpoint policy saved ✨'
		);
		if (response) {
			setDraft(emptyEndpoint());
			setEditingId(null);
		}
	};

	const editEndpoint = (endpoint: EndpointRow) => {
		setEditingId(endpoint.id);
		setDraft({
			label: endpoint.label,
			provider: endpoint.provider,
			origin: endpoint.origin,
			secretId: endpoint.secretId,
			allowedPathPrefixes: endpoint.allowedPathPrefixes,
			allowRead: endpoint.allowRead,
			writeMode: endpoint.writeMode
		});
	};

	const createVercelEnvironment = async () => {
		const endpoint = endpoints.find((item) => item.id === vercelEnvironment.endpointId);
		if (!endpoint || endpoint.provider !== 'vercel' || endpoint.writeMode !== 'create-only') return;
		const query = vercelEnvironment.teamId ? { teamId: vercelEnvironment.teamId } : undefined;
		const response = await action(
			'vercel-create',
			{
				action: 'proxy',
				endpointId: endpoint.id,
				operation: 'create',
				path: `/v10/projects/${encodeURIComponent(vercelEnvironment.project)}/env`,
				query,
				body: {
					key: vercelEnvironment.key,
					value: vercelEnvironment.value,
					target: [vercelEnvironment.target],
					type: 'sensitive'
				}
			},
			'New Vercel environment variable created ✨'
		);
		if (response) setVercelEnvironment((previous) => ({ ...previous, key: '', value: '' }));
	};

	const createOnlyVercelEndpoints = endpoints.filter((endpoint) => endpoint.provider === 'vercel' && endpoint.writeMode === 'create-only');

	return (
		<Flex flexDirection="column" rowGap={3}>
			<Text sx={eyebrow}>External integrations</Text>
			<Text fontSize="xs" opacity={0.7} lineHeight="tall">
				Credentials are write-only. The proxy only calls saved HTTPS origins and paths, and applies the permissions below before it decrypts a
				credential.
			</Text>
			{vaultConfigured === false ? (
				<Box padding={3} borderRadius="var(--tt-radius-sm, 9px)" background="orange.50" border="1px solid" borderColor="orange.200">
					<Text fontSize="sm" fontWeight={600}>
						Vault is not configured
					</Text>
					<Text fontSize="xs" opacity={0.75}>
						Set a distinct 32-byte base64url <code>THINGTIME_ADMIN_VAULT_KEY</code> server secret before saving credentials. It must not reuse a JWT,
						peer, or cron secret.
					</Text>
				</Box>
			) : null}
			{vaultConfigured === null ? (
				<Flex justifyContent="center">
					<Spinner size="sm" />
				</Flex>
			) : null}

			<Divider />
			<Text sx={eyebrow}>Write-only secrets</Text>
			<Flex columnGap={2} rowGap={2} flexWrap="wrap">
				<Input
					size="sm"
					flex="1 1 160px"
					value={secretLabel}
					onChange={(event) => setSecretLabel(event.target.value)}
					placeholder="Label, e.g. Vercel token"
					aria-label="Secret label"
				/>
				<Input
					size="sm"
					flex="1 1 180px"
					type="password"
					value={secretValue}
					onChange={(event) => setSecretValue(event.target.value)}
					placeholder="Secret value (never shown again)"
					aria-label="Secret value"
					autoComplete="off"
				/>
				<Button size="sm" isLoading={busy === 'secret'} isDisabled={!vaultConfigured || !secretLabel || !secretValue} onClick={createSecret}>
					Save secret
				</Button>
			</Flex>
			<Flex flexDirection="column" rowGap={1}>
				{secrets.length ? (
					secrets.map((secret) => (
						<Flex
							key={secret.id}
							alignItems="center"
							padding={2}
							columnGap={2}
							borderRadius="var(--tt-radius-sm, 9px)"
							background="var(--tt-surface-alt, #f5f5f7)"
						>
							<Box minWidth={0} flex="1">
								<Text fontSize="sm" fontWeight={600} noOfLines={1}>
									{secret.label}
								</Text>
								<Text fontSize="xs" opacity={0.6}>
									write-only · {new Date(secret.createdAt).toLocaleDateString()}
								</Text>
							</Box>
							<Button
								size="xs"
								variant="outline"
								isLoading={busy === secret.id}
								onClick={() => action(secret.id, { action: 'delete-secret', id: secret.id }, 'Secret deleted')}
							>
								Delete
							</Button>
						</Flex>
					))
				) : (
					<Text fontSize="xs" opacity={0.6}>
						No credentials stored yet.
					</Text>
				)}
			</Flex>

			<Divider />
			<Text sx={eyebrow}>{editingId ? 'Edit endpoint permissions' : 'Endpoint permissions'}</Text>
			<Flex flexDirection="column" rowGap={2} padding={3} borderRadius="var(--tt-radius-sm, 9px)" background="var(--tt-surface-alt, #f5f5f7)">
				<Flex columnGap={2} rowGap={2} flexWrap="wrap">
					<Input
						size="sm"
						flex="1 1 190px"
						value={draft.label}
						onChange={(event) => setDraft((previous) => ({ ...previous, label: event.target.value }))}
						placeholder="Endpoint label"
						aria-label="Endpoint label"
					/>
					<Select
						size="sm"
						width="150px"
						value={draft.provider}
						onChange={(event) =>
							setDraft((previous) => ({
								...previous,
								provider: event.target.value as EndpointRow['provider'],
								origin: event.target.value === 'vercel' ? 'https://api.vercel.com' : previous.origin,
								writeMode: event.target.value === 'vercel' ? previous.writeMode : 'none'
							}))
						}
						aria-label="Endpoint provider"
					>
						<option value="vercel">Vercel</option>
						<option value="generic">Generic read / full write</option>
					</Select>
					<Select
						size="sm"
						flex="1 1 190px"
						value={draft.secretId}
						onChange={(event) => setDraft((previous) => ({ ...previous, secretId: event.target.value }))}
						aria-label="Endpoint secret"
					>
						<option value="">Select write-only secret…</option>
						{secrets.map((secret) => (
							<option value={secret.id} key={secret.id}>
								{secret.label}
							</option>
						))}
					</Select>
				</Flex>
				<Input
					size="sm"
					value={draft.origin}
					onChange={(event) => setDraft((previous) => ({ ...previous, origin: event.target.value }))}
					isReadOnly={draft.provider === 'vercel'}
					placeholder="https://allowed-provider.example"
					aria-label="Endpoint origin"
				/>
				<Input
					size="sm"
					value={draft.allowedPathPrefixes.join(', ')}
					onChange={(event) =>
						setDraft((previous) => ({
							...previous,
							allowedPathPrefixes: event.target.value
								.split(',')
								.map((value) => value.trim())
								.filter(Boolean)
						}))
					}
					placeholder="/v9/projects, /v10/projects"
					aria-label="Allowed path prefixes"
				/>
				<Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap">
					<Checkbox
						size="sm"
						isChecked={draft.allowRead}
						onChange={(event) => setDraft((previous) => ({ ...previous, allowRead: event.target.checked }))}
					>
						Read through proxy
					</Checkbox>
					<Select
						size="sm"
						width="210px"
						value={draft.writeMode}
						onChange={(event) => setDraft((previous) => ({ ...previous, writeMode: event.target.value as EndpointRow['writeMode'] }))}
						aria-label="Endpoint write permission"
					>
						<option value="none">No writes</option>
						<option value="create-only" disabled={draft.provider !== 'vercel'}>
							Create new items only (Vercel)
						</option>
						<option value="write">Full writes (PATCH only)</option>
					</Select>
					<Button
						marginLeft="auto"
						size="sm"
						isLoading={busy === 'endpoint'}
						isDisabled={!vaultConfigured || !draft.label || !draft.secretId}
						onClick={saveEndpoint}
					>
						{editingId ? 'Update endpoint' : 'Save endpoint'}
					</Button>
					{editingId ? (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setEditingId(null);
								setDraft(emptyEndpoint());
							}}
						>
							Cancel edit
						</Button>
					) : null}
				</Flex>
				<Text fontSize="xs" opacity={0.65}>
					Create-only checks the current Vercel project env list and never issues PATCH. Generic create-only is refused because the proxy cannot
					honestly promise conditional creation for an arbitrary provider.
				</Text>
			</Flex>
			<Flex flexDirection="column" rowGap={1}>
				{endpoints.length ? (
					endpoints.map((endpoint) => (
						<Flex
							key={endpoint.id}
							alignItems="center"
							padding={2}
							columnGap={2}
							borderRadius="var(--tt-radius-sm, 9px)"
							background="var(--tt-surface-alt, #f5f5f7)"
						>
							<Box minWidth={0} flex="1">
								<Text fontSize="sm" fontWeight={600} noOfLines={1}>
									{endpoint.label}
								</Text>
								<Text fontSize="xs" opacity={0.62} noOfLines={1}>
									{endpoint.origin} · {endpoint.allowRead ? 'read' : 'no read'} · {endpoint.writeMode}
								</Text>
							</Box>
							<Badge colorScheme={endpoint.writeMode === 'none' ? 'gray' : endpoint.writeMode === 'create-only' ? 'green' : 'orange'}>
								{endpoint.writeMode}
							</Badge>
							<Button size="xs" variant="outline" onClick={() => editEndpoint(endpoint)}>
								Edit
							</Button>
							<Button
								size="xs"
								variant="outline"
								isLoading={busy === endpoint.id}
								onClick={() => action(endpoint.id, { action: 'delete-endpoint', id: endpoint.id }, 'Endpoint deleted')}
							>
								Delete
							</Button>
						</Flex>
					))
				) : (
					<Text fontSize="xs" opacity={0.6}>
						No endpoint policies saved yet.
					</Text>
				)}
			</Flex>

			{createOnlyVercelEndpoints.length ? (
				<>
					<Divider />
					<Text sx={eyebrow}>Create a new Vercel environment variable</Text>
					<Flex flexDirection="column" rowGap={2} padding={3} borderRadius="var(--tt-radius-sm, 9px)" background="green.50">
						<Text fontSize="xs" opacity={0.72}>
							This is intentionally create-only: Thingtime checks the remote project first and never sends PATCH or an upsert request. The value is
							sent once to Vercel and is not kept in this form.
						</Text>
						<Flex columnGap={2} rowGap={2} flexWrap="wrap">
							<Select
								size="sm"
								flex="1 1 200px"
								value={vercelEnvironment.endpointId}
								onChange={(event) => setVercelEnvironment((previous) => ({ ...previous, endpointId: event.target.value }))}
								aria-label="Vercel create-only endpoint"
							>
								<option value="">Select endpoint…</option>
								{createOnlyVercelEndpoints.map((endpoint) => (
									<option value={endpoint.id} key={endpoint.id}>
										{endpoint.label}
									</option>
								))}
							</Select>
							<Input
								size="sm"
								flex="1 1 180px"
								value={vercelEnvironment.project}
								onChange={(event) => setVercelEnvironment((previous) => ({ ...previous, project: event.target.value }))}
								placeholder="Vercel project ID or name"
								aria-label="Vercel project"
							/>
						</Flex>
						<Flex columnGap={2} rowGap={2} flexWrap="wrap">
							<Input
								size="sm"
								flex="1 1 180px"
								value={vercelEnvironment.key}
								onChange={(event) => setVercelEnvironment((previous) => ({ ...previous, key: event.target.value }))}
								placeholder="Environment variable name"
								aria-label="Vercel environment variable name"
							/>
							<Input
								size="sm"
								flex="1 1 200px"
								type="password"
								value={vercelEnvironment.value}
								onChange={(event) => setVercelEnvironment((previous) => ({ ...previous, value: event.target.value }))}
								placeholder="New sensitive value"
								aria-label="Vercel environment variable value"
								autoComplete="off"
							/>
						</Flex>
						<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
							<Select
								size="sm"
								width="170px"
								value={vercelEnvironment.target}
								onChange={(event) =>
									setVercelEnvironment((previous) => ({ ...previous, target: event.target.value as VercelEnvironmentDraft['target'] }))
								}
								aria-label="Vercel environment target"
							>
								<option value="production">Production</option>
								<option value="preview">Preview</option>
								<option value="development">Development</option>
							</Select>
							<Input
								size="sm"
								flex="1 1 150px"
								value={vercelEnvironment.teamId}
								onChange={(event) => setVercelEnvironment((previous) => ({ ...previous, teamId: event.target.value }))}
								placeholder="Optional Vercel team ID"
								aria-label="Vercel team ID"
							/>
							<Button
								size="sm"
								marginLeft="auto"
								isLoading={busy === 'vercel-create'}
								isDisabled={
									!vaultConfigured ||
									!vercelEnvironment.endpointId ||
									!vercelEnvironment.project ||
									!vercelEnvironment.key ||
									!vercelEnvironment.value
								}
								onClick={createVercelEnvironment}
							>
								Create new sensitive variable
							</Button>
						</Flex>
					</Flex>
				</>
			) : null}

			<Divider />
			<Text sx={eyebrow}>Recent proxy activity</Text>
			{audit.length ? (
				<Flex flexDirection="column" rowGap={1}>
					{audit.slice(0, 12).map((row) => (
						<Text key={row.id} fontSize="xs" opacity={0.72}>
							{new Date(row.createdAt).toLocaleString()} · {row.operation.toUpperCase()} {row.path} · {row.status} · {row.outcome}
						</Text>
					))}
				</Flex>
			) : (
				<Text fontSize="xs" opacity={0.6}>
					No proxied calls yet.
				</Text>
			)}
		</Flex>
	);
};
