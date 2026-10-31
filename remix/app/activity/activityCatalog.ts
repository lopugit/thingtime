// Stable background-work vocabulary. Mounted instances supply live timing and cleanup.
import type { ActivitySpec } from './activityManager';
export const activityCatalog: ActivitySpec[] = [
	{
		id: 'timer:timeline/useThingTimeline:1',
		title: 'Thing history',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:timeline/TimelineProvider:1',
		title: 'Timeline updates',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/NativeBridge/WidgetBridgeHost:1',
		title: 'Widget Bridge Host',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Settings/MediaCacheSettings:1',
		title: 'Media Cache Settings',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Settings/NotificationTools:1',
		title: 'Notification Tools',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Lopu/RecordingAutomationPage:1',
		title: 'Recording Automation Page',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Lopu/useLopuChat:1',
		title: 'use Lopu Chat',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Thingtime/ThingFields:1',
		title: 'Live Thing fields',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Messenger/ChatView:1',
		title: 'Chat View',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Feed/useFeedEngagement:1',
		title: 'use Feed Engagement',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Feed/useViewTracking:1',
		title: 'use View Tracking',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Watch/WatchPendingApprovals:1',
		title: 'Watch Pending Approvals',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Nav/NotificationsBell:1',
		title: 'Notification badge',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Attachments/RecordingTranscript:1',
		title: 'Recording Transcript',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Builder/NativeComponentControls:1',
		title: 'Native Component Controls',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Builder/liveComponent:1',
		title: 'Live component refresh',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Builder/useFormatClock:1',
		title: 'Running elapsed clocks',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Timeline/TimelineEventBrowser:1',
		title: 'Timeline Event Browser',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Timeline/TimelineBranches:1',
		title: 'Timeline Branches',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Devices/useLocalThingtimeNode:1',
		title: 'Local node status',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Devices/MobileDeviceSetupCard:1',
		title: 'Mobile Device Setup Card',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Devices/useDeviceStore:1',
		title: 'Device list',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Devices/useLocalDeviceBattery:1',
		title: 'Device battery',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Devices/TransferSpeedTrackers:1',
		title: 'Transfer speed display',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Admin/CIControl/StackRunChat:1',
		title: 'Stack Run Chat',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Admin/CIControl/CIControlDashboard:1',
		title: 'CIControl Dashboard',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	},
	{
		id: 'timer:components/Admin/CIControl/CIControlDashboard:2',
		title: 'CIControl Dashboard',
		kind: 'polling',
		detail: 'Runs only while its owning view is mounted; hidden windows release the interval.'
	}
];
