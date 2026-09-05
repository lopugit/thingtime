import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { updateBlock, type WebpageBlock } from '../app/components/Builder/webpageBlocks';
import { InlineRichTextEditor } from '../app/components/Builder/InlineRichTextEditor';
import { editorJsToHtml, htmlToEditorJs } from '../app/components/Builder/editorJsHtml';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { LongTextEditor } from '../app/components/Editor/LongTextEditor';
import { RichTextBlocks } from '../app/components/Kinds/kindRenderersMedia';
import { applySelectionStyle } from '../app/components/Editor/InlineStyle';
import { EditorHistory } from '../app/components/Editor/editorHistory';
import { RichTextModal } from '../app/components/Builder/RichTextModal';
const initial = {
	blocks: [
		{ type: 'header', data: { text: 'A lovely heading', level: 2 } },
		{ type: 'paragraph', data: { text: 'Select these lovely words for colour and size.' } },
		{ type: 'list', data: { style: 'unordered', items: [{ content: 'List item', meta: {}, items: [] }] } },
		{ type: 'checklist', data: { items: [{ text: 'Checklist text', checked: false }] } },
		{ type: 'quote', data: { text: 'A beautiful quote', caption: 'Quote caption' } },
		{
			type: 'table',
			data: {
				content: [
					['Table heading', 'Another cell'],
					['Table text', 'Final cell']
				],
				withHeadings: true
			}
		},
		{ type: 'warning', data: { title: 'Warning title', message: 'Warning message' } }
	]
};
function BuilderCheck() {
	const [history] = React.useState(() => new EditorHistory());
	const [modal, setModal] = React.useState(false);
	const [html, setHtml] = React.useState('<h2>A lovely builder heading</h2><p>Builder paragraph</p>'),
		[editing, setEditing] = React.useState(true);
	return (
		<section>
			<h2>Builder round trip</h2>
			<button onClick={() => setEditing(!editing)}>Toggle builder editing</button>
			<button onClick={() => setModal(true)}>Open floating editor</button>
			<RichTextModal
				block={{ id: 'fixture-builder', type: 'text', html }}
				isOpen={modal}
				onClose={() => setModal(false)}
				onApply={(patch) => setHtml(patch.html || '')}
			/>
			{editing ? (
				<InlineRichTextEditor history={history} html={html} onChange={(patch) => setHtml(patch.html)} />
			) : (
				<RichTextBlocks blocks={htmlToEditorJs(html).blocks} />
			)}
			<details>
				<summary>Builder saved HTML</summary>
				<pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{html}</pre>
			</details>
			<button onClick={() => setHtml(editorJsToHtml(htmlToEditorJs(html)))}>Round trip builder HTML</button>
		</section>
	);
}
function TightBuilderCheck() {
	const [blocks, setBlocks] = React.useState<WebpageBlock[]>([
		{ id: 'tight-heading', type: 'text', text: 'Love', style: 'heading', align: 'center', css: { 'font-size': '80px', color: 'hotpink' } },
		{ id: 'tight-text', type: 'text', text: 'hehe 😌', align: 'center', css: { padding: '55px 0' } },
		{ id: 'edge-text', type: 'text', text: 'Right edge text', align: 'end', css: { 'text-align': 'right' } }
	]);
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	const [hoverId, setHoverId] = React.useState<string | null>(null);
	const [narrow, setNarrow] = React.useState(false);
	return (
		<section
			data-testid="tight-builder-check"
			style={{ margin: '80px 0', border: '1px solid #ddd', padding: 16, width: narrow ? 240 : '100%', maxWidth: '100%' }}
		>
			<h2>Tight builder spaces</h2>
			<button onClick={() => setNarrow(!narrow)}>Resize builder container</button>
			<button onClick={() => setSelectedId(null)}>Deselect block</button>
			<div style={{ marginTop: 80 }}>
				<WebpageBlocksRenderer
					blocks={blocks}
					componentsByRef={{}}
					chrome={{
						selectedId,
						hoverId,
						onSelect: setSelectedId,
						onHover: setHoverId,
						onUpdate: (id, patch) => setBlocks((current) => updateBlock(current, id, patch)),
						onInsert: () => {},
						onMove: () => {},
						onContextMenu: () => {}
					}}
				/>
			</div>
		</section>
	);
}
function App() {
	const [doc, setDoc] = React.useState(initial),
		[revision, setRevision] = React.useState(0),
		[result, setResult] = React.useState(''),
		[mobile, setMobile] = React.useState(false);
	const ref = React.useRef<any>(null);
	return (
		<ChakraProvider>
			<style>
				{'main>button, main>div>button{padding:8px 12px;border:1px solid #ddd;border-radius:8px} h1{font-size:22px!important} h2{margin-top:12px}'}
			</style>
			<main style={{ padding: 16, maxWidth: 1000, margin: 'auto' }}>
				<h1>Rich text verification</h1>
				<p>Ephemeral test document — no account data is saved.</p>
				<button onClick={() => setMobile(!mobile)}>Toggle 390px mobile frame</button>
				{mobile ? (
					<iframe
						title="Mobile editor"
						src="./editor-rich-text.html"
						style={{ width: 390, maxWidth: '100%', height: 800, border: '1px solid #aaa' }}
					/>
				) : null}
				<div style={{ height: 80 }} />
				<LongTextEditor key={revision} ref={ref} value={doc} onValueChange={(value) => setDoc(value as any)} />
				<div style={{ display: 'flex', gap: 16, margin: '16px 0' }}>
					<button
						onClick={async () => {
							setDoc(await ref.current.save());
							setRevision(revision + 1);
						}}
					>
						Save and reopen
					</button>
					<button
						onClick={async () => {
							const field = document.createElement('div');
							field.contentEditable = 'true';
							field.innerHTML = '<span style="color:#ff0000">before selected after</span>';
							document.body.append(field);
							const t = field.querySelector('span')!.firstChild!;
							const range = document.createRange();
							range.setStart(t, 7);
							range.setEnd(t, 15);
							const ok = applySelectionStyle(range, { color: '#0000ff', size: '1.5rem' });
							const spans = field.querySelectorAll('span');
							const passed =
								ok &&
								field.textContent === 'before selected after' &&
								field.innerHTML.includes('1.5rem') &&
								spans[0].style.color === 'rgb(255, 0, 0)';
							const detail = field.innerHTML;
							document.execCommand('undo');
							const undo = field.innerHTML === '<span style="color:#ff0000">before selected after</span>';
							field.remove();
							setResult(JSON.stringify({ passed, undo, detail }));
						}}
					>
						Run selection and undo regression
					</button>
				</div>
				<pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result}</pre>
				<BuilderCheck />
				<TightBuilderCheck />
				<h2>Saved rendering</h2>
				<RichTextBlocks blocks={doc.blocks} />
				<details>
					<summary>Saved JSON</summary>
					<pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(doc, null, 2)}</pre>
				</details>
				<p style={{ marginTop: 80 }}>End of test document</p>
			</main>
		</ChakraProvider>
	);
}
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
import.meta.hot?.dispose(() => root.unmount());
