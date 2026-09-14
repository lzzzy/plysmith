import type Database from 'better-sqlite3';

import type { StoredContextAnalysisWorkspace } from '../../../../application/analysis/index.ts';
import {
  localId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import { readAnalysisRecordView } from './sqlite-analysis-record.ts';
import { readContextScratch } from './sqlite-analysis-scratch.ts';
import { readDataRevision } from './sqlite-store-helpers.ts';
import { readWorkingContextSummary } from './sqlite-workspace.ts';

export function readContextAnalysisWorkspace(
  database: Database.Database,
  contextId: WorkingContextId,
): StoredContextAnalysisWorkspace | undefined {
  const context = readWorkingContextSummary(database, contextId);
  if (context === undefined || context.lifecycle !== 'active') return undefined;
  const scratch = readContextScratch(database, contextId);
  const resume = database
    .prepare(
      `SELECT resume_version AS resumeVersion,
              item_id AS itemId, revision_id AS revisionId,
              anchor_id AS anchorId
         FROM workspace_analysis_resume WHERE context_id = ?`,
    )
    .get(contextId.value) as
    | {
        resumeVersion: number;
        itemId: number | null;
        revisionId: number | null;
        anchorId: number | null;
      }
    | undefined;
  const record =
    resume?.itemId === null ||
    resume?.itemId === undefined ||
    resume.revisionId === null ||
    resume.anchorId === null
      ? undefined
      : readAnalysisRecordView(database, {
          itemId: localId('inventory-item', resume.itemId),
          revisionId: localId('item-revision', resume.revisionId),
          anchorId: localId('anchor', resume.anchorId),
          contextId,
          readOnlyPreview: false,
        });
  return Object.freeze({
    contextId,
    contextName: context.displayName,
    dataRevision: readDataRevision(database),
    ...(resume === undefined ? {} : { resumeVersion: resume.resumeVersion }),
    ...(scratch === undefined ? {} : { scratch }),
    ...(record === undefined ? {} : { record }),
  });
}
