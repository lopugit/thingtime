import React from 'react';
import { Avatar, Button, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { avatarThumbnail } from './inviteClient';
import { useLopu } from '~/components/Lopu/useLopu';
export type InviteProfile = { username: string; displayName: string; avatarUrl: string | null };
export const InviteProfileFields = ({
	value,
	onChange,
	disabled = false,
	onPreparingChange
}: {
	value: InviteProfile;
	onChange: (value: InviteProfile) => void;
	disabled?: boolean;
	onPreparingChange?: (busy: boolean) => void;
}) => {
	const lopu = useLopu();
	const [preparing, setPreparing] = React.useState(false);
	const selection = React.useRef(0);
	const id = React.useId();
	return (
		<Flex direction="column" gap={4} minW={0}>
			<Flex gap={3} align="center" wrap="wrap">
				<Avatar size="lg" name={value.displayName} src={value.avatarUrl || undefined} />
				<FormControl flex="1" minW="180px">
					<FormLabel htmlFor={`${id}-avatar`} fontSize="sm">
						Profile picture
					</FormLabel>
					<Input
						id={`${id}-avatar`}
						type="file"
						accept="image/png,image/jpeg,image/webp"
						disabled={disabled || preparing}
						p={1}
						h="auto"
						maxW="100%"
						onChange={async (event) => {
							const file = event.target.files?.[0];
							event.target.value = '';
							if (!file) return;
							const current = ++selection.current;
							setPreparing(true);
							onPreparingChange?.(true);
							try {
								const avatarUrl = await avatarThumbnail(file);
								if (selection.current === current) onChange({ ...value, avatarUrl });
							} catch (error) {
								lopu({ title: 'Could not use this photo', description: (error as Error).message, status: 'error' });
							} finally {
								setPreparing(false);
								onPreparingChange?.(false);
							}
						}}
					/>
				</FormControl>
				{value.avatarUrl && (
					<Button size="xs" variant="ghost" isDisabled={disabled || preparing} onClick={() => onChange({ ...value, avatarUrl: null })}>
						Remove photo
					</Button>
				)}
			</Flex>
			{preparing && <Text fontSize="xs">Preparing photo…</Text>}
			<FormControl isRequired>
				<FormLabel htmlFor={`${id}-name`}>Display name</FormLabel>
				<Input
					id={`${id}-name`}
					value={value.displayName}
					maxLength={100}
					disabled={disabled || preparing}
					onChange={(e) => onChange({ ...value, displayName: e.target.value })}
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
					onChange={(e) => onChange({ ...value, username: e.target.value })}
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
