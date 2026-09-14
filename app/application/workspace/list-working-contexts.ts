import type { WorkingContextReader } from './workspace-ports.ts';
import { invalidWorkspacePage } from './workspace-problems.ts';

export interface ListWorkingContextsRequest {
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ListWorkingContextsUseCase {
  execute(
    request: ListWorkingContextsRequest,
  ): ReturnType<WorkingContextReader['listWorkingContexts']>;
}

export class ListWorkingContexts implements ListWorkingContextsUseCase {
  readonly #reader: WorkingContextReader;

  constructor(reader: WorkingContextReader) {
    this.#reader = reader;
  }

  execute(request: ListWorkingContextsRequest) {
    const pageSize = request.pageSize ?? 50;
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (request.cursor !== undefined && request.cursor.length === 0)
    ) {
      return Promise.reject(invalidWorkspacePage());
    }
    return this.#reader.listWorkingContexts({
      pageSize,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    });
  }
}
