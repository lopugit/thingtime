// The curated ready-to-post imagery set for the /branding page: hand-picked
// scenes (see brandScenes.ts) across every logo lock-up and fun cut, rendered
// to committed PNGs by scripts/generate-branding-assets.mjs.
//
// One list drives the generator, the gallery, the sitemap and the tests. Each
// entry is just scene options, so every picture can be reopened in the studio
// and remixed. Imported by node under type stripping: explicit `.ts`
// specifiers, erasable-only syntax.

import { DEFAULT_SCENE, IMAGERY_FORMATS, brandBackdrop, describeScene, normaliseSceneOptions, sceneLogoName, sceneSlug } from './brandScenes.ts';
import type { BrandImageryFormat, BrandSceneOptions } from './brandScenes.ts';
import { brandLogoVariant } from './logoVariants.ts';

export type ImageryShape = 'wordmark' | 'square' | 'tree';
export type ImageryTone = 'light' | 'dark' | 'colour';
/** Gallery format filter: desktop and phone wallpapers share one group. */
export type ImageryFormatGroup = 'square' | 'portrait' | 'story' | 'card' | 'banner' | 'slide' | 'wallpaper';

export type BrandImageryItem = {
  /** Filename stem: <format>-<logo>-<backdrop>-<pattern>. */
  id: string;
  name: string;
  alt: string;
  format: BrandImageryFormat;
  scene: BrandSceneOptions;
  shape: ImageryShape;
  /** One of the "ways to play" cuts rather than a core or hotpink lock-up. */
  fun: boolean;
  tone: ImageryTone;
  group: ImageryFormatGroup;
};

export const IMAGERY_FORMAT_GROUPS: Record<string, ImageryFormatGroup> = {
  'square-post': 'square',
  'portrait-post': 'portrait',
  story: 'story',
  'link-card': 'card',
  banner: 'banner',
  slide: 'slide',
  desktop: 'wallpaper',
  phone: 'wallpaper'
};

export const imageryShape = (logo: string): ImageryShape =>
  logo.startsWith('logo-square') ? 'square' : logo.startsWith('icon') || logo === 'monogram' ? 'tree' : 'wordmark';

export const imageryTone = (backdrop: string): ImageryTone => (backdrop === 'paper' ? 'light' : backdrop === 'ink' || backdrop === 'night' ? 'dark' : 'colour');

// How large each cut likes to sit when nothing says otherwise: wide lock-ups
// fill the width, the confetti square brings its own sprinkles and wants room.
const preferredLogoSize = (logo: string): number => {
  if (logo === 'logo-square-confetti') return 1.5;
  if (logo === 'icon' || logo === 'icon-pink') return 0.7;
  if (logo === 'monogram') return 0.8;
  if (logo.startsWith('logo-square')) return 0.85;
  return 1;
};

type Recipe = [format: string, logo: string, backdrop: string, pattern: string, tweaks?: Partial<BrandSceneOptions>];

