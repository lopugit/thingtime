import React, { memo } from 'react';

import { Box, Button, Flex, Grid, Input, Menu, MenuButton, MenuList, Portal, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Text } from '@chakra-ui/react';
import { Bluetooth, Camera, ChevronDown, Keyboard, Monitor, Moon, MousePointer2, Music, Printer, Shield, Wifi } from 'lucide-react';

import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';

import type { DeviceAppleMusic, DeviceBluetoothDevice, DeviceCamera, DeviceChromeYouTube, DeviceDisplay, DevicePowerTimers, DevicePrinter, DeviceSpotify, DeviceVPNService } from './deviceTypes';
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

const MediaVolumeControl = ({
	action,
	deviceId,
	disabledReason,
	label,
	targetId,
	controlFor,
	onAction
}: {
	action: 'set-apple-music-volume' | 'set-spotify-volume' | 'set-chrome-youtube-volume';
	deviceId: string;
	disabledReason?: string | null;
	label: string;
	targetId: string;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
}) => {
	const [percent, setPercent] = React.useState(50);
	return (
		<Box marginTop={2}>
			<Slider aria-label={`${label} target volume`} isDisabled={Boolean(disabledReason)} max={100} min={0} onChange={setPercent} step={1} value={percent}>
				<SliderTrack background="var(--tt-surface-alt, #eeeeef)"><SliderFilledTrack background="var(--tt-accent, #f472b6)" /></SliderTrack>
				<SliderThumb boxShadow="0 1px 3px rgba(0, 0, 0, 0.24)" />
			</Slider>
			<Flex alignItems="center" gap={2} marginTop={1.5} wrap="wrap">
				<Text color="var(--tt-muted, #71717a)" fontSize="10px">Target {percent}%</Text>
				<DevicePolicyButton action={action} controlFor={controlFor} controlKey={`${targetId}:volume:${percent}`} deviceId={deviceId} disabledReason={disabledReason} input={{ level: percent / 100 }} label="Set volume" onAction={onAction} targetId={targetId} />
			</Flex>
		</Box>
	);
};

