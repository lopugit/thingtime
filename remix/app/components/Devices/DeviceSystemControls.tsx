import React, { memo } from 'react';

import { Box, Button, Flex, Grid, Input, Menu, MenuButton, MenuList, Portal, Text } from '@chakra-ui/react';
import { Bluetooth, Camera, ChevronDown, Monitor, Moon, Music, Printer, Wifi } from 'lucide-react';

import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';

import type { DeviceAppleMusic, DeviceBluetoothDevice, DeviceCamera, DeviceDisplay, DevicePrinter, DeviceSpotify, DeviceVPNService } from './deviceTypes';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton, DevicePolicyMenuItem } from './DeviceStateGrid';

const Card = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
	<Box border="1px solid var(--tt-border, #ececef)" borderRadius="10px" minWidth={0} padding={2.5}>
		<Flex alignItems="center" color="var(--tt-muted, #71717a)" gap={1.5} marginBottom={2}>
			{icon}
			<Text fontSize="10px" fontWeight={800} letterSpacing="0.04em" textTransform="uppercase">{label}</Text>
		</Flex>
		{children}
	</Box>
);

const DisplayCard = ({ deviceId, display, allDisplays, controlFor, onAction }: { deviceId: string; display: DeviceDisplay; allDisplays: DeviceDisplay[]; controlFor?: DeviceControlResolver; onAction?: DeviceActionHandler }) => {
	const [origin, setOrigin] = React.useState({ x: String(display.originX), y: String(display.originY) });
	React.useEffect(() => setOrigin({ x: String(display.originX), y: String(display.originY) }), [display.id, display.originX, display.originY]);
	const label = `${display.isMain ? 'Main · ' : ''}${display.width} × ${display.height}${display.hdrActive ? ' · HDR active' : ''}`;
	return (
		<Card icon={<Monitor aria-hidden size={14} />} label={label}>
			<Text fontSize="11px" marginBottom={2}>{display.currentMode ? `${display.currentMode.width} × ${display.currentMode.height} @ ${display.currentMode.refreshRate || 'variable'} Hz` : 'Mode unavailable'}</Text>
			<Flex gap={1.5} wrap="wrap">
				<Menu placement="bottom-start">
					<MenuButton as={Button} rightIcon={<ChevronDown size={13} />} size="xs" variant="outline">Display mode</MenuButton>
					<Portal><MenuList fontSize="12px" maxHeight="260px" overflowY="auto" zIndex={DRAWER_POPUP_Z}>
						{display.availableModes.map((mode) => <DevicePolicyMenuItem action="set-display-mode" controlFor={controlFor} controlKey={`display-mode:${display.id}:${mode.id}`} deviceId={deviceId} input={{ displayId: display.id, modeId: mode.id }} key={mode.id} label={`${display.currentMode?.id === mode.id ? '✓ ' : ''}${mode.width} × ${mode.height} @ ${mode.refreshRate || 'variable'} Hz`} onAction={onAction} targetId={String(display.id)} />)}
					</MenuList></Portal>
				</Menu>
				{display.brightnessControlSupported ? [0.25, 0.5, 0.75, 1].map((level) => <DevicePolicyButton action="set-display-brightness" controlFor={controlFor} controlKey={`display-brightness:${display.id}:${level}`} deviceId={deviceId} input={{ displayId: display.id, level }} key={level} label={`${Math.round(level * 100)}%`} onAction={onAction} targetId={String(display.id)} />) : null}
				<Menu placement="bottom-start">
					<MenuButton as={Button} rightIcon={<ChevronDown size={13} />} size="xs" variant="outline">Mirroring</MenuButton>
					<Portal><MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>
						<DevicePolicyMenuItem action="set-display-mirroring" controlFor={controlFor} controlKey={`display-mirror:${display.id}:none`} deviceId={deviceId} input={{ displayId: display.id, sourceDisplayId: null }} label={display.mirroredDisplayId ? 'Stop mirroring' : 'Keep extended'} onAction={onAction} targetId={String(display.id)} />
						{allDisplays.filter((candidate) => candidate.id !== display.id).map((candidate) => <DevicePolicyMenuItem action="set-display-mirroring" controlFor={controlFor} controlKey={`display-mirror:${display.id}:${candidate.id}`} deviceId={deviceId} input={{ displayId: display.id, sourceDisplayId: candidate.id }} key={candidate.id} label={`Mirror display ${candidate.id}`} onAction={onAction} targetId={String(display.id)} />)}
					</MenuList></Portal>
				</Menu>
			</Flex>
			<Flex alignItems="center" gap={1.5} marginTop={2}>
				<Text color="var(--tt-muted, #71717a)" fontSize="10px">Origin</Text>
				<Input aria-label={`Display ${display.id} horizontal origin`} fontSize="11px" height="28px" onChange={(event) => setOrigin((value) => ({ ...value, x: event.target.value }))} type="number" value={origin.x} width="76px" />
				<Input aria-label={`Display ${display.id} vertical origin`} fontSize="11px" height="28px" onChange={(event) => setOrigin((value) => ({ ...value, y: event.target.value }))} type="number" value={origin.y} width="76px" />
				<DevicePolicyButton action="set-display-origin" controlFor={controlFor} controlKey={`display-origin:${display.id}:${origin.x}:${origin.y}`} deviceId={deviceId} input={{ displayId: display.id, x: Number(origin.x), y: Number(origin.y) }} label="Apply" onAction={onAction} targetId={String(display.id)} />
			</Flex>
		</Card>
	);
};

