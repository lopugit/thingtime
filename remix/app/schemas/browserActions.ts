// API requests are ordinary configurable Action steps, not app-specific commands.
// Credentials and caller identity remain outside the saved program.
export const BROWSER_ACTION_OPS = ['http.request', 'compute', 'fail', 'return', 'actions.invoke', 'each'] as const;
export const ACTION_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const isActionHttpPath = (value: unknown): value is string =>
	typeof value === 'string' && /^\/api\/v1\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value) && value.length <= 240;
export const actionHttpEndpoint = (method: unknown, path: unknown): string | null =>
	typeof method === 'string' && (ACTION_HTTP_METHODS as readonly string[]).includes(method) && isActionHttpPath(path) ? `${method} ${path}` : null;
export const isActionHttpEndpoint = (value: unknown): value is string => {
	if (typeof value !== 'string') return false;
	const [method, path, extra] = value.split(' ');
	return !extra && actionHttpEndpoint(method, path) === value;
};

export type PreparedBrowserAction = {
	ok: true;
	status: 'prepared';
	execution: 'browser';
	actionId: string;
	viewer: { id: string; username?: string | null };
	program: Record<string, any>;
	inputs: Record<string, unknown>;
};

// Browser runs do not occupy a server worker between requests. Their optional
// larger envelopes are negotiated by the 1.8 execution protocol; defaults stay
// small, and server Actions retain their original ceilings.
export const BROWSER_ACTION_EXPANDED_LIMITS = { timeoutMs: 120_000, maxResultBytes: 8 * 1024 * 1024 } as const;
export const BROWSER_ACTION_LEGACY_LIMITS = { timeoutMs: 10_000, maxResultBytes: 256 * 1024 } as const;

export const BROWSER_EXPRESSION_DEFAULTS = { nodes: 20_000, listItems: 1000 };
export const BROWSER_EXPRESSION_CEILINGS = { nodes: 1_000_000, listItems: 10_000 };
export function parseBrowserExpressionLimits(value: unknown): { nodes: number; listItems: number } | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some((key) => !(key === 'nodes' || key === 'listItems'))) return null;
	const result = { ...BROWSER_EXPRESSION_DEFAULTS };
	for (const key of ['nodes', 'listItems'] as const) {
		const amount = input[key] ?? result[key];
		if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > BROWSER_EXPRESSION_CEILINGS[key]) return null;
		result[key] = amount;
	}
	return result;
}
