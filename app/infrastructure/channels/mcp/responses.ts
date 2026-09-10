import { Value } from '@sinclair/typebox/value';
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  HostProblem,
  SetUiLanguageResult,
  SystemStatus,
  UserPreferences,
} from './host-client.ts';
import {
  SetUiLanguageResultSchema,
  SystemStatusSchema,
  UserPreferencesSchema,
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
