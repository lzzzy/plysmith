import { app, protocol } from 'electron';

import { registerPlysmithScheme } from '../../infrastructure/channels/ui/desktop/index.ts';
import { composeDesktop, type DesktopRuntime } from './composition-root.ts';
import { parseDesktopPaths, selectDesktopArguments } from './desktop-paths.ts';

export async function runDesktop(arguments_: readonly string[]): Promise<void> {
  const paths = parseDesktopPaths(arguments_);
  await app.whenReady();
  const runtime = await composeDesktop(paths);
  installDesktopLifecycle(runtime);
}

function installDesktopLifecycle(runtime: DesktopRuntime): void {
  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    runtime.close();
  };
  app.once('before-quit', close);
  app.once('window-all-closed', () => app.quit());
  process.once('SIGINT', () => app.quit());
  process.once('SIGTERM', () => app.quit());
}

registerPlysmithScheme(protocol);
runDesktop(selectDesktopArguments(process.argv)).catch(() => {
  console.error(
    'Plysmith Desktop could not start. Keep the Application Host running and check application-home.',
  );
  app.quit();
  process.exitCode = 1;
});
