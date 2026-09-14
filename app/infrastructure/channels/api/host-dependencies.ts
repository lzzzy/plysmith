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
} from '../../../application/analysis/index.ts';
import type { SearchInventoryUseCase } from '../../../application/inventory/index.ts';
import type {
  AddContextReferenceUseCase,
  CreateWorkingContextUseCase,
  GetWorkingContextWorkspaceUseCase,
  ListWorkingContextsUseCase,
  SetWorkScopeResumeUseCase,
} from '../../../application/workspace/index.ts';
import type { DiagnosticSink } from '../../../../contracts/diagnostics/index.ts';

export interface HostDependencies {
  readonly getSystemStatus: GetSystemStatusUseCase;
  readonly getDiagnosticSettings: GetDiagnosticSettingsUseCase;
  readonly setDiagnosticLogLevel: SetDiagnosticLogLevelUseCase;
  readonly getDiagnosticReportManifest: GetDiagnosticReportManifestUseCase;
  readonly createDiagnosticReport: CreateDiagnosticReportUseCase;
  readonly getUserPreferences: GetUserPreferencesUseCase;
  readonly setUiLanguage: SetUiLanguageUseCase;
  readonly getAnalysisWorkspace: GetAnalysisWorkspaceUseCase;
  readonly updateAnalysisScratch: UpdateAnalysisScratchUseCase;
  readonly createAnalysisRecord: CreateAnalysisRecordUseCase;
  readonly createAnalysisNote: CreateAnalysisNoteUseCase;
  readonly createPositionNote: CreatePositionNoteUseCase;
  readonly updateAnalysisNote: UpdateAnalysisNoteUseCase;
  readonly deleteAnalysisNote: DeleteAnalysisNoteUseCase;
  readonly searchInventory: SearchInventoryUseCase;
  readonly listWorkingContexts: ListWorkingContextsUseCase;
  readonly getWorkingContextWorkspace: GetWorkingContextWorkspaceUseCase;
  readonly createWorkingContext: CreateWorkingContextUseCase;
  readonly addContextReference: AddContextReferenceUseCase;
  readonly setWorkScopeResume: SetWorkScopeResumeUseCase;
  readonly events: HostEventSource;
  readonly security: { readonly hostToken: string };
  readonly productRelease: string;
  readonly contractFingerprint: string;
  readonly correlationIdFactory: () => string;
  readonly diagnostics?: DiagnosticSink;
}
