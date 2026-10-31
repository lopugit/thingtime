export const normalizeWatchCodeInput = (value: string) =>
	value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 8);
export const watchCodeSlotCount = (value: string) => (value.length > 4 || /[A-Z]/i.test(value) ? 8 : 4);
