import { isCssPropertyName } from '../../schemas/cssDeclarationNames';
import { isSafeCssText } from '../Kinds/safeUrl';

export type ImageFit = 'cover' | 'contain' | 'fill';

export type ImagePresentation = {
  fit?: ImageFit;
  zoom?: number;
  anchorX?: number;
  anchorY?: number;
  offsetX?: number;
  offsetY?: number;
  paddingX?: number;
  paddingY?: number;
  css?: Record<string, string>;
  attributes?: Record<string, string>;
};

export const IMAGE_PRESENTATION_DEFAULTS = {
  fit: 'cover', zoom: 100, anchorX: 50, anchorY: 50, offsetX: 0, offsetY: 0, paddingX: 0, paddingY: 0
} as const;

// Presentation can describe a saved image, but cannot select another source,
// make the image interactive, or relax how the browser requests its bytes.
const IMAGE_ATTRIBUTES = new Set(['alt', 'title', 'width', 'height', 'loading', 'decoding', 'dir', 'lang', 'role', 'aria-label', 'aria-hidden']);
export const isImagePresentationAttribute = (name: string) => IMAGE_ATTRIBUTES.has(name);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
};

const isImageCssValue = (value: string) =>
  isSafeCssText(value) &&
  // These declarations are rendered for other viewers. Keep network requests
  // bound to the validated media source, including CSS image-set string URLs.
  !/[\\{}\u0000-\u0008\u000B-\u001F\u007F]|\/\*|\b(?:url|src|(?:-webkit-)?image-set|image)\s*\(/i.test(value);

const isImageAttributeValue = (key: string, value: string) => {
  if (key === 'width' || key === 'height') return /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
  if (key === 'loading') return value === 'lazy' || value === 'eager';
  if (key === 'decoding') return value === 'auto' || value === 'async' || value === 'sync';
  if (key === 'dir') return value === 'auto' || value === 'ltr' || value === 'rtl';
  if (key === 'aria-hidden') return value === 'true' || value === 'false';
  return true;
};

// undefined is an invalid request; null is a valid reset. Persist only
// deviations from the default frame so unedited slots retain legacy behavior.
export const normalizeImagePresentation = (value: unknown): ImagePresentation | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const out: ImagePresentation = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'fit') {
      if (entry !== 'cover' && entry !== 'contain' && entry !== 'fill') return undefined;
      if (entry !== IMAGE_PRESENTATION_DEFAULTS.fit) out.fit = entry;
    } else if (key === 'css' || key === 'attributes') {
      if (!isRecord(entry)) return undefined;
      const fields: [string, string][] = [];
      for (const [name, source] of Object.entries(entry)) {
        if (typeof source !== 'string') return undefined;
        if (key === 'css') {
          if (!isCssPropertyName(name) || !isImageCssValue(source)) return undefined;
          if (source.trim()) fields.push([name, source.trim()]);
        } else {
          if (!isImagePresentationAttribute(name) || !isImageAttributeValue(name, source)) return undefined;
          fields.push([name, source]);
        }
      }
      if (fields.length) out[key] = Object.fromEntries(fields);
    } else if (key === 'zoom' || key === 'anchorX' || key === 'anchorY' || key === 'offsetX' || key === 'offsetY' || key === 'paddingX' || key === 'paddingY') {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined;
      if (key === 'zoom' && entry <= 0) return undefined;
      if ((key === 'anchorX' || key === 'anchorY') && (entry < 0 || entry > 100)) return undefined;
      if ((key === 'paddingX' || key === 'paddingY') && entry < 0) return undefined;
      if (entry !== IMAGE_PRESENTATION_DEFAULTS[key]) out[key] = entry;
    } else {
      return undefined;
    }
  }
  return Object.keys(out).length ? out : null;
};
