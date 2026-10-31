import React, { memo } from 'react';

import { Box, Flex, Input, Text } from '@chakra-ui/react';
import { Network, Wifi, WifiOff } from 'lucide-react';

import type { DeviceWiFiState } from './deviceTypes';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton } from './DeviceStateGrid';

const validSSID = (value: string): boolean => value.length > 0 && value === value.trim() && new TextEncoder().encode(value).length <= 32 && !/[\p{Cc}]/u.test(value);

export type DeviceNetworkControlsProps = {
	deviceId: string;
	wifi: DeviceWiFiState | null;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceNetworkControls = memo(({ deviceId, wifi, controlFor, onAction }: DeviceNetworkControlsProps) => {
	const [ssid, setSSID] = React.useState('');
	const valid = validSSID(ssid);
	const status = wifi?.powerOn === false ? 'Wi‑Fi is off' : wifi?.ssid ? `Connected to ${wifi.ssid}` : wifi?.powerOn ? 'On, not connected' : 'Status unavailable';
	return (
		<Box>
			<Flex alignItems="center" gap={2} marginBottom={2}>
			{wifi?.powerOn === false ? <WifiOff aria-hidden color="var(--tt-muted, #71717a)" size={16} /> : <Wifi aria-hidden color="var(--tt-accent, #ec4899)" size={16} />}
			<Box minWidth={0}>
				<Text fontSize="12px" fontWeight={700} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
					{status}
				</Text>
				<Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={0.5}>
					Only open networks or networks already saved on this Mac can be joined.
				</Text>
			</Box>
		</Flex>
		<Flex gap={1.5} wrap="wrap">
			<DevicePolicyButton
				action="set-wifi-power"
				controlFor={controlFor}
				controlKey="wifi-power"
				deviceId={deviceId}
				input={{ enabled: wifi?.powerOn !== true }}
				label={wifi?.powerOn === true ? 'Turn Wi‑Fi off' : 'Turn Wi‑Fi on'}
				onAction={onAction}
				variant="ghost"
			/>
			<DevicePolicyButton
				action="disconnect-wifi"
				controlFor={controlFor}
				controlKey="wifi-disconnect"
				deviceId={deviceId}
				label="Disconnect"
				onAction={onAction}
				variant="ghost"
			/>
		</Flex>
		<Box borderTop="1px solid var(--tt-border, #ececef)" marginTop={3} paddingTop={3}>
			<Flex alignItems="center" gap={1.5} marginBottom={1.5}>
				<Network aria-hidden size={14} />
				<Text fontSize="11px" fontWeight={700}>
					Join a saved network
				</Text>
			</Flex>
			<Flex gap={1.5} minWidth={0} wrap={{ base: 'wrap', sm: 'nowrap' }}>
				<Input
					aria-label="Wi-Fi network name"
					fontSize="12px"
					maxLength={32}
					onChange={(event) => setSSID(event.target.value)}
					placeholder="Network name"
					value={ssid}
				/>
				<DevicePolicyButton
					action="connect-wifi"
					controlFor={controlFor}
					controlKey={ssid || 'wifi-connect'}
					deviceId={deviceId}
					disabledReason={ssid && !valid ? 'Use a visible Wi‑Fi name of 32 bytes or fewer.' : !ssid ? 'Enter a Wi‑Fi network name first.' : null}
					input={{ ssid }}
					label="Connect"
					onAction={onAction}
					size="sm"
				/>
			</Flex>
			<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.4" marginTop={1.5}>
				Passwords are never requested, stored, or transmitted by Thingtime. macOS decides whether an existing credential can be used.
			</Text>
		</Box>
		</Box>
	);
});
DeviceNetworkControls.displayName = 'DeviceNetworkControls';