const RemoteInputControls = ({ deviceId, displays, controlFor, onAction }: { deviceId: string; displays: DeviceDisplay[]; controlFor?: DeviceControlResolver; onAction?: DeviceActionHandler }) => {
	const [pointer, setPointer] = React.useState({ displayId: String(displays[0]?.id || ''), x: '0', y: '0', scrollX: '0', scrollY: '0' });
	const [text, setText] = React.useState('');
	const [textRevision, setTextRevision] = React.useState(0);
	const [shortcut, setShortcut] = React.useState({ key: 'tab', modifiers: 'command' });
	const display = displays.find((candidate) => candidate.id === Number(pointer.displayId));
	const x = Number(pointer.x), y = Number(pointer.y), deltaX = Number(pointer.scrollX), deltaY = Number(pointer.scrollY);
	const pointerIsValid = Boolean(display) && Number.isSafeInteger(x) && x >= 0 && x < (display?.width || 0) && Number.isSafeInteger(y) && y >= 0 && y < (display?.height || 0);
	const scrollIsValid = Number.isSafeInteger(deltaX) && deltaX >= -5_000 && deltaX <= 5_000 && Number.isSafeInteger(deltaY) && deltaY >= -5_000 && deltaY <= 5_000 && (deltaX !== 0 || deltaY !== 0);
	const modifiers = shortcut.modifiers.split(',').map((value) => value.trim()).filter(Boolean);
	const shortcutIsValid = /^(?:[a-z0-9]|return|tab|space|delete|escape|left|right|up|down|home|end|pageup|pagedown|f(?:[1-9]|1[0-2]))$/u.test(shortcut.key) && modifiers.length <= 5 && modifiers.every((value) => value === 'command' || value === 'control' || value === 'option' || value === 'shift' || value === 'function') && new Set(modifiers).size === modifiers.length;
	return <Grid gap={2} templateColumns="repeat(auto-fit, minmax(280px, 1fr))">
		<Card icon={<MousePointer2 aria-hidden size={14} />} label="Remote pointer"><Text fontSize="11px">Screen-relative pixels. Every move, click, and scroll needs a fresh approval and macOS Accessibility.</Text><Flex alignItems="center" gap={1.5} marginTop={2} wrap="wrap"><Input aria-label="Remote display id" fontSize="11px" height="28px" min={1} onChange={(event) => setPointer((value) => ({ ...value, displayId: event.target.value }))} type="number" value={pointer.displayId} width="70px" /><Input aria-label="Remote pointer x coordinate" fontSize="11px" height="28px" min={0} onChange={(event) => setPointer((value) => ({ ...value, x: event.target.value }))} type="number" value={pointer.x} width="76px" /><Input aria-label="Remote pointer y coordinate" fontSize="11px" height="28px" min={0} onChange={(event) => setPointer((value) => ({ ...value, y: event.target.value }))} type="number" value={pointer.y} width="76px" /><DevicePolicyButton action="move-pointer" controlFor={controlFor} controlKey={`pointer-move:${pointer.displayId}:${pointer.x}:${pointer.y}`} deviceId={deviceId} disabledReason={pointerIsValid ? null : 'Use a reported display id and whole coordinates inside its bounds.'} input={{ displayId: Number(pointer.displayId), x, y }} label="Move" onAction={onAction} targetId={pointer.displayId} /></Flex><Flex gap={1} marginTop={2} wrap="wrap">{(['left', 'right', 'middle'] as const).map((button) => <DevicePolicyButton action="click-pointer" controlFor={controlFor} controlKey={`pointer-click:${button}:${pointer.displayId}:${pointer.x}:${pointer.y}`} deviceId={deviceId} disabledReason={pointerIsValid ? null : 'Use whole coordinates inside the selected display.'} input={{ displayId: Number(pointer.displayId), x, y, button }} key={button} label={`${button[0].toUpperCase()}${button.slice(1)} click`} onAction={onAction} targetId={pointer.displayId} />)}</Flex><Flex alignItems="center" gap={1.5} marginTop={2} wrap="wrap"><Input aria-label="Horizontal scroll delta" fontSize="11px" height="28px" max={5000} min={-5000} onChange={(event) => setPointer((value) => ({ ...value, scrollX: event.target.value }))} placeholder="Δx" type="number" value={pointer.scrollX} width="76px" /><Input aria-label="Vertical scroll delta" fontSize="11px" height="28px" max={5000} min={-5000} onChange={(event) => setPointer((value) => ({ ...value, scrollY: event.target.value }))} placeholder="Δy" type="number" value={pointer.scrollY} width="76px" /><DevicePolicyButton action="scroll-pointer" controlFor={controlFor} controlKey={`pointer-scroll:${pointer.scrollX}:${pointer.scrollY}`} deviceId={deviceId} disabledReason={scrollIsValid ? null : 'Use whole deltas from −5000 to 5000; one must be nonzero.'} input={{ deltaX, deltaY }} label="Scroll" onAction={onAction} targetId="pointer" /></Flex></Card>
		<Card icon={<Keyboard aria-hidden size={14} />} label="Remote keyboard"><Text fontSize="11px">Text is only sent in the approved command; no key log, clipboard access, shell, or generic scripting is used.</Text><Flex alignItems="center" gap={1.5} marginTop={2}><Input aria-label="Text to type remotely" fontSize="11px" height="28px" maxLength={4096} onChange={(event) => { setText(event.target.value); setTextRevision((value) => value + 1); }} placeholder="Text to type" value={text} /><DevicePolicyButton action="type-text" controlFor={controlFor} controlKey={`keyboard-type:${textRevision}`} deviceId={deviceId} disabledReason={text ? null : 'Enter text to type.'} input={{ text }} label="Type" onAction={onAction} targetId="keyboard" /></Flex><Flex alignItems="center" gap={1.5} marginTop={2} wrap="wrap"><Input aria-label="Shortcut key" fontSize="11px" height="28px" onChange={(event) => setShortcut((value) => ({ ...value, key: event.target.value.trim().toLowerCase() }))} placeholder="tab" value={shortcut.key} width="88px" /><Input aria-label="Shortcut modifiers" fontSize="11px" height="28px" onChange={(event) => setShortcut((value) => ({ ...value, modifiers: event.target.value.toLowerCase() }))} placeholder="command,shift" value={shortcut.modifiers} width="142px" /><DevicePolicyButton action="send-shortcut" controlFor={controlFor} controlKey={`keyboard-shortcut:${shortcut.key}:${shortcut.modifiers}`} deviceId={deviceId} disabledReason={shortcutIsValid ? null : 'Use an allowlisted key and command, control, option, shift, or function modifiers.'} input={{ key: shortcut.key, modifiers }} label="Send shortcut" onAction={onAction} targetId="keyboard" /></Flex><Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={1}>Keys: a–z, 0–9, return, tab, space, delete, escape, arrows, home/end, page up/down, F1–F12.</Text></Card>
	</Grid>;
};

