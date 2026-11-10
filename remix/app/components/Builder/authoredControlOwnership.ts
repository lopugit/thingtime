/** React portal events retain their authored surface even across Builder's
 * same-origin viewport document. Follow only real frame ownership; ordinary
 * DOM ancestry, unrelated documents and inaccessible frames stay fenced. */
export function ownsAuthoredControl(boundary: HTMLElement, control: Element): boolean {
	let node: Element = control;
	const documents = new Set<Document>();
	while (!boundary.contains(node)) {
		const document = node.ownerDocument;
		if (document === boundary.ownerDocument || documents.has(document)) return false;
		documents.add(document);
		try {
			const frame = document.defaultView?.frameElement;
			if (!frame) return false;
			node = frame;
		} catch {
			return false;
		}
	}
	return true;
}
