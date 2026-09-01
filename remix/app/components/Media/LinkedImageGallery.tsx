import React from 'react';
import { Box, Button, Flex, IconButton, Image, Input, Text, Textarea } from '@chakra-ui/react';
import { Link2, X } from 'lucide-react';

import { MediaGalleryGrid, MediaGalleryTile, type MediaGalleryGridProps, type MediaGalleryTileProps } from './MediaGallery';
import {
	appendLinkedImageLines,
	isLinkedImageUrl,
	linkedImageAddMessage,
	linkedImageItemError,
	MAX_LINKED_IMAGES,
	type LinkedImageItem
} from './mediaGalleryCore';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';

export type LinkedImageGalleryProps = {
	items: LinkedImageItem[];
	onChange: (items: LinkedImageItem[]) => void;
	disabled?: boolean;
	maxItems?: number;
	ariaLabel?: string;
	addButtonLabel?: string;
	itemLabel?: string;
	inputLabel?: string;
	helperText?: string;
	noun?: string;
	submitButtonLabel?: string;
	aspectRatio?: MediaGalleryTileProps['aspectRatio'];
	gridTemplateColumns?: MediaGalleryGridProps['templateColumns'];
	// inline: no "Add from URL" disclosure — a single always-visible URL input
	// with an Add button sits below the preview grid, clearing after each add
	// so the next URL can go straight in
	inline?: boolean;
};

