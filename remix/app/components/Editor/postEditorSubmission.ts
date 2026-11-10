import { isEditorJsDoc, type EditorJsDoc } from './editorJsValue';
import type { LongTextEditorHandle } from './LongTextEditor';

export const capturePostEditorValue = async (editor: LongTextEditorHandle | null, fallback: EditorJsDoc): Promise<EditorJsDoc> => {
	const captured = await editor?.save();
	return isEditorJsDoc(captured) ? captured : fallback;
};
