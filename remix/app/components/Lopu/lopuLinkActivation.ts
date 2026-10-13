// 🦄 A Lopu header control that carries an href is a real link, so the browser
// keeps every affordance it normally gives one: Cmd/Ctrl-click and middle-click
// open a new tab, Shift-click opens a new window, Alt-click downloads and the
// context menu copies the address. Only a plain primary activation (mouse click
// or keyboard Enter, which reports button 0 with no modifiers) is taken over by
// the in-app router, so a modified click never closes the original chat.

export type LopuLinkActivation = {
	button: number;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	defaultPrevented: boolean;
};

export const handlesLopuLinkInApp = (event: LopuLinkActivation): boolean =>
	!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
