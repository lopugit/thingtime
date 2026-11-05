export const EDITOR_RUNTIME_SLOT = Symbol.for('thingtime.editorjs.runtime');
export const importEditorJsRuntime = async () => {
	const [EditorJS, Header, List, Quote, Checklist, Delimiter, Table, CodeTool, Warning, Embed, SimpleImage, Marker, InlineCode, Underline] =
		await Promise.all([
			import('@editorjs/editorjs'),
			import('@editorjs/header'),
			import('@editorjs/list'),
			import('@editorjs/quote'),
			import('@editorjs/checklist'),
			import('@editorjs/delimiter'),
			import('@editorjs/table'),
			import('@editorjs/code'),
			import('@editorjs/warning'),
			import('@editorjs/embed'),
			import('@editorjs/simple-image'),
			import('@editorjs/marker'),
			import('@editorjs/inline-code'),
			import('@editorjs/underline')
		]);
	return {
		EditorJS: EditorJS.default,
		Header: Header.default,
		List: List.default,
		Quote: Quote.default,
		Checklist: Checklist.default,
		Delimiter: Delimiter.default,
		Table: Table.default,
		CodeTool: CodeTool.default,
		Warning: Warning.default,
		Embed: Embed.default,
		SimpleImage: SimpleImage.default,
		Marker: Marker.default,
		InlineCode: InlineCode.default,
		Underline: Underline.default
	};
};
export type EditorJsRuntime = Awaited<ReturnType<typeof importEditorJsRuntime>>;
