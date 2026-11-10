// Only ordinary primary activation belongs to the SPA. Modified clicks and
// middle clicks must retain the browser's native tab/window/link behaviour.
export const isPlainLinkClick = (event: { button: number; defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export const safeMenuHref = (href?: string) => {
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return undefined;
  return /^(?:\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(href) ? href : undefined;
};
