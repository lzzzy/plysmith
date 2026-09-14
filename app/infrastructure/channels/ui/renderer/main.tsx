import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PlysmithApplication } from './application-shell.tsx';
import { PlysmithApplicationStore } from './plysmith-application-store.ts';
import './tokens.css';

const rootElement = document.querySelector('#root');
if (rootElement === null) {
  throw new Error('Plysmith renderer root is missing.');
}

const store = new PlysmithApplicationStore({
  getBootstrap: () => window.plysmithDesktop.getBootstrap(),
});

createRoot(rootElement).render(
  <StrictMode>
    <PlysmithApplication store={store} />
  </StrictMode>,
);
