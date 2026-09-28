import { mkdir } from 'node:fs/promises';
import path from 'node:path';

interface ElectronProfilePaths {
  setPath(name: 'userData' | 'sessionData', value: string): void;
}

export async function configureElectronProfile(
  electron: ElectronProfilePaths,
  applicationHome: string,
): Promise<void> {
  const profile = path.resolve(applicationHome, 'desktop', 'profile');
  const session = path.join(profile, 'session');
  await mkdir(session, { recursive: true });
  electron.setPath('userData', profile);
  electron.setPath('sessionData', session);
}
