// Convert positions in a scaled responsive iframe to the overlay document.
export function builderPoint(element: Element, x: number, y: number) {
	let view = element.ownerDocument.defaultView;
	while (view?.frameElement) {
		const frame = view.frameElement;
		const rect = frame.getBoundingClientRect();
		const scaleX = rect.width / (frame as HTMLElement).offsetWidth;
		const scaleY = rect.height / (frame as HTMLElement).offsetHeight;
		x = rect.left + x * scaleX;
		y = rect.top + y * scaleY;
		view = frame.ownerDocument.defaultView;
	}
	return { x, y };
}
export function builderRect(element: Element) {
	const rect = element.getBoundingClientRect();
	const start = builderPoint(element, rect.left, rect.top);
	const end = builderPoint(element, rect.right, rect.bottom);
	return { left: start.x, top: start.y, right: end.x, bottom: end.y, width: end.x - start.x, height: end.y - start.y };
}

// Editor menus live in the host but must dismiss on clicks/keys in previews.
export function builderDocuments(): Document[] {
	const documents = [document];
	for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[title="Responsive page preview"]')) {
		if (frame.contentDocument) documents.push(frame.contentDocument);
	}
	return documents;
}
