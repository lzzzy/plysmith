import type { WorkScope } from './working-context.ts';

export type WorkspaceArea = 'manage' | 'analyze' | 'playout' | 'settings';

export interface StartupResumeTarget {
  readonly scope: WorkScope;
  readonly area: WorkspaceArea;
}

export function startupResumeTarget(
  input: StartupResumeTarget,
): StartupResumeTarget {
  if (!['manage', 'analyze', 'playout', 'settings'].includes(input.area)) {
    throw new Error('The startup area is invalid.');
  }
  return Object.freeze({ scope: input.scope, area: input.area });
}
