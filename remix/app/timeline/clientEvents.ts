export const TIMELINE_CHANGED_EVENT = 'thingtime:timeline-changed';
export const TIMELINE_SCOPE_CHANGED_EVENT = 'thingtime:timeline-scope-changed';
const channelName = 'thingtime:timeline-scope';
/** Data source changes invalidate metadata, never migrate pending edits. */
export function announceTimelineScopeChange() {
	window.dispatchEvent(new Event(TIMELINE_SCOPE_CHANGED_EVENT));
	if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel(channelName); channel.postMessage('changed'); channel.close(); }
}
export function listenTimelineScopeChange(callback: () => void) {
	window.addEventListener(TIMELINE_SCOPE_CHANGED_EVENT, callback);
	const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
	if (channel) channel.onmessage = callback;
	return () => { window.removeEventListener(TIMELINE_SCOPE_CHANGED_EVENT, callback); channel?.close(); };
}
