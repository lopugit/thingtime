import React from 'react';
import { Badge, Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';

type Group = { id: string; name: string };
type Entry = {
	id: string;
	kind: 'secret' | 'provider';
	name: string;
	groupId: string | null;
	key?: string;
	provider?: string;
	endpoint?: string;
};
type Template = { id: string; label: string; endpoint: string; tokenLabel: string };
type VaultPayload = { vaultConfigured: boolean; groups: Group[]; entries: Entry[]; providerTemplates: Template[] };

const fieldStyles = {
	background: 'var(--tt-surface-alt, #f5f5f7)',
	border: '1px solid var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const emptyVault: VaultPayload = { vaultConfigured: false, groups: [], entries: [], providerTemplates: [] };

const postVault = async (body: Record<string, unknown>) => {
	const response = await fetch('/api/v1/lopu/vault', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok || !result?.ok) throw new Error(result?.error || 'Secure Vault action failed.');
	return result;
};
export const SecureVault = () => {
	const lopu = useLopu();
	const [vault, setVault] = React.useState<VaultPayload>(emptyVault);
	const [busy, setBusy] = React.useState(false);
	const [groupName, setGroupName] = React.useState('');
	const [groupId, setGroupId] = React.useState('');
	const [secretName, setSecretName] = React.useState('');
	const [secretKey, setSecretKey] = React.useState('');
	const [secretValue, setSecretValue] = React.useState('');
	const [templateId, setTemplateId] = React.useState('openai');
	const [providerName, setProviderName] = React.useState('OpenAI');
	const [providerEndpoint, setProviderEndpoint] = React.useState('https://api.openai.com/v1');
	const [providerToken, setProviderToken] = React.useState('');

	const refresh = React.useCallback(async () => {
		const response = await fetch('/api/v1/lopu/vault', { credentials: 'include', cache: 'no-store' });
		const result = await response.json().catch(() => ({}));
		if (!response.ok || !result?.ok) throw new Error(result?.error || 'Secure Vault could not be loaded.');
		setVault(result);
		return result as VaultPayload;
	}, []);

	React.useEffect(() => {
		refresh().catch((error) => lopu({ title: 'Secure Vault unavailable', description: error.message, status: 'error' }));
	}, [lopu, refresh]);

	const run = async (body: Record<string, unknown>, success: string, clear?: () => void) => {
		setBusy(true);
		try {
			await postVault(body);
			clear?.();
			await refresh();
			lopu({ title: success, status: 'success' });
		} catch (error) {
			lopu({ title: 'Secure Vault action failed', description: error instanceof Error ? error.message : 'Please try again.', status: 'error' });
		} finally {
			setBusy(false);
		}
	};

	const selectTemplate = (id: string) => {
		setTemplateId(id);
		const selected = vault.providerTemplates.find((item) => item.id === id);
		if (!selected) {
			// the custom endpoint has no template: clear the previous vendor's
			// name/endpoint/model so a "compatible" row never points at a vendor
			// host under a vendor's name by accident
			setProviderName('Custom endpoint');
			setProviderEndpoint('');
			setProviderModel('');
			return;
		}
		setProviderName(selected.label);
		setProviderEndpoint(selected.endpoint);
	};

	const deleteEntry = (entry: Entry | Group) => run({ action: 'delete', id: entry.id }, `${entry.name} removed`);

	return (
		<Flex flexDirection="column" rowGap={5} width="100%">
			<Flex alignItems="center" gap={2} flexWrap="wrap">
				<Badge colorScheme={vault.vaultConfigured ? 'green' : 'orange'}>{vault.vaultConfigured ? 'Encryption ready' : 'Encryption not configured'}</Badge>
				<Text fontSize="xs" color="var(--tt-muted, #777783)">
					Values and AI tokens are write-only. Thingtime never sends them back to this browser.
				</Text>
			</Flex>

			<Box>
				<Text fontWeight={700} fontSize="sm" mb={2}>Environments</Text>
				<Flex gap={2} flexWrap="wrap">
					<Input {...fieldStyles} maxWidth="280px" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Production, Personal, Work…" aria-label="New vault environment" />
					<Button isLoading={busy} onClick={() => run({ action: 'create-group', name: groupName }, 'Environment created', () => setGroupName(''))}>Add environment</Button>
				</Flex>
				<Flex gap={2} mt={2} flexWrap="wrap">
					{vault.groups.map((group) => <Badge key={group.id} px={2} py={1}>{group.name} <Box as="button" ml={1} aria-label={`Delete ${group.name}`} onClick={() => deleteEntry(group)}>×</Box></Badge>)}
				</Flex>
			</Box>

			<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
				<Text fontWeight={700} fontSize="sm">AI provider connection</Text>
				<Text fontSize="xs" color="var(--tt-muted, #777783)" mb={3}>Store access here; choose the model, reasoning, and speed separately for each Lopu chat. Custom compatible hosts require the server allowlist.</Text>
				<Flex flexDirection="column" gap={2}>
					<Select {...fieldStyles} value={templateId} onChange={(event) => selectTemplate(event.target.value)} aria-label="AI provider template">
						{vault.providerTemplates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
						<option value="compatible">OpenAI-compatible custom endpoint</option>
					</Select>
					<Input {...fieldStyles} value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="Connection name" aria-label="Provider connection name" />
					<Input {...fieldStyles} value={providerEndpoint} onChange={(event) => setProviderEndpoint(event.target.value)} placeholder="https://api.example.com/v1" aria-label="Provider endpoint" />
					<Input {...fieldStyles} type="password" autoComplete="new-password" value={providerToken} onChange={(event) => setProviderToken(event.target.value)} placeholder="Provider token (write-only)" aria-label="Provider token" />
					<Select {...fieldStyles} value={groupId} onChange={(event) => setGroupId(event.target.value)} aria-label="Provider environment">
						<option value="">No environment</option>
						{vault.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
					</Select>
					<Button alignSelf="flex-start" isLoading={busy} isDisabled={!vault.vaultConfigured} onClick={() => run({ action: 'save-provider', name: providerName, provider: templateId, endpoint: providerEndpoint, token: providerToken, groupId }, 'AI provider saved', () => setProviderToken(''))}>Save provider</Button>
				</Flex>
			</Box>

			<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
				<Text fontWeight={700} fontSize="sm" mb={3}>Password / key value</Text>
				<Flex flexDirection="column" gap={2}>
					<Input {...fieldStyles} value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder="Display name" aria-label="Secret display name" />
					<Input {...fieldStyles} value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="Key, e.g. SERVICE_TOKEN" aria-label="Secret key" />
					<Input {...fieldStyles} type="password" autoComplete="new-password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Value (write-only)" aria-label="Secret value" />
					<Button alignSelf="flex-start" isLoading={busy} isDisabled={!vault.vaultConfigured} onClick={() => run({ action: 'save-secret', name: secretName, key: secretKey, value: secretValue, groupId }, 'Secret saved', () => { setSecretName(''); setSecretKey(''); setSecretValue(''); })}>Save secret</Button>
				</Flex>
			</Box>

			<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
				<Text fontWeight={700} fontSize="sm" mb={2}>Stored metadata</Text>
				{vault.entries.length === 0 ? <Text fontSize="sm" color="var(--tt-muted, #777783)">No vault entries yet.</Text> : null}
				<Flex flexDirection="column" gap={2}>
					{vault.entries.map((entry) => (
						<Flex key={entry.id} alignItems="center" gap={2} border="1px solid var(--tt-border, #ececef)" borderRadius="10px" p={3} flexWrap="wrap">
							<Box minWidth={0} flex="1">
								<Text fontSize="sm" fontWeight={700}>{entry.name}</Text>
								<Text fontSize="xs" color="var(--tt-muted, #777783)" wordBreak="break-word">{entry.kind === 'provider' ? `${entry.provider} · ${entry.endpoint}` : entry.key}</Text>
							</Box>
							<Badge>{vault.groups.find((group) => group.id === entry.groupId)?.name || 'Ungrouped'}</Badge>
							<Button size="xs" variant="ghost" onClick={() => deleteEntry(entry)}>Delete</Button>
						</Flex>
					))}
				</Flex>
			</Box>
		</Flex>
	);
};
