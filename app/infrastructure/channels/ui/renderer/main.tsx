import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HostReadModelStore } from './host-read-model-store.ts';
import { SettingsApplication } from './settings-view.tsx';
import './tokens.css';

const rootElement = document.querySelector('#root');
if (rootElement === null) {
  throw new Error('Plysmith renderer root is missing.');
}

const store = new HostReadModelStore({
  getBootstrap: () => window.plysmithDesktop.getBootstrap(),
});

createRoot(rootElement).render(
  <StrictMode>
    <SettingsApplication store={store} />
  </StrictMode>,
);