// Grouped by format here for easy editing; the published order interleaves
// the formats so the gallery opens on a mix.
const RECIPES: Recipe[] = [
  // Square posts
  ['square-post', 'logo-square', 'paper', 'confetti'],
  ['square-post', 'icon', 'sky', 'forest'],
  ['square-post', 'logo-rainbow', 'ink', 'dust'],
  ['square-post', 'logo-square-arcade', 'sunshine', 'checker'],
  ['square-post', 'icon-seasons', 'paper', 'hills'],
  ['square-post', 'logo-glitch', 'ink', 'rain'],
  ['square-post', 'logo-square-sunset', 'paper', 'stairs'],
  ['square-post', 'monogram', 'mint', 'mosaic'],
  ['square-post', 'logo-square-confetti', 'ink', 'frame'],
  ['square-post', 'logo-square-pink', 'bubblegum', 'dots'],
  ['square-post', 'logo-outline', 'ink', 'stars'],
  ['square-post', 'logo-bounce', 'prism', 'none'],
  ['square-post', 'logo', 'pastel', 'confetti'],
  ['square-post', 'icon', 'night', 'stars'],
  ['square-post', 'logo-dissolve', 'paper', 'dust'],
  ['square-post', 'logo-square', 'sunset', 'blocks'],
  ['square-post', 'icon-pink', 'grape', 'tiles'],
  ['square-post', 'logo-square', 'dusk', 'frame'],
  ['square-post', 'logo-square', 'night', 'hills'],
  ['square-post', 'icon', 'sunshine', 'checker'],
  ['square-post', 'logo-pink', 'paper', 'tiles'],
  ['square-post', 'logo-square-arcade', 'ink', 'stairs'],
  ['square-post', 'logo-square', 'mint', 'tiles'],
  ['square-post', 'icon-seasons', 'night', 'forest'],
  ['square-post', 'logo-rainbow', 'paper', 'frame'],
  ['square-post', 'monogram', 'ink', 'confetti'],
  ['square-post', 'logo-square-sunset', 'ink', 'dust'],
  ['square-post', 'icon', 'pastel', 'hills'],
  // Portrait posts
  ['portrait-post', 'logo-square', 'sky', 'hills'],
  ['portrait-post', 'icon-seasons', 'paper', 'forest'],
  ['portrait-post', 'logo-square-sunset', 'ink', 'stars'],
  ['portrait-post', 'logo-rainbow', 'paper', 'stairs'],
  ['portrait-post', 'icon', 'mint', 'tiles'],
  ['portrait-post', 'logo-square-confetti', 'paper', 'none'],
  ['portrait-post', 'logo-square-arcade', 'bubblegum', 'checker'],
  ['portrait-post', 'monogram', 'ink', 'dust'],
  ['portrait-post', 'logo-square-pink', 'ink', 'rain'],
  ['portrait-post', 'logo-square', 'prism', 'frame'],
  ['portrait-post', 'logo-square', 'night', 'stars'],
  ['portrait-post', 'icon', 'sky', 'forest'],
  ['portrait-post', 'logo-bounce', 'sunshine', 'blocks'],
  ['portrait-post', 'logo-glitch', 'ink', 'stairs'],
  // Stories
  ['story', 'logo-square', 'night', 'forest'],
  ['story', 'icon', 'sunset', 'hills'],
  ['story', 'logo-square-arcade', 'ink', 'dust'],
  ['story', 'icon-seasons', 'sky', 'forest'],
  ['story', 'logo-square', 'paper', 'rain'],
  ['story', 'logo-square-sunset', 'paper', 'blocks'],
  ['story', 'monogram', 'sunshine', 'mosaic'],
  ['story', 'logo-square-confetti', 'ink', 'stars'],
  ['story', 'icon-pink', 'bubblegum', 'checker'],
  ['story', 'logo-square', 'pastel', 'confetti'],
  ['story', 'icon', 'ink', 'stars'],
  ['story', 'logo-square', 'sky', 'hills'],
  ['story', 'logo-square-pink', 'paper', 'tiles'],
  ['story', 'icon-seasons', 'night', 'hills'],
  // Link cards
  ['link-card', 'logo', 'paper', 'confetti'],
  ['link-card', 'logo', 'ink', 'stars'],
  ['link-card', 'logo-rainbow', 'ink', 'stairs'],
  ['link-card', 'logo-glitch', 'ink', 'none'],
  ['link-card', 'logo-bounce', 'sky', 'hills'],
  ['link-card', 'logo-outline', 'paper', 'dots'],
  ['link-card', 'logo-dissolve', 'ink', 'dust'],
  ['link-card', 'logo-square', 'pastel', 'frame'],
  ['link-card', 'icon', 'paper', 'forest'],
  ['link-card', 'logo-pink', 'bubblegum', 'mosaic'],
  ['link-card', 'icon-seasons', 'night', 'hills'],
  ['link-card', 'monogram', 'prism', 'checker'],
  ['link-card', 'logo-square-arcade', 'sunshine', 'none'],
  ['link-card', 'logo', 'sunset', 'blocks'],
  ['link-card', 'logo-square-confetti', 'ink', 'frame'],
  ['link-card', 'logo', 'mint', 'tiles'],
  // Banners
  ['banner', 'logo', 'sky', 'forest', { logoSize: 0.8 }],
  ['banner', 'logo-rainbow', 'paper', 'blocks', { logoSize: 0.85 }],
  ['banner', 'logo', 'night', 'stars'],
  ['banner', 'logo-bounce', 'sunshine', 'checker'],
  ['banner', 'logo-glitch', 'ink', 'rain'],
  ['banner', 'icon-seasons', 'paper', 'hills', { logoSize: 0.8 }],
  ['banner', 'logo-pink', 'ink', 'frame'],
  ['banner', 'logo-square', 'sunset', 'none'],
  ['banner', 'logo-dissolve', 'paper', 'dust'],
  ['banner', 'monogram', 'pastel', 'confetti'],
  // Slides
  ['slide', 'logo', 'paper', 'stairs'],
  ['slide', 'logo-square', 'ink', 'confetti'],
  ['slide', 'icon', 'pastel', 'mosaic'],
  ['slide', 'logo-rainbow', 'dusk', 'none'],
  ['slide', 'logo-square-arcade', 'night', 'stars'],
  ['slide', 'logo-bounce', 'sky', 'forest'],
  // Desktop wallpapers
  ['desktop', 'logo', 'night', 'hills', { logoSize: 0.7 }],
  ['desktop', 'icon', 'ink', 'stars', { logoSize: 0.4 }],
  ['desktop', 'logo-square', 'paper', 'mosaic', { logoSize: 0.6 }],
  ['desktop', 'logo-outline', 'ink', 'rain', { logoSize: 0.8 }],
  // Phone wallpapers
  ['phone', 'icon', 'night', 'forest', { logoSize: 0.6 }],
  ['phone', 'logo-square', 'ink', 'confetti'],
  ['phone', 'icon-seasons', 'sky', 'hills'],
  ['phone', 'logo-square-sunset', 'paper', 'dust']
];

