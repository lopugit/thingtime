import { requestActionPages } from './actionRequestPagination';
import { browserActionMinimumVersion } from '~/schemas/actionRequestPagination';
import { evaluateExpression, type ExpressionContext, type ExpressionLambdaScope } from '~/schemas/actionExpressions';
import { ACTION_LIMIT_CEILINGS, ACTION_LIMIT_DEFAULTS, MAX_ACTION_EACH_ITEMS, parseActionRef, sanitizeActionCrystal } from '~/schemas/registry';
import {
	BROWSER_ACTION_EXPANDED_LIMITS,
	BROWSER_EXPRESSION_DEFAULTS,
	actionHttpEndpoint,
	type PreparedBrowserAction
} from '~/schemas/browserActions';

type RequestStep = {
	path: string;
	method: string;
	query: Record<string, unknown>;
	body?: unknown;
	feature: string;
	minimumVersion: string;
	maxResultBytes: number;
	runtimeVersion?: string;
};
export type BrowserActionTrace = { step: string; op: string; ms: number; status: 'ok' | 'skipped' | 'error' };
export type BrowserActionHost = {
	// The host pins every authenticated request to this identity on the server.
	assertIdentity: (id: string) => void;
	request: (step: RequestStep, actorId: string, signal: AbortSignal) => Promise<unknown>;
	prepare: (action: string, inputs: Record<string, unknown>, actorId: string, signal: AbortSignal) => Promise<PreparedBrowserAction>;
	now?: () => number;
	recordStep?: (entry: BrowserActionTrace) => void;
};
type Frame = { deadline: number; remaining: number; children: number; maxDepth: number; expression: { nodes: number }; maxListItems: number };
type Budget = { stack: string[]; frames: Frame[]; signal: AbortSignal };
const refuse = (message: string): never => {
	throw new Error(message);
};
const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : refuse('Expected an object');
const read = (root: unknown, path: string[]): unknown => {
	let value = root;
	for (const key of path) {
		if (
			['__proto__', 'constructor', 'prototype'].includes(key) ||
			!value ||
			typeof value !== 'object' ||
			!Object.prototype.hasOwnProperty.call(value, key)
		)
			return undefined;
		value = (value as Record<string, unknown>)[key];
	}
	return value;
};
const truthy = (value: unknown) =>
	typeof value === 'string' ? !!value.trim() && value !== 'false' && value !== '0' : Array.isArray(value) ? !!value.length : !!value;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength;
