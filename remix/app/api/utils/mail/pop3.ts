import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { MailError, type MailServer } from '../../../mail/model';
/** Bounded POP3 reader. RETR is read-only; DELE is deliberately not exposed. */
export class Pop3Reader {
	private pending = Buffer.alloc(0);
	private waiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
	private failure: Error | null = null;
	private received = 0;
	private readonly maxBytes = 16 * 1024 * 1024;
	private socket: net.Socket;
	private readonly onData = (chunk: Buffer) => {
		this.received += chunk.length;
		if (this.received > this.maxBytes || this.pending.length + chunk.length > 2 * 1024 * 1024) {
			this.fail(new MailError(502, 'Mail response is too large.'));
			return;
		}
		this.pending = Buffer.concat([this.pending, chunk]);
		this.waiter?.resolve();
		this.waiter = null;
	};
	private readonly onError = () => this.fail(new MailError(502, 'The mail server connection failed.'));
	private readonly onClose = () => this.fail(new MailError(502, 'The mail server closed the connection.'));
	private readonly onAbort = () => this.fail(new MailError(504, 'Mail connection timed out.'));
	constructor(socket: net.Socket, private readonly signal: AbortSignal) {
		this.socket = socket;
		this.attach();
		signal.addEventListener('abort', this.onAbort, { once: true });
	}
	private attach() {
		this.socket.on('data', this.onData);
		this.socket.on('error', this.onError);
		this.socket.on('close', this.onClose);
	}
	private detach() {
		this.socket.off('data', this.onData);
		this.socket.off('error', this.onError);
		this.socket.off('close', this.onClose);
	}
	private fail(error: Error) {
		this.failure = error;
		this.waiter?.reject(error);
		this.waiter = null;
		this.socket.destroy();
	}
	private async line(max = 8192): Promise<Buffer> {
		while (true) {
			if (this.failure) throw this.failure;
			this.signal.throwIfAborted();
			const end = this.pending.indexOf('\r\n');
			if (end > max || (end < 0 && this.pending.length > max)) throw new MailError(502, 'Mail response line is too large.');
			if (end >= 0) {
				const line = this.pending.subarray(0, end);
				this.pending = this.pending.subarray(end + 2);
				return line;
			}
			await new Promise<void>((resolve, reject) => {
				this.waiter = { resolve, reject };
			});
		}
	}
	private async positive() {
		if (!/^\+OK(?:\s|$)/.test((await this.line()).toString('ascii')))
			throw new MailError(502, 'The mail server refused the request. Check the account settings.');
	}
	private async command(command: string) {
		if (/[\r\n]/.test(command)) throw new MailError(400, 'Invalid mail command.');
		this.signal.throwIfAborted();
		this.socket.write(command + '\r\n');
		await this.positive();
	}
	private async multiline(command: string, limit: number): Promise<Buffer> {
		await this.command(command);
		const lines: Buffer[] = [];
		let size = 0;
		while (true) {
			let line = await this.line(Math.min(limit, 1024 * 1024));
			if (line.length === 1 && line[0] === 46) break;
			if (line[0] === 46) line = line.subarray(1);
			size += line.length + 2;
			if (size > limit) throw new MailError(502, 'This message exceeds the mail download limit.');
			lines.push(line, Buffer.from('\r\n'));
		}
		return Buffer.concat(lines);
	}
	static async connect(server: MailServer, address: string, signal: AbortSignal) {
		const socket =
			server.security === 'tls'
				? tls.connect({ host: address, port: server.port, servername: server.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' })
				: net.connect({ host: address, port: server.port });
		const reader = new Pop3Reader(socket, signal);
		try {
			await once(socket, server.security === 'tls' ? 'secureConnect' : 'connect', { signal });
			await reader.positive();
			if (server.security === 'starttls') {
				await reader.command('STLS');
				// Reject pipelined plaintext after STLS: none may be treated as TLS data.
				if (reader.pending.length) throw new MailError(502, 'Invalid STARTTLS response.');
				reader.detach();
				reader.socket = tls.connect({ socket, servername: server.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
				reader.attach();
				await once(reader.socket, 'secureConnect', { signal });
			}
			await reader.command(`USER ${server.username}`);
			await reader.command(`PASS ${server.password}`);
			return reader;
		} catch (error) {
			reader.close();
			throw error;
		}
	}
	async list() {
		const uidLines = (await this.multiline('UIDL', 1024 * 1024)).toString('ascii').trim().split('\r\n').filter(Boolean);
		const sizeLines = (await this.multiline('LIST', 1024 * 1024)).toString('ascii').trim().split('\r\n').filter(Boolean);
		const sizes = new Map(
			sizeLines.map((line) => {
				const parts = /^(\d+) (\d+)$/.exec(line);
				if (!parts) throw new MailError(502, 'Invalid POP3 listing.');
				return [Number(parts[1]), Number(parts[2])];
			})
		);
		const uids = new Set<string>();
		return uidLines.map((line) => {
			const parts = /^(\d+) ([\x21-\x7e]{1,70})$/.exec(line);
			if (!parts || uids.has(parts[2]) || !Number.isSafeInteger(Number(parts[1])) || !sizes.has(Number(parts[1])))
				throw new MailError(502, 'The server does not provide stable POP3 message ids.');
			uids.add(parts[2]);
			return { number: Number(parts[1]), uid: parts[2], size: sizes.get(Number(parts[1]))! };
		});
	}
	async retrieve(number: number, max: number) {
		if (!Number.isSafeInteger(number) || number <= 0) throw new MailError(400, 'Invalid POP3 message.');
		return this.multiline(`RETR ${number}`, max);
	}
	close() {
		this.signal.removeEventListener('abort', this.onAbort);
		this.detach();
		this.socket.on('error', () => {});
		this.socket.destroy();
	}
}
