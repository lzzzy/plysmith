import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  LICHESS_TOKEN_ENVIRONMENT_VARIABLE,
  LICHESS_TOKEN_PATTERN,
} from '../../../../../contracts/host/live-provider-configuration.ts';

export function isValidLichessToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    new RegExp(LICHESS_TOKEN_PATTERN, 'u').test(token)
  );
}

export function parseLichessEnvironment(
  source: string,
): { readonly token?: string } | undefined {
  let token: string | undefined;
  let seen = false;
  for (const line of source.split(/\r?\n/u)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const prefix = `${LICHESS_TOKEN_ENVIRONMENT_VARIABLE}=`;
    if (seen || !line.startsWith(prefix)) return undefined;
    seen = true;
    const value = line.slice(prefix.length);
    if (value === '') continue;
    if (!isValidLichessToken(value)) return undefined;
    token = value;
  }
  return token === undefined ? {} : { token };
}

// Host-only: never load this file into process.env or return it through a settings view.
export async function loadLichessToken(
  applicationHome: string,
): Promise<string | undefined> {
  try {
    const filePath = path.join(applicationHome, '.env');
    const info = await lstat(filePath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 65_536
    )
      return undefined;
    return parseLichessEnvironment(await readFile(filePath, 'utf8'))?.token;
  } catch {
    return undefined;
  }
}
