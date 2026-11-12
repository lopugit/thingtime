import React from 'react';
import { Box, Button, Flex, Select, Text } from '@chakra-ui/react';

import { CustomAudienceModal } from '~/components/Feed/CustomAudienceModal';
import { THING_AUDIENCES, THING_AUDIENCE_META, aclForAudience, audienceOfAcl, preservedNonAudienceAcl, type ThingAudience } from './audienceCore';

export const ThingAudienceControl = ({
	acl,
	onChange,
	label = 'Audience',
	testId = 'thing-audience'
}: {
	acl: readonly string[];
	onChange: (acl: string[]) => void;
	label?: string;
	testId?: string;
}) => {
	const [customOpen, setCustomOpen] = React.useState(false);
	const audience = audienceOfAcl(acl);
	const meta = THING_AUDIENCE_META[audience];

	const pick = (next: ThingAudience) => {
		if (next === 'custom') {
			setCustomOpen(true);
			return;
		}
		onChange(aclForAudience(next, acl));
	};

	return (
		<>
			<Box minWidth={0} width="100%">
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" marginBottom={1}>
					{label}
				</Text>
				<Flex alignItems="center" gap={2}>
					<Select
						aria-label={label}
						data-testid={`${testId}-select`}
						onChange={(event) => pick(event.target.value as ThingAudience)}
						size="sm"
						value={audience}
					>
						{THING_AUDIENCES.map((value) => (
							<option key={value} value={value}>
								{THING_AUDIENCE_META[value].emoji} {THING_AUDIENCE_META[value].label}
							</option>
						))}
					</Select>
					{audience === 'custom' ? (
						<Button flexShrink={0} onClick={() => setCustomOpen(true)} size="sm" variant="outline">
							Edit 🎭
						</Button>
					) : null}
				</Flex>
				<Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" marginTop={1}>
					{meta.hint}
				</Text>
			</Box>
			<CustomAudienceModal
				initialAcl={acl}
				isOpen={customOpen}
				onApply={(customAcl) => onChange([...customAcl, ...preservedNonAudienceAcl(acl)])}
				onClose={() => setCustomOpen(false)}
			/>
		</>
	);
};
