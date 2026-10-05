import { Type } from '@sinclair/typebox';

const closed = { additionalProperties: false } as const;
const id = () => Type.String({ pattern: '^[1-9][0-9]{0,15}$' });
const previewId = () =>
  Type.String({
    pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
  });
const name = () => Type.String({ minLength: 1, maxLength: 160 });
const sourceOrder = () => Type.Integer({ minimum: 0, maximum: 100000 });
const encoding = () =>
  Type.Union([Type.Literal('utf-8'), Type.Literal('iso-8859-1')]);
const formatId = () => Type.String({ minLength: 1, maxLength: 100 });
export const ImportFidelityFindingSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100 }),
    disposition: Type.Union([
      Type.Literal('preserved'),
      Type.Literal('normalized'),
      Type.Literal('preserved_opaque'),
      Type.Literal('unsupported'),
      Type.Literal('invalid'),
    ]),
    severity: Type.Union([
      Type.Literal('info'),
      Type.Literal('warning'),
      Type.Literal('error'),
    ]),
    feature: Type.String({ minLength: 1, maxLength: 100 }),
    nodeIndex: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { ...closed, $id: 'ImportFidelityFinding' },
);
export const ImportInputDescriptorSchema = Type.Object(
  {
    inputHandle: previewId(),
    displayName: Type.String({ minLength: 1, maxLength: 255 }),
    inputSize: Type.Integer({ minimum: 1, maximum: 16777216 }),
  },
  { ...closed, $id: 'ImportInputDescriptor' },
);
export const RegisterImportInputBodySchema = Type.Object(
  { inputLocator: Type.String({ minLength: 1, maxLength: 4096 }) },
  { ...closed, $id: 'RegisterImportInputBody' },
);

export const ImportCandidatePreviewSchema = Type.Object(
  {
    sourceOrder: sourceOrder(),
    status: Type.Union([
      Type.Literal('ready'),
      Type.Literal('warning'),
      Type.Literal('rejected'),
    ]),
    suggestedName: Type.String({ minLength: 1, maxLength: 200 }),
    moveCount: Type.Integer({ minimum: 0 }),
    variationCount: Type.Integer({ minimum: 0 }),
    rootFen: Type.Optional(Type.String({ maxLength: 128 })),
    findings: Type.Array(ImportFidelityFindingSchema, { maxItems: 1000 }),
  },
  { ...closed, $id: 'ImportCandidatePreview' },
);

export const ImportPreviewSchema = Type.Object(
  {
    previewId: previewId(),
    sourceDisplayName: Type.String({ minLength: 1, maxLength: 255 }),
    inputSize: Type.Integer({ minimum: 1 }),
    encoding: encoding(),
    formatId: formatId(),
    candidates: Type.Array(ImportCandidatePreviewSchema, { maxItems: 1000 }),
  },
  { ...closed, $id: 'ImportPreview' },
);

export const PrepareImportBodySchema = Type.Object(
  {
    inputHandle: previewId(),
    encoding: Type.Optional(encoding()),
    languageTag: Type.Union([Type.Literal('de-DE'), Type.Literal('en-GB')]),
    formatId: Type.Optional(formatId()),
  },
  { ...closed, $id: 'PrepareImportBody' },
);

export const CheckImportNamesBodySchema = Type.Object(
  {
    candidates: Type.Array(
      Type.Object(
        {
          sourceOrder: sourceOrder(),
          displayName: name(),
        },
        closed,
      ),
      { maxItems: 1000 },
    ),
  },
  { ...closed, $id: 'CheckImportNamesBody' },
);

export const ImportNameChecksSchema = Type.Object(
  {
    candidates: Type.Array(
      Type.Object(
        {
          sourceOrder: sourceOrder(),
          displayName: name(),
          available: Type.Boolean(),
          suggestedDisplayName: Type.String({ minLength: 1, maxLength: 256 }),
        },
        closed,
      ),
      { maxItems: 1000 },
    ),
    dataRevision: Type.Integer({ minimum: 0 }),
  },
  { ...closed, $id: 'ImportNameChecks' },
);

export const ImportFolderDestinationSchema = Type.Union(
  [
    Type.Object({ kind: Type.Literal('unfiled') }, closed),
    Type.Object({ kind: Type.Literal('existing'), folderId: id() }, closed),
    Type.Object(
      {
        kind: Type.Literal('new'),
        displayName: name(),
        parentFolderId: Type.Optional(id()),
      },
      closed,
    ),
  ],
  { $id: 'ImportFolderDestination' },
);

export const PublishImportBodySchema = Type.Object(
  {
    previewId: previewId(),
    candidates: Type.Array(
      Type.Object(
        {
          sourceOrder: sourceOrder(),
          itemType: Type.Union([
            Type.Literal('analysis'),
            Type.Literal('game'),
          ]),
          displayName: name(),
        },
        closed,
      ),
      { minItems: 1, maxItems: 1000 },
    ),
    folder: ImportFolderDestinationSchema,
    confirmWarnings: Type.Boolean(),
  },
  { ...closed, $id: 'PublishImportBody' },
);

export const DiscardImportBodySchema = Type.Object(
  {
    previewId: previewId(),
  },
  { ...closed, $id: 'DiscardImportBody' },
);
export const DiscardImportResultSchema = Type.Object(
  {
    discarded: Type.Boolean(),
  },
  { ...closed, $id: 'DiscardImportResult' },
);

export const ImportPublishedSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          itemId: id(),
          revisionId: id(),
          sourceOrder: sourceOrder(),
        },
        closed,
      ),
      { maxItems: 1000 },
    ),
    folderId: Type.Optional(id()),
    dataRevision: Type.Integer({ minimum: 0 }),
  },
  { ...closed, $id: 'ImportPublished' },
);

export const importSchemas = [
  ImportFidelityFindingSchema,
  ImportInputDescriptorSchema,
  RegisterImportInputBodySchema,
  ImportCandidatePreviewSchema,
  ImportPreviewSchema,
  PrepareImportBodySchema,
  CheckImportNamesBodySchema,
  ImportNameChecksSchema,
  ImportFolderDestinationSchema,
  PublishImportBodySchema,
  DiscardImportBodySchema,
  DiscardImportResultSchema,
  ImportPublishedSchema,
] as const;
