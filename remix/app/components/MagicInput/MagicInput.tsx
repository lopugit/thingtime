import React from 'react';
import { Box, type BoxProps } from '@chakra-ui/react';

import { uuid as uuidV4 } from '~/smarts';

export interface MagicInputProps {
	timemachineNamespace?: string;

	value?: string;
	placeholder?: string;
	onValueChange?: (args: { value: string }) => void;
	onChange?: (args: { value: string }) => void;
	onFocus?: (event: React.FocusEvent<HTMLDivElement>) => void;
	onEnter?: (args: { value: string | undefined }) => void;
	readonly?: boolean;
	transition?: BoxProps['transition'];
	chakras?: BoxProps;
	whiteSpace?: BoxProps['whiteSpace'];
	fullPath?: string;
	path?: string;
}

export const MagicInput = React.forwardRef<HTMLDivElement, MagicInputProps & Omit<BoxProps, keyof MagicInputProps>>((props, ref) => {
	const { onValueChange: onValueChangeProp, onChange: onChangeProp, onFocus: onFocusProp, onEnter: onEnterProp } = props;
	const [inputValue, setInputValue] = React.useState<string | undefined>(props.value ?? props.placeholder);

	const [isClientSide, setIsClientSide] = React.useState(false);

	const [uuid] = React.useState(uuidV4());

	React.useEffect(() => {
		setIsClientSide(true);
	}, []);

	const contentEditableRef = React.useRef<HTMLDivElement>(null);
	const editValueRef = React.useRef<Record<string, string>>({});

	// values are plain text: escape them before the newline -> <br/> pass so
	// dangerouslySetInnerHTML can never execute markup smuggled into a value
	// (pasted, API-loaded, or shared)
	const escapeHtml = React.useCallback((value: string) => {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}, []);

	const [contentEditableValue, setContentEditableValue] = React.useState(props?.value || props?.placeholder || '');

	const updateContentEditableValue = React.useCallback(
		(rawValue: string | undefined) => {
			// replace all new line occurences in value with <div><br></div>

			const value = typeof rawValue === 'string' ? escapeHtml(rawValue) : '';

			// extract all series of new lines
			const newlines = value?.split?.(/[^\n]/)?.filter((v) => v !== '');

			let newValue = value;

			// replace all new lines groups with <div><br></div>
			newlines?.forEach?.((newline) => {
				const baseLength = '\n'?.length;

				const newlineClone = newline;

				const newlineClonePart1 = newlineClone?.replace('\n\n\n', '<div><br /></div>');
				const newlineClonePart2 = newlineClonePart1?.replace(/\n\n/g, '<div><br /></div>');
				const newlineClonePart3 = newlineClonePart2?.replace(/\n/g, '<br />');

				newValue = newValue?.replace(newline, newlineClonePart3);
			});

			setContentEditableValue(newValue);
		},
		[escapeHtml]
	);

	React.useEffect(() => {
		setInputValue(contentEditableValue);
	}, [contentEditableValue]);

	React.useEffect(() => {
		const entries = Object.entries(editValueRef.current);
		const propsValueInEntries = entries?.find?.((entry) => entry[1] === props?.value);
		if (!propsValueInEntries) {
			// const valueToUse = props?.value || props?.placeholder
			const valueToUse = props?.value;
			updateContentEditableValue(valueToUse);
			// setContentEditableValue(props?.value)
		} else {
			const [time, value] = propsValueInEntries;
			if (time && value) {
				delete editValueRef.current[time];
			}
		}
	}, [props?.value, props?.placeholder, updateContentEditableValue]);

	const onValueChange = React.useCallback(
		(args: { value: string }) => {
			const { value } = args;
			onValueChangeProp?.({ value });
			onChangeProp?.({ value });
			// updateContentEditableValue(value)
		},
		[onValueChangeProp, onChangeProp]
	);

	const updateValue = React.useCallback(
		(args: { value: string }) => {
			const { value } = args;

			onValueChange({ value });
			setInputValue(value);
		},
		[onValueChange]
	);

	const onFocus = React.useCallback(
		(e: React.FocusEvent<HTMLDivElement>) => {
			onFocusProp?.(e);
		},
		[onFocusProp]
	);

	const maybeUpdateValue = React.useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			const { key } = e;
			if (key === 'Enter') {
				if (onEnterProp) {
					e?.preventDefault?.();
				}
				onEnterProp?.({ value: inputValue });
			}
		},
		[inputValue, onEnterProp]
	);

	const dangerouslySetInnerHTML = React.useMemo(() => {
		if (!props?.readonly) {
			return { __html: contentEditableValue };
		}
		// return { __html: contentEditableValue }
	}, [contentEditableValue, props?.readonly]);

	return (
		<Box key={uuid} position="relative" width="100%" transition={props?.transition} {...(props?.chakras || {})} ref={ref}>
			<Box
				className="magic-input-focusable"
				ref={contentEditableRef}
				whiteSpace={props?.whiteSpace}
				width="100%"
				maxWidth="100%"
				border="none"
				outline="none"
				contentEditable={!props?.readonly ? true : false}
				dangerouslySetInnerHTML={dangerouslySetInnerHTML}
				onFocus={onFocus}
				onInput={(value: EventTarget | any) => {
					const innerText = value?.target?.innerText;
					if (typeof innerText === 'string') {
						const time = Date.now();
						editValueRef.current[time] = innerText;
						updateValue({ value: innerText });
					}
				}}
				onKeyDown={maybeUpdateValue}
			>
				{props?.readonly ? props?.value : null}
			</Box>
			<Box display={!props.readonly || inputValue || !isClientSide ? 'none' : 'block'} opacity={0}>
				Imagine..
			</Box>
			<Box
				position="absolute"
				top={0}
				left={0}
				display={inputValue || !isClientSide ? 'none' : 'block'}
				width="100%"
				maxWidth="100%"
				color="var(--tt-muted, #9a9aa6)"
				pointerEvents="none"
			>
				{props?.placeholder || 'Imagine..'}
			</Box>
		</Box>
	);
});

MagicInput.displayName = 'MagicInput';