// Discovery and injected hosts may not consume the transport signal.
const bounded = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
	new Promise((resolve, reject) => {
		const abort = () => reject(new Error('The action flow timed out'));
		if (signal.aborted) {
			work.catch(() => {});
			abort();
			return;
		}
		signal.addEventListener('abort', abort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});

// Shared expression grammar, reference semantics and budgets for all client
// programs. No app names, business record types, credentials, eval, or JSX here.
export async function executeBrowserAction(prepared: PreparedBrowserAction, host: BrowserActionHost, budget?: Budget): Promise<unknown> {
	const checked = sanitizeActionCrystal(prepared.program);
	if (checked.ok === false) return refuse(checked.error);
	if (prepared.status !== 'prepared' || prepared.execution !== 'browser' || checked.crystal.runtime !== 'browser' || !prepared.viewer?.id)
		return refuse('This action was not prepared for browser execution');
	const program = checked.crystal;
	const now = host.now ?? Date.now;
	const limits = Object.fromEntries(
		Object.entries(ACTION_LIMIT_DEFAULTS).map(([key, fallback]) => [
			key,
			Math.min(Number((program.limits as any)?.[key]) || fallback, ({ ...ACTION_LIMIT_CEILINGS, ...BROWSER_ACTION_EXPANDED_LIMITS } as any)[key])
		])
	);
	const expressionLimits = { ...BROWSER_EXPRESSION_DEFAULTS, ...(program.expressionLimits as Record<string, number> | undefined) };
	const shared = budget ?? { stack: [], frames: [], signal: AbortSignal.timeout(limits.timeoutMs) };
	if (bytes(prepared.inputs) > limits.maxInputBytes) refuse('The action inputs exceed their byte budget');
	if (shared.stack.includes(prepared.actionId) || shared.frames.some((frame, index) => shared.stack.length - index >= frame.maxDepth))
		return refuse('Recursive or overly deep action flow');
	shared.stack.push(prepared.actionId);
	shared.frames.push({
		deadline: now() + limits.timeoutMs,
		remaining: limits.maxOperations,
		children: limits.maxChildActions,
		maxDepth: limits.maxDepth,
		expression: { nodes: expressionLimits.nodes },
		maxListItems: expressionLimits.listItems
	});
	const signal = AbortSignal.any([shared.signal, AbortSignal.timeout(limits.timeoutMs)]);
	const steps: unknown[] = [];
	const ensure = () => {
		host.assertIdentity(prepared.viewer.id);
		if (signal.aborted || shared.frames.some((frame) => now() >= frame.deadline)) refuse('The action flow timed out');
	};
	const resolve = (value: unknown, lambda?: ExpressionLambdaScope): unknown => {
		if (typeof value === 'string') {
			if (value.startsWith('$$')) return value.slice(1);
			const ref = parseActionRef(value);
			if (!ref) return value;
			if ('ok' in ref) return refuse(ref.error);
			if (ref.kind === 'input') return read(prepared.inputs, [ref.name]);
			if (ref.kind === 'viewer') return read(prepared.viewer, [ref.field]);
			if (ref.kind === 'now') return new Date(now()).toISOString();
			if (ref.kind === 'item') return lambda ? read(lambda.item, ref.path) : refuse('No current list item');
			if (ref.kind === 'index') return lambda ? lambda.index : refuse('No current list index');
			if (ref.step > steps.length) return refuse('A step cannot read a future result');
			return read(steps[ref.step - 1], ref.path);
		}
		if (Array.isArray(value)) return value.map((item) => resolve(item, lambda));
		if (value && typeof value === 'object') {
			const record = value as Record<string, unknown>;
			if (Object.keys(record).length === 1 && Array.isArray(record.ttExpr)) return evaluateExpression(record.ttExpr, expressions, lambda);
			if (Object.keys(record).length === 1 && Array.isArray(record.ttConcat))
				return record.ttConcat.map((item) => String(resolve(item, lambda) ?? '')).join('');
			return Object.fromEntries(
				Object.entries(record)
					.filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))
					.map(([key, entry]) => [key, resolve(entry, lambda)])
					.filter(([, entry]) => entry !== undefined)
			);
		}
		return value;
	};
	const expressionBudget = {
		get nodes() {
			return Math.min(...shared.frames.map((frame) => frame.expression.nodes));
		},
		set nodes(value: number) {
			const spent = this.nodes - value;
			for (const frame of shared.frames) frame.expression.nodes -= spent;
		}
	};
	const expressions: ExpressionContext = {
		resolve,
		budget: expressionBudget,
		maxListItems: Math.min(...shared.frames.map((frame) => frame.maxListItems)),
		checkpoint: ensure,
		packs: Object.create(null),
		random: Math.random,
		fail: refuse
	};
	try {
		for (const [index, step] of (program.steps as Record<string, any>[]).entries()) {
			ensure();
			if (shared.frames.some((frame) => --frame.remaining < 0)) refuse('The action operation budget was exceeded');
			const started = now();
			const trace: BrowserActionTrace = { step: `${shared.stack.join('/')}:${index + 1}`, op: step.op, ms: 0, status: 'error' };
			try {
				if (step.when != null && !truthy(resolve(step.when))) {
					steps.push(null);
					trace.status = 'skipped';
					continue;
				}
				let result: unknown;
				if (step.op === 'http.request') {
					const endpoint = actionHttpEndpoint(step.method, step.path);
					if (!endpoint || !(program.capabilities as any[])?.some((cap) => cap.capability === 'http.request' && cap.endpoints?.includes(endpoint)))
						refuse('Request is outside this action’s declared endpoints');
					const request = async (query: Record<string, unknown>, page = 1) => {
						ensure();
						if (page > 1 && shared.frames.some((frame) => --frame.remaining < 0)) refuse('The action operation budget was exceeded');
						const started = now();
						const pageTrace: BrowserActionTrace = { step: `${trace.step}.page.${page}`, op: step.op, ms: 0, status: 'error' };
						try {
							const response = await bounded(
								host.request(
									{
										path: step.path,
										method: step.method,
										query,
										...(step.body === undefined ? {} : { body: resolve(step.body) }),
										feature: step.feature,
										minimumVersion: step.minimumVersion,
										maxResultBytes: limits.maxResultBytes,
										runtimeVersion: browserActionMinimumVersion(program)
									},
									prepared.viewer.id,
									signal
								),
								signal
							);
							ensure();
							pageTrace.status = 'ok';
							return response;
						} finally {
							if (page > 1) {
								pageTrace.ms = now() - started;
								host.recordStep?.(pageTrace);
							}
						}
					};
					const query = object(resolve(step.query ?? {}));
					result = step.pagination ? await requestActionPages(step.pagination, query, request, limits.maxResultBytes) : await request(query);
				} else if (step.op === 'actions.invoke' || step.op === 'each') {
					if (!(program.capabilities as any[])?.some((cap) => cap.capability === 'actions.invoke' && cap.actions?.includes(step.action)))
						refuse('Child action is outside this action’s allowlist');
					const invoke = async (lambda?: ExpressionLambdaScope) => {
						ensure();
						if (shared.frames.some((frame) => --frame.children < 0)) refuse('The child action budget was exceeded');
						const child = await bounded(host.prepare(step.action, object(resolve(step.inputs ?? {}, lambda)), prepared.viewer.id, signal), signal);
						ensure();
						if (child.viewer.id !== prepared.viewer.id) refuse('Account changed while preparing the child action');
						return executeBrowserAction(child, host, { ...shared, signal });
					};
					if (step.op === 'each') {
						const list = resolve(step.list);
						if (!Array.isArray(list)) refuse('Each needs a list');
						// Refuse before the first child instead of reporting a partial
						// operation as success. Authors can explicitly slice a batch.
						if ((list as unknown[]).length > (step.max ?? MAX_ACTION_EACH_ITEMS)) refuse('Each list exceeds its item budget');
						const results: unknown[] = [];
						for (const [position, item] of (list as unknown[]).entries()) {
							results.push((await invoke({ item, index: position })) ?? null);
							if (bytes(results) > limits.maxResultBytes) refuse('The action result exceeds its byte budget');
						}
						result = results;
					} else result = await invoke();
				} else if (step.op === 'compute' || step.op === 'return') result = resolve(step.value) ?? null;
				else if (step.op === 'fail') return refuse(String(resolve(step.message) || 'Action refused'));
				else return refuse('Unsupported browser action step');
				ensure();
				if (bytes(result) > limits.maxResultBytes) refuse('The action result exceeds its byte budget');
				steps.push(result);
				trace.status = 'ok';
				if (step.op === 'return') return result;
			} finally {
				trace.ms = now() - started;
				host.recordStep?.(trace);
			}
		}
		return steps.at(-1) ?? null;
	} finally {
		shared.stack.pop();
		shared.frames.pop();
	}
}
