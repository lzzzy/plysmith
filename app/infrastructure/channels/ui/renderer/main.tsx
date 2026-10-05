import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PlysmithApplication } from './application-shell.tsx';
import { ensurePlysmithChessFont } from './plysmith-chess-font.ts';
import { PlysmithApplicationStore } from './plysmith-application-store.ts';
import './tokens.css';

const rootElement = document.querySelector('#root');
if (rootElement === null) {
  throw new Error('Plysmith renderer root is missing.');
}
const root = createRoot(rootElement);

async function renderPlysmithApplication() {
  await ensurePlysmithChessFont();

  const store = new PlysmithApplicationStore({
    getBootstrap: () => window.plysmithDesktop.getBootstrap(),
    chooseDiagnosticReportDestination: (suggestedFileName) =>
      window.plysmithDesktop.chooseDiagnosticReportDestination(
        suggestedFileName,
      ),
    chooseEngineExecutable: () =>
      window.plysmithDesktop.chooseEngineExecutable(),
    chooseEngineWeights: () => window.plysmithDesktop.chooseEngineWeights(),
    chooseImportFile: () => window.plysmithDesktop.chooseImportFile(),
    recordDiagnostic: (event) => window.plysmithDesktop.recordDiagnostic(event),
  });

  root.render(
    <StrictMode>
      <PlysmithApplication store={store} />
    </StrictMode>,
  );
}

void renderPlysmithApplication().catch((error: unknown) => {
  console.error('Plysmith Desktop renderer could not load.', error);
});
