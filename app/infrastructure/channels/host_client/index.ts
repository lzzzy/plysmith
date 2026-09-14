export {
  connectHost,
  PlysmithHostClient,
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
  type CreatePositionNoteRequestDto,
  type DeleteAnalysisNoteRequestDto,
  type CreateWorkingContextRequestDto,
  type CreateWorkingContextResultDto,
  type GetAnalysisWorkspaceRequestDto,
  type ListWorkingContextsRequestDto,
  type ListWorkingContextsResultDto,
  type SearchInventoryRequestDto,
  type SearchInventoryResultDto,
  type SetWorkScopeResumeRequestDto,
  type SetWorkScopeResumeResultDto,
  type UpdateAnalysisScratchRequestDto,
  type UpdateAnalysisScratchResultDto,
  type UpdateAnalysisNoteRequestDto,
  type WorkingContextWorkspaceDto,
} from './host-client.ts';
export {
  connectRediscoveringHost,
  RediscoveringHostClient,
  type DiscoverHost,
} from './rediscovering-host-client.ts';
export {
  HostEventClient,
  type HostEventClientOptions,
} from './host-event-client.ts';
export type { HostEvent } from '../api/contract.ts';
export {
  createHostFetch,
  type HostConnection,
  type HostFetchOptions,
} from './host-fetch.ts';
export {
  HostClientProblem,
  localHostProblem,
  type SafeHostProblem,
} from './host-client-problem.ts';
