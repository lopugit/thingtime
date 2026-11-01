// A receipt belongs to one generated form operation. Failed, stale and sibling
// receipts cannot discard a draft or change the identity used for a retry.
export function formCompletionMatches(completion: unknown, name: string, identity: string): boolean {
	if (!name || !identity || !completion || typeof completion !== 'object' || Array.isArray(completion)) return false;
	const receipt = completion as { ok?: unknown; result?: unknown };
	if (receipt.ok !== true || !receipt.result || typeof receipt.result !== 'object' || Array.isArray(receipt.result)) return false;
	return Object.prototype.hasOwnProperty.call(receipt.result, name) && (receipt.result as Record<string, unknown>)[name] === identity;
}
