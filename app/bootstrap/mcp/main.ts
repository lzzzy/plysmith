import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { composeMcp } from './composition-root.ts';

export async function runMcp(arguments_: readonly string[]): Promise<void> {
  const applicationHome = parseApplicationHome(arguments_);
  const server = await composeMcp({ applicationHome });

  const close = (): void => {
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  };
  const removeListeners = (): void => {
    process.stdin.off('end', close);
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
  };
  server.onclose = removeListeners;
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    removeListeners();
    await server.close();
    throw error;
  }
}

export function parseApplicationHome(arguments_: readonly string[]): string {
  if (arguments_.length === 0) {
    return path.resolve('.');
  }
  const [option, value] = arguments_;
  if (
    arguments_.length === 2 &&
    option === '--application-home' &&
    value !== undefined &&
    value.trim().length > 0 &&
    !value.startsWith('--')
  ) {
    return path.resolve(value);
  }
  throw new Error('Expected --application-home followed by a directory.');
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  path.resolve(entryPoint) === fileURLToPath(import.meta.url)
) {
  runMcp(process.argv.slice(2)).catch(() => {
    console.error(
      'Plysmith MCP could not attach. Start the matching Application Host and check application-home.',
    );
    process.exitCode = 1;
  });
}
