import React from 'react';
import { Box } from '@chakra-ui/react';
import { LongTextEditor, type LongTextEditorHandle, type LongTextBlockTypes } from '../Editor/LongTextEditor';
import { getEditorJsValueSignature, type EditorJsDoc } from '../Editor/editorJsValue';
import { RichTextBlocks } from '../Kinds/kindRenderersMedia';
import { ComponentDisplayOnly, NativeControlsEnabled } from './NativeComponentControls';
import { useWebpageRuntime } from './webpageRuntime';
import { registerComponentFormField } from './componentFormFields';
import { observeFirstVisibleEditor } from './componentRichTextVisibility';
import {
	componentRichTextDocument,
	componentRichTextHasContent,
	componentRichTextSnapshot,
	componentRichTextSaveSnapshot,
	componentRichTextFieldName
} from './componentRichTextValue';

type Props = {
	name?: unknown;
	plainTextName?: unknown;
	value?: unknown;
	readOnly?: unknown;
	disabled?: unknown;
	required?: unknown;
	placeholder?: unknown;
	label?: unknown;
	blockTypes?: unknown;
	presentation?: unknown;
	minHeight?: unknown;
	resetKey?: unknown;
};

/** One reusable authored field/read adapter; the caller owns its saved schema
 * and Action. Inert previews never mount an editor or contribute form inputs. */
export function ComponentRichText(props: Props) {
	const enabled = React.useContext(NativeControlsEnabled);
	const displayOnly = React.useContext(ComponentDisplayOnly);
	const interactive = enabled && !displayOnly;
	const runtime = useWebpageRuntime();
	let document: EditorJsDoc;
	try {
		document = componentRichTextDocument(props.value);
		componentRichTextSnapshot(document);
	} catch (error) {
		return <p role="alert">{error instanceof Error ? error.message : 'Rich text is unavailable.'}</p>;
	}
	if (!interactive || props.readOnly === true)
		return (
			<Box
				minWidth={0}
				overflowWrap="anywhere"
				sx={
					props.presentation === 'inline'
						? {
								'& :is(p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, span)': { color: 'inherit', fontSize: 'inherit', fontFamily: 'inherit' }
						  }
						: undefined
				}
			>
				<RichTextBlocks blocks={document.blocks} />
			</Box>
		);
	return <RichTextField key={JSON.stringify([runtime.identity.key, props.resetKey ?? null, props.name ?? null])} {...props} document={document} />;
}

