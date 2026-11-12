// Plain-data view of the official branding assets for the thingtime defaults
// tree (tt.assets / tt.branding). Derived from the committed manifest that
// `npm run branding-assets` writes — no render/exec payloads, just facts.

import brandingAssets from './brandingAssets.generated.json';

export type BrandingAssetRecord = {
  name: string;
  description: string;
  type: string;
  url: string;
};

const variantRecords: BrandingAssetRecord[] = brandingAssets.variants.map((variant) => ({
  name: `Thingtime ${variant.name}`,
  description: `The official Thingtime ${variant.name.toLowerCase()} — scalable SVG, with PNGs from ${variant.pngs[0]?.w ?? 10}px to ${
    variant.pngs[variant.pngs.length - 1]?.w ?? 10000
  }px on /branding.`,
  type: 'image/svg+xml',
  url: variant.svg.url
}));

const pressKitRecords: BrandingAssetRecord[] = brandingAssets.presskit.map((item) => ({
  name: `Thingtime ${item.name}`,
  description: item.description,
  type: 'image/png',
  url: item.url
}));

export const brandingAssetRecords: BrandingAssetRecord[] = [...variantRecords, ...pressKitRecords];
