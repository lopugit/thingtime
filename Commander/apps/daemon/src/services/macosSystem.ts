import type { CommanderExtension, ExtensionCommand } from '@commander/protocol';

export const macosSystemExtensionId = 'builtin:macos-system';

interface MacOSSystemShortcut extends ExtensionCommand {
  url: string;
}

interface ShortcutInput {
  name: string;
  title: string;
  description: string;
  pane: string;
  anchor?: string;
  keywords: string[];
}

function systemSettingsShortcut(input: ShortcutInput): MacOSSystemShortcut {
  return {
    name: input.name,
    title: input.title,
    description: input.description,
    mode: 'no-view',
    keywords: [...input.keywords, 'macos', 'system settings', 'system preferences'],
    disabled: false,
    url: `x-apple.systempreferences:${input.pane}${input.anchor ? `?${input.anchor}` : ''}`,
  };
}

const privacyPane = 'com.apple.settings.PrivacySecurity.extension';

export const macosSystemShortcuts = [
  systemSettingsShortcut({
    name: 'open-accessibility-settings',
    title: 'Accessibility Settings',
    description: 'Open Privacy & Security → Accessibility app permissions.',
    pane: privacyPane,
    anchor: 'Privacy_Accessibility',
    keywords: ['accessibility', 'permission', 'assistive access', 'control this mac', 'privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-accessibility-features-settings',
    title: 'Accessibility Features Settings',
    description: 'Open macOS vision, hearing, motor, speech, and accessibility features.',
    pane: 'com.apple.Accessibility-Settings.extension',
    keywords: ['accessibility features', 'vision', 'hearing', 'motor', 'voice control'],
  }),
  systemSettingsShortcut({
    name: 'open-screen-recording-settings',
    title: 'Screen & System Audio Recording Settings',
    description: 'Manage apps allowed to record the screen and system audio.',
    pane: privacyPane,
    anchor: 'Privacy_ScreenCapture',
    keywords: ['screen recording', 'screen capture', 'system audio', 'share screen', 'privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-full-disk-access-settings',
    title: 'Full Disk Access Settings',
    description: 'Manage apps allowed to access all files on this Mac.',
    pane: privacyPane,
    anchor: 'Privacy_AllFiles',
    keywords: ['full disk access', 'files', 'permission', 'privacy', 'storage'],
  }),
  systemSettingsShortcut({
    name: 'open-input-monitoring-settings',
    title: 'Input Monitoring Settings',
    description: 'Manage apps allowed to monitor keyboard and input events.',
    pane: privacyPane,
    anchor: 'Privacy_ListenEvent',
    keywords: ['input monitoring', 'keyboard monitoring', 'key events', 'permission', 'privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-automation-settings',
    title: 'Automation Settings',
    description: 'Manage apps allowed to control other apps.',
    pane: privacyPane,
    anchor: 'Privacy_Automation',
    keywords: ['automation', 'apple events', 'control apps', 'permission', 'privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-camera-settings',
    title: 'Camera Privacy Settings',
    description: 'Manage apps allowed to use the camera.',
    pane: privacyPane,
    anchor: 'Privacy_Camera',
    keywords: ['camera', 'webcam', 'permission', 'privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-microphone-settings',
    title: 'Microphone Privacy Settings',
    description: 'Manage apps allowed to use the microphone.',
    pane: privacyPane,
    anchor: 'Privacy_Microphone',
    keywords: ['microphone', 'mic', 'audio input', 'permission', 'privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-location-services-settings',
    title: 'Location Services Settings',
    description: 'Manage location access for macOS and installed apps.',
    pane: privacyPane,
    anchor: 'Privacy_LocationServices',
    keywords: ['location services', 'gps', 'location permission', 'privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-files-folders-settings',
    title: 'Files & Folders Privacy Settings',
    description: 'Manage app access to Desktop, Documents, Downloads, and removable storage.',
    pane: privacyPane,
    anchor: 'Privacy_FilesAndFolders',
    keywords: ['files and folders', 'documents', 'downloads', 'desktop folder', 'permission'],
  }),
  systemSettingsShortcut({
    name: 'open-app-management-settings',
    title: 'App Management Settings',
    description: 'Manage apps allowed to update or delete other apps.',
    pane: privacyPane,
    anchor: 'Privacy_AppBundles',
    keywords: ['app management', 'application bundles', 'update apps', 'delete apps', 'permission'],
  }),
  systemSettingsShortcut({
    name: 'open-developer-tools-settings',
    title: 'Developer Tools Settings',
    description: 'Manage apps allowed to run software that does not meet system security policy.',
    pane: privacyPane,
    anchor: 'Privacy_DevTools',
    keywords: ['developer tools', 'terminal', 'debugging', 'security policy', 'permission'],
  }),
  systemSettingsShortcut({
    name: 'open-privacy-security-settings',
    title: 'Privacy & Security Settings',
    description: 'Open the macOS privacy and security overview.',
    pane: privacyPane,
    keywords: ['privacy', 'security', 'permissions', 'gatekeeper', 'firewall'],
  }),
  systemSettingsShortcut({
    name: 'open-wifi-settings',
    title: 'Wi-Fi Settings',
    description: 'Connect to and manage Wi-Fi networks.',
    pane: 'com.apple.wifi-settings-extension',
    keywords: ['wifi', 'wi-fi', 'wireless', 'internet', 'network'],
  }),
  systemSettingsShortcut({
    name: 'open-bluetooth-settings',
    title: 'Bluetooth Settings',
    description: 'Connect to and manage Bluetooth devices.',
    pane: 'com.apple.BluetoothSettings',
    keywords: ['bluetooth', 'wireless devices', 'pair device', 'headphones'],
  }),
  systemSettingsShortcut({
    name: 'open-network-settings',
    title: 'Network Settings',
    description: 'Manage network interfaces, VPNs, DNS, and connectivity.',
    pane: 'com.apple.Network-Settings.extension',
    keywords: ['network', 'ethernet', 'vpn', 'dns', 'internet'],
  }),
  systemSettingsShortcut({
    name: 'open-battery-settings',
    title: 'Battery Settings',
    description: 'Manage battery health, charging, and energy options.',
    pane: 'com.apple.Battery-Settings.extension',
    keywords: ['battery', 'power', 'energy', 'charging', 'low power mode'],
  }),
  systemSettingsShortcut({
    name: 'open-general-settings',
    title: 'General Settings',
    description: 'Open the General section of System Settings.',
    pane: 'com.apple.systempreferences.GeneralSettings',
    keywords: ['general', 'about', 'software update', 'language', 'date time'],
  }),
  systemSettingsShortcut({
    name: 'open-login-items-settings',
    title: 'Login Items & Extensions Settings',
    description: 'Manage apps, services, and extensions allowed to run in the background.',
    pane: 'com.apple.LoginItems-Settings.extension',
    keywords: ['login items', 'startup apps', 'background items', 'extensions', 'open at login'],
  }),
  systemSettingsShortcut({
    name: 'open-appearance-settings',
    title: 'Appearance Settings',
    description: 'Manage light and dark appearance, colors, and interface behavior.',
    pane: 'com.apple.Appearance-Settings.extension',
    keywords: ['appearance', 'dark mode', 'light mode', 'accent color', 'theme'],
  }),
  systemSettingsShortcut({
    name: 'open-desktop-dock-settings',
    title: 'Desktop & Dock Settings',
    description: 'Manage the Dock, desktop, windows, Mission Control, and Stage Manager.',
    pane: 'com.apple.Desktop-Settings.extension',
    keywords: ['desktop', 'dock', 'mission control', 'stage manager', 'windows'],
  }),
  systemSettingsShortcut({
    name: 'open-displays-settings',
    title: 'Displays Settings',
    description: 'Manage displays, resolution, brightness, arrangement, and color.',
    pane: 'com.apple.Displays-Settings.extension',
    keywords: ['display', 'monitor', 'screen', 'resolution', 'brightness'],
  }),
  systemSettingsShortcut({
    name: 'open-wallpaper-settings',
    title: 'Wallpaper Settings',
    description: 'Choose the desktop wallpaper and screen background.',
    pane: 'com.apple.Wallpaper-Settings.extension',
    keywords: ['wallpaper', 'background', 'desktop picture'],
  }),
  systemSettingsShortcut({
    name: 'open-notifications-settings',
    title: 'Notifications Settings',
    description: 'Manage app notifications, alerts, sounds, and badges.',
    pane: 'com.apple.Notifications-Settings.extension',
    keywords: ['notifications', 'alerts', 'badges', 'banners', 'do not disturb'],
  }),
  systemSettingsShortcut({
    name: 'open-sound-settings',
    title: 'Sound Settings',
    description: 'Manage audio output, input, volume, and sound effects.',
    pane: 'com.apple.Sound-Settings.extension',
    keywords: ['sound', 'audio', 'speaker', 'microphone input', 'volume'],
  }),
  systemSettingsShortcut({
    name: 'open-focus-settings',
    title: 'Focus Settings',
    description: 'Manage Focus modes and notification schedules.',
    pane: 'com.apple.Focus-Settings.extension',
    keywords: ['focus', 'do not disturb', 'dnd', 'notifications', 'schedule'],
  }),
  systemSettingsShortcut({
    name: 'open-screen-time-settings',
    title: 'Screen Time Settings',
    description: 'Review usage and manage app limits, downtime, and restrictions.',
    pane: 'com.apple.Screen-Time-Settings.extension',
    keywords: ['screen time', 'app limits', 'downtime', 'content restrictions'],
  }),
  systemSettingsShortcut({
    name: 'open-lock-screen-settings',
    title: 'Lock Screen Settings',
    description: 'Manage display sleep, screen saver, and password timing.',
    pane: 'com.apple.Lock-Screen-Settings.extension',
    keywords: ['lock screen', 'sleep', 'screen saver', 'password', 'display off'],
  }),
  systemSettingsShortcut({
    name: 'open-touch-id-password-settings',
    title: 'Touch ID & Password Settings',
    description: 'Manage fingerprints, Touch ID, and the login password.',
    pane: 'com.apple.Touch-ID-Settings.extension',
    keywords: ['touch id', 'fingerprint', 'password', 'login'],
  }),
  systemSettingsShortcut({
    name: 'open-users-groups-settings',
    title: 'Users & Groups Settings',
    description: 'Manage user accounts, groups, and login options.',
    pane: 'com.apple.Users-Groups-Settings.extension',
    keywords: ['users', 'groups', 'accounts', 'login options', 'guest user'],
  }),
  systemSettingsShortcut({
    name: 'open-internet-accounts-settings',
    title: 'Internet Accounts Settings',
    description: 'Manage mail, calendar, contacts, and other online accounts.',
    pane: 'com.apple.Internet-Accounts-Settings.extension',
    keywords: ['internet accounts', 'mail accounts', 'calendar accounts', 'google', 'icloud'],
  }),
  systemSettingsShortcut({
    name: 'open-keyboard-settings',
    title: 'Keyboard Settings',
    description: 'Manage keyboard behavior, text input, dictation, and shortcuts.',
    pane: 'com.apple.Keyboard-Settings.extension',
    keywords: ['keyboard', 'text input', 'dictation', 'function keys', 'shortcuts'],
  }),
  systemSettingsShortcut({
    name: 'open-keyboard-shortcuts-settings',
    title: 'Keyboard Shortcuts Settings',
    description: 'Open the Keyboard pane for system and app shortcut configuration.',
    pane: 'com.apple.Keyboard-Settings.extension',
    keywords: ['keyboard shortcuts', 'hotkeys', 'key bindings', 'app shortcuts'],
  }),
  systemSettingsShortcut({
    name: 'open-mouse-settings',
    title: 'Mouse Settings',
    description: 'Manage mouse tracking, scrolling, clicking, and gestures.',
    pane: 'com.apple.Mouse-Settings.extension',
    keywords: ['mouse', 'scrolling', 'tracking speed', 'right click'],
  }),
  systemSettingsShortcut({
    name: 'open-trackpad-settings',
    title: 'Trackpad Settings',
    description: 'Manage trackpad tracking, clicking, scrolling, and gestures.',
    pane: 'com.apple.Trackpad-Settings.extension',
    keywords: ['trackpad', 'gestures', 'scrolling', 'clicking'],
  }),
  systemSettingsShortcut({
    name: 'open-printers-scanners-settings',
    title: 'Printers & Scanners Settings',
    description: 'Add and manage printers and scanners.',
    pane: 'com.apple.Print-Scan-Settings.extension',
    keywords: ['printers', 'scanners', 'print', 'airprint'],
  }),
  systemSettingsShortcut({
    name: 'open-siri-settings',
    title: 'Siri Settings',
    description: 'Manage Siri, voice, language, and spoken responses.',
    pane: 'com.apple.Siri-Settings.extension',
    keywords: ['siri', 'voice assistant', 'spoken responses'],
  }),
  systemSettingsShortcut({
    name: 'open-spotlight-settings',
    title: 'Spotlight Settings',
    description: 'Manage Spotlight search results, indexing, and privacy.',
    pane: 'com.apple.Spotlight-Settings.extension',
    keywords: ['spotlight', 'search', 'indexing', 'search privacy'],
  }),
  systemSettingsShortcut({
    name: 'open-control-center-settings',
    title: 'Control Center Settings',
    description: 'Choose controls shown in Control Center and the menu bar.',
    pane: 'com.apple.ControlCenter-Settings.extension',
    keywords: ['control center', 'menu bar', 'status items', 'controls'],
  }),
] satisfies readonly MacOSSystemShortcut[];

export const macosSystemExtension: CommanderExtension = {
  id: macosSystemExtensionId,
  name: 'macos-system',
  title: 'macOS System',
  description: 'Open indexed macOS System Settings destinations directly from Commander.',
  version: '0.1.0',
  author: 'Thingtime',
  icon: 'settings',
  source: 'builtin',
  enabled: true,
  compatibility: 'native',
  commands: macosSystemShortcuts.map(({ url: _url, ...command }) => command),
};

const shortcutURLs = new Map(macosSystemShortcuts.map((shortcut) => [shortcut.name, shortcut.url]));

export function macosSystemShortcutURL(commandName: string): string | undefined {
  return shortcutURLs.get(commandName);
}
