import { useSyncExternalStore } from 'react';
import { DEFAULT_AUTOMATION_SWITCHES, type AutomationSwitchId, type AutomationSwitchState } from './automationSwitches';
import { automationSwitches } from './automationSwitchesClient';

const subscribe = (listener: () => void) => automationSwitches().subscribe(listener);
const read = () => automationSwitches().read();
const serverRead = () => DEFAULT_AUTOMATION_SWITCHES;

/** Live administrator Automation switches (all off until the server answers). */
export function useAutomationSwitches(): AutomationSwitchState {
	return useSyncExternalStore(subscribe, read, serverRead);
}

export function useAutomationSwitch(id: AutomationSwitchId): boolean {
	return useAutomationSwitches()[id] === true;
}
