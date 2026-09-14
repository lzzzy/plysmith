import createClient, { type Client } from 'openapi-fetch';

import {
  contractFingerprint,
  productRelease,
  type components,
  type paths,
} from '../../../../contracts/host/index.ts';
import { createHostFetch, type HostConnection } from './host-fetch.ts';
import {
  HostClientProblem,
  localHostProblem,
  type SafeHostProblem,
} from './host-client-problem.ts';

export type SystemStatusDto = components['schemas']['SystemStatus'];
export type UserPreferencesDto = components['schemas']['UserPreferences'];
export type SetUiLanguageResultDto =
  components['schemas']['SetUiLanguageResult'];
export type GetAnalysisWorkspaceRequestDto =
  components['schemas']['GetAnalysisWorkspaceQuery'];
export type AnalysisWorkspaceDto = components['schemas']['AnalysisWorkspace'];
export type UpdateAnalysisScratchRequestDto =
  components['schemas']['UpdateAnalysisScratchBody'];
export type UpdateAnalysisScratchResultDto =
  components['schemas']['UpdateAnalysisScratchResult'];
export type CreateAnalysisRecordRequestDto =
  components['schemas']['CreateAnalysisRecordBody'];
export type CreateAnalysisRecordResultDto =
  components['schemas']['CreateAnalysisRecordResult'];
export type CreateAnalysisNoteRequestDto =
  components['schemas']['CreateAnalysisNoteBody'];
export type CreateAnalysisNoteResultDto =
  components['schemas']['CreateAnalysisNoteResult'];
export type CreatePositionNoteRequestDto =
  components['schemas']['CreatePositionNoteBody'];
export type UpdateAnalysisNoteRequestDto =
  components['schemas']['UpdateAnalysisNoteBody'];
export type DeleteAnalysisNoteRequestDto =
  components['schemas']['DeleteAnalysisNoteBody'];
export type AnalysisNoteMutationResultDto =
  components['schemas']['AnalysisNoteMutationResult'];
export type SearchInventoryRequestDto =
  components['schemas']['InventorySearchQuery'];
export type SearchInventoryResultDto =
  components['schemas']['SearchInventoryResult'];
export type ListWorkingContextsRequestDto = components['schemas']['PageQuery'];
export type ListWorkingContextsResultDto =
  components['schemas']['ListWorkingContextsResult'];
export type WorkingContextWorkspaceDto =
  components['schemas']['WorkingContextWorkspace'];
export type CreateWorkingContextRequestDto =
  components['schemas']['CreateWorkingContextBody'];
export type CreateWorkingContextResultDto =
  components['schemas']['CreateWorkingContextResult'];
export type AddContextReferenceRequestDto =
  components['schemas']['AddContextReferenceBody'];
export type AddContextReferenceResultDto =
  components['schemas']['AddContextReferenceResult'];
export type SetWorkScopeResumeRequestDto =
  components['schemas']['SetWorkScopeResumeBody'];
export type SetWorkScopeResumeResultDto =
  components['schemas']['SetWorkScopeResumeResult'];

export interface PlysmithHostClientOptions {
  readonly fetch?: typeof fetch;
  readonly origin?: 'app://plysmith';
}

export class PlysmithHostClient {
  readonly #client: Client<paths>;

