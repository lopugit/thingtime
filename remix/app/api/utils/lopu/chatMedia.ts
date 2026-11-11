// Provider-neutral content. Bytes and signed URLs never enter chat persistence.
export type LopuMedia = { name: string; contentType: string; data: string };
export const LOPU_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const LOPU_MEDIA_TOTAL_BYTES = 12 * 1024 * 1024;
export const LOPU_TEXT_MAX_BYTES = 128 * 1024;
export const isLopuImage = (type: string) => ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type);
export const isLopuText = (type: string) =>
	type.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(type);

export function anthropicMediaContent(text: string, media: LopuMedia[] = []): any {
	if (!media.length) return text;
	return [
		{ type: 'text', text: text || 'Please inspect the attached files.' },
		...media.map((file) =>
			isLopuImage(file.contentType)
				? { type: 'image', source: { type: 'base64', media_type: file.contentType, data: file.data } }
				: { type: 'document', title: file.name, source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
		)
	];
}

export function openAiMediaContent(text: string, media: LopuMedia[] = []): any {
	if (!media.length) return text;
	return [
		{ type: 'text', text: text || 'Please inspect the attached files.' },
		...media.map((file) =>
			isLopuImage(file.contentType)
				? { type: 'image_url', image_url: { url: `data:${file.contentType};base64,${file.data}` } }
				: { type: 'file', file: { filename: file.name, file_data: `data:application/pdf;base64,${file.data}` } }
		)
	];
}

export async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
	if (!response.ok || !response.body) throw new Error('File could not be read.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > maxBytes) throw new Error('File exceeds the content limit.');
			chunks.push(next.value);
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
