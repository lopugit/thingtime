import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { visibilityFromAcl } from '../schemas/registry';
import type { AccountSuiteConflict } from './accountSuiteReconcile';
import type { LocalThing } from './things';

type ConflictVersion = Pick<LocalThing, 'thingtime' | 'crystal' | 'extended' | 'tags' | 'folderId' | 'targetId'> & { acl: string[]; visibility?: string };
const audienceLabel = (row: ConflictVersion) => {
	const visibility = row.visibility || visibilityFromAcl(row.acl);
	return ({ private: 'Private', public: 'Public', hidden: 'Hidden link', app: 'App audience', inherited: 'Inherited access', inherit: 'Inherited access', limited: 'Restricted access' } as Record<string, string>)[visibility] || 'Custom access';
};

/** The exact audience belongs beside each selectable snapshot. A recovered
 * public version must never look like a private content-only restoration. */
export function AccountConflictVersion({ label, row }: { label: string; row: ConflictVersion }) {
	return <Box flex="1" minW="min(260px, 100%)" maxW="100%">
		<Text fontWeight="semibold">{label}</Text>
		<Text fontSize="sm">Audience: {audienceLabel(row)}</Text>
		<Box as="pre" maxH="240px" overflow="auto" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="xs">{JSON.stringify({
			thingtime: row.thingtime, crystal: row.crystal, extended: row.extended, tags: row.tags,
			folderId: row.folderId, targetId: row.targetId, acl: row.acl
		}, null, 2)}</Box>
	</Box>;
}

export function AccountSuiteConflictAlternatives({ alternatives, disabled, onChoose }: {
	alternatives: AccountSuiteConflict;
	disabled: boolean;
	onChoose(source: 'provisional' | 'canonical'): void;
}) {
	const choices = [
		{ source: 'provisional' as const, label: 'Original device version', row: alternatives.provisional },
		...(alternatives.canonical ? [{ source: 'canonical' as const, label: 'Previously cached account version', row: alternatives.canonical }] : [])
	];
	return <Box as="section" aria-label="Preserved suite versions" mt={4} pt={3} borderTopWidth="1px" minW={0}>
		<Text as="h3" fontWeight="bold">Other preserved suite versions</Text>
		<Text fontSize="sm">These versions were kept separately during installation. Choosing one replaces the current device version and syncs its content with the audience shown below.</Text>
		<Flex gap={3} flexWrap="wrap" my={3}>
			{choices.map(choice => <Box key={choice.source} flex="1" minW="min(260px, 100%)" maxW="100%">
				<AccountConflictVersion label={choice.label} row={choice.row} />
				<Button size="sm" minH="44px" height="auto" py={2} mt={2} whiteSpace="normal" maxW="100%" isDisabled={disabled}
					onClick={() => onChoose(choice.source)}>{`Use ${choice.label.toLowerCase()} · ${audienceLabel(choice.row)}`}</Button>
			</Box>)}
		</Flex>
	</Box>;
}
