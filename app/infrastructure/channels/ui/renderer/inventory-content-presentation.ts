import type { AnalysisRecordDto } from '../../host_client/index.ts';
import { localizeSan } from './chess-display.ts';
import type { UiLocale } from './messages.ts';

type LineStep = Pick<AnalysisRecordDto['steps'][number], 'before' | 'move'>;

function moveLabels(steps: readonly LineStep[], locale: UiLocale) {
  return steps.map((step, index) => ({
    ply: index + 1,
    label: `${step.before.playState.fullmoveNumber}${
      step.before.position.sideToMove === 'white' ? '.' : '...'
    } ${localizeSan(step.move.san, locale)}`,
  }));
}

export function inventoryContentPresentation(
  record: AnalysisRecordDto,
  cursor: number,
  locale: UiLocale,
) {
  const boundedCursor = Math.max(0, Math.min(record.steps.length, cursor));
  const source = record.sourceLine ?? record.sourcePath;
  return {
    cursor: boundedCursor,
    state: record.steps[boundedCursor - 1]?.after ?? record.root,
    moves: moveLabels(record.steps, locale),
    source:
      source === undefined
        ? undefined
        : {
            displayName:
              'sourceDisplayName' in source
                ? source.sourceDisplayName
                : source.displayName,
            moves: moveLabels(source.steps, locale),
          },
  };
}