function RichTextField(props: Props & { document: EditorJsDoc }) {
	const editor = React.useRef<LongTextEditorHandle>(null);
	const host = React.useRef<HTMLDivElement>(null);
	const jsonField = React.useRef<HTMLInputElement>(null);
	const textField = React.useRef<HTMLInputElement>(null);
	const [document, setDocument] = React.useState(props.document);
	const dirty = React.useRef(false);
	const latestDefault = React.useRef(props.document);
	latestDefault.current = props.document;
	const [opened, setOpened] = React.useState(false);
	const openedRef = React.useRef(false);

	const [error, setError] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	const mounted = React.useRef(true);
	const name = componentRichTextFieldName(props.name),
		plainName = componentRichTextFieldName(props.plainTextName);
	const disabled = props.disabled === true;
	const binding = React.useMemo(() => ({ disabled, name, plainName }), [disabled, name, plainName]);
	const current = React.useRef(binding);
	current.current = binding;
	const open = React.useCallback(() => {
		if (!current.current.disabled && !openedRef.current) {
			openedRef.current = true;
			setOpened(true);
		}
	}, []);
	React.useEffect(() => {
		if (openedRef.current || disabled || !host.current) return;
		return observeFirstVisibleEditor(host.current, open);
	}, [disabled, open]);
	const signature = getEditorJsValueSignature(props.document);
	React.useEffect(() => {
		if (!dirty.current) setDocument(props.document);
		// Adopt late source defaults only until the visitor edits the field.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [signature]);
	React.useEffect(() => {
		mounted.current = true;
		const element = host.current;
		if (!element) return;
		const unregister = registerComponentFormField(element, async () => {
			if (current.current.disabled) return;
			const binding = current.current;
			setSaving(true);
			try {
				const source = latestDefault.current;
				const saved = await editor.current?.save();
				if (!mounted.current || current.current !== binding || !element.isConnected)
					throw new Error('This rich-text field changed while it was saving.');
				const snapshot = componentRichTextSaveSnapshot(saved, source, dirty.current);
				if (props.required === true && !componentRichTextHasContent(snapshot.document)) throw new Error('Enter text before saving this field.');
				// Write both named values synchronously before the form collector
				// runs; React state batching cannot leave the previous draft behind.
				if (jsonField.current) jsonField.current.value = snapshot.json;
				if (textField.current) textField.current.value = snapshot.plainText;
				setDocument(snapshot.document);
				setError('');
				return {
					...(binding.name ? { [binding.name]: snapshot.document } : {}),
					...(binding.plainName && binding.plainName !== binding.name ? { [binding.plainName]: snapshot.plainText } : {})
				};
			} catch (failure) {
				if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not save this rich text.');
				throw failure;
			} finally {
				if (mounted.current) setSaving(false);
			}
		});
		return () => {
			mounted.current = false;
			unregister();
		};
	}, [props.required]);
	const snapshot = componentRichTextSnapshot(document);
	return (
		<div
			ref={host}
			data-tt-form-field="rich-text"
			role="group"
			aria-label={typeof props.label === 'string' ? props.label : name || 'Rich text'}
			aria-busy={saving}
			style={{ minWidth: 0 }}
			onInputCapture={() => {
				dirty.current = true;
			}}
			onBeforeInputCapture={() => {
				dirty.current = true;
			}}
			onPasteCapture={() => {
				dirty.current = true;
			}}
			onCutCapture={() => {
				dirty.current = true;
			}}
			onDropCapture={() => {
				dirty.current = true;
			}}
			onFocusCapture={open}
			onPointerDownCapture={open}
			onKeyDownCapture={(event) => {
				if (
					((event.ctrlKey || event.metaKey) && ['b', 'i', 'u', 'z', 'y', 'k'].includes(event.key.toLowerCase())) ||
					(event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key))
				)
					dirty.current = true;
			}}
			onClickCapture={(event) => {
				if ((event.target as HTMLElement).closest('button, [role="button"]')) dirty.current = true;
			}}
		>
			{props.label ? <div style={{ marginBottom: 6 }}>{String(props.label)}</div> : null}
			<fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
				{opened ? (
					<LongTextEditor
						ref={editor}
						value={document}
						readonly={disabled}
						onValueChange={(value) => {
							const next = componentRichTextDocument(value);
							setDocument(next);
							setError('');
						}}
						placeholder={typeof props.placeholder === 'string' ? props.placeholder : undefined}
						presentation={props.presentation === 'inline' ? 'inline' : 'field'}
						minHeight={typeof props.minHeight === 'string' ? props.minHeight : undefined}
						blockTypes={
							props.blockTypes && typeof props.blockTypes === 'object' && !Array.isArray(props.blockTypes)
								? (props.blockTypes as LongTextBlockTypes)
								: undefined
						}
					/>
				) : (
					<div
						data-tt-rich-text-preview=""
						style={{
							minHeight: typeof props.minHeight === 'string' ? props.minHeight : '96px',
							padding: props.presentation === 'inline' ? 0 : '10px 12px',
							border: props.presentation === 'inline' ? 0 : '1px solid var(--tt-border, #ececef)',
							borderRadius: 6
						}}
					>
						<RichTextBlocks blocks={document.blocks} />
					</div>
				)}
				{name ? <input ref={jsonField} type="hidden" name={name} data-tt-input-type="json" defaultValue={snapshot.json} disabled={disabled} /> : null}
				{plainName && plainName !== name ? (
					<input ref={textField} type="hidden" name={plainName} defaultValue={snapshot.plainText} disabled={disabled} />
				) : null}
			</fieldset>
			{saving ? (
				<span role="status" aria-label="Saving rich text" style={{ display: 'inline-block', fontSize: 12 }}>
					⋯
				</span>
			) : null}
			{error ? (
				<p role="alert" style={{ margin: '4px 0', color: 'var(--tt-danger, #c33)' }}>
					{error}
				</p>
			) : null}
		</div>
	);
}