  constructor(
    connection: HostConnection,
    options: PlysmithHostClientOptions = {},
  ) {
    this.#client = createClient<paths>({
      baseUrl: connection.endpoint,
      fetch: createHostFetch(connection, options),
    });
  }

  async getSystemStatus(): Promise<SystemStatusDto> {
    try {
      const result = await this.#client.GET('/status');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getUserPreferences(): Promise<UserPreferencesDto> {
    try {
      const result = await this.#client.GET('/preferences');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setUiLanguage(request: {
    readonly uiLocale: 'de-DE' | 'en-GB';
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto> {
    try {
      const result = await this.#client.PUT('/preferences/ui-language', {
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getAnalysisWorkspace(
    request: GetAnalysisWorkspaceRequestDto,
  ): Promise<AnalysisWorkspaceDto> {
    try {
      const result = await this.#client.GET('/analysis/workspace', {
        params: { query: request },
      });
      return unwrap<AnalysisWorkspaceDto>(
        result.data as unknown as AnalysisWorkspaceDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async updateAnalysisScratch(
    request: UpdateAnalysisScratchRequestDto,
  ): Promise<UpdateAnalysisScratchResultDto> {
    try {
      const result = await this.#client.PUT('/analysis/scratch', {
        body: request,
      });
      return unwrap<UpdateAnalysisScratchResultDto>(
        result.data as unknown as UpdateAnalysisScratchResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createAnalysisRecord(
    request: CreateAnalysisRecordRequestDto,
  ): Promise<CreateAnalysisRecordResultDto> {
    try {
      const result = await this.#client.POST('/inventory/analysis-records', {
        body: request,
      });
      return unwrap<CreateAnalysisRecordResultDto>(
        result.data as unknown as CreateAnalysisRecordResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createAnalysisNote(
    request: CreateAnalysisNoteRequestDto,
  ): Promise<CreateAnalysisNoteResultDto> {
    try {
      const result = await this.#client.POST('/analysis/notes', {
        body: request,
      });
      return unwrap<CreateAnalysisNoteResultDto>(
        result.data as unknown as CreateAnalysisNoteResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createPositionNote(
    request: CreatePositionNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    try {
      const result = await this.#client.POST('/analysis/position-notes', {
        body: request,
      });
      return unwrap<AnalysisNoteMutationResultDto>(
        result.data as unknown as AnalysisNoteMutationResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async updateAnalysisNote(
    contributionId: string,
    request: UpdateAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    try {
      const result = await this.#client.PATCH(
        '/analysis/notes/{contributionId}',
        {
          params: { path: { contributionId } },
          body: request,
        },
      );
      return unwrap<AnalysisNoteMutationResultDto>(
        result.data as unknown as AnalysisNoteMutationResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async deleteAnalysisNote(
    contributionId: string,
    request: DeleteAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    try {
      const result = await this.#client.DELETE(
        '/analysis/notes/{contributionId}',
        {
          params: { path: { contributionId } },
          body: request,
        },
      );
      return unwrap<AnalysisNoteMutationResultDto>(
        result.data as unknown as AnalysisNoteMutationResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async searchInventory(
    request: SearchInventoryRequestDto,
  ): Promise<SearchInventoryResultDto> {
    try {
      const result = await this.#client.GET('/inventory', {
        params: { query: request },
      });
      return unwrap<SearchInventoryResultDto>(
        result.data as unknown as SearchInventoryResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async listWorkingContexts(
    request: ListWorkingContextsRequestDto,
  ): Promise<ListWorkingContextsResultDto> {
    try {
      const result = await this.#client.GET('/working-contexts', {
        params: { query: request },
      });
      return unwrap<ListWorkingContextsResultDto>(
        result.data as unknown as ListWorkingContextsResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getWorkingContextWorkspace(
    contextId: string,
  ): Promise<WorkingContextWorkspaceDto> {
    try {
      const result = await this.#client.GET('/working-contexts/{contextId}', {
        params: { path: { contextId } },
      });
      return unwrap<WorkingContextWorkspaceDto>(
        result.data as unknown as WorkingContextWorkspaceDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createWorkingContext(
    request: CreateWorkingContextRequestDto,
  ): Promise<CreateWorkingContextResultDto> {
    try {
      const result = await this.#client.POST('/working-contexts', {
        body: request,
      });
      return unwrap<CreateWorkingContextResultDto>(
        result.data as unknown as CreateWorkingContextResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async addContextReference(
    contextId: string,
    request: AddContextReferenceRequestDto,
  ): Promise<AddContextReferenceResultDto> {
    try {
      const result = await this.#client.POST(
        '/working-contexts/{contextId}/references',
        { params: { path: { contextId } }, body: request },
      );
      return unwrap<AddContextReferenceResultDto>(
        result.data as unknown as AddContextReferenceResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setWorkScopeResume(
    contextId: string,
    request: SetWorkScopeResumeRequestDto,
  ): Promise<SetWorkScopeResumeResultDto> {
    try {
      const result = await this.#client.PUT(
        '/working-contexts/{contextId}/resume',
        { params: { path: { contextId } }, body: request },
      );
      return unwrap<SetWorkScopeResumeResultDto>(
        result.data as unknown as SetWorkScopeResumeResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }
}

export async function connectHost(
  connection: HostConnection,
  options: PlysmithHostClientOptions = {},
): Promise<PlysmithHostClient> {
  if (
    connection.productRelease !== productRelease ||
    connection.contractFingerprint !== contractFingerprint
  ) {
    throw localHostProblem('host.contract_mismatch');
  }
  const client = new PlysmithHostClient(connection, options);
  const status = await client.getSystemStatus();
  if (
    status.productRelease !== productRelease ||
    status.contractFingerprint !== contractFingerprint
  ) {
    throw localHostProblem('host.contract_mismatch');
  }
  return client;
}

function unwrap<T>(data: T | undefined, error: SafeHostProblem | undefined): T {
  if (data !== undefined) {
    return data;
  }
  if (error !== undefined) {
    throw new HostClientProblem(error);
  }
  throw localHostProblem('host.unavailable');
}

function normalizeClientError(error: unknown): HostClientProblem {
  return error instanceof HostClientProblem
    ? error
    : localHostProblem('host.unavailable');
}
