import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { UiErrorBoundary } from './components/UiErrorBoundary.js';
import './styles/tokens.css';
import './styles/app.css';

const pathname = window.location.pathname;
const surface = pathname.endsWith('/settings.html')
  ? 'settings'
  : pathname.endsWith('/launcher.html')
    ? 'launcher'
    : undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiErrorBoundary>
      <App {...(surface ? { surface } : {})} />
    </UiErrorBoundary>
  </StrictMode>,
);
