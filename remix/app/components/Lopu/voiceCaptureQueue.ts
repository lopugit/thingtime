import type { VoiceCapture } from '~/api/utils/lopu/voiceCapture';

export type PendingVoiceCapture = VoiceCapture & { ownerId: string; localId: string; capturedAt: number };
export type CaptureStore = { keys(): string[]; read(key: string): string | null; write(key: string, value: string): void; remove(key: string): void };
const browserStore: CaptureStore = {
	keys: () => Object.keys(window.localStorage), read: key => window.localStorage.getItem(key),
	write: (key, value) => window.localStorage.setItem(key, value), remove: key => window.localStorage.removeItem(key)
};

// One local record per event prevents two tabs from overwriting an entire
// outbox. The server is the final idempotency authority. No credentials or
// provider URLs are retained here. Failed writes remain available in memory.
export class VoiceCaptureQueue {
	private memory = new Map<string, PendingVoiceCapture>();
	private running: Promise<void> | null = null;
	private prefix: string;
	constructor(readonly ownerId: string, private storage: CaptureStore = browserStore) {
		this.prefix = `tt-lopu-voice-capture:${encodeURIComponent(ownerId)}:`;
	}
	private key(item: PendingVoiceCapture) { return this.prefix + encodeURIComponent(JSON.stringify([item.sessionId, item.role, item.eventId])); }
	list() {
		try {
			for (const key of this.storage.keys().filter(key => key.startsWith(this.prefix)).slice(0, 100)) {
				try {
					const item = JSON.parse(this.storage.read(key) || 'null');
					if (item?.ownerId === this.ownerId && typeof item.localId === 'string' && typeof item.text === 'string' && item.text.length <= 24000 && Number.isFinite(item.capturedAt) && typeof item.sessionId === 'string' && typeof item.eventId === 'string' && (item.role === 'user' || item.role === 'assistant') && this.key(item) === key) this.memory.set(key, item);
				} catch { /* Ignore malformed local cache entries. */ }
			}
		} catch { /* Storage disabled; retain this session's memory copy. */ }
		return [...this.memory.values()].sort((a, b) => a.capturedAt - b.capturedAt);
	}
	add(item: PendingVoiceCapture): boolean {
		if (item.ownerId !== this.ownerId) throw new Error('Voice account changed.');
		const key = this.key(item), pending = this.list();
		const existing = this.memory.get(key);
		if (existing && (existing.text !== item.text || existing.chatId !== item.chatId)) throw new Error('Voice event changed before it could be saved.');
		if (existing) item = existing;
		if (!existing && (pending.length >= 50 || pending.reduce((sum, row) => sum + row.text.length, 0) + item.text.length > 240000)) throw new Error('Voice save queue is full. Retry saving before recording more.');
		this.memory.set(key, item);
		try { this.storage.write(key, JSON.stringify(item)); return true; } catch { return false; }
	}
	flush(currentOwner: () => string | null, send: (item: PendingVoiceCapture) => Promise<{ ok: boolean; ownerId?: string; chatId?: string; messages?: { id: string }[]; error?: string }>, saved: (item: PendingVoiceCapture, result: { chatId: string; messages: { id: string }[] }) => Promise<void>) {
		if (this.running) return this.running;
		this.running = (async () => {
			const seen = new Set<string>();
			for (let count = 0; count < 50; count++) {
				const item = this.list().find(entry => !seen.has(this.key(entry)));
				if (!item) return;
				seen.add(this.key(item));
				if (currentOwner() !== this.ownerId) return;
				const result = await send(item);
				if (!result.ok || result.ownerId !== this.ownerId || !result.chatId || !Array.isArray(result.messages) || !result.messages.length || result.messages.some(row => !row || typeof row.id !== 'string' || !row.id)) throw new Error(result.error || 'Voice transcript could not be saved.');
				this.memory.delete(this.key(item));
				try { this.storage.remove(this.key(item)); } catch { /* Exact server replay remains safe. */ }
				if (currentOwner() === this.ownerId) await saved(item, { chatId: result.chatId, messages: result.messages });
			}
		})().finally(() => { this.running = null; });
		return this.running;
	}
}
