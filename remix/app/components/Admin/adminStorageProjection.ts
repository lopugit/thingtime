export type AdminStorageProjection = {
	usedBytes: number | null;
	allowanceBytes: number | null;
	remainingBytes: number | null;
	overageBytes: number | null;
	status: 'ready' | 'reconciling' | 'unavailable';
	accountingVersion: number | null;
	reconciledAt: string | null;
};

export const exactByteLabel = (value: number | null | undefined): string => {
	if (!Number.isSafeInteger(value) || Number(value) < 0) return '—';
	const bytes = Number(value);
	return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
};

export const storageStatusPresentation = (storage: AdminStorageProjection | null | undefined) => {
	const status = storage?.status ?? 'unavailable';
	if (status === 'ready') {
		return {
			label: 'exact',
			colorScheme: storage && (storage.overageBytes ?? 0) > 0 ? 'red' : 'green',
			description: 'The displayed byte count is backed by the canonical reconciled ledger.'
		} as const;
	}
	if (status === 'reconciling') {
		return {
			label: 'reconciling',
			colorScheme: 'orange',
			description: 'The account ledger is being reconciled; the displayed count is provisional.'
		} as const;
	}
	return {
		label: 'unavailable',
		colorScheme: 'red',
		description: 'The canonical ledger is unavailable, so usage is not presented as zero.'
	} as const;
};

export const storageProjectionTitle = (storage: AdminStorageProjection | null | undefined): string => {
	const state = storageStatusPresentation(storage);
	if (!storage) return state.description;
	const allowance = storage.allowanceBytes === null ? 'unlimited allowance' : `${exactByteLabel(storage.allowanceBytes)} allowance`;
	if (storage.status === 'unavailable') {
		return [
			'Usage unavailable',
			allowance,
			state.description,
			`accounting version ${storage.accountingVersion ?? 'unavailable'}`,
			storage.reconciledAt ? `last reconciled ${storage.reconciledAt}` : 'not yet reconciled'
		].join(' · ');
	}
	const remaining = storage.remainingBytes === null ? 'unlimited remaining' : `${exactByteLabel(storage.remainingBytes)} remaining`;
	const reconciled = storage.reconciledAt ? `last reconciled ${storage.reconciledAt}` : 'not yet reconciled';
	return [
		`${exactByteLabel(storage.usedBytes)} used`,
		allowance,
		remaining,
		`${exactByteLabel(storage.overageBytes)} overage`,
		state.description,
		`accounting version ${storage.accountingVersion ?? 'unavailable'}`,
		reconciled
	].join(' · ');
};
