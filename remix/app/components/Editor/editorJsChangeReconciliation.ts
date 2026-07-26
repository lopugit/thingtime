export type EditorJsSourceRevision = {
	configKey: string;
	valueMode: string;
	externalRevision: number;
};

export const acknowledgeLatestEditorJsEcho = (
	pending: string[],
	previousIncomingSignature: string,
	incomingSignature: string,
	latestSignature: string
): boolean => {
	if (previousIncomingSignature !== incomingSignature || pending.length === 0 || incomingSignature !== latestSignature) return false;
	pending.length = 0;
	return true;
};

export const shouldAcceptEditorJsSnapshot = (
	source: EditorJsSourceRevision,
	current: Pick<EditorJsSourceRevision, 'valueMode' | 'externalRevision'>,
	sequence: number,
	lastAcceptedSequence: number
): boolean => source.valueMode === current.valueMode && source.externalRevision === current.externalRevision && sequence > lastAcceptedSequence;
