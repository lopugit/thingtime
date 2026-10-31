import React from 'react';
import { Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { ProfileMediaField } from '../Profile/ProfileMediaField';
import type { ProfileMediaFieldSnapshot } from '../Profile/profileMediaCore';
export type InviteProfile = { username: string; displayName: string; avatarUrl: string | null };
export const InviteProfileFields = ({
	value,
	onChange,
	disabled = false,
	onPreparingChange
}: {
	value: InviteProfile;
	onChange: React.Dispatch<React.SetStateAction<InviteProfile>>;
	disabled?: boolean;
	onPreparingChange?: (busy: boolean) => void;
}) => {
	const [preparing, setPreparing] = React.useState(false);
	const id = React.useId();
	const photoChanged = React.useCallback(
		(snapshot: ProfileMediaFieldSnapshot) => {
			setPreparing(snapshot.blocking);
			onPreparingChange?.(snapshot.blocking);
			if (!snapshot.blocking)
				onChange((current) => (current.avatarUrl === snapshot.previewUrl ? current : { ...current, avatarUrl: snapshot.previewUrl }));
		},
		[onChange, onPreparingChange]
	);
	return (
		<Flex direction="column" gap={4} minW={0}>
			<ProfileMediaField
				ownerId={id}
				slot="avatar"
				label="Profile picture"
				storageMode="inline-thumbnail"
				savedUrl={value.avatarUrl}
				savedLinkedUrl={null}
				disabled={disabled}
				onChange={photoChanged}
			/>
			<FormControl isRequired>
				<FormLabel htmlFor={`${id}-name`}>Display name</FormLabel>
				<Input
					id={`${id}-name`}
					value={value.displayName}
					maxLength={100}
					disabled={disabled || preparing}
					onChange={(e) => {
						const displayName = e.target.value;
						onChange((current) => ({ ...current, displayName }));
					}}
					autoComplete="name"
				/>
			</FormControl>
			<FormControl isRequired>
				<FormLabel htmlFor={`${id}-username`}>Username</FormLabel>
				<Input
					id={`${id}-username`}
					value={value.username}
					maxLength={40}
					disabled={disabled || preparing}
					onChange={(e) => {
						const username = e.target.value;
						onChange((current) => ({ ...current, username }));
					}}
					autoCapitalize="none"
					autoComplete="username"
					pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{1,39}"
				/>
				<Text fontSize="xs" mt={1} color="var(--tt-muted)">
					2–40 letters, numbers, dots, underscores or hyphens.
				</Text>
			</FormControl>
		</Flex>
	);
};
