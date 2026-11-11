import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createDesktopRendererBootHealth, watchDesktopRendererReady } from '../../../remix/app/utils/desktopRendererReady';

const state = (window as any).__rendererReadyFixture = { acknowledged: 0, renderErrors: 0, routerErrors: null as unknown };
const health = createDesktopRendererBootHealth();
const router = createMemoryRouter([{ path: '/', Component: () => {
  if ((window as any).__fixtureThrow) throw new Error('Expected render exception');
  return <p>Healthy fixture</p>;
}, errorElement: <p>Expected recovery screen</p> }]);
const root = document.getElementById('root')!;
function Ready() {
  React.useEffect(() => watchDesktopRendererReady({ router, root, isHealthy: health.isHealthy,
    bridge: { rendererReady: async () => { state.acknowledged++; return true; } } }), []);
  return null;
}
createRoot(root).render(<><RouterProvider router={router} onError={() => {
  state.renderErrors++; state.routerErrors = router.state.errors; health.onError();
}} /><Ready /></>);
