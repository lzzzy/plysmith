import type {
  GetUserPreferencesUseCase,
  SetUiLanguageUseCase,
} from '../../../application/preferences/index.ts';
import type {
  CreateDiagnosticReportUseCase,
  GetDiagnosticReportManifestUseCase,
  GetDiagnosticSettingsUseCase,
  GetSystemStatusUseCase,
  SetDiagnosticLogLevelUseCase,
} from '../../../application/system/index.ts';
import type { HostEventSource } from '../../../application/events/index.ts';
import type {
  CreateAnalysisRecordUseCase,
  CreateAnalysisNoteUseCase,
  CreatePositionNoteUseCase,
  DeleteAnalysisNoteUseCase,
  GetAnalysisWorkspaceUseCase,
  UpdateAnalysisScratchUseCase,
  UpdateAnalysisNoteUseCase,
  ValidateAnalysisSetupUseCase,
} from '../../../application/analysis/index.ts';
import type {
  GetInventoryRevisionUseCase,
  GetPendingRevisionImpactUseCase,
  ListInventoryRevisionsUseCase,
  PreviewInventoryRevisionUseCase,
  PromoteAnalysisToInventoryRevisionUseCase,
  ResolvePendingRevisionImpactUseCase,
  SaveInventoryRevisionUseCase,
  SearchInventoryUseCase,
  StartInventoryRevisionUseCase,
} from '../../../application/inventory/index.ts';
import type {
  AddContextReferenceUseCase,
  CreateWorkingContextUseCase,
  GetWorkingContextWorkspaceUseCase,
  ListWorkingContextsUseCase,
  RemoveContextItemUseCase,
  SetWorkScopeResumeUseCase,
} from '../../../application/workspace/index.ts';
import type { DiagnosticSink } from '../../../../contracts/diagnostics/index.ts';
import type {
  CompletePlayoutUseCase,
  DiscardPlayoutUseCase,
  ExpectedPlayoutUseCase,
  GetPlayoutUseCase,
  ListMovePolicyProvidersUseCase,
  StartPlayoutUseCase,
  SubmitPlayoutMoveUseCase,
  DisableEngineProviderConfigurationUseCase,
  GetEngineProviderConfigurationsUseCase,
  PreviewEngineProviderConfigurationUseCase,
  SaveEngineProviderConfigurationUseCase,
} from '../../../application/playout/index.ts';

export interface HostDependencies {
  readonly getSystemStatus: GetSystemStatusUseCase;
  readonly getDiagnosticSettings: GetDiagnosticSettingsUseCase;
  readonly setDiagnosticLogLevel: SetDiagnosticLogLevelUseCase;
  readonly getDiagnosticReportManifest: GetDiagnosticReportManifestUseCase;
  readonly createDiagnosticReport: CreateDiagnosticReportUseCase;
  readonly getUserPreferences: GetUserPreferencesUseCase;
  readonly setUiLanguage: SetUiLanguageUseCase;
  readonly getAnalysisWorkspace: GetAnalysisWorkspaceUseCase;
  readonly validateAnalysisSetup: ValidateAnalysisSetupUseCase;
  readonly updateAnalysisScratch: UpdateAnalysisScratchUseCase;
  readonly createAnalysisRecord: CreateAnalysisRecordUseCase;
  readonly createAnalysisNote: CreateAnalysisNoteUseCase;
  readonly createPositionNote: CreatePositionNoteUseCase;
  readonly updateAnalysisNote: UpdateAnalysisNoteUseCase;
  readonly deleteAnalysisNote: DeleteAnalysisNoteUseCase;
  readonly searchInventory: SearchInventoryUseCase;
  readonly startInventoryRevision: StartInventoryRevisionUseCase;
  readonly promoteAnalysisToInventoryRevision: PromoteAnalysisToInventoryRevisionUseCase;
  readonly previewInventoryRevision: PreviewInventoryRevisionUseCase;
  readonly saveInventoryRevision: SaveInventoryRevisionUseCase;
  readonly getInventoryRevision: GetInventoryRevisionUseCase;
  readonly listInventoryRevisions: ListInventoryRevisionsUseCase;
  readonly getPendingRevisionImpact: GetPendingRevisionImpactUseCase;
  readonly resolvePendingRevisionImpact: ResolvePendingRevisionImpactUseCase;
  readonly listWorkingContexts: ListWorkingContextsUseCase;
  readonly getWorkingContextWorkspace: GetWorkingContextWorkspaceUseCase;
  readonly createWorkingContext: CreateWorkingContextUseCase;
  readonly addContextReference: AddContextReferenceUseCase;
  readonly removeContextItem: RemoveContextItemUseCase;
  readonly setWorkScopeResume: SetWorkScopeResumeUseCase;
  readonly listMovePolicyProviders: ListMovePolicyProvidersUseCase;
  readonly getPlayout: GetPlayoutUseCase;
  readonly startPlayout: StartPlayoutUseCase;
  readonly submitPlayoutMove: SubmitPlayoutMoveUseCase;
  readonly retryPlayoutPolicyMove: ExpectedPlayoutUseCase;
  readonly pausePlayout: ExpectedPlayoutUseCase;
  readonly resumePlayout: ExpectedPlayoutUseCase;
  readonly stopPlayout: ExpectedPlayoutUseCase;
  readonly completePlayout: CompletePlayoutUseCase;
  readonly discardPlayout: DiscardPlayoutUseCase;
  readonly getEngineProviderConfigurations: GetEngineProviderConfigurationsUseCase;
  readonly previewEngineProviderConfiguration: PreviewEngineProviderConfigurationUseCase;
  readonly saveEngineProviderConfiguration: SaveEngineProviderConfigurationUseCase;
  readonly disableEngineProviderConfiguration: DisableEngineProviderConfigurationUseCase;
  readonly events: HostEventSource;
  readonly security: { readonly hostToken: string };
  readonly productRelease: string;
  readonly contractFingerprint: string;
  readonly correlationIdFactory: () => string;
  readonly diagnostics?: DiagnosticSink;
}
