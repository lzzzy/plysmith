import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { productRelease } from '../../../contracts/host/index.ts';
import { readHostDiscovery } from '../../infrastructure/adapters/platform/windows/index.ts';
import { connectRediscoveringHost } from '../../infrastructure/channels/host_client/index.ts';
import { createMcpServer } from '../../infrastructure/channels/mcp/index.ts';

export interface ComposeMcpOptions {
  readonly applicationHome: string;
}

export async function composeMcp({
  applicationHome,
}: ComposeMcpOptions): Promise<Server> {
  const hostClient = await connectRediscoveringHost(() =>
    readHostDiscovery(applicationHome),
  );
  return createMcpServer({ hostClient, productRelease });
}
