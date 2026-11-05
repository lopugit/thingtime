import React from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import type { useMail } from '~/mail/useMail';
import { mailSettingsStatus, type MailSettingsWrite } from '~/mail/settingsSync';
export function MailSettingsStatus({ mail }: { mail: ReturnType<typeof useMail> }) {
	const [review, setReview] = React.useState<MailSettingsWrite | null>(null);
	const pending = Object.values(mail.data.settingsWrites);
	if (!pending.length) return null;
	return (
		<Flex direction="column" gap={2} minW={0}>
			<Text role="status" fontSize="sm">
				Your mail settings are saved on this device. Account sync runs separately.
			</Text>
			{pending.map((write) => (
				<Flex key={`${write.kind}:${write.id}`} direction="column" gap={2}>
					<Text fontSize="sm" overflowWrap="anywhere">
						{write.name}: {mailSettingsStatus(write)}
					</Text>
					{write.status && [400, 403, 404, 409, 410, 413, 422].includes(write.status) && (
						<Button size="sm" alignSelf="start" onClick={() => setReview(structuredClone(write))}>
							Review account settings
						</Button>
					)}
				</Flex>
			))}
			{review && (
				<Flex direction="column" gap={2} border="1px solid var(--tt-border)" p={3}>
					<Text fontSize="sm" overflowWrap="anywhere">
						Replace this device’s pending changes to “{review.name}” with the latest account settings? If the account entry was removed, its device
						copy will also be removed. Other mail settings stay as they are.
					</Text>
					<Flex gap={2} wrap="wrap">
						<Button
							size="sm"
							isDisabled={!mail.cloudAvailable || mail.busy}
							onClick={async () => {
								if (await mail.useAccountSettings(review)) setReview(null);
							}}
						>
							Use account settings
						</Button>
						<Button size="sm" onClick={() => setReview(null)}>
							Keep device changes
						</Button>
					</Flex>
				</Flex>
			)}
			<Text fontSize="xs">
				Pending saves retry after reconnection or within a minute while Mail is open. Sending mail and mailbox actions still require your explicit
				action.
			</Text>
		</Flex>
	);
}
