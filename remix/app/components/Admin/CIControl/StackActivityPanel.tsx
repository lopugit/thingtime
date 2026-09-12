import { Badge, Box, Flex, Grid, Heading, Link, Stack, Text } from '@chakra-ui/react';
import type { StackActivity } from './featureStackActivity';
const colors: Record<StackActivity['state'], string> = {
	working: 'blue',
	queued: 'gray',
	waiting: 'orange',
	blocked: 'red',
	failed: 'red',
	merged: 'green',
	skipped: 'gray',
	stopped: 'gray',
	unknown: 'gray'
};
export function StackActivityPanel({ rows }: { rows: StackActivity[] }) {
	return (
		<Grid templateColumns={{ base: 'minmax(0, 1fr)', lg: 'repeat(3, minmax(0, 1fr))' }} gap={3} mt={4} aria-label="Current target activity">
			{rows.map((row) => (
				<Box
					key={row.target}
					border="1px solid var(--tt-border, #e7e7eb)"
					bg="var(--tt-card, #fff)"
					borderRadius="lg"
					p={4}
					minW={0}
					overflowWrap="anywhere"
				>
					<Flex gap={2} justify="space-between" align="start" wrap="wrap">
						<Heading size="xs">{row.target}</Heading>
						<Badge colorScheme={colors[row.state]} whiteSpace="normal">
							{row.title}
						</Badge>
					</Flex>
					<Stack spacing={2} mt={3}>
						<Text fontSize="sm">{row.detail}</Text>
						<Text fontSize="xs" opacity={0.75}>
							<strong>Next:</strong> {row.next}
						</Text>
						{row.updatedAt ? (
							<Text fontSize="xs" opacity={0.6}>
								Last reported {new Date(row.updatedAt).toLocaleString()}
							</Text>
						) : null}
						{row.url ? (
							<Link href={row.url} isExternal fontSize="xs" textDecoration="underline">
								Open {row.url.includes('/job/') ? 'worker job' : 'target PR'} ↗
							</Link>
						) : null}
					</Stack>
				</Box>
			))}
		</Grid>
	);
}
