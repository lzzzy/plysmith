import { Value } from '@sinclair/typebox/value';
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  AddContextReferenceResult,
  AnalysisNoteMutationResult,
  AnalysisWorkspace,
  HostProblem,
  CreateAnalysisRecordResult,
  CreateAnalysisNoteResult,
  CreateDiagnosticReportResult,
  CreateWorkingContextResult,
  DiagnosticReportManifest,
  DiagnosticSettings,
  ListWorkingContextsResult,
  SearchInventoryResult,
  SetDiagnosticLogLevelResult,
  SetUiLanguageResult,
  SetWorkScopeResumeResult,
  SystemStatus,
  UpdateAnalysisScratchResult,
  UserPreferences,
  WorkingContextWorkspace,
} from './host-client.ts';
import {
  AddContextReferenceResultSchema,
  AnalysisNoteMutationResultSchema,
  AnalysisWorkspaceSchema,
  CreateAnalysisRecordResultSchema,
  CreateAnalysisNoteResultSchema,
  CreateDiagnosticReportResultSchema,
  CreateWorkingContextResultSchema,
  DiagnosticReportManifestSchema,
  DiagnosticSettingsSchema,
  ListWorkingContextsResultSchema,
  SearchInventoryResultSchema,
  SetDiagnosticLogLevelResultSchema,
  SetUiLanguageResultSchema,
  SetWorkScopeResumeResultSchema,
  SystemStatusSchema,
  UpdateAnalysisScratchResultSchema,
  UserPreferencesSchema,
  WorkingContextWorkspaceSchema,
} from './schemas.ts';

export function systemStatusDto(model: SystemStatus) {
  const dto = {
    state: model.state,
    persistence: {
      schemaVersion: model.persistence.schemaVersion,
      dataRevision: model.persistence.dataRevision,
    },
    productRelease: model.productRelease,
    contractFingerprint: model.contractFingerprint,
  };
  if (!Value.Check(SystemStatusSchema, dto))
    throw new Error('Invalid host response');
  return dto;
}

export function preferencesDto(model: UserPreferences) {
  const dto = {
    uiLocale: model.uiLocale,
    preferenceRevision: model.preferenceRevision,
    dataRevision: model.dataRevision,
    updatedAt: model.updatedAt,
  };
  if (!Value.Check(UserPreferencesSchema, dto))
    throw new Error('Invalid host response');
  return dto;
}

export function languageResultDto(model: SetUiLanguageResult) {
  const dto = {
    changed: model.changed,
    preferences: preferencesDto(model.preferences),
  };
  if (!Value.Check(SetUiLanguageResultSchema, dto))
    throw new Error('Invalid host response');
  return dto;
}

export function diagnosticSettingsDto(model: DiagnosticSettings) {
  return checked(DiagnosticSettingsSchema, model);
}

export function diagnosticLogLevelResultDto(
  model: SetDiagnosticLogLevelResult,
) {
  return checked(SetDiagnosticLogLevelResultSchema, model);
}

export function diagnosticReportManifestDto(model: DiagnosticReportManifest) {
  return checked(DiagnosticReportManifestSchema, model);
}

export function createDiagnosticReportResultDto(
  model: CreateDiagnosticReportResult,
) {
  return checked(CreateDiagnosticReportResultSchema, model);
}

export function analysisWorkspaceDto(model: AnalysisWorkspace) {
  return checked(AnalysisWorkspaceSchema, model);
}

export function updateAnalysisScratchResultDto(
  model: UpdateAnalysisScratchResult,
) {
  return checked(UpdateAnalysisScratchResultSchema, model);
}

export function createAnalysisRecordResultDto(
  model: CreateAnalysisRecordResult,
) {
  return checked(CreateAnalysisRecordResultSchema, model);
}

export function createAnalysisNoteResultDto(model: CreateAnalysisNoteResult) {
  return checked(CreateAnalysisNoteResultSchema, model);
}

export function analysisNoteMutationResultDto(
  model: AnalysisNoteMutationResult,
) {
  return checked(AnalysisNoteMutationResultSchema, model);
}

export function searchInventoryResultDto(model: SearchInventoryResult) {
  return checked(SearchInventoryResultSchema, model);
}

export function listWorkingContextsResultDto(model: ListWorkingContextsResult) {
  return checked(ListWorkingContextsResultSchema, model);
}

export function workingContextWorkspaceDto(model: WorkingContextWorkspace) {
  return checked(WorkingContextWorkspaceSchema, model);
}

export function createWorkingContextResultDto(
  model: CreateWorkingContextResult,
) {
  return checked(CreateWorkingContextResultSchema, model);
}

export function addContextReferenceResultDto(model: AddContextReferenceResult) {
  return checked(AddContextReferenceResultSchema, model);
}

export function setWorkScopeResumeResultDto(model: SetWorkScopeResumeResult) {
  return checked(SetWorkScopeResumeResultSchema, model);
}

export function statusSummary(dto: SystemStatus): string {
  return `Plysmith: ${dto.state}. Data revision ${dto.persistence.dataRevision}.`;
}

export function preferencesSummary(dto: UserPreferences): string {
  return `UI language: ${dto.uiLocale}. Preference revision ${dto.preferenceRevision}.`;
}

export function toolResult(
  dto: Record<string, unknown>,
  summary: string,
): CallToolResult {
  return {
    structuredContent: dto,
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(dto) },
    ],
  };
}

export function toolProblem(problem: HostProblem): CallToolResult {
  return {
    ...toolResult({ ...problem }, `${problem.code}: ${problem.detail}`),
    isError: true,
  };
}

export function resourceResult(
  uri: string,
  dto: Record<string, unknown>,
): ReadResourceResult {
  return {
    contents: [
      { uri, mimeType: 'application/json', text: JSON.stringify(dto, null, 2) },
    ],
  };
}

function checked<T extends Record<string, unknown>>(
  schema: Parameters<typeof Value.Check>[0],
  model: T,
): T {
  if (!Value.Check(schema, model)) throw new Error('Invalid host response');
  return model;
}
