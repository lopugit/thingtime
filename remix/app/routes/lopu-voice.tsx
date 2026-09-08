import { LopuVoiceChat } from '~/components/Lopu/LopuVoiceChat';

// /lopu/voice — Lopu's hands-free mode (continuous listening, spoken replies,
// transcribe mode, Secure Vault providers). The text chat lives at /lopu.
export default function LopuVoice() {
	return <LopuVoiceChat />;
}
