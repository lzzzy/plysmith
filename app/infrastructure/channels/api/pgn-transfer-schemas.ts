import { Type } from '@sinclair/typebox';

const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const restoreId = Type.String({ format: 'uuid' });
const fingerprint = Type.String({ pattern: '^[a-f0-9]{64}$' });
const path = Type.String({ minLength: 1, maxLength: 4096 });
export const InventoryBackupCountsSchema = Type.Object(
  {
    analyses: counter,
    games: counter,
    folders: counter,
    provenanceRecords: counter,
    contributions: counter,
  },
  { $id: 'InventoryBackupCounts', additionalProperties: false },
);
export const InventoryBackupStatusSchema = Type.Object(
  {
    canRestore: Type.Boolean(),
    blockerCodes: Type.Array(
      Type.Union([
        Type.Literal('stored_content'),
        Type.Literal('workspace_state'),
        Type.Literal('live_session'),
        Type.Literal('import_active'),
        Type.Literal('live_active'),
        Type.Literal('playout_active'),
        Type.Literal('transfer_busy'),
      ]),
      {
        maxItems: 32,
      },
    ),
    suggestedFileName: Type.String({
      pattern: '^plysmith-backup-[0-9]{8}-[0-9]{6}\\.pgn$',
    }),
  },
  { $id: 'InventoryBackupStatus', additionalProperties: false },
);
export const CreateInventoryBackupBodySchema = Type.Object(
  {
    destinationPath: path,
    formatVersion: Type.Literal(1),
  },
  { $id: 'CreateInventoryBackupBody', additionalProperties: false },
);
export const InventoryBackupCreatedSchema = Type.Object(
  {
    fileName: Type.String({ minLength: 1, maxLength: 255 }),
    counts: Type.Ref(InventoryBackupCountsSchema),
    bytes: counter,
    snapshotDataRevision: counter,
  },
  { $id: 'InventoryBackupCreated', additionalProperties: false },
);
export const PrepareInventoryRestoreBodySchema = Type.Object(
  {
    restoreId,
    inputLocator: path,
  },
  { $id: 'PrepareInventoryRestoreBody', additionalProperties: false },
);
export const InventoryRestorePreviewSchema = Type.Object(
  {
    restoreId,
    fingerprint,
    counts: Type.Ref(InventoryBackupCountsSchema),
    expiresAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'InventoryRestorePreview', additionalProperties: false },
);
export const RestoreInventoryBodySchema = Type.Object(
  {
    restoreId,
    acceptedFingerprint: fingerprint,
  },
  { $id: 'RestoreInventoryBody', additionalProperties: false },
);
export const InventoryRestoredSchema = Type.Object(
  {
    counts: Type.Ref(InventoryBackupCountsSchema),
    dataRevision: counter,
    noOp: Type.Boolean(),
  },
  { $id: 'InventoryRestored', additionalProperties: false },
);
export const CancelInventoryRestoreParamsSchema = Type.Object(
  { restoreId },
  {
    $id: 'CancelInventoryRestoreParams',
    additionalProperties: false,
  },
);
export const CancelInventoryRestoreResultSchema = Type.Object(
  { cancelled: Type.Boolean() },
  {
    $id: 'CancelInventoryRestoreResult',
    additionalProperties: false,
  },
);
export const pgnTransferSchemas = [
  InventoryBackupCountsSchema,
  InventoryBackupStatusSchema,
  CreateInventoryBackupBodySchema,
  InventoryBackupCreatedSchema,
  PrepareInventoryRestoreBodySchema,
  InventoryRestorePreviewSchema,
  RestoreInventoryBodySchema,
  InventoryRestoredSchema,
  CancelInventoryRestoreParamsSchema,
  CancelInventoryRestoreResultSchema,
];
