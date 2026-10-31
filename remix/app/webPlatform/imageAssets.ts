import magickUrl from '@imagemagick/magick-wasm/magick.wasm?url';
import resvgUrl from '@resvg/resvg-wasm/index_bg.wasm?url';
import type { ImageWasmAssets } from './imagePipeline';

/** Only public, build-pinned same-origin engine assets are fetched by the host.
 * Selected media bytes never enter this loader or a request body. */
export async function loadImageWasmAssets(signal?: AbortSignal): Promise<ImageWasmAssets> {
	const read = async (asset: string) => {
		const url = new URL(asset, location.href);
		if (url.origin !== location.origin) throw new Error('Local image engines must be served from this origin');
		const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
		if (!response.ok) throw new Error('The bundled local image engine could not be loaded');
		return new Uint8Array(await response.arrayBuffer());
	};
	const [magick, resvg] = await Promise.all([read(magickUrl), read(resvgUrl)]);
	return { magick, resvg };
}
