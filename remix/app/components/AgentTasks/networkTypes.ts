export type AgentNetworkMode = 'isolated' | 'restricted' | 'unrestricted';
export type AgentNetworkRule = { address: string; protocol: 'any' | 'tcp' | 'udp'; ports: number[] };
export type AgentNetworkPolicy = { mode: AgentNetworkMode; rules: AgentNetworkRule[] };
export type AgentTaskSecurity = { useCustomSecurity: boolean; network: AgentNetworkPolicy };
export const isolatedAgentNetwork: AgentNetworkPolicy = { mode: 'isolated', rules: [] };
export const agentNetworkLabels: Record<AgentNetworkMode, string> = {
	isolated: 'Isolated testing', restricted: 'Restricted network', unrestricted: 'Allow all network traffic'
};
export type AgentBrowserSnapshot = {
	version: string;
	defaults: AgentNetworkPolicy;
	installs: Array<{ id: string; taskId: string; browser: string; buildId: string; platform: string }>;
	downloads: Array<{ id: string; taskId: string; browser: string; buildId: string; state: string; error?: string }>;
	nativeBundles?: {
		installs: Array<{ id: string; taskId: string; browser: string; buildId: string; platform: string }>;
		downloads: Array<{ id: string; taskId: string; browser: string; buildId: string; state: string; error?: string; downloaded: number; total: number }>;
	};
	leases: Array<{ id: string; taskId: string; agentId: string; installId: string; expiresAt: number; expired: boolean }>;
	sessions: Array<{ id: string; leaseId: string; state: string; policy: AgentNetworkPolicy; proof: { isolated: boolean } | null }>;
};
