import {
	AlphaAction,
	ColorSpace,
	ConfigurationFiles,
	ImageMagick,
	MagickColor,
	MagickFormat,
	MagickGeometry,
	MagickReadSettings,
	ResourceLimits,
	initializeImageMagick
} from '@imagemagick/magick-wasm';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
export { isImageFile } from './imageFiles';

export type ImageWasmAssets = { magick: Uint8Array; resvg?: Uint8Array };
export type ImageFormat = 'auto' | 'webp' | 'jpeg' | 'png' | 'avif' | 'gif';
export type ImageSettings = { maxWidth: number; maxHeight: number; imageFormat?: ImageFormat; imageQuality?: number; imageBackground?: string };

// Blob-only decoding: no host filesystem, delegates or URL/pseudo-image coders.
// AVIF's temporary files stay in this worker's private in-memory WASM filesystem.
const rasterCoders =
	'PNG,APNG,JPEG,JPG,JPE,PJPEG,WEBP,AVIF,HEIC,HEIF,GIF,GIF87,BMP,BMP2,BMP3,ICO,CUR,ICON,TIFF,TIFF64,PTIF,TGA,ICB,VDA,VST,PCX,DCX,PNM,PBM,PGM,PPM,PAM,PFM,PSD,PSB,JP2,J2K,J2C,JPC,JPM,JPT,JXL,QOI,DDS,DXT1,DXT5,EXR,HDR,RGBE,RAS,SUN,SGI,XCF,MNG,JNG,WBMP,XBM,XPM,DPX,CIN,FITS,FTS,FARBFELD,FF,MIFF';
export const IMAGE_DECODER_POLICY = `<policymap>
<policy domain="delegate" rights="none" pattern="*"/>
<policy domain="path" rights="none" pattern="*"/>
<policy domain="path" rights="read|write" pattern="/tmp/magick-*"/>
<policy domain="coder" rights="none" pattern="*"/>
<policy domain="coder" rights="read|write" pattern="{${rasterCoders}}"/>
</policymap>`;
let magickReady: Promise<void> | undefined;
let resvgReady: Promise<void> | undefined;
async function initialize(assets: ImageWasmAssets) {
	magickReady ??= (async () => {
		const base = ConfigurationFiles.default;
		const policy = { fileName: base.policy.fileName, data: IMAGE_DECODER_POLICY };
		await initializeImageMagick(assets.magick, {
			policy,
			log: base.log,
			*all() {
				for (const file of base.all()) yield file.fileName === policy.fileName ? policy : file;
			}
		});
		// The WASM virtual disk is memory too: never spill decoded pixels to it.
		// No arbitrary source-size/pixel/frame cap; allocation failures are explicit.
		ResourceLimits.disk = BigInt(0);
	})();
	await magickReady;
}

