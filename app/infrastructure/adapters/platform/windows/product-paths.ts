import { execFile } from 'node:child_process';
import path from 'node:path';

export async function resolveWindowsApplicationHome(): Promise<string> {
  const systemRoot = process.env.SystemRoot;
  if (process.platform !== 'win32' || !systemRoot) {
    throw new Error(
      'The Windows per-user application directory is unavailable.',
    );
  }
  const powershell = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const localAppData = await new Promise<string>((resolve, reject) => {
    execFile(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::Out.Write([Environment]::GetFolderPath("LocalApplicationData"))',
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 4096 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
  });
  if (!path.isAbsolute(localAppData)) {
    throw new Error('The Windows per-user application directory is invalid.');
  }
  return path.join(localAppData, 'Plysmith');
}
