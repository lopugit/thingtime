import React from 'react';
import { Button, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay } from '@chakra-ui/react';

import { DRAWER_Z } from '../Nav/Drawer/useDrawer';
import { LongTextEditor, type LongTextValue } from '../Editor/LongTextEditor';
import { isEditorJsDoc } from '../Editor/editorJsValue';
import { editorJsToHtml, htmlToEditorJs, htmlToPlainText } from './editorJsHtml';
import type { WebpageBlock } from './webpageBlocks';

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

	const apply = () => {
		if (isEditorJsDoc(value)) {
			const html = editorJsToHtml(value);
			onApply({ html, text: htmlToPlainText(html).slice(0, 2000) });
		} else {
			onApply({ text: String(value || ''), html: undefined });
		}
		onClose();
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
			<ModalOverlay zIndex={DRAWER_Z + 20} />
			<ModalContent containerProps={{ zIndex: DRAWER_Z + 21 }} data-testid="rich-text-editor-modal">
				<ModalHeader fontSize="sm">Rich text ✍️</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					{isOpen ? (
						<LongTextEditor
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
					<Button size="sm" onClick={apply} data-testid="rich-text-editor-apply">
						Apply
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
