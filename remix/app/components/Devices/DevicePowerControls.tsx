import React, { memo } from 'react';

import { Box, Button, Flex, Menu, MenuButton, MenuList, Portal, Text } from '@chakra-ui/react';
import { ChevronDown, Power } from 'lucide-react';

import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';

import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyMenuItem } from './DeviceStateGrid';

export type DevicePowerControlsProps = {
	deviceId: string;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DevicePowerControls = memo(({ deviceId, controlFor, onAction }: DevicePowerControlsProps) => (
	<Flex alignItems="center" background="var(--tt-surface-alt, #f7f7f8)" border="1px solid var(--tt-border, #ececef)" borderRadius="12px" gap={3} padding={3}>
		<Flex alignItems="center" background="var(--tt-card, #fff)" borderRadius="10px" color="var(--tt-muted, #71717a)" height="32px" justifyContent="center" width="32px">
			<Power aria-hidden size={16} />
		</Flex>
		<Box flex="1" minWidth={0}>
			<Text fontSize="12px" fontWeight={700}>
				Power actions
			</Text>
			<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={0.5}>
				Sleep keeps this Mac available to wake locally. Restart and shutdown are intentionally unavailable because the signed node never shells out or uses AppleScript.
			</Text>
		</Box>
		<Menu placement="bottom-end">
			<MenuButton as={Button} rightIcon={<ChevronDown size={14} />} size="sm" variant="outline">
				Power
			</MenuButton>
			<Portal>
				<MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>
					<DevicePolicyMenuItem action="sleep" controlFor={controlFor} deviceId={deviceId} label="Sleep" onAction={onAction} />
				</MenuList>
			</Portal>
		</Menu>
	</Flex>
));
DevicePowerControls.displayName = 'DevicePowerControls';
