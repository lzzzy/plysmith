import type { WorkingContextId } from '../../domain/identity/index.ts';
import type { WorkingContextWorkspace } from './workspace-models.ts';
import type { WorkingContextReader } from './workspace-ports.ts';
import { workingContextNotFound } from './workspace-problems.ts';

export interface GetWorkingContextWorkspaceUseCase {
  execute(request: {
    readonly contextId: WorkingContextId;
  }): Promise<WorkingContextWorkspace>;
}

export class GetWorkingContextWorkspace implements GetWorkingContextWorkspaceUseCase {
  readonly #reader: WorkingContextReader;

  constructor(reader: WorkingContextReader) {
    this.#reader = reader;
  }

  async execute(request: {
    readonly contextId: WorkingContextId;
  }): Promise<WorkingContextWorkspace> {
    const workspace = await this.#reader.readWorkingContextWorkspace(
      request.contextId,
    );
    if (workspace === undefined) throw workingContextNotFound();
    return workspace;
  }
}
