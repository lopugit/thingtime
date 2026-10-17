import React from 'react';
import { Badge, Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { VaultReveal } from './VaultReveal';
import { DeviceProviderVault, DeviceProviderReveal } from './DeviceProviderVault';
import type { LocalProviderVault } from '~/local-workspace/providerVault';
import { LOPU_PROVIDER_TEMPLATES } from '~/api/utils/lopu/userVaultModel';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLocation } from 'react-router';
import { isAnonymousWorkspace, subscribeWorkspaceIdentity, workspaceIdentityKey, announceLocalWorkspaceChange, LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';

type Group = { id: string; name: string; revision?: number };
type Entry = {
	id: string;
	revision?: number;
	kind: 'secret' | 'provider';
	name: string;
	groupId: string | null;
	key?: string;
	provider?: string;
	endpoint?: string;
	model?: string;
};
type TemplateModel = { id: string; label: string; audioInput?: string };
type Template = { id: string; label: string; endpoint: string; tokenLabel: string; models?: readonly TemplateModel[] };
// the model select's "type your own id" entry
const CUSTOM_MODEL = '__custom__';
type VaultPayload = { vaultConfigured: boolean; groups: Group[]; entries: Entry[]; providerTemplates: readonly Template[] };

const fieldStyles = {
	background: 'var(--tt-surface-alt, #f5f5f7)',
	border: '1px solid var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const emptyVault: VaultPayload = { vaultConfigured: false, groups: [], entries: [], providerTemplates: [] };

const postVault = async (body: Record<string, unknown>, signal: AbortSignal) => {
	await requireThingtimeCapability('api.lopu-vault', '1.2.1');
	if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
	const response = await fetch('/api/v1/lopu/vault', {
		signal,
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
 const user = useCurrentUser(), location = useLocation();
 const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, () => '');
 const key = `${identity}:${user?.id ?? ''}:${location.key}`;
 return isAnonymousWorkspace() ? <DeviceProviderVault key={key}>{vault => <SecureVaultScope localVault={vault} />}</DeviceProviderVault>
  : user && !user.temporary ? <SecureVaultScope key={key} /> : <Text>Reconnect your account to open its provider vault.</Text>;
};
export const SecureVaultScope = ({ localVault }: { localVault?: LocalProviderVault }) => {
	const lopu = useLopu();
	const [vault, setVault] = React.useState<VaultPayload>(() => localVault ? { ...emptyVault, vaultConfigured: true, providerTemplates: LOPU_PROVIDER_TEMPLATES } : emptyVault);
	const [busy, setBusy] = React.useState(false);
	const [groupName, setGroupName] = React.useState('');
	const [groupId, setGroupId] = React.useState('');
	const [secretGroupId, setSecretGroupId] = React.useState('');
	const [editingEnvironment, setEditingEnvironment] = React.useState<{ id: string; groupId: string } | null>(null);
	const [secretName, setSecretName] = React.useState('');
	const [secretKey, setSecretKey] = React.useState('');
	const [secretValue, setSecretValue] = React.useState('');
	const [templateId, setTemplateId] = React.useState('openai');
	const [providerName, setProviderName] = React.useState('OpenAI');
	const [providerEndpoint, setProviderEndpoint] = React.useState('https://api.openai.com/v1');
	// '' = the kind's first catalog model; CUSTOM_MODEL = the typed id below
	const [providerModel, setProviderModel] = React.useState('');
	const [customModel, setCustomModel] = React.useState('');
	const [providerToken, setProviderToken] = React.useState('');

	const mounted = React.useRef(false), controllers = React.useRef(new Set<AbortController>()), refreshSequence = React.useRef(0), running = React.useRef(false);
 const retry = React.useRef<{ fingerprint: string; command: Record<string, unknown> } | null>(null);
 const [error, setError] = React.useState('');
 const report = React.useCallback((reason: unknown) => {
  if (!mounted.current || (reason instanceof Error && reason.name === 'AbortError')) return;
  setError(reason instanceof Error ? reason.message : 'Secure Vault could not be loaded. Please try again.');
 }, []);
 React.useEffect(() => {
  mounted.current = true; const pending = controllers.current;
  return () => { mounted.current = false; pending.forEach(controller => controller.abort()); pending.clear(); retry.current = null; };
 }, []);
 const refresh = React.useCallback(async () => {
  if (running.current) return;
  const sequence = ++refreshSequence.current, controller = new AbortController(); controllers.current.add(controller);
  try {
   let result: VaultPayload;
   if (localVault) result = await localVault.list(controller.signal);
   else {
    const response = await fetch('/api/v1/lopu/vault', { credentials: 'include', cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error('Secure Vault could not be loaded. Please try again.');
    result = data;
   }
   if (mounted.current && !controller.signal.aborted && sequence === refreshSequence.current && !running.current) setVault(result);
  } finally { controllers.current.delete(controller); }
 }, [localVault]);
 React.useEffect(() => {
  const update = () => { void refresh().catch(report); };
  update(); window.addEventListener('focus', update);
  if (localVault) window.addEventListener(LOCAL_WORKSPACE_CHANGED, update);
  return () => { window.removeEventListener('focus', update); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, update); };
 }, [refresh, report, localVault]);
 const run = async (body: Record<string, unknown>, success: string, clear?: () => void) => {
  if (running.current) return;
  running.current = true; refreshSequence.current++; setBusy(true); setError('');
  const controller = new AbortController(); controllers.current.add(controller);
  try {
   let result;
   if (localVault) {
    // Keep one immutable operation across an uncertain completion. Never persist
    // this plaintext retry buffer or pass it through network request diagnostics.
    const fingerprint = JSON.stringify(body);
    if (retry.current?.fingerprint !== fingerprint) {
     const record = [...vault.groups, ...vault.entries].find(item => item.id === body.id);
     retry.current = { fingerprint, command: { ...body, id: body.id ?? crypto.randomUUID(), revision: record?.revision ?? 0, writeId: crypto.randomUUID() } };
    }
    result = await localVault.mutate(retry.current.command, controller.signal);
   } else result = await postVault(body, controller.signal);
   if (!mounted.current || controller.signal.aborted) return;
   retry.current = null; refreshSequence.current++;
   setVault(previous => ({ ...previous,
    groups: result.group ? [...previous.groups.filter(item => item.id !== result.group.id), result.group] : body.action === 'delete' ? previous.groups.filter(item => item.id !== body.id) : previous.groups,
    entries: result.entry ? [...previous.entries.filter(item => item.id !== result.entry.id), result.entry] : body.action === 'delete' ? previous.entries.filter(item => item.id !== body.id) : previous.entries
   }));
   clear?.(); lopu({ title: success, status: 'success' });
   if (localVault) announceLocalWorkspaceChange();
  } catch (reason) { if (localVault && (reason as { code?: string })?.code === 'VAULT_CONFLICT') retry.current = null; report(reason); }
  finally {
   controllers.current.delete(controller); running.current = false;
   if (mounted.current && !controller.signal.aborted) { setBusy(false); void refresh().catch(report); }
  }
 };

	const selectTemplate = (id: string) => {
		setTemplateId(id);
		const selected = vault.providerTemplates.find((item) => item.id === id);
		if (!selected) {
			// the custom endpoint has no template: clear the previous vendor's
			// name/endpoint/model so a "compatible" row never points at a vendor
			// host under a vendor's name by accident (a custom host must name
			// its model — there is no catalog to fall back on)
			setProviderName('Custom endpoint');
			setProviderEndpoint('');
			setProviderModel(CUSTOM_MODEL);
			setCustomModel('');
			return;
		}
		setProviderName(selected.label);
		setProviderEndpoint(selected.endpoint);
		setProviderModel('');
		setCustomModel('');
	};

	const selectedTemplate = vault.providerTemplates.find((item) => item.id === templateId) ?? null;
	const templateModels = selectedTemplate?.models ?? [];
	const modelToSave = providerModel === CUSTOM_MODEL ? customModel.trim() : providerModel;

	const deleteEntry = (entry: Entry | Group) => run({ action: 'delete', id: entry.id }, 'Vault entry removed');

	return (
		<Flex as="fieldset" disabled={busy} border={0} m={0} p={0} minWidth={0} flexDirection="column" rowGap={5} width="100%">
      <Box><Button as="a" href="/passwords">Open password manager</Button><Text mt={2} fontSize="sm">Logins, custom fields, authenticator codes and imports. Available offline with a separate device passphrase.</Text></Box>
			<Flex alignItems="center" gap={2} flexWrap="wrap">
				<Badge colorScheme={vault.vaultConfigured ? 'green' : 'orange'}>{vault.vaultConfigured ? 'Encryption ready' : 'Encryption not configured'}</Badge>
				<Text fontSize="xs" color="var(--tt-muted, #777783)">
					{localVault ? 'Encrypted on this device. Anonymous entries are never uploaded. Unlock this vault to briefly show a selected value.' : 'Values and AI tokens stay encrypted and hidden. Verify your password or passkey to briefly show one.'}
				</Text>
			</Flex>

   {localVault && <Button alignSelf="flex-start" variant="outline" onClick={() => localVault.lock()}>Lock provider vault</Button>}
   {error && <Box><Text role="alert" color="red.600">{error}</Text><Button size="sm" mt={2} isDisabled={busy} onClick={() => { setError(''); void refresh().catch(report); }}>Refresh vault</Button></Box>}
			<Box>
				<Text fontWeight={700} fontSize="sm" mb={2}>Environments</Text>
				<Flex gap={2} flexWrap="wrap">
					<Input {...fieldStyles} maxWidth="280px" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Production, Personal, Work…" aria-label="New vault environment" />
					<Button isLoading={busy} onClick={() => run({ action: 'create-group', name: groupName }, 'Environment created', () => setGroupName(''))}>Add environment</Button>
				</Flex>
				<Flex gap={2} mt={2} flexWrap="wrap">
					{vault.groups.map((group) => <Badge key={group.id} px={2} py={1} maxWidth="100%" whiteSpace="normal" overflowWrap="anywhere">{group.name} <Box as="button" ml={1} aria-label={`Delete ${group.name}`} disabled={busy} onClick={() => deleteEntry(group)}>×</Box></Badge>)}
				</Flex>
			</Box>

			<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
				<Text fontWeight={700} fontSize="sm">AI provider connection</Text>
				<Text fontSize="xs" color="var(--tt-muted, #777783)" mb={3}>Store access here. The model is optional for a listed provider (its first catalog model when blank); reasoning and speed are chosen per Lopu chat. Custom compatible hosts must name their model. Saving a connection does not contact its provider. Server use still requires the provider allowlist.</Text>
				<Flex flexDirection="column" gap={2}>
					<Select {...fieldStyles} value={templateId} onChange={(event) => selectTemplate(event.target.value)} aria-label="AI provider template">
						{vault.providerTemplates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
						<option value="compatible">OpenAI-compatible custom endpoint</option>
					</Select>
					<Input {...fieldStyles} value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="Connection name" aria-label="Provider connection name" />
					<Input {...fieldStyles} value={providerEndpoint} onChange={(event) => setProviderEndpoint(event.target.value)} placeholder="https://api.example.com/v1" aria-label="Provider endpoint" />
					{templateModels.length ? (
						<Select {...fieldStyles} value={providerModel} onChange={(event) => setProviderModel(event.target.value)} aria-label="Provider model">
							<option value="">Provider default ({templateModels[0]?.label})</option>
							{templateModels.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
									{item.audioInput === 'realtime' ? ' · realtime voice' : ''}
								</option>
							))}
							<option value={CUSTOM_MODEL}>Custom model id…</option>
						</Select>
					) : null}
					{providerModel === CUSTOM_MODEL || !templateModels.length ? (
						<Input {...fieldStyles} value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="Provider model id" aria-label="Provider model id" />
					) : null}
					<Input {...fieldStyles} type="password" autoComplete="new-password" value={providerToken} onChange={(event) => setProviderToken(event.target.value)} placeholder="Provider token (encrypted)" aria-label="Provider token" />
					<Select {...fieldStyles} value={groupId} onChange={(event) => setGroupId(event.target.value)} aria-label="Provider environment">
						<option value="">Ungrouped</option>
						{vault.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
					</Select>
					<Button alignSelf="flex-start" isLoading={busy} isDisabled={!vault.vaultConfigured} onClick={() => run({ action: 'save-provider', name: providerName, provider: templateId, endpoint: providerEndpoint, model: modelToSave, token: providerToken, groupId }, 'AI provider saved', () => setProviderToken(''))}>Save provider</Button>
				</Flex>
			</Box>

			<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
				<Text fontWeight={700} fontSize="sm" mb={3}>Password / key value</Text>
				<Flex flexDirection="column" gap={2}>
					<Input {...fieldStyles} value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder="Display name" aria-label="Secret display name" />
					<Input {...fieldStyles} value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder="Key, e.g. SERVICE_TOKEN" aria-label="Secret key" />
					<Input {...fieldStyles} type="password" autoComplete="new-password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="Value (encrypted)" aria-label="Secret value" />
					<Text as="label" htmlFor="vault-secret-environment" fontSize="sm">Environment</Text>
					<Select {...fieldStyles} id="vault-secret-environment" value={secretGroupId} onChange={(event) => setSecretGroupId(event.target.value)} aria-label="Secret environment">
						<option value="">Ungrouped</option>
						{vault.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
					</Select>
					<Button alignSelf="flex-start" isLoading={busy} isDisabled={!vault.vaultConfigured} onClick={() => run({ action: 'save-secret', name: secretName, key: secretKey, value: secretValue, groupId: secretGroupId }, 'Secret saved', () => { setSecretName(''); setSecretKey(''); setSecretValue(''); })}>Save secret</Button>
				</Flex>
			</Box>

			<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
				<Text fontWeight={700} fontSize="sm" mb={2}>Stored metadata</Text>
				{vault.entries.length === 0 ? <Text fontSize="sm" color="var(--tt-muted, #777783)">No vault entries yet.</Text> : null}
				<Flex flexDirection="column" gap={2}>
					{vault.entries.map((entry) => (
						<Flex key={entry.id} alignItems="center" gap={2} border="1px solid var(--tt-border, #ececef)" borderRadius="10px" p={3} flexWrap="wrap">
							<Box minWidth={0} flex={{ base: '1 1 100%', md: '1 1 200px' }}>
								<Text fontSize="sm" fontWeight={700} overflowWrap="anywhere">{entry.name}</Text>
								<Text fontSize="xs" color="var(--tt-muted, #777783)" wordBreak="break-word">{entry.kind === 'provider' ? [entry.provider, entry.model, entry.endpoint].filter(Boolean).join(' · ') : entry.key}</Text>
							</Box>
							{editingEnvironment?.id === entry.id ? <Flex width="100%" gap={2} flexWrap="wrap" alignItems="center">
         <Text as="label" htmlFor={`vault-env-${entry.id}`} fontSize="sm">Environment</Text>
         <Select {...fieldStyles} id={`vault-env-${entry.id}`} aria-label={`Environment for ${entry.name}`} flex="1" minWidth="160px" value={editingEnvironment.groupId} isDisabled={busy} onChange={event => setEditingEnvironment({ id: entry.id, groupId: event.target.value })}>
          <option value="">Ungrouped</option>{vault.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
         </Select>
         <Button size="sm" isLoading={busy} onClick={() => run({ action: 'move-entry', id: entry.id, groupId: editingEnvironment.groupId }, 'Environment updated', () => setEditingEnvironment(null))}>Save environment</Button>
         <Button size="sm" variant="ghost" isDisabled={busy} onClick={() => setEditingEnvironment(null)}>Cancel</Button>
        </Flex> : <Button size="sm" variant="outline" isDisabled={busy} aria-label={`Change environment for ${entry.name}`} onClick={() => setEditingEnvironment({ id: entry.id, groupId: entry.groupId || '' })}>{vault.groups.find((group) => group.id === entry.groupId)?.name || 'Ungrouped'} · Change</Button>}
							{localVault ? <DeviceProviderReveal key={`${entry.id}:${entry.revision}`} vault={localVault} id={entry.id} label={entry.name} /> : <VaultReveal vault="personal" id={entry.id} label={entry.name} />}
							<Button size="xs" variant="ghost" isDisabled={busy} onClick={() => deleteEntry(entry)}>Delete</Button>
						</Flex>
					))}
				</Flex>
			</Box>
		</Flex>
	);
};
