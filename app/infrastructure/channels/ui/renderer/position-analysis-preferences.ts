import type { AnalyzePositionRequestDto } from '../../host_client/index.ts';

type ObjectiveBudget = Extract<
  AnalyzePositionRequestDto['mode'],
  { kind: 'objective' }
>['budget'];

export interface PositionAnalysisPreferences {
  readonly budget: ObjectiveBudget;
  readonly humanProviderIds?: readonly string[];
  readonly objectiveProviderId?: string;
  readonly sortBy: string;
}

const storageKey = 'Plysmith.positionAnalysis';
const defaults: PositionAnalysisPreferences = {
  budget: 'fast',
  sortBy: 'stockfish',
};

export function readPositionAnalysisPreferences(): PositionAnalysisPreferences {
  try {
    const raw: unknown = JSON.parse(
      globalThis.localStorage.getItem(storageKey) ?? 'null',
    );
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      return defaults;
    const value = raw as Record<string, unknown>;
    return {
      budget:
        value.budget === 'thorough' || value.budget === 'very_deep'
          ? value.budget
          : 'fast',
      ...(Array.isArray(value.humanProviderIds) &&
      value.humanProviderIds.every(validId)
        ? { humanProviderIds: [...new Set(value.humanProviderIds as string[])] }
        : {}),
      ...(validId(value.objectiveProviderId)
        ? { objectiveProviderId: value.objectiveProviderId }
        : {}),
      sortBy: validId(value.sortBy) ? value.sortBy : 'stockfish',
    };
  } catch {
    return defaults;
  }
}

export function savePositionAnalysisPreferences(
  value: PositionAnalysisPreferences,
): void {
  try {
    globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Choices remain usable when the desktop profile cannot persist them.
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
