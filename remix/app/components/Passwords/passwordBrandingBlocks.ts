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

/** Repair only shipped subtitle/icon contrast. Authored colors, structure, content,
 * and deleted blocks remain user-owned; hierarchy comes from size and weight. */
const oldPreviewIconCss:Record<string,string>={width:'32px',height:'32px','object-fit':'contain','flex-shrink':'0'};
export const PASSWORD_PREVIEW_ICON_CSS:Record<string,string>={...oldPreviewIconCss,background:'#fff',padding:'3px','border-radius':'6px','box-sizing':'border-box'};
export const migratePasswordPreviewContrast = (blocks: WebpageBlock[]): WebpageBlock[] => {
  let changed = false;
  const next = blocks.map(block => {
    const children = block.children ? migratePasswordPreviewContrast(block.children) : undefined;
    const repair = (block.id === 'pp-username' || block.id === 'pp-type') && block.type === 'element'
      && block.css?.color === 'var(--tt-muted, #6b7280)';
    const iconRepair=block.id==='pp-icon'&&block.type==='element'&&block.tag==='img'&&block.props?.src==='{item.image}'
      &&Object.keys(block.css||{}).length===Object.keys(oldPreviewIconCss).length&&Object.entries(oldPreviewIconCss).every(([key,value])=>block.css?.[key]===value);
    if (!repair && !iconRepair && children === block.children) return block;
    changed = true;
    return { ...block, ...(repair ? { css: { ...block.css, color: 'inherit' } } : {}), ...(iconRepair?{css:{...PASSWORD_PREVIEW_ICON_CSS}}:{}), ...(children ? { children } : {}) };
  });
  return changed ? next : blocks;
};