export const LinkedImageGallery = React.memo((props: LinkedImageGalleryProps) => {
	const {
		items,
		onChange,
		disabled,
		maxItems = MAX_LINKED_IMAGES,
		ariaLabel = 'Linked image URLs',
		addButtonLabel = 'Add from URL',
		itemLabel = 'Linked image',
		inputLabel = 'Public image URLs',
		helperText,
		noun = 'linked image',
		submitButtonLabel,
		aspectRatio,
		gridTemplateColumns,
		inline = false
	} = props;
	const [adding, setAdding] = React.useState(false);
	const [input, setInput] = React.useState('');
	const [message, setMessage] = React.useState<string | null>(null);
	const [brokenPreviewIds, setBrokenPreviewIds] = React.useState<Set<string>>(() => new Set());
	const panelId = React.useId();

	const updateItem = React.useCallback(
		(id: string, url: string) => {
			setBrokenPreviewIds((current) => {
				if (!current.has(id)) return current;
				const next = new Set(current);
				next.delete(id);
				return next;
			});
			onChange(items.map((item) => (item.id === id ? { ...item, url } : item)));
		},
		[items, onChange]
	);

	const removeItem = React.useCallback(
		(id: string) => {
			setBrokenPreviewIds((current) => {
				if (!current.has(id)) return current;
				const next = new Set(current);
				next.delete(id);
				return next;
			});
			onChange(items.filter((item) => item.id !== id));
		},
		[items, onChange]
	);

	const addLinkedImages = React.useCallback(() => {
		// the inline single-line input can receive several pasted URLs at once —
		// URLs never contain whitespace, so every run of it splits entries
		const result = appendLinkedImageLines(items, inline ? input.trim().replace(/\s+/g, '\n') : input, { maxItems });
		onChange(result.items);
		setInput(result.remainingInput);
		setMessage(linkedImageAddMessage(result, maxItems, noun));
		if (!result.remainingInput && result.addedCount > 0) setAdding(false);
	}, [inline, input, items, maxItems, noun, onChange]);

	const labelForItem = React.useCallback((index: number) => (maxItems === 1 ? itemLabel : `${itemLabel} ${index + 1}`), [itemLabel, maxItems]);

	return (
		<Flex flexDirection="column" rowGap={2} role="group" aria-label={ariaLabel}>
			{items.length > 0 ? (
				<MediaGalleryGrid ariaLabel={`${ariaLabel} previews`} templateColumns={gridTemplateColumns}>
					{items.map((item, index) => {
						const itemError = linkedImageItemError(items, index);
						const previewReady = isLinkedImageUrl(item.url);
						const previewBroken = brokenPreviewIds.has(item.id);
						const errorId = `${panelId}-${index}-error`;
						return (
							<MediaGalleryTile
								key={item.id}
								ariaLabel={labelForItem(index)}
								invalid={Boolean(itemError)}
								aspectRatio={aspectRatio}
								preview={
									previewReady && !previewBroken ? (
										<Image
											src={item.url.trim()}
											alt={`${labelForItem(index)} preview`}
											width="100%"
											height="100%"
											objectFit="cover"
											loading="lazy"
											referrerPolicy="no-referrer"
											onError={() => setBrokenPreviewIds((current) => new Set(current).add(item.id))}
										/>
									) : (
										<Flex width="100%" height="100%" alignItems="center" justifyContent="center" padding={3} textAlign="center">
											<Text fontSize="xs" color={MUTED} whiteSpace="normal">
												{previewBroken ? 'Preview unavailable' : 'Add an image URL below'}
											</Text>
										</Flex>
									)
								}
								action={
									<IconButton
										aria-label={`Remove ${labelForItem(index).toLowerCase()}`}
										icon={<X size={14} />}
										size="sm"
										minWidth="44px"
										height="44px"
										position="absolute"
										top={1}
										right={1}
										variant="solid"
										background="rgba(255, 255, 255, 0.9)"
										color="var(--tt-text, #5a5a66)"
										borderRadius="999px"
										isDisabled={disabled}
										onClick={() => removeItem(item.id)}
									/>
								}
							>
								<Input
									size="xs"
									value={item.url}
									placeholder="https://…"
									aria-label={`URL for ${labelForItem(index).toLowerCase()}`}
									aria-describedby={itemError ? errorId : undefined}
									borderRadius={RADIUS_SM}
									isInvalid={Boolean(itemError)}
									isDisabled={disabled}
									onChange={(event) => updateItem(item.id, event.target.value)}
									onBlur={(event) => updateItem(item.id, event.currentTarget.value.trim())}
								/>
								{itemError ? (
									<Text id={errorId} fontSize="10px" color="var(--tt-danger, #e5484d)" paddingTop={1} whiteSpace="normal">
										{itemError}
									</Text>
								) : null}
							</MediaGalleryTile>
						);
					})}
				</MediaGalleryGrid>
			) : null}

			{inline && items.length < maxItems ? (
				<Flex columnGap={2} alignItems="center">
					<Input
						id={`${panelId}-input`}
						size="sm"
						value={input}
						placeholder="https://example.com/photo.jpg"
						aria-label={inputLabel}
						borderRadius={RADIUS_SM}
						isDisabled={disabled}
						onChange={(event) => {
							setInput(event.target.value);
							setMessage(null);
						}}
						onKeyDown={(event) => {
							if (event.key !== 'Enter') return;
							event.preventDefault();
							if (input.trim()) addLinkedImages();
						}}
					/>
					<Button
						type="button"
						size="sm"
						minHeight="44px"
						flexShrink={0}
						borderRadius="var(--tt-radius-md, 12px)"
						leftIcon={<Link2 size={14} />}
						isDisabled={disabled || !input.trim()}
						onClick={addLinkedImages}
					>
						{submitButtonLabel ?? 'Add'}
					</Button>
				</Flex>
			) : null}
			{inline && helperText ? (
				<Text fontSize="11px" color={MUTED} whiteSpace="normal">
					{helperText}
				</Text>
			) : null}

			{!inline && items.length < maxItems ? (
				<Box>
					<Button
						type="button"
						size="sm"
						variant="outline"
						leftIcon={<Link2 size={14} />}
						minHeight="44px"
						borderRadius="var(--tt-radius-md, 12px)"
						borderColor="var(--tt-border, #ececef)"
						isDisabled={disabled}
						aria-expanded={adding}
						aria-controls={panelId}
						onClick={() => setAdding((current) => !current)}
					>
						{addButtonLabel}
					</Button>
				</Box>
			) : null}

			{!inline && adding ? (
				<Flex
					id={panelId}
					flexDirection="column"
					rowGap={2}
					padding={3}
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
				>
					<Text as="label" htmlFor={`${panelId}-input`} fontSize="xs" fontWeight={650} color="var(--tt-text, #5a5a66)">
						{inputLabel}
					</Text>
					<Textarea
						id={`${panelId}-input`}
						value={input}
						placeholder={'https://example.com/photo-one.jpg\nhttps://example.com/photo-two.jpg'}
						rows={3}
						resize="vertical"
						isDisabled={disabled}
						onChange={(event) => {
							setInput(event.target.value);
							setMessage(null);
						}}
					/>
					<Text fontSize="11px" color={MUTED} whiteSpace="normal">
						{helperText ?? `One full http(s) image URL per line · ${Math.max(0, maxItems - items.length)} remaining`}
					</Text>
					<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
						<Button
							type="button"
							size="sm"
							minHeight="44px"
							borderRadius="var(--tt-radius-md, 12px)"
							isDisabled={disabled || !input.trim()}
							onClick={addLinkedImages}
						>
							{submitButtonLabel ?? `Add ${noun}${maxItems === 1 ? '' : 's'}`}
						</Button>
						<Button type="button" size="sm" minHeight="44px" variant="ghost" isDisabled={disabled} onClick={() => setAdding(false)}>
							Cancel
						</Button>
					</Flex>
				</Flex>
			) : null}

			{message ? (
				<Text
					fontSize="11px"
					color={message.includes('http(s)') || message.includes('up to') ? 'var(--tt-danger, #e5484d)' : MUTED}
					role="status"
					whiteSpace="normal"
				>
					{message}
				</Text>
			) : null}
		</Flex>
	);
});

LinkedImageGallery.displayName = 'LinkedImageGallery';
