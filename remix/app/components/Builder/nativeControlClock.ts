export const countdownDuration = (value: unknown) => {
	const seconds = Number(value);
	return Number.isFinite(seconds) ? Math.max(1, Math.min(604800, Math.floor(seconds))) : 60;
};
export const countdownRemaining = (deadline: number, now: number) => Math.max(0, Math.ceil((deadline - now) / 1000));
