// Client-side export engine for the /branding page. One entry point renders a
// logo variant as a downloadable SVG or PNG at any pixel width, with per-side
// pixel padding and an optional solid background baked into the file. SVG and
// PNG share buildLogoSvg, so the two formats always match voxel-for-voxel.

import { buildLogoSvg, logoMatrixToCells, trimLogoCells } from './logoMatrix';
import type { LogoColourMap, LogoMatrix } from './logoMatrix';

export type PaddingPx = { top: number; right: number; bottom: number; left: number };

export type BrandExportOptions = {
  matrix: LogoMatrix;
  colourMap: LogoColourMap;
  slug: string;
  format: 'svg' | 'png';
  /** Artwork width in px — padding is added on top of this. */
  width: number;
  padding: PaddingPx;
  /** CSS colour baked behind the artwork; undefined = transparent. */
  background?: string;
};

const clampPad = (value: number) => (Number.isFinite(value) && value > 0 ? Math.min(value, 4000) : 0);

export const buildExportSvg = ({
  matrix,
  colourMap,
  width,
  padding,
  background
}: Omit<BrandExportOptions, 'format' | 'slug'>): { svg: string; width: number; height: number } => {
  const cells = trimLogoCells(logoMatrixToCells(matrix), colourMap);
  const columns = Math.max(1, ...cells.map((row) => row.length));
  const artworkWidth = Math.max(1, Math.round(width));
  const pxPerCell = artworkWidth / columns;
  const pad = {
    top: clampPad(padding.top),
    right: clampPad(padding.right),
    bottom: clampPad(padding.bottom),
    left: clampPad(padding.left)
  };
  const totalWidth = artworkWidth + Math.round(pad.left) + Math.round(pad.right);
  const { svg, pixelHeight } = buildLogoSvg({
    matrix,
    colourMap,
    background,
    padding: {
      top: pad.top / pxPerCell,
      right: pad.right / pxPerCell,
      bottom: pad.bottom / pxPerCell,
      left: pad.left / pxPerCell
    },
    pixelWidth: totalWidth
  });
  return { svg, width: totalWidth, height: pixelHeight ?? totalWidth };
};

const triggerDownload = (url: string, filename: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

/** Renders + downloads the export. Resolves once the file has been handed to the browser. */
export const downloadBrandExport = async (options: BrandExportOptions): Promise<{ filename: string }> => {
  const { svg, width, height } = buildExportSvg(options);
  const filename = `thingtime-${options.slug}-${width}x${height}.${options.format}`;

  if (options.format === 'svg') {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    URL.revokeObjectURL(url);
    return { filename };
  }

  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The SVG could not be loaded for rasterising'));
      image.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    // the SVG already carries padding + background, so a 1:1 draw is exact
    context.drawImage(image, 0, 0, width, height);
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('The PNG could not be rendered');
    const pngUrl = URL.createObjectURL(pngBlob);
    triggerDownload(pngUrl, filename);
    URL.revokeObjectURL(pngUrl);
    return { filename };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
};
