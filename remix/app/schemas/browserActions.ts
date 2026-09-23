// API requests are ordinary configurable Action steps, not app-specific commands.
// Credentials and caller identity remain outside the saved program.
export const BROWSER_ACTION_OPS = ['http.request', 'compute', 'fail', 'return', 'actions.invoke'] as const;
export const ACTION_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const isActionHttpPath = (value: unknown): value is string =>
	typeof value === 'string' && /^\/api\/v1\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value) && value.length <= 240;
export const actionHttpEndpoint = (method: unknown, path: unknown): string | null =>
	(typeof method === 'string' && (ACTION_HTTP_METHODS as readonly string[]).includes(method) && isActionHttpPath(path)) ? `${method} ${path}` : null;
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