export type DeviceSystemControlsProps = {
	deviceId: string;
	displays: DeviceDisplay[];
	printers: DevicePrinter[];
	cameras: DeviceCamera[];
	bluetoothDevices: DeviceBluetoothDevice[];
	vpnServices: DeviceVPNService[];
	battery: { level: number | null; charging: boolean | null; isExternalPower: boolean | null; isPreventingIdleSleep: boolean; isLowPowerModeEnabled?: boolean } | null;
	powerTimers?: DevicePowerTimers;
	appleMusic?: DeviceAppleMusic;
	spotify?: DeviceSpotify;
	chromeYouTube?: DeviceChromeYouTube;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceSystemControls = memo(({ deviceId, displays, printers, cameras, bluetoothDevices, vpnServices, battery, powerTimers, appleMusic, spotify, chromeYouTube, controlFor, onAction }: DeviceSystemControlsProps) => (
	<Flex direction="column" gap={3}>
		{displays.length ? <Grid gap={2} templateColumns="repeat(auto-fit, minmax(260px, 1fr))">{displays.map((display) => <DisplayCard allDisplays={displays} controlFor={controlFor} deviceId={deviceId} display={display} key={display.id} onAction={onAction} />)}</Grid> : <Text color="var(--tt-muted, #71717a)" fontSize="12px">No display layout telemetry has been reported by this node yet.</Text>}
		{displays.length ? <RemoteInputControls controlFor={controlFor} deviceId={deviceId} displays={displays} onAction={onAction} /> : null}
		<Grid gap={2} templateColumns="repeat(auto-fit, minmax(220px, 1fr))">
			<Card icon={<Printer aria-hidden size={14} />} label="Default printer"><Menu><MenuButton as={Button} rightIcon={<ChevronDown size={13} />} size="xs" variant="outline">{printers.find((printer) => printer.isDefault)?.name || 'Choose printer'}</MenuButton><Portal><MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>{printers.map((printer) => <DevicePolicyMenuItem action="set-default-printer" controlFor={controlFor} controlKey={`printer:${printer.id}`} deviceId={deviceId} input={{ id: printer.id }} key={printer.id} label={`${printer.isDefault ? '✓ ' : ''}${printer.name}`} onAction={onAction} targetId={printer.id} />)}</MenuList></Portal></Menu></Card>
			<Card icon={<Camera aria-hidden size={14} />} label="Preferred camera"><Menu><MenuButton as={Button} rightIcon={<ChevronDown size={13} />} size="xs" variant="outline">{cameras.find((camera) => camera.isPreferred)?.name || 'Choose camera'}</MenuButton><Portal><MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>{cameras.map((camera) => <DevicePolicyMenuItem action="set-preferred-camera" controlFor={controlFor} controlKey={`camera:${camera.id}`} deviceId={deviceId} input={{ id: camera.id }} key={camera.id} label={`${camera.isPreferred ? '✓ ' : ''}${camera.name}${camera.authorization === 'denied' ? ' · access not granted' : ''}`} onAction={onAction} targetId={camera.id} />)}</MenuList></Portal></Menu></Card>
			<Card icon={<Bluetooth aria-hidden size={14} />} label="Paired Bluetooth">{bluetoothDevices.length ? <Flex gap={1} wrap="wrap">{bluetoothDevices.map((device) => <DevicePolicyButton action="set-bluetooth-device-connected" controlFor={controlFor} controlKey={`bluetooth:${device.id}:${device.isConnected ? 'off' : 'on'}`} deviceId={deviceId} input={{ id: device.id, connected: !device.isConnected }} key={device.id} label={`${device.isConnected ? 'Disconnect' : 'Connect'} ${device.name}`} onAction={onAction} targetId={device.id} />)}</Flex> : <Text fontSize="11px">No paired devices reported.</Text>}</Card>
			<Card icon={<Wifi aria-hidden size={14} />} label="VPN services">{vpnServices.length ? <Flex gap={1} wrap="wrap">{vpnServices.map((service) => <DevicePolicyButton action="set-vpn-connected" controlFor={controlFor} controlKey={`vpn:${service.id}:${service.isConnected ? 'off' : 'on'}`} deviceId={deviceId} input={{ id: service.id, connected: !service.isConnected }} key={service.id} label={`${service.isConnected ? 'Disconnect' : 'Connect'} ${service.name}`} onAction={onAction} targetId={service.id} />)}</Flex> : <Text fontSize="11px">No controllable service reported.</Text>}</Card>
			<Card icon={<Moon aria-hidden size={14} />} label="Battery & sleep"><Text fontSize="11px">{battery?.level === null || !battery ? 'Battery status unavailable' : `${Math.round(battery.level * 100)}%${battery.charging ? ' · charging' : ''}${battery.isLowPowerModeEnabled ? ' · Low Power Mode' : ''}`}</Text><Box marginTop={2}><DevicePolicyButton action="set-prevent-idle-sleep" controlFor={controlFor} controlKey={`idle-sleep:${battery?.isPreventingIdleSleep ? 'allow' : 'prevent'}`} deviceId={deviceId} input={{ enabled: !battery?.isPreventingIdleSleep }} label={battery?.isPreventingIdleSleep ? 'Allow idle sleep' : 'Keep awake'} onAction={onAction} targetId="idle-sleep" /></Box><Flex gap={1} marginTop={2} wrap="wrap">{([{ scope: 'display', label: 'Display idle', minutes: powerTimers?.displayIdleMinutes }, { scope: 'system', label: 'System sleep', minutes: powerTimers?.systemSleepMinutes }, { scope: 'disk', label: 'Disk idle', minutes: powerTimers?.diskIdleMinutes }] as const).map((timer) => <Menu key={timer.scope} placement="bottom-start"><MenuButton as={Button} rightIcon={<ChevronDown size={13} />} size="xs" variant="outline">{`${timer.label}: ${timer.minutes === null || timer.minutes === undefined ? 'Unavailable' : timer.minutes === 0 ? 'Never' : `${timer.minutes}m`}`}</MenuButton><Portal><MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>{[0, 1, 2, 5, 10, 15, 30, 60, 120, 180].map((minutes) => <DevicePolicyMenuItem action="set-power-idle-timer" controlFor={controlFor} controlKey={`power-idle:${timer.scope}:${minutes}`} deviceId={deviceId} input={{ scope: timer.scope, minutes }} key={minutes} label={`${timer.minutes === minutes ? '✓ ' : ''}${minutes === 0 ? 'Never' : `${minutes} minutes`}`} onAction={onAction} targetId={timer.scope} />)}</MenuList></Portal></Menu>)}</Flex></Card>
			<Card icon={<Shield aria-hidden size={14} />} label="Global availability policy"><Text fontSize="11px">Creates a fixed profile proposal and opens macOS review. Installation is required; this is global availability, not a per-app privacy grant.</Text><Flex gap={1} marginTop={2} wrap="wrap"><DevicePolicyButton action="propose-airdrop-policy-profile" controlFor={controlFor} controlKey="airdrop:restrict" deviceId={deviceId} input={{ enabled: false }} label="Restrict AirDrop" onAction={onAction} targetId="airdrop" /><DevicePolicyButton action="propose-airdrop-policy-profile" controlFor={controlFor} controlKey="airdrop:allow" deviceId={deviceId} input={{ enabled: true }} label="Allow AirDrop" onAction={onAction} targetId="airdrop" /><DevicePolicyButton action="propose-camera-policy-profile" controlFor={controlFor} controlKey="camera:restrict" deviceId={deviceId} input={{ enabled: false }} label="Restrict camera" onAction={onAction} targetId="camera" /><DevicePolicyButton action="propose-camera-policy-profile" controlFor={controlFor} controlKey="camera:allow" deviceId={deviceId} input={{ enabled: true }} label="Allow camera" onAction={onAction} targetId="camera" /></Flex></Card>
			<Card icon={<Music aria-hidden size={14} />} label="Apple Music"><Text fontSize="11px">{appleMusic?.isInstalled ? appleMusic.isRunning ? 'Running · controls need Automation approval' : 'Installed · playback opens it; volume needs it running' : 'Not installed'}</Text>{appleMusic?.isInstalled ? <><Flex gap={1} marginTop={2} wrap="wrap">{(['play', 'pause', 'previous', 'next'] as const).map((operation) => <DevicePolicyButton action="set-apple-music-playback" controlFor={controlFor} controlKey={`apple-music:${operation}`} deviceId={deviceId} input={{ operation }} key={operation} label={operation === 'previous' ? 'Previous' : operation[0].toUpperCase() + operation.slice(1)} onAction={onAction} targetId="apple-music" />)}</Flex><MediaVolumeControl action="set-apple-music-volume" controlFor={controlFor} deviceId={deviceId} disabledReason={appleMusic.isRunning ? null : 'Open Apple Music before changing its app volume.'} label="Apple Music" onAction={onAction} targetId="apple-music" /></> : null}</Card>
			<Card icon={<Music aria-hidden size={14} />} label="Spotify"><Text fontSize="11px">{spotify?.isInstalled ? spotify.isRunning ? 'Running · controls need Automation approval' : 'Installed · playback opens it; volume needs it running' : 'Not installed'}</Text>{spotify?.isInstalled ? <><Flex gap={1} marginTop={2} wrap="wrap">{(['play', 'pause', 'previous', 'next'] as const).map((operation) => <DevicePolicyButton action="set-spotify-playback" controlFor={controlFor} controlKey={`spotify:${operation}`} deviceId={deviceId} input={{ operation }} key={operation} label={operation === 'previous' ? 'Previous' : operation[0].toUpperCase() + operation.slice(1)} onAction={onAction} targetId="spotify" />)}</Flex><MediaVolumeControl action="set-spotify-volume" controlFor={controlFor} deviceId={deviceId} disabledReason={spotify.isRunning ? null : 'Open Spotify before changing its app volume.'} label="Spotify" onAction={onAction} targetId="spotify" /></> : null}</Card>
			<Card icon={<Music aria-hidden size={14} />} label="Chrome YouTube"><Text fontSize="11px">{chromeYouTube?.isInstalled ? chromeYouTube.isRunning ? 'Active YouTube or YouTube Music tab only · needs Automation approval' : 'Installed · open Chrome on YouTube first' : 'Chrome not installed'}</Text>{chromeYouTube?.isInstalled ? <><MediaVolumeControl action="set-chrome-youtube-volume" controlFor={controlFor} deviceId={deviceId} disabledReason={chromeYouTube.isRunning ? null : 'Open Chrome on a YouTube or YouTube Music player first.'} label="Chrome YouTube" onAction={onAction} targetId="chrome-youtube" /><Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={1}>Requires Chrome’s user-enabled Allow JavaScript from Apple Events setting. No tab URL, title, history, or page data is read.</Text></> : null}</Card>
		</Grid>
		<Text color="var(--tt-muted, #71717a)" fontSize="10px">Idle timers and policy proposals always require approval. AirDrop and camera availability proposals are fixed local profiles requiring a separate macOS installation review; they do not change per-app camera TCC. Apple Music and Spotify are fixed app-specific media surfaces. Chrome is restricted to the active YouTube or YouTube Music tab; arbitrary websites, cross-origin embeds, browser-player metadata, and generic global media playback remain unavailable.</Text>
	</Flex>
));
DeviceSystemControls.displayName = 'DeviceSystemControls';
