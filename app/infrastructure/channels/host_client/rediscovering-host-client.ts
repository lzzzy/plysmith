import {
  connectHost,
  type PlysmithHostClient,
  type PlysmithHostClientOptions,
  type SetUiLanguageResultDto,
  type SystemStatusDto,
  type UserPreferencesDto,
  type AddContextReferenceRequestDto,
  type AddContextReferenceResultDto,
  type AnalysisWorkspaceDto,
  type AnalysisNoteMutationResultDto,
  type CreateAnalysisRecordRequestDto,
  type CreateAnalysisRecordResultDto,
  type CreateAnalysisNoteRequestDto,
  type CreateAnalysisNoteResultDto,
  type CreateDiagnosticReportRequestDto,
  type CreateDiagnosticReportResultDto,
  type CreatePositionNoteRequestDto,
  type DeleteAnalysisNoteRequestDto,
  type DiagnosticReportManifestDto,
  type DiagnosticSettingsDto,
  type CreateWorkingContextRequestDto,
  type CreateWorkingContextResultDto,
  type GetAnalysisWorkspaceRequestDto,
  type ListWorkingContextsRequestDto,
  type ListWorkingContextsResultDto,
  type SearchInventoryRequestDto,
  type SearchInventoryResultDto,
  type SetDiagnosticLogLevelRequestDto,
  type SetDiagnosticLogLevelResultDto,
  type SetWorkScopeResumeRequestDto,
  type SetWorkScopeResumeResultDto,
  type UpdateAnalysisScratchRequestDto,
  type UpdateAnalysisScratchResultDto,
  type UpdateAnalysisNoteRequestDto,
  type WorkingContextWorkspaceDto,
} from './host-client.ts';
import { HostClientProblem, localHostProblem } from './host-client-problem.ts';
import type { HostConnection } from './host-fetch.ts';

export type DiscoverHost = () => Promise<HostConnection>;

export class RediscoveringHostClient {
  readonly #discover: DiscoverHost;
  readonly #options: PlysmithHostClientOptions;
  #connected:
    | {
        readonly connection: HostConnection;
        readonly client: PlysmithHostClient;
      }
    | undefined;

  constructor(discover: DiscoverHost, options: PlysmithHostClientOptions = {}) {
    this.#discover = discover;
    this.#options = options;
  }

  async attach(): Promise<void> {
    await this.#currentClient();
  }

  async getSystemStatus(): Promise<SystemStatusDto> {
    return this.#read((client) => client.getSystemStatus());
  }

  async getUserPreferences(): Promise<UserPreferencesDto> {
    return this.#read((client) => client.getUserPreferences());
  }

