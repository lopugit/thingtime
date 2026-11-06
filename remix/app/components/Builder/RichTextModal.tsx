import React from 'react';
import { Button, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay } from '@chakra-ui/react';

import { DRAWER_Z } from '../Nav/Drawer/useDrawer';
import { LongTextEditor, type LongTextEditorHandle, type LongTextValue } from '../Editor/LongTextEditor';
import { makeEditorPanelResizable } from '../Editor/floatingEditorPanel';
import { EditorHistory } from '../Editor/editorHistory';
import { isEditorJsDoc } from '../Editor/editorJsValue';
import { editorJsToHtml, htmlToEditorJs, htmlToPlainText } from './editorJsHtml';
import type { WebpageBlock } from './webpageBlocks';
import { useLopu } from '../Lopu/useLopu';

function ResizeHandle() {
	const ref = React.useRef<HTMLButtonElement>(null);
	React.useEffect(() => {
		const panel = ref.current?.closest<HTMLElement>('[data-testid="rich-text-editor-modal"]');
		if (panel && ref.current) return makeEditorPanelResizable(panel, ref.current);
	}, []);
	return (
		<button ref={ref} type="button" style={{ padding: '8px' }}>
			⤡
		</button>
	);
}

// The ADVANCED Editor.js editing surface for a text block — reachable from
// the drawer's 📝 button and the block right-click menu. The everyday path is
// the inline canvas editor; this modal gives a big, focused canvas. Apply
// converts the document to the block's sanitised-at-render html (+ plain-text
// fallback); opening converts the stored html back into editable blocks
// (scrubbed on entry — the modal renders live innerHTML).
export const RichTextModal = ({
	block,
	isOpen,
	onClose,
	onApply
}: {
	block: WebpageBlock;
	isOpen: boolean;
	onClose: () => void;
	onApply: (patch: Partial<WebpageBlock>) => void;
}) => {
	const [value, setValue] = React.useState<LongTextValue>('');
	const seededForRef = React.useRef<string | null>(null);
	const editorRef = React.useRef<LongTextEditorHandle>(null);
	const [saving, setSaving] = React.useState(false);
	const lopu = useLopu();
	const histories = React.useRef(new Map<string, EditorHistory>());
	if (!histories.current.has(block.id)) histories.current.set(block.id, new EditorHistory());

	React.useEffect(() => {
		if (!isOpen) {
			seededForRef.current = null;
			return;
		}
		const seedKey = `${block.id}:${block.html || ''}:${block.text || ''}`;
		if (seededForRef.current === seedKey) return;
		seededForRef.current = seedKey;
		setValue(block.html ? htmlToEditorJs(block.html) : block.text || '');
	}, [isOpen, block.id, block.html, block.text]);

	const apply = async () => {
		setSaving(true);
		try {
			const latest = (await editorRef.current?.save()) ?? value;
			if (isEditorJsDoc(latest)) {
				const html = editorJsToHtml(latest);
				onApply({ html, text: htmlToPlainText(html).slice(0, 2000) });
			} else {
				onApply({ text: String(latest || ''), html: undefined });
			}
			onClose();
		} catch {
			lopu({ title: 'Could not save this text', description: 'Your editor and change history are still open. Please try again.', status: 'error' });
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="6xl" scrollBehavior="inside">
			<ModalOverlay zIndex={DRAWER_Z + 20} />
			<ModalContent
				containerProps={{ zIndex: DRAWER_Z + 21 }}
				data-testid="rich-text-editor-modal"
				width="min(1100px,calc(100vw - 24px))"
				height="min(780px,calc(100dvh - 24px))"
				maxWidth="calc(100vw - 24px)"
				maxHeight="calc(100dvh - 24px)"
				my="12px"
				resize="both"
				overflow="hidden"
			>
				<ModalHeader fontSize="sm">Rich text ✍️</ModalHeader>
				<ModalCloseButton />
				<ModalBody pt="40px">
					{isOpen ? (
						<LongTextEditor
							key={block.id}
							history={histories.current.get(block.id)}
							ref={editorRef}
							value={value}
							onValueChange={setValue}
							placeholder="Write something lovely ✨"
							minHeight="280px"
							blockTypes={{ embed: false, warning: false }}
						/>
					) : null}
				</ModalBody>
				<ModalFooter columnGap={2}>
					<Button size="sm" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button size="sm" isLoading={saving} onClick={() => void apply()} data-testid="rich-text-editor-apply">
						Save
					</Button>
					<ResizeHandle />
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
