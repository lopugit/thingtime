import type { WebpageBlock } from '../Builder/webpageBlocks';

/** The existing official tree, shared by password UI and its packaged providers. */
export const PASSWORD_BRAND_ICON = '/branding/generated/icon/thingtime-icon-128x128.png';
export const passwordBrandMark = (id: string, size = 32): WebpageBlock => ({
  id, type: 'element', tag: 'img', props: { src: PASSWORD_BRAND_ICON, alt: '', 'aria-hidden': true, width: size, height: size },
  css: { width: `${size}px`, height: `${size}px`, 'object-fit': 'contain', 'flex-shrink': '0', 'image-rendering': 'pixelated' },
});

/** Add an editable mark beside a known heading, preserving its text, style and ID.
 * The wrapper is the migration marker: deleting its image stays deleted on reload.
 * Documents without that heading are authored layouts and remain untouched. */
export const passwordBrandingMigration = (headingId: string) => (blocks: WebpageBlock[]): WebpageBlock[] => {
  const marker = `${headingId}-brand`;
  const hasMarker = (items: WebpageBlock[]): boolean => items.some(block => block.id === marker || !!block.children && hasMarker(block.children));
  if (hasMarker(blocks)) return blocks;
  const visit = (items: WebpageBlock[]): WebpageBlock[] => {
    let changed = false;
    const next = items.map(block => {
      if (block.id === headingId && block.type === 'element') {
        changed = true;
        return { id: marker, type: 'element', tag: block.tag === 'legend' ? 'legend' : 'div',
          css: { display: 'flex', gap: '10px', 'align-items': 'center', 'min-width': '0' },
          children: [passwordBrandMark(`${headingId}-tree`), block.tag === 'legend' ? { ...block, tag: 'span' } : block] } as WebpageBlock;
      }
      if (!block.children) return block;
      const children = visit(block.children);
      if (children === block.children) return block;
      changed = true; return { ...block, children };
    });
    return changed ? next : items;
  };
  return visit(blocks);
};
