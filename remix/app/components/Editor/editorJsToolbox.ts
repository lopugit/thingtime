type ListV2ToolboxEntry = {
	data?: {
		style?: unknown;
	};
};

const isListV2ChecklistToolboxEntry = (entry: unknown): boolean => {
	if (entry === null || typeof entry !== 'object') return false;
	const data = (entry as ListV2ToolboxEntry).data;
	return data !== null && typeof data === 'object' && data.style === 'checklist';
};

/** Remove List v2's checklist alias while leaving every other toolbox value intact. */
export const filterListV2ChecklistToolbox = <Toolbox>(toolbox: Toolbox): Toolbox => {
	if (!Array.isArray(toolbox)) return toolbox;

	const filtered = toolbox.filter((entry) => !isListV2ChecklistToolboxEntry(entry));
	return (filtered.length === toolbox.length ? toolbox : filtered) as Toolbox;
};
