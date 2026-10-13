export const DEFAULT_DICTATION_SILENCE_SECONDS = 5;
export const HEAR_ME_OUT_SILENCE_MS = 10_000;
export const normalizeDictationSilenceSeconds = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value)
		? Math.min(120, Math.max(1, Math.round(value * 10) / 10))
		: DEFAULT_DICTATION_SILENCE_SECONDS;

type Policy = { silenceSeconds: number; hearMeOut: boolean };
type Clock = { set: (callback: () => void, delay: number) => unknown; clear: (timer: unknown) => void };

// One logical recording can span many browser/native recognition captures.
// Final results and recognizer restarts must not end or reset its silence window.
export class DictationSilence {
	private timer: unknown = null;
	private generation = 0;
	private active = false;
	private hasWords = false;
	private speaking = false;
	constructor(
		private policy: Policy,
		private callbacks: { isCurrent: () => boolean; prompt: (open: boolean) => void; send: () => void },
		private clock: Clock = { set: (fn, ms) => setTimeout(fn, ms), clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) }
	) {}
	private cancel() {
		++this.generation;
		if (this.timer !== null) this.clock.clear(this.timer);
		this.timer = null;
	}
	private arm() {
		this.cancel();
		if (!this.active || !this.hasWords || this.speaking) return;
		const generation = this.generation;
		this.timer = this.clock.set(() => {
			if (generation !== this.generation || !this.active) return;
			if (!this.callbacks.isCurrent()) { this.stop(); return; }
			if (this.policy.hearMeOut) {
				this.callbacks.prompt(true);
				this.arm(); // One popup, never a stack; repeat after dismissal too.
			} else this.send();
		}, this.policy.hearMeOut ? HEAR_ME_OUT_SILENCE_MS : normalizeDictationSilenceSeconds(this.policy.silenceSeconds) * 1000);
	}
	start() { this.stop(); this.active = true; }
	stop() {
		this.cancel(); this.active = false; this.hasWords = false; this.speaking = false;
		this.callbacks.prompt(false);
	}
	update(policy: Policy) {
		if (this.policy.silenceSeconds === policy.silenceSeconds && this.policy.hearMeOut === policy.hearMeOut) return;
		this.policy = policy;
		this.callbacks.prompt(false);
		this.arm();
	}
	transcript() {
		if (!this.active) return;
		this.hasWords = true;
		this.callbacks.prompt(false);
		this.arm();
	}
	speechStart() {
		if (!this.active) return;
		this.speaking = true; this.cancel(); this.callbacks.prompt(false);
	}
	speechEnd() { this.speaking = false; this.arm(); }
	recognitionEnd() { if (this.speaking) this.speechEnd(); }
	keepListening() { this.callbacks.prompt(false); this.arm(); }
	send() {
		if (!this.active || !this.hasWords || !this.callbacks.isCurrent()) { this.stop(); return; }
		this.stop();
		this.callbacks.send();
	}
}
