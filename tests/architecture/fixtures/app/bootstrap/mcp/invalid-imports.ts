import { applicationProbe } from '../../application/probe.ts';
import { sqliteAdapterProbe } from '../../infrastructure/adapters/persistence/sqlite/probe.ts';
import { hostCompositionProbe } from '../host/probe.ts';

export const invalidMcpBootstrapImports = [
  applicationProbe,
  sqliteAdapterProbe,
  hostCompositionProbe,
];