export type DeviceSystemControlsProps = {
	deviceId: string;
	displays: DeviceDisplay[];
	printers: DevicePrinter[];
	cameras: DeviceCamera[];
	bluetoothDevices: DeviceBluetoothDevice[];
	vpnServices: DeviceVPNService[];
	battery: { level: number | null; charging: boolean | null; isExternalPower: boolean | null; isPreventingIdleSleep: boolean; isLowPowerModeEnabled?: boolean } | null;
	appleMusic?: DeviceAppleMusic;
	spotify?: DeviceSpotify;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceSystemControls = memo(({ deviceId, displays, printers, cameras, bluetoothDevices, vpnServices, battery, appleMusic, spotify, controlFor, onAction }: DeviceSystemControlsProps) => (
	<Flex direction="column" gap={3}>
		{displays.length ? <Grid gap={2} templateColumns="repeat(auto-fit, minmax(260px, 1fr))">{displays.map((display) => <DisplayCard allDisplays={displays} controlFor={controlFor} deviceId={deviceId} display={display} key={display.id} onAction={onAction} />)}</Grid> : <Text color="var(--tt-muted, #71717a)" fontSize="12px">No display layout telemetry has been reported by this node yet.</Text>}
		<Grid gap={2} templateColumns="repeat(auto-fit, minmax(220px, 1fr))">
			<Card icon={<Printer aria-hidden size={14} />} label="Default printer"><Menu><MenuButton as={Button} rightIcon={<ChevronDown size={13} />} size="xs" variant="outline">{printers.find((printer) => printer.isDefault)?.name || 'Choose printer'}</MenuButton><Portal><MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>{printers.map((printer) => <DevicePolicyMenuItem action="set-default-printer" controlFor={controlFor} controlKey={`printer:${printer.id}`} deviceId={deviceId} input={{ id: printer.id }} key={printer.id} label={`${printer.isDefault ? '✓ ' : ''}${printer.name}`} onAction={onAction} targetId={printer.id} />)}</MenuList></Portal></Menu></Card>
			<Card icon={<Camera aria-hidden size={14} />} label="Preferred camera"><Menu><MenuButton as={Button} rightIcon={<ChevronDown size={13} />} size="xs" variant="outline">{cameras.find((camera) => camera.isPreferred)?.name || 'Choose camera'}</MenuButton><Portal><MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>{cameras.map((camera) => <DevicePolicyMenuItem action="set-preferred-camera" controlFor={controlFor} controlKey={`camera:${camera.id}`} deviceId={deviceId} input={{ id: camera.id }} key={camera.id} label={`${camera.isPreferred ? '✓ ' : ''}${camera.name}${camera.authorization === 'denied' ? ' · access not granted' : ''}`} onAction={onAction} targetId={camera.id} />)}</MenuList></Portal></Menu></Card>
			<Card icon={<Bluetooth aria-hidden size={14} />} label="Paired Bluetooth">{bluetoothDevices.length ? <Flex gap={1} wrap="wrap">{bluetoothDevices.map((device) => <DevicePolicyButton action="set-bluetooth-device-connected" controlFor={controlFor} controlKey={`bluetooth:${device.id}:${device.isConnected ? 'off' : 'on'}`} deviceId={deviceId} input={{ id: device.id, connected: !device.isConnected }} key={device.id} label={`${device.isConnected ? 'Disconnect' : 'Connect'} ${device.name}`} onAction={onAction} targetId={device.id} />)}</Flex> : <Text fontSize="11px">No paired devices reported.</Text>}</Card>
			<Card icon={<Wifi aria-hidden size={14} />} label="VPN services">{vpnServices.length ? <Flex gap={1} wrap="wrap">{vpnServices.map((service) => <DevicePolicyButton action="set-vpn-connected" controlFor={controlFor} controlKey={`vpn:${service.id}:${service.isConnected ? 'off' : 'on'}`} deviceId={deviceId} input={{ id: service.id, connected: !service.isConnected }} key={service.id} label={`${service.isConnected ? 'Disconnect' : 'Connect'} ${service.name}`} onAction={onAction} targetId={service.id} />)}</Flex> : <Text fontSize="11px">No controllable service reported.</Text>}</Card>
			<Card icon={<Moon aria-hidden size={14} />} label="Battery & sleep"><Text fontSize="11px">{battery?.level === null || !battery ? 'Battery status unavailable' : `${Math.round(battery.level * 100)}%${battery.charging ? ' · charging' : ''}${battery.isLowPowerModeEnabled ? ' · Low Power Mode' : ''}`}</Text><Box marginTop={2}><DevicePolicyButton action="set-prevent-idle-sleep" controlFor={controlFor} controlKey={`idle-sleep:${battery?.isPreventingIdleSleep ? 'allow' : 'prevent'}`} deviceId={deviceId} input={{ enabled: !battery?.isPreventingIdleSleep }} label={battery?.isPreventingIdleSleep ? 'Allow idle sleep' : 'Keep awake'} onAction={onAction} targetId="idle-sleep" /></Box></Card>
			<Card icon={<Music aria-hidden size={14} />} label="Apple Music"><Text fontSize="11px">{appleMusic?.isInstalled ? appleMusic.isRunning ? 'Running · commands need Automation approval' : 'Installed · opens on play' : 'Not installed'}</Text>{appleMusic?.isInstalled ? <Flex gap={1} marginTop={2} wrap="wrap">{(['play', 'pause', 'previous', 'next'] as const).map((operation) => <DevicePolicyButton action="set-apple-music-playback" controlFor={controlFor} controlKey={`apple-music:${operation}`} deviceId={deviceId} input={{ operation }} key={operation} label={operation === 'previous' ? 'Previous' : operation[0].toUpperCase() + operation.slice(1)} onAction={onAction} targetId="apple-music" />)}</Flex> : null}</Card>
			<Card icon={<Music aria-hidden size={14} />} label="Spotify"><Text fontSize="11px">{spotify?.isInstalled ? spotify.isRunning ? 'Running · commands need Automation approval' : 'Installed · opens on play' : 'Not installed'}</Text>{spotify?.isInstalled ? <Flex gap={1} marginTop={2} wrap="wrap">{(['play', 'pause', 'previous', 'next'] as const).map((operation) => <DevicePolicyButton action="set-spotify-playback" controlFor={controlFor} controlKey={`spotify:${operation}`} deviceId={deviceId} input={{ operation }} key={operation} label={operation === 'previous' ? 'Previous' : operation[0].toUpperCase() + operation.slice(1)} onAction={onAction} targetId="spotify" />)}</Flex> : null}</Card>
		</Grid>
		<Text color="var(--tt-muted, #71717a)" fontSize="10px">HDR and Low Power Mode are reported read-only. Focus, AirDrop, Bluetooth radio state, camera privacy, and global media playback have no supported scoped setter; Apple Music and Spotify are deliberately limited consented media surfaces.</Text>
	</Flex>
));
DeviceSystemControls.displayName = 'DeviceSystemControls';