  async setUiLanguage(request: {
    readonly uiLocale: 'de-DE' | 'en-GB';
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto> {
    const client = await this.#currentClient();
    return client.setUiLanguage(request);
  }

  async getDiagnosticSettings(): Promise<DiagnosticSettingsDto> {
    return this.#read((client) => client.getDiagnosticSettings());
  }

  async setDiagnosticLogLevel(
    request: SetDiagnosticLogLevelRequestDto,
  ): Promise<SetDiagnosticLogLevelResultDto> {
    return (await this.#currentClient()).setDiagnosticLogLevel(request);
  }

  async getDiagnosticReportManifest(): Promise<DiagnosticReportManifestDto> {
    return this.#read((client) => client.getDiagnosticReportManifest());
  }

  async createDiagnosticReport(
    request: CreateDiagnosticReportRequestDto,
  ): Promise<CreateDiagnosticReportResultDto> {
    return (await this.#currentClient()).createDiagnosticReport(request);
  }

  async getAnalysisWorkspace(
    request: GetAnalysisWorkspaceRequestDto,
  ): Promise<AnalysisWorkspaceDto> {
    return this.#read((client) => client.getAnalysisWorkspace(request));
  }

  async updateAnalysisScratch(
    request: UpdateAnalysisScratchRequestDto,
  ): Promise<UpdateAnalysisScratchResultDto> {
    return (await this.#currentClient()).updateAnalysisScratch(request);
  }

  async createAnalysisRecord(
    request: CreateAnalysisRecordRequestDto,
  ): Promise<CreateAnalysisRecordResultDto> {
    return (await this.#currentClient()).createAnalysisRecord(request);
  }

  async createAnalysisNote(
    request: CreateAnalysisNoteRequestDto,
  ): Promise<CreateAnalysisNoteResultDto> {
    return (await this.#currentClient()).createAnalysisNote(request);
  }

  async createPositionNote(
    request: CreatePositionNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    return (await this.#currentClient()).createPositionNote(request);
  }

  async updateAnalysisNote(
    contributionId: string,
    request: UpdateAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    return (await this.#currentClient()).updateAnalysisNote(
      contributionId,
      request,
    );
  }

  async deleteAnalysisNote(
    contributionId: string,
    request: DeleteAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    return (await this.#currentClient()).deleteAnalysisNote(
      contributionId,
      request,
    );
  }

  async searchInventory(
    request: SearchInventoryRequestDto,
  ): Promise<SearchInventoryResultDto> {
    return this.#read((client) => client.searchInventory(request));
  }

  async listWorkingContexts(
    request: ListWorkingContextsRequestDto,
  ): Promise<ListWorkingContextsResultDto> {
    return this.#read((client) => client.listWorkingContexts(request));
  }

  async getWorkingContextWorkspace(
    contextId: string,
  ): Promise<WorkingContextWorkspaceDto> {
    return this.#read((client) => client.getWorkingContextWorkspace(contextId));
  }

  async createWorkingContext(
    request: CreateWorkingContextRequestDto,
  ): Promise<CreateWorkingContextResultDto> {
    return (await this.#currentClient()).createWorkingContext(request);
  }

  async addContextReference(
    contextId: string,
    request: AddContextReferenceRequestDto,
  ): Promise<AddContextReferenceResultDto> {
    return (await this.#currentClient()).addContextReference(
      contextId,
      request,
    );
  }

  async setWorkScopeResume(
    contextId: string,
    request: SetWorkScopeResumeRequestDto,
  ): Promise<SetWorkScopeResumeResultDto> {
    return (await this.#currentClient()).setWorkScopeResume(contextId, request);
  }

  async #read<T>(operation: (client: PlysmithHostClient) => Promise<T>) {
    try {
      return await operation(await this.#currentClient());
    } catch (error) {
      if (!isHostUnavailable(error)) {
        throw error;
      }
      return operation(await this.#currentClient(true));
    }
  }

  async #currentClient(forceReconnect = false): Promise<PlysmithHostClient> {
    const connection = await this.#discoverConnection();
    if (
      !forceReconnect &&
      this.#connected !== undefined &&
      sameConnection(this.#connected.connection, connection)
    ) {
      return this.#connected.client;
    }

    const client = await connectHost(connection, this.#options);
    this.#connected = { connection, client };
    return client;
  }

  async #discoverConnection(): Promise<HostConnection> {
    try {
      return await this.#discover();
    } catch (error) {
      if (error instanceof HostClientProblem) {
        throw error;
      }
      throw localHostProblem('host.unavailable');
    }
  }
}

export async function connectRediscoveringHost(
  discover: DiscoverHost,
  options: PlysmithHostClientOptions = {},
): Promise<RediscoveringHostClient> {
  const client = new RediscoveringHostClient(discover, options);
  await client.attach();
  return client;
}

function sameConnection(left: HostConnection, right: HostConnection): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.productRelease === right.productRelease &&
    left.contractFingerprint === right.contractFingerprint &&
    left.token === right.token
  );
}

function isHostUnavailable(error: unknown): boolean {
  return (
    error instanceof HostClientProblem &&
    error.problem.code === 'host.unavailable'
  );
}
