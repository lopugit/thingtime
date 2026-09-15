import { lopuCredentialVaultConfigured, readServerCredential } from '../ciControl/credentialVault';

export type EnvironmentEntry = { id: string; key: string; target: string[]; gitBranch: string | null; type: string; revealable: boolean };
type Options = { project: string; team?: string; token: string; fetch?: typeof fetch };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const retiredClaudeKey = (key: string) => ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'].includes(key);
export const publicEnvironmentEntry = (row: any): EnvironmentEntry => ({
	id: row.id,
	key: row.key,
	target: Array.isArray(row.target) ? row.target.filter((v: unknown) => typeof v === 'string') : [],
	gitBranch: typeof row.gitBranch === 'string' ? row.gitBranch : null,
	type: row.type,
	revealable: row.type !== 'sensitive'
});

// Fixed origin and server-selected project. Neither the browser nor CI callers
// can choose a project, team, token, upstream URL, or arbitrary HTTP method.
export const createSystemEnvironmentStore = (options: Options) => {
	if (!identifier(options.project) || (options.team && !identifier(options.team)))
		throw new Error('Deployment environment management is not configured.');
	const upstream = options.fetch || fetch;
	const request = async (version: number, suffix = '', method = 'GET', body?: unknown) => {
		const url = new URL(`https://api.vercel.com/v${version}/projects/${options.project}/env${suffix}`);
		if (options.team) url.searchParams.set('teamId', options.team);
		if (!suffix && method === 'GET') url.searchParams.set('decrypt', 'false');
		const response = await upstream(url, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(8000),
			headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error('Deployment environment request failed. Check project access and retry.');
		}
		const reader = response.body?.getReader();
		let text = '';
		let bytes = 0;
		if (reader) {
			const decoder = new TextDecoder();
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) break;
				bytes += chunk.value.byteLength;
				if (bytes > 1024 * 1024) {
					await reader.cancel();
					throw new Error('Deployment environment response exceeded the limit.');
				}
				text += decoder.decode(chunk.value, { stream: true });
			}
			text += decoder.decode();
		}
		return text ? JSON.parse(text) : {};
	};
	const list = async (): Promise<EnvironmentEntry[]> => {
		const result = await request(10);
		if (!Array.isArray(result.envs)) throw new Error('Deployment environment metadata is unavailable.');
		return result.envs
			.filter((row: any) => identifier(row.id) && typeof row.key === 'string')
			.map(publicEnvironmentEntry)
			.sort((a: EnvironmentEntry, b: EnvironmentEntry) => a.key.localeCompare(b.key));
	};
	const selected = async (id: unknown) => {
		if (!identifier(id)) throw new Error('Choose an environment entry.');
		const row = (await list()).find((row) => row.id === id);
		if (!row) throw new Error('Environment entry not found.');
		return row;
	};
	return {
		list,
		async reveal(id: string) {
			const row = await selected(id);
			if (!row.revealable) return null;
			const result = await request(1, `/${row.id}`);
			return typeof result.value === 'string' ? result.value : null;
		},
		async mutate(input: Record<string, unknown>) {
			if (Object.keys(input).some((key) => !['action', 'id', 'key', 'value', 'target'].includes(key)))
				throw new Error('Unsupported environment field.');
			if (!['create', 'rotate', 'delete'].includes(String(input.action))) throw new Error('Unsupported environment action.');
			const row = input.action === 'create' ? null : await selected(input.id);
			if (input.action === 'delete') {
				await request(9, `/${row!.id}`, 'DELETE');
				return;
			}
			const key = row?.key || input.key;
			if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(key) || retiredClaudeKey(key))
				throw new Error('Use a supported environment key. Claude uses OAuth from the System vault.');
			if (typeof input.value !== 'string' || Buffer.byteLength(input.value) > 32 * 1024) throw new Error('Environment value exceeds the limit.');
			if (row) await request(9, `/${row.id}`, 'PATCH', { value: input.value });
			else {
				if (!['production', 'preview', 'development'].includes(String(input.target))) throw new Error('Choose an environment.');
				// No upsert: creating a duplicate cannot replace another value.
				await request(10, '', 'POST', { key, value: input.value, target: [input.target], type: 'encrypted' });
			}
		}
	};
};

export const systemEnvironmentStore = async () => {
	const project = process.env.VERCEL_PROJECT_ID;
	const token = (lopuCredentialVaultConfigured() ? await readServerCredential('Vercel') : null) || process.env.VERCEL_API_TOKEN;
	if (!project || !token) return null;
	return createSystemEnvironmentStore({ project, token, team: process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID });
};
export const revealSystemEnvironment = async (id: string) => (await systemEnvironmentStore())?.reveal(id) ?? null;
