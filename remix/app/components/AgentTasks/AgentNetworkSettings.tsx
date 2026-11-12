import React from 'react';
import { Box, Button, Checkbox, Flex, FormControl, FormLabel, Input, Select, Text } from '@chakra-ui/react';
import { agentNetworkLabels, type AgentNetworkPolicy, type AgentTaskSecurity } from './networkTypes';

export function AgentNetworkSettings({ value, onChange, disabled = false, prefix = 'Network security' }: {
	value: AgentNetworkPolicy; onChange: (policy: AgentNetworkPolicy) => void; disabled?: boolean; prefix?: string;
}) {
	return <Box display="grid" gap={3} minWidth={0}>
		<FormControl><FormLabel fontSize="sm">{prefix}</FormLabel>
			<Select value={value.mode} isDisabled={disabled} onChange={event => onChange({ ...value, mode: event.target.value as AgentNetworkPolicy['mode'] })}>
				{Object.entries(agentNetworkLabels).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
			</Select>
		</FormControl>
		<Text fontSize="sm" color="gray.500">
			{value.mode === 'isolated' ? 'Only this task’s browser, app and database can communicate. External networks are disconnected.' :
				value.mode === 'restricted' ? 'Allow only the IP addresses or ranges below. Other traffic, including external DNS, is blocked. An allowed destination may be production.' :
				'Internet and production services are reachable. Use this for tasks that deliberately need external access.'}
		</Text>
		{value.mode === 'restricted' && <Box display="grid" gap={3}>
			{value.rules.map((rule, index) => {
				const update = (patch: Partial<typeof rule>) => onChange({ ...value, rules: value.rules.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
				return <Flex key={index} gap={2} align="end" wrap="wrap" padding={3} borderWidth="1px" borderRadius="md">
					<FormControl flex="2 1 190px"><FormLabel fontSize="xs">IP address or CIDR range</FormLabel>
						<Input aria-label={`Allowed address ${index + 1}`} placeholder="192.0.2.10/32" value={rule.address} isDisabled={disabled} onChange={event => update({ address: event.target.value })} />
					</FormControl>
					<FormControl flex="1 1 110px"><FormLabel fontSize="xs">Protocol</FormLabel>
						<Select aria-label={`Protocol ${index + 1}`} value={rule.protocol} isDisabled={disabled} onChange={event => update({ protocol: event.target.value as typeof rule.protocol, ports: [] })}>
							<option value="any">Any</option><option value="tcp">TCP</option><option value="udp">UDP</option>
						</Select>
					</FormControl>
					{rule.protocol !== 'any' && <FormControl flex="1 1 140px"><FormLabel fontSize="xs">Ports (blank allows all)</FormLabel>
						<Ports value={rule.ports} disabled={disabled} onChange={ports => update({ ports })} />
					</FormControl>}
					<Button variant="ghost" isDisabled={disabled} onClick={() => onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) })}>Remove</Button>
				</Flex>;
			})}
			<Button size="sm" justifySelf="start" isDisabled={disabled} onClick={() => onChange({ ...value, rules: [...value.rules, { address: '', protocol: 'tcp', ports: [] }] })}>Add allowed destination</Button>
			<Text fontSize="xs" color="gray.500">Use literal IPv4 or IPv6 addresses. Redirects and backend requests must also match these rules.</Text>
		</Box>}
	</Box>;
}

function Ports({ value, disabled, onChange }: { value: number[]; disabled: boolean; onChange: (ports: number[]) => void }) {
	const [draft, setDraft] = React.useState(value.join(', '));
	const lastPublished = React.useRef(value);
	React.useEffect(() => {
		if (value !== lastPublished.current) setDraft(value.join(', '));
		lastPublished.current = value;
	}, [value]);
	return <Input aria-label="Allowed ports" value={draft} placeholder="443, 8443" isDisabled={disabled} onChange={event => {
		const next = event.target.value; setDraft(next);
		// Keep invalid input visible and let the canonical native validator refuse
		// saving it. Never turn a malformed port list into unrestricted ports.
		const ports = next.trim() ? next.split(',').map(part => /^\d+$/.test(part.trim()) ? Number(part.trim()) : NaN) : [];
		lastPublished.current = ports; onChange(ports);
	}} />;
}

export function AgentTaskSecuritySettings({ value, defaults, onChange, disabled = false }: {
	value: AgentTaskSecurity; defaults: AgentNetworkPolicy; onChange: (value: AgentTaskSecurity) => void; disabled?: boolean;
}) {
	return <Box display="grid" gap={3}>
		<Checkbox isChecked={value.useCustomSecurity} isDisabled={disabled} onChange={event => onChange({ ...value, useCustomSecurity: event.target.checked })}>Use custom security settings</Checkbox>
		{value.useCustomSecurity ? <AgentNetworkSettings value={value.network} onChange={network => onChange({ ...value, network })} disabled={disabled} prefix="Task network security" /> :
			<Text fontSize="sm" color="gray.500">Uses the device default: {agentNetworkLabels[defaults.mode]}.</Text>}
		<Text fontSize="xs" color="gray.500">A running session keeps the policy it started with. Release it and start a new session to apply changes.</Text>
	</Box>;
}