const describeAlt = (format: BrandImageryFormat, scene: BrandSceneOptions): string => {
  const backdrop = brandBackdrop(scene.backdrop).label.toLowerCase();
  return `Thingtime ${format.label.toLowerCase()} — the ${sceneLogoName(scene.logo)} voxel logo on a ${backdrop} background, ${format.width}×${format.height} PNG`;
};

// FNV-1a over the recipe's own name: each picture keeps its arrangement no
// matter what is added, removed or reordered around it.
const seedFor = (name: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
  return hash >>> 0;
};

const build = ([formatKey, logo, backdrop, pattern, tweaks]: Recipe): BrandImageryItem => {
  const format = IMAGERY_FORMATS.find((entry) => entry.key === formatKey);
  if (!format) throw new Error(`Unknown imagery format: ${formatKey}`);
  const scene = normaliseSceneOptions({
    ...DEFAULT_SCENE,
    width: format.width,
    height: format.height,
    logo,
    backdrop,
    pattern,
    seed: seedFor([formatKey, logo, backdrop, pattern].join('/')),
    logoSize: preferredLogoSize(logo),
    ...tweaks
  });
  return {
    id: `${format.key}-${sceneSlug(scene)}`,
    name: `${format.label} · ${describeScene(scene)}`,
    alt: describeAlt(format, scene),
    format,
    scene,
    shape: imageryShape(scene.logo),
    fun: brandLogoVariant(scene.logo)?.group === 'fun',
    tone: imageryTone(scene.backdrop),
    group: IMAGERY_FORMAT_GROUPS[format.key]
  };
};

// Round-robin through the formats: first of each, then second of each, …
const interleave = (items: BrandImageryItem[]): BrandImageryItem[] => {
  const lanes = new Map<string, BrandImageryItem[]>();
  for (const item of items) lanes.set(item.format.key, [...(lanes.get(item.format.key) ?? []), item]);
  const out: BrandImageryItem[] = [];
  for (let round = 0; out.length < items.length; round += 1) {
    for (const lane of lanes.values()) if (lane[round]) out.push(lane[round]);
  }
  return out;
};

export const BRAND_IMAGERY: BrandImageryItem[] = interleave(RECIPES.map((recipe) => build(recipe)));

export const brandImageryUrl = (item: Pick<BrandImageryItem, 'id' | 'format'>): string =>
  `/branding/imagery/thingtime-${item.id}-${item.format.width}x${item.format.height}.png`;
