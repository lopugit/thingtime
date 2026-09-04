import React from 'react';
import { Box, Button, Checkbox, Flex, Input, Select, Spinner, Text } from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { CARD_STYLES } from '~/theme/card';

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

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const eyebrow = {
	fontFamily: MONO,
	fontSize: '10px',
	fontWeight: 600,
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const,
	color: 'var(--tt-muted, #9a9aa6)'
};

// Status dot colors for the endpoint write-mode chip (house pattern: token
// dot + mono uppercase label).
const WRITE_MODE_DOT: Record<EndpointRow['writeMode'], string> = {
	none: 'var(--tt-faint, #b6b6c0)',
	'create-only': 'var(--tt-positive, #2f8f4f)',
	write: 'var(--tt-warning, #ffbc48)'
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
			<Flex flexDirection="column" rowGap={2} padding={4} {...CARD_STYLES}>
				<Text sx={eyebrow}>External integrations</Text>
				<Text fontSize="xs" color="var(--tt-text, #5a5a66)" lineHeight="tall">
					Credentials are write-only. The proxy only calls saved HTTPS origins and paths, and applies the permissions below before it decrypts a
					credential.
				</Text>
				{vaultConfigured === false ? (
					<Box
						padding={3}
						borderRadius="var(--tt-radius-sm, 9px)"
						background="rgba(255, 188, 72, 0.14)"
						border="1px solid"
						borderColor="rgba(255, 188, 72, 0.45)"
					>
						<Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
							Vault is not configured
						</Text>
						<Text fontSize="xs" color="var(--tt-text, #5a5a66)">
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
			</Flex>

			<Flex flexDirection="column" rowGap={2} padding={4} {...CARD_STYLES}>
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
									<Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)" noOfLines={1}>
										{secret.label}
									</Text>
									<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
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
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
							No credentials stored yet.
						</Text>
					)}
				</Flex>
			</Flex>

			<Flex flexDirection="column" rowGap={2} padding={4} {...CARD_STYLES}>
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
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
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
									<Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)" noOfLines={1}>
										{endpoint.label}
									</Text>
									<Text fontFamily={MONO} fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={1}>
										{endpoint.origin} · {endpoint.allowRead ? 'read' : 'no read'} · {endpoint.writeMode}
									</Text>
								</Box>
								<Flex alignItems="center" columnGap={1.5} flexShrink={0}>
									<Box width="7px" height="7px" borderRadius="2px" background={WRITE_MODE_DOT[endpoint.writeMode]} />
									<Text
										fontFamily={MONO}
										fontSize="10px"
										fontWeight={600}
										letterSpacing="0.06em"
										textTransform="uppercase"
										color="var(--tt-muted, #9a9aa6)"
									>
										{endpoint.writeMode}
									</Text>
								</Flex>
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
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
							No endpoint policies saved yet.
						</Text>
					)}
				</Flex>
			</Flex>

			{createOnlyVercelEndpoints.length ? (
				<Flex flexDirection="column" rowGap={2} padding={4} {...CARD_STYLES}>
					<Text sx={eyebrow}>Create a new Vercel environment variable</Text>
					<Flex
						flexDirection="column"
						rowGap={2}
						padding={3}
						borderRadius="var(--tt-radius-sm, 9px)"
						background="var(--tt-positive-soft, rgba(88, 202, 112, 0.14))"
					>
						<Text fontSize="xs" color="var(--tt-text, #5a5a66)">
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
				</Flex>
			) : null}

			<Flex flexDirection="column" rowGap={2} padding={4} {...CARD_STYLES}>
				<Text sx={eyebrow}>Recent proxy activity</Text>
				{audit.length ? (
					<Flex flexDirection="column" rowGap={1}>
						{audit.slice(0, 12).map((row) => (
							<Text key={row.id} fontFamily={MONO} fontSize="xs" color="var(--tt-text, #5a5a66)">
								{new Date(row.createdAt).toLocaleString()} · {row.operation.toUpperCase()} {row.path} · {row.status} · {row.outcome}
							</Text>
						))}
					</Flex>
				) : (
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
						No proxied calls yet.
					</Text>
				)}
			</Flex>
		</Flex>
	);
};
