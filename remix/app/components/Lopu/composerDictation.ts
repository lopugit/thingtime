export type ComposerTranscript = { captureId: string; text: string };
export type ComposerDraft = { text: string; capture: { id: string; prefix: string } | null };
export type ComposerDraftAction =
	| { type: 'edit'; value: string | ((current: string) => string) }
	| { type: 'dictate'; transcript: ComposerTranscript };

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: '', capture: null };
export const LOPU_MAX_MESSAGE_CHARS = 8000;

// A recognizer revises its entire current capture, including already-final
// segments. Replace that span; only a new capture appends to the existing draft.
export function composerDraftReducer(state: ComposerDraft, action: ComposerDraftAction): ComposerDraft {
	if (action.type === 'edit') {
		return { text: typeof action.value === 'function' ? action.value(state.text) : action.value, capture: null };
	}
	const text = action.transcript.text.trim();
	if (!text) return state;
	const capture = state.capture?.id === action.transcript.captureId ? state.capture : {
		id: action.transcript.captureId,
		prefix: state.text + (state.text && !/\s$/.test(state.text) ? ' ' : '')
	};
	return { text: (capture.prefix + text).slice(0, LOPU_MAX_MESSAGE_CHARS), capture };
}
