const imageExtensions =
	/\.(?:avif|heic|heif|jpe?g|jfif|png|apng|webp|gif|bmp|dib|ico|cur|tiff?|tga|pcx|dcx|p[bnpgaf]m|ps[bd]|jp[2cxm]|j2[ck]|jxl|qoi|dds|exr|hdr|rgbe|ras|sgi|xcf|mng|jng|wbmp|xbm|xpm|dpx|cin|fits?|fts|ff|miff|svg|svgz)$/i;
export function isImageFile(file: { name?: string; type?: string }): boolean {
	return /^image\//i.test(file.type ?? '') || imageExtensions.test(file.name ?? '');
}
