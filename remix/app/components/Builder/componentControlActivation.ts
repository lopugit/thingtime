// A local UI acknowledgement, never an Action request or authorization signal.
// Controls publish it only after their own validation and snapshot boundary.
export const COMPONENT_CONTROL_ACTIVATED = 'tt-component-control-activated';

export function notifyComponentControlActivation(control: HTMLElement) {
	const view = control.ownerDocument.defaultView;
	if (control.isConnected && view) control.dispatchEvent(new view.Event(COMPONENT_CONTROL_ACTIVATED, { bubbles: true }));
}
