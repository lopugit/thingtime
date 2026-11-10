import React from 'react';
import { applyInlineCssDeclarations } from '../ElementInspector/cssDeclarations';
import { IMAGE_PRESENTATION_DEFAULTS, normalizeImagePresentation, type ImagePresentation } from './imagePresentation';

const renderableImageSource = (input: string): string | undefined => {
  if (typeof input !== 'string') return undefined;
  const source = input.trim();
  if (!source) return undefined;
  try {
    const { protocol } = new URL(source, 'https://thingtime.invalid/');
    if (protocol !== 'https:' && protocol !== 'http:' && protocol !== 'blob:' &&
        !(protocol === 'data:' && /^data:image\//i.test(source))) return undefined;
    // Encode literal URL metacharacters at the image sink while retaining
    // existing escapes, query separators, and the original stored source.
    return source.replace(/[<>"]/g, encodeURIComponent);
  } catch {
    return undefined;
  }
};

/** Responsive image presentation inside a caller-owned, already sized slot. */
export const PresentedImage = ({
  src, presentation, alt = '', onError, loading
}: {
  src: string;
  presentation?: ImagePresentation | null;
  alt?: string;
  loading?: 'eager' | 'lazy';
  onError?: React.ReactEventHandler<HTMLImageElement>;
}) => {
  const image = React.useMemo(() => normalizeImagePresentation(presentation) || {}, [presentation]);
  const frame = { ...IMAGE_PRESENTATION_DEFAULTS, ...image };
  const attributes = image.attributes || {};
  const source = React.useMemo(() => renderableImageSource(src), [src]);
  const imageRef = React.useRef<HTMLImageElement>(null);
  React.useLayoutEffect(() => {
    const element = imageRef.current;
    if (!element) return;
    const frame = { ...IMAGE_PRESENTATION_DEFAULTS, ...image };
    const anchor = `${frame.anchorX}% ${frame.anchorY}%`;
    const transformed = frame.zoom !== 100 || frame.offsetX !== 0 || frame.offsetY !== 0;
    const declarations = {
      display: 'block',
      'box-sizing': 'border-box',
      width: image.attributes?.width ? '' : '100%',
      height: image.attributes?.height ? '' : '100%',
      'object-fit': frame.fit,
      'object-position': anchor,
      'transform-origin': anchor,
      transform: transformed ? `translate(${frame.offsetX}px, ${frame.offsetY}px) scale(${frame.zoom / 100})` : ''
    };
    element.removeAttribute('style');
    for (const [name, value] of Object.entries(declarations)) element.style.setProperty(name, value);
    if (image.css) applyInlineCssDeclarations(element, image.css);
  }, [image]);
  return (
    <span style={{ display: 'block', position: 'relative', width: '100%', height: '100%', overflow: 'hidden', contain: 'layout paint', boxSizing: 'border-box', padding: `${frame.paddingY}px ${frame.paddingX}px` }}>
      <img {...attributes} ref={imageRef} src={source} alt={attributes.alt ?? alt} loading={attributes.loading === 'eager' || attributes.loading === 'lazy' ? attributes.loading : loading} referrerPolicy="no-referrer" onError={onError} />
    </span>
  );
};
