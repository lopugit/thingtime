import React from 'react';
import { Box, Link, Text } from '@chakra-ui/react';

export type ControlResult = { action: string; ok: boolean; result: unknown; error: string | null };

const metadata = new Set(['id', 'ownerId', 'schema', 'schemaId', 'message', 'silent', 'status']);
const display = (value: unknown): string =>
	typeof value === 'string'
		? value
		: typeof value === 'number' || typeof value === 'boolean'
		? String(value)
		: JSON.stringify(value)?.slice(0, 1000) || '';
const ResultRecord = ({ value, showLink = true }: { value: unknown; showLink?: boolean }) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return <Text>{display(value)}</Text>;
	const item = value as Record<string, unknown>;
	const fields = item.crystal && typeof item.crystal === 'object' && !Array.isArray(item.crystal) ? (item.crystal as Record<string, unknown>) : item;
	const title = typeof fields.title === 'string' ? fields.title : typeof fields.name === 'string' ? fields.name : 'Saved Thing';
	return (
		<Box paddingY="8px">
			{showLink && typeof item.id === 'string' ? (
				<Link href={`/thing/${encodeURIComponent(item.id)}`} fontWeight={600} textDecoration="underline">
					{title}
				</Link>
			) : null}
			{Object.entries(fields)
				.filter(([key]) => !metadata.has(key))
				.slice(0, 16)
				.map(([key, content]) => (
					<Text key={key} fontSize="sm">
						<Box as="span" fontWeight={600}>
							{key.replace(/([a-z])([A-Z])/g, '$1 $2')}:{' '}
						</Box>
						{display(content)}
					</Text>
				))}
		</Box>
	);
};

// Results belong to the control that ran, including outside a page provider.
// Ordinary React text escaping applies; results never become executable markup.
export const ActionResult = ({ outcome }: { outcome: ControlResult }) => {
	const result = outcome.result;
	const record = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
	if (record?.silent === true) return null;
	const id = typeof record?.id === 'string' ? record.id : null;
	return (
		<Box
			role="status"
			aria-live="polite"
			marginTop="12px"
			padding="12px"
			border="1px solid var(--tt-border, #ddd)"
			borderRadius="10px"
			maxWidth="100%"
			overflowWrap="anywhere"
		>
			<Text fontWeight={600}>
				{outcome.ok ? (typeof record?.message === 'string' ? record.message : 'Action completed') : outcome.error || 'Action failed'}
			</Text>
			{id ? (
				<Link href={`/thing/${encodeURIComponent(id)}`} textDecoration="underline">
					Open saved Thing
				</Link>
			) : null}
			{outcome.ok && result !== null && result !== undefined ? (
				<Box maxHeight="320px" overflow="auto" marginTop="8px">
					{Array.isArray(result) ? (
						result.length ? (
							result.slice(0, 24).map((item, index) => <ResultRecord key={index} value={item} />)
						) : (
							<Text>No records yet.</Text>
						)
					) : (
						<ResultRecord value={result} showLink={!id} />
					)}
				</Box>
			) : null}
		</Box>
	);
};
