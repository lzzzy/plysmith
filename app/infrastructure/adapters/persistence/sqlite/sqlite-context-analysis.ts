import type Database from 'better-sqlite3';

import type { StoredContextAnalysisWorkspace } from '../../../../application/analysis/index.ts';
import type { StoredFreeAnalysisWorkspace } from '../../../../application/analysis/analysis-models.ts';
import {
  localId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import { readAnalysisRecordView } from './sqlite-analysis-record.ts';
import { readContextScratch } from './sqlite-analysis-scratch-state.ts';
import { readDataRevision } from './sqlite-store-helpers.ts';
import {
  readWorkingContextSummary,
  readAnalysisResume,
} from './sqlite-workspace.ts';

export function readFreeAnalysisWorkspace(
  database: Database.Database,
): StoredFreeAnalysisWorkspace {
  const scratch = readContextScratch(database, null);
  const resume = readAnalysisResume(database, null);
  const itemId =
    scratch?.origin.kind === 'inventory_anchor'
      ? scratch.origin.itemId
      : resume?.itemId;
  const revisionId =
    scratch?.origin.kind === 'inventory_anchor'
      ? scratch.origin.revisionId
      : resume?.revisionId;
  const anchorId =
    scratch?.origin.kind === 'inventory_anchor'
      ? scratch.origin.anchorId
      : resume?.anchorId;
  const record =
    itemId === undefined || revisionId === undefined || anchorId === undefined
      ? undefined
      : readAnalysisRecordView(database, { itemId, revisionId, anchorId });
  return Object.freeze({
    dataRevision: readDataRevision(database),
    ...(scratch === undefined ? {} : { scratch }),
    ...(resume === undefined ? {} : { resumeVersion: resume.resumeVersion }),
    ...(record === undefined ? {} : { record }),
  });
}

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