export function imageDimensions(width: number, height: number, settings: Pick<ImageSettings, 'maxWidth' | 'maxHeight'>) {
	for (const value of [width, height, settings.maxWidth, settings.maxHeight])
		if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Image dimensions must be positive finite integers');
	const scale = Math.min(1, settings.maxWidth / width, settings.maxHeight / height);
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function validateStaticSvg(svg: string) {
	// resvg has no script execution. Refuse unsupported behavior instead of
	// producing a plausible image that silently omits text, motion or resources.
	if (/<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(svg)) throw new Error('SVG document types, entities and processing instructions are unsupported');
	if (/<\s*(?:[\w.-]+:)?(?:text|tspan|textPath)\b/i.test(svg))
		throw new Error('SVG text requires fonts; convert text to paths before local compression');
	if (/<\s*(?:[\w.-]+:)?image\b/i.test(svg))
		throw new Error('SVG embedded or external images are unsupported; use a static SVG made from paths and shapes');
	if (/\b(?:[\w.-]+:)?href\s*=\s*(['"])(?!#)[\s\S]*?\1/i.test(svg)) throw new Error('SVG external references are unsupported');
	if (/<\s*(?:[\w.-]+:)?(?:script|foreignObject|animate\w*|set|discard)\b|@keyframes|\banimation\s*:/i.test(svg))
		throw new Error('Animated or scripted SVG is unsupported; use a static image or animated GIF/WebP');
	if (/@import/i.test(svg)) throw new Error('SVG external resources are unsupported');
	for (const match of svg.matchAll(/\burl\s*\(([^)]*)\)/gi)) {
		const target = match[1]
			.trim()
			.replace(/^(['"])([\s\S]*)\1$/, '$2')
			.trim();
		if (!target.startsWith('#')) throw new Error('SVG external resources are unsupported');
	}
}

async function rasterizeSvg(bytes: Uint8Array, settings: ImageSettings, assets: ImageWasmAssets) {
	if (!assets.resvg) throw new Error('The bundled local SVG renderer is unavailable');
	const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	validateStaticSvg(svg);
	resvgReady ??= initWasm(assets.resvg);
	await resvgReady;
	let renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
	try {
		if (renderer.imagesToResolve().length) throw new Error('SVG external images are unsupported; embed the image first');
		const size = imageDimensions(renderer.width, renderer.height, settings);
		if (size.width !== renderer.width || size.height !== renderer.height) {
			renderer.free();
			renderer = new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: size.width } });
		}
		const rendered = renderer.render();
		try {
			return new Uint8Array(rendered.asPng());
		} finally {
			rendered.free();
		}
	} finally {
		renderer.free();
	}
}

const formats = { webp: MagickFormat.WebP, jpeg: MagickFormat.Jpeg, png: MagickFormat.Png, avif: MagickFormat.Avif, gif: MagickFormat.Gif };
const mime = { webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png', avif: 'image/avif', gif: 'image/gif' };
const animationSources = new Set<string>(['GIF', 'GIF87', 'WEBP', 'PNG', 'APNG', 'MNG']);

export function pngAnimationFrames(bytes: Uint8Array): number | undefined {
	if (bytes.length < 8 || bytes[0] !== 137 || String.fromCharCode(...bytes.subarray(1, 4)) !== 'PNG') return;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 8; offset + 12 <= bytes.length; ) {
		const length = view.getUint32(offset);
		if (length > bytes.length - offset - 12) throw new Error('Truncated PNG chunk');
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		if (type === 'acTL') {
			if (length !== 8) throw new Error('Invalid PNG animation header');
			return view.getUint32(offset + 8);
		}
		if (type === 'IDAT' || type === 'IEND') return;
		offset += length + 12;
	}
}

/** Runs only inside the task-owned, network-disabled, terminable media worker. */
export async function compressImage(file: Blob, settings: ImageSettings, wasm: ImageWasmAssets | Uint8Array, fileName?: string) {
	if (!file.size) throw new Error('Choose a nonempty local image');
	const assets = wasm instanceof Uint8Array ? { magick: wasm } : wasm;
	for (const [name, bytes] of [
		['raster', assets?.magick],
		['SVG', assets?.resvg]
	] as const) {
		if (name === 'SVG' && bytes === undefined) continue;
		if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 97 || bytes[2] !== 115 || bytes[3] !== 109)
			throw new Error(`The bundled local ${name} image engine is missing or malformed. Reload the updated app.`);
	}
	const quality = settings.imageQuality ?? 80;
	if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('Image quality must be 1–100');
	const requested = settings.imageFormat ?? 'auto';
	if (!['auto', ...Object.keys(formats)].includes(requested)) throw new Error('Unsupported image output format');
	const background = settings.imageBackground ?? 'none';
	if (background !== 'none' && !/^#[a-f\d]{6}$/i.test(background)) throw new Error('Choose an explicit six-digit hex image background or none');
	let bytes = new Uint8Array(await file.arrayBuffer());
	// libpng can expose only APNG's default still image. Never silently discard
	// its animation when the bundled decoder lacks a native animation delegate.
	if (pngAnimationFrames(bytes)) throw new Error('Animated PNG decoding is unavailable locally; use animated GIF or WebP to preserve every frame');
	// The comment body spells out "anything that is not the `-->` terminator"
	// rather than a lazy `[\s\S]*?`: a lazy body can also swallow `-->`, so an
	// uploaded `<!--` followed by many `--><!--` made the leading-comment loop
	// backtrack exponentially over this 4 KB window.
	const svg =
		file.type === 'image/svg+xml' ||
		/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096)));
	if (svg) bytes = await rasterizeSvg(bytes, settings, assets);
	await initialize(assets);
	const extension = (fileName ?? (file as Blob & { name?: string }).name ?? '').split('.').pop()?.toLowerCase();
	const formatHint =
		bytes.length >= 22 && bytes[0] === 0 && bytes[1] === 0 && bytes[3] === 0 && (bytes[2] === 1 || bytes[2] === 2) && (bytes[4] > 0 || bytes[5] > 0)
			? bytes[2] === 1
				? MagickFormat.Ico
				: MagickFormat.Cur
			: extension === 'tga'
			? MagickFormat.Tga
			: undefined;
	return ImageMagick.readCollection(bytes, new MagickReadSettings({ format: formatHint }), (images) => {
		if (!images.length) throw new Error('The image decoder returned no frames');
		const sourceFormat = images[0].format;
		const animated = images.length > 1;
		if (animated && !animationSources.has(sourceFormat))
			throw new Error('Multi-page or layered images cannot be silently flattened; export one image or an animation first');
		const format = requested === 'auto' ? 'webp' : requested;
		if (animated && format !== 'webp' && format !== 'gif')
			throw new Error('Animation requires WebP or GIF output; choose one to preserve every frame');
		if (animated) images.coalesce();
		for (const image of images) image.autoOrient();
		const size = imageDimensions(images[0].width, images[0].height, settings);
		const inputHasAlpha = images.some((image) => !image.isOpaque);
		if (inputHasAlpha && format === 'jpeg' && background === 'none')
			throw new Error('JPEG cannot preserve transparency; choose WebP/PNG/AVIF or an explicit background');
		if (inputHasAlpha && format === 'gif') throw new Error('GIF alpha conversion is unsupported here; choose WebP to preserve transparency');
		const delays = images.map((image) => image.animationDelay / (image.animationTicksPerSecond || 100));
		const iterations = images[0].animationIterations;
		for (const image of images) {
			image.colorSpace = ColorSpace.sRGB;
			const geometry = new MagickGeometry(size.width, size.height);
			geometry.ignoreAspectRatio = true;
			image.resize(geometry);
			image.quality = quality;
			if (format === 'jpeg') {
				if (background !== 'none') image.backgroundColor = new MagickColor(background);
				image.alpha(AlphaAction.Remove);
			}
			// Apply EXIF orientation before stripping location and other metadata.
			image.strip();
		}
		images.resetPage();
		return images.write(formats[format], (output) => {
			const encoded = new Uint8Array(output);
			if (!encoded.length) throw new Error('The image encoder returned no output');
			ImageMagick.readCollection(encoded, (verified) => {
				if (verified.length !== images.length) throw new Error('Image output verification failed: frame count changed');
				// GIF/WebP encoders may store only each changed rectangle. Validate
				// the composited frames, including alpha, against the source canvas;
				// smaller delta rectangles are not missing pixels or flattened frames.
				if (animated) verified.coalesce();
				if (verified.some((image) => image.width !== size.width || image.height !== size.height))
					throw new Error('Image output verification failed: composited dimensions changed');
				if (inputHasAlpha && format !== 'jpeg' && !verified.some((image) => !image.isOpaque))
					throw new Error('Image output verification failed: transparency was lost');
				if (
					animated &&
					(verified[0].animationIterations !== iterations ||
						verified.some((image, i) => Math.abs(image.animationDelay / (image.animationTicksPerSecond || 100) - delays[i]) > 0.011))
				)
					throw new Error('The encoder cannot preserve this animation timing or loop count; try another format');
			});
			const blob = new Blob([encoded], { type: mime[format] });
			const smaller = blob.size < file.size;
			return {
				blob,
				receipt: {
					kind: 'image' as const,
					format,
					extension: format === 'jpeg' ? 'jpg' : format,
					...size,
					inputBytes: file.size,
					outputBytes: blob.size,
					savedPercent: Math.round((1 - blob.size / file.size) * 1000) / 10,
					frameCount: images.length,
					animated,
					duration: animated ? delays.reduce((sum, delay) => sum + delay, 0) : 0,
					hasAlpha: inputHasAlpha && format !== 'jpeg',
					note: `${svg ? 'Static SVG rasterized; vector editability is not retained. ' : ''}${
						animated ? 'Animation frames and timing retained. ' : ''
					}${format === 'jpeg' && inputHasAlpha ? 'Transparency flattened onto the selected background. ' : ''}${
						smaller
							? 'Output is smaller than the selected source.'
							: 'Output is not smaller; reduce quality or dimensions. The original file is unchanged.'
					}`
				}
			};
		});
	});
}
