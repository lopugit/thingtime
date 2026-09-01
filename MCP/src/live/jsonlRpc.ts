import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

export type RpcId = string | number;
export type RpcMessage = {
	id?: RpcId;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code?: number; message?: string; data?: unknown };
};

export type RpcMessageHandler = (message: RpcMessage) => void | Promise<void>;

export interface JsonRpcTransport {
	start(): Promise<void>;
	stop(): Promise<void>;
	call<T>(method: string, params?: unknown): Promise<T>;
	notify(method: string, params?: unknown): Promise<void>;
	respond(id: RpcId, result: unknown): Promise<void>;
	onMessage(handler: RpcMessageHandler): () => void;
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

export const LOCAL_CONNECTOR_ERROR_MESSAGES = {
	command_outcome_uncertain: 'The local AI connector may have accepted the request; its outcome requires review.',
	connector_protocol_error: 'The local AI connector returned an invalid response.',
	connector_request_failed: 'The local AI connector request failed.',
	connector_request_rejected: 'The local AI connector rejected the request.',
	connector_stopped: 'The local AI connector stopped.',
	connector_timeout: 'The local AI connector timed out.',
	connector_unavailable: 'The local AI connector is unavailable.',
	connector_unsupported: 'The local AI connector does not support that operation.'
} as const;

export type LocalConnectorErrorCode = keyof typeof LOCAL_CONNECTOR_ERROR_MESSAGES;

export class LocalConnectorError extends Error {
	constructor(readonly code: LocalConnectorErrorCode) {
		super(LOCAL_CONNECTOR_ERROR_MESSAGES[code]);
		this.name = 'LocalConnectorError';
	}
}

const localConnectorError = (code: LocalConnectorErrorCode): LocalConnectorError => new LocalConnectorError(code);

export const publicConnectorError = (value: unknown): { code: LocalConnectorErrorCode; message: string } | null =>
	value instanceof LocalConnectorError ? { code: value.code, message: LOCAL_CONNECTOR_ERROR_MESSAGES[value.code] } : null;

// This sanitizer is defense in depth for local-only diagnostics. Cloud-visible
// errors use the enumerated messages above and never serialize source text.
export const sanitizeLocalConnectorError = (message: string): string => {
	const quoted = message
		.slice(0, 1_000)
		.replace(/(["'`])(?:(?:file:\/\/\/|~\/|\/(?!\/))[^"'`\r\n]+)\1/gu, '$1[local path]$1')
		.replace(/(\()(?:(?:file:\/\/\/|~\/|\/(?!\/))[^)\r\n]+)(\))/gu, '$1[local path]$2')
		.replace(/(\[)(?:(?:file:\/\/\/|~\/|\/(?!\/))[^\]\r\n]+)(\])/gu, '$1[local path]$2')
		.replace(/(\{)(?:(?:file:\/\/\/|~\/|\/(?!\/))[^}\r\n]+)(\})/gu, '$1[local path]$2')
		.replace(/(<)(?:(?:file:\/\/\/|~\/|\/(?!\/))[^>\r\n]+)(>)/gu, '$1[local path]$2');
	return quoted.replace(
		/(^|[\s=:([{<])(?:file:\/\/\/|~\/|\/(?!\/))(?:(?!\s+(?:and|or|but|then|because|from|at|with|while|after|before)\s|[,;\r\n)\]}>]).)+/giu,
		'$1[local path]'
	);
};

const safeError = (value: unknown): Error => {
	const code = value && typeof value === 'object' && 'code' in value ? value.code : null;
	if (code === -32601) return localConnectorError('connector_unsupported');
	if (code === -32602) return localConnectorError('connector_request_rejected');
	if (code === -32700 || code === -32600) return localConnectorError('connector_protocol_error');
	return localConnectorError('connector_request_failed');
};

export class JsonlRpcProcess implements JsonRpcTransport {
	private child: ChildProcessWithoutNullStreams | null = null;
	private lines: Interface | null = null;
	private nextId = 1;
	private pending = new Map<RpcId, PendingRequest>();
	private handlers = new Set<RpcMessageHandler>();

	constructor(
		private readonly command: string,
		private readonly args: string[],
		private readonly options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
	) {}

	async start(): Promise<void> {
		if (this.child) return;
		const child = spawn(this.command, this.args, {
			cwd: this.options.cwd,
			env: this.options.env ?? process.env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		this.child = child;
		this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
		this.lines.on('line', (line) => void this.handleLine(line));
		// A child can exit between the writable preflight and a queued write.
		// Keep an error listener for the lifetime of this pipe: without it, an
		// ordinary EPIPE is an unhandled Node event that can crash the connector
		// host after the request has already been failed closed.
		child.stdin.on('error', () => this.failAll(localConnectorError('connector_unavailable')));
		child.stderr.resume();
		child.once('error', () => this.failAll(localConnectorError('connector_unavailable')));
		child.once('exit', () => {
			this.child = null;
			this.lines?.close();
			this.lines = null;
			this.failAll(localConnectorError('connector_unavailable'));
		});
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) return;
		this.child = null;
		this.lines?.close();
		this.lines = null;
		child.kill('SIGTERM');
		this.failAll(localConnectorError('connector_stopped'));
	}

	async call<T>(method: string, params: unknown = {}): Promise<T> {
		const id = this.nextId++;
		const timeoutMs = this.options.timeoutMs ?? 30_000;
		const result = new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(localConnectorError('connector_timeout'));
			}, timeoutMs);
			timer.unref();
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
		});
		try {
			await this.write({ id, method, params });
		} catch {
			const pending = this.pending.get(id);
			if (pending) {
				this.pending.delete(id);
				clearTimeout(pending.timer);
				pending.reject(localConnectorError('connector_unavailable'));
			}
			// Return the tracked promise so its rejection is observed by the caller
			// rather than becoming an orphaned rejection after a failed write.
			return result;
		}
		return result;
	}

	async notify(method: string, params?: unknown): Promise<void> {
		await this.write(params === undefined ? { method } : { method, params });
	}

	async respond(id: RpcId, result: unknown): Promise<void> {
		await this.write({ id, result });
	}

	onMessage(handler: RpcMessageHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	private async write(message: RpcMessage): Promise<void> {
		const child = this.child;
		if (!child?.stdin.writable) throw localConnectorError('connector_unavailable');
		const line = `${JSON.stringify(message)}\n`;
		await new Promise<void>((resolve, reject) => {
			try {
				child.stdin.write(line, (error) => (error ? reject(localConnectorError('connector_unavailable')) : resolve()));
			} catch {
				reject(localConnectorError('connector_unavailable'));
			}
		});
	}

	private async handleLine(line: string): Promise<void> {
		if (!line.trim()) return;
		let message: RpcMessage;
		try {
			message = JSON.parse(line) as RpcMessage;
		} catch {
			return;
		}
		if (message.id !== undefined && !message.method) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) pending.reject(safeError(message.error));
			else pending.resolve(message.result);
			return;
		}
		for (const handler of this.handlers) await handler(message);
	}

	private failAll(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}
