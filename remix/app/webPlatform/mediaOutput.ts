/** Random-access muxer writes in fixed-size chunks. Pages preserve
 * overwritten container headers without accumulating every historical write. */
export class MediaOutput {
	private pages = new Map<number, Uint8Array>();
	private length = 0;
	private readonly pageSize = 1024 * 1024;
	write(data: Uint8Array, position: number) {
		const end = position + data.byteLength;
		if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(end)) throw new Error('Invalid media output offset');
		for (let read = 0; read < data.length; ) {
			const offset = position + read,
				index = Math.floor(offset / this.pageSize),
				within = offset % this.pageSize;
			let page = this.pages.get(index);
			if (!page) {
				page = new Uint8Array(this.pageSize);
				this.pages.set(index, page);
			}
			const count = Math.min(data.length - read, page.length - within);
			page.set(data.subarray(read, read + count), within);
			read += count;
		}
		this.length = Math.max(this.length, end);
	}
	blob(type: string): Blob {
		const parts: Uint8Array<ArrayBuffer>[] = [];
		for (let offset = 0; offset < this.length; offset += this.pageSize) {
			const count = Math.min(this.pageSize, this.length - offset);
			parts.push(this.pages.get(offset / this.pageSize)?.slice(0, count) ?? new Uint8Array(count));
		}
		return new Blob(parts, { type });
	}
}
