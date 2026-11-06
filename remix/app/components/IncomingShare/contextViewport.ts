/** WKWebView and browsers can expose different inner/client heights during
 * keyboard transitions. Fixed controls use the full current layout viewport. */
export function contextLayoutHeight() {
 return Math.max(window.innerHeight, document.documentElement.clientHeight);
}
export function contextDockTop(viewport: { height: number; offsetTop: number }, height: number, gap = 0) {
 return viewport.offsetTop + viewport.height - gap - height;
}
