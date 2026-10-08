import { workspacePrivate } from '../workspace/private.ts';

export { analysisPrivate } from '../analysis/private.ts';
export type { AnalysisPort } from '../analysis/ports.ts';
export { nestedPublic } from '../analysis/internal/public.ts';
export { workspacePrivate as domainPrivate } from '../../domain/workspace/private.ts';
export const privateImport = workspacePrivate;
