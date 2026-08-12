import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
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
    <App {...(surface ? { surface } : {})} />
  </StrictMode>,
);
