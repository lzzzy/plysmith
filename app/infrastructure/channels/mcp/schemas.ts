import { Type } from '@sinclair/typebox';

const objectOptions = { additionalProperties: false } as const;
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const preferenceRevision = Type.Integer({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
const uiLocale = Type.Union([Type.Literal('de-DE'), Type.Literal('en-GB')]);
const localId = Type.String({ pattern: '^[1-9]\\d{0,15}$' });
const timestamp = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
});
const cursor = Type.String({ minLength: 1, maxLength: 512 });
const languageTag = Type.String({ minLength: 1, maxLength: 35 });

export const EmptyArgumentsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const SetUiLanguageArgumentsSchema = Type.Object(
  {
    uiLocale,
    expectedRevision: preferenceRevision,
  },
  { additionalProperties: false },
);

export const UserPreferencesSchema = Type.Object(
  {
    uiLocale,
    preferenceRevision,
    dataRevision: revision,
    updatedAt: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
    }),
  },
  objectOptions,
);

export const SystemStatusSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal('starting'),
      Type.Literal('ready'),
      Type.Literal('degraded'),
      Type.Literal('startup_blocked'),
      Type.Literal('shutting_down'),
    ]),
    persistence: Type.Object(
      { schemaVersion: preferenceRevision, dataRevision: revision },
      objectOptions,
    ),
    productRelease: Type.String({ minLength: 1 }),
    contractFingerprint: Type.String({ minLength: 1 }),
  },
  objectOptions,
);

export const SetUiLanguageResultSchema = Type.Object(
  { changed: Type.Boolean(), preferences: UserPreferencesSchema },
  objectOptions,
);

export const HostProblemSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.String(),
    instance: Type.String(),
    code: Type.String(),
    correlationId: Type.String(),
    retryable: Type.Boolean(),
    parameters: Type.Object(
      {
        expectedRevision: Type.Optional(revision),
        currentRevision: Type.Optional(revision),
      },
      objectOptions,
    ),
  },
  objectOptions,
);

const workScope = Type.Union([
  Type.Object({ kind: Type.Literal('free') }, objectOptions),
  Type.Object(
    { kind: Type.Literal('context'), contextId: localId },
    objectOptions,
  ),
]);

const analysisNoteScope = Type.Union([
  Type.Object({ kind: Type.Literal('global') }, objectOptions),
  Type.Object(
    { kind: Type.Literal('context'), contextId: localId },
    objectOptions,
  ),
]);

const canonicalMove = Type.Object(
  {
    from: Type.String({ pattern: '^[a-h][1-8]$' }),
    to: Type.String({ pattern: '^[a-h][1-8]$' }),
    promotion: Type.Optional(
      Type.Union([
        Type.Literal('queen'),
        Type.Literal('rook'),
        Type.Literal('bishop'),
        Type.Literal('knight'),
      ]),
    ),
    san: Type.String({ minLength: 1, maxLength: 32 }),
  },
  objectOptions,
);

const chessState = Type.Object(
  {
    position: Type.Object(
      {
        ruleSetId: Type.Literal('standardChess'),
        boardKey: Type.String({ pattern: '^[PNBRQKpnbrqk.]{64}$' }),
        sideToMove: Type.Union([Type.Literal('white'), Type.Literal('black')]),
        castlingRights: Type.Object(
          {
            whiteKingSide: Type.Boolean(),
            whiteQueenSide: Type.Boolean(),
            blackKingSide: Type.Boolean(),
            blackQueenSide: Type.Boolean(),
          },
          objectOptions,
        ),
        effectiveEnPassantSquare: Type.Integer({ minimum: -1, maximum: 63 }),
        positionKey: Type.String({ minLength: 1, maxLength: 256 }),
      },
      objectOptions,
    ),
    playState: Type.Object(
      {
        halfmoveClock: Type.Integer({ minimum: 0 }),
        fullmoveNumber: preferenceRevision,
        historyKnowledge: Type.Union([
          Type.Literal('complete'),
          Type.Literal('partial'),
          Type.Literal('unknown'),
        ]),
      },
      objectOptions,
    ),
    fen: Type.String({ minLength: 1, maxLength: 128 }),
  },
  objectOptions,
);

const analysisStep = Type.Object(
  { before: chessState, move: canonicalMove, after: chessState },
  objectOptions,
);

const analysisOrigin = Type.Union([
  Type.Object({ kind: Type.Literal('initial_position') }, objectOptions),
  Type.Object({ kind: Type.Literal('fen') }, objectOptions),
  Type.Object(
    {
      kind: Type.Literal('inventory_anchor'),
      itemId: localId,
      revisionId: localId,
      anchorId: localId,
    },
    objectOptions,
  ),
]);

const analysisScratch = Type.Object(
  {
    scratchId: Type.String({ minLength: 1, maxLength: 160 }),
    scratchRevision: preferenceRevision,
    origin: analysisOrigin,
    root: chessState,
    steps: Type.Array(analysisStep, { maxItems: 1_000 }),
    cursor: Type.Integer({ minimum: 0, maximum: 1_000 }),
    noteDraft: Type.Optional(
      Type.Object(
        {
          moves: Type.Array(canonicalMove, { maxItems: 1_000 }),
          body: Type.String({ maxLength: 8_000 }),
        },
        objectOptions,
      ),
    ),
  },
  objectOptions,
);

const analysisRecordStep = Type.Object(
  {
    before: chessState,
    move: canonicalMove,
    after: chessState,
    anchorId: localId,
  },
  objectOptions,
);

const analysisContribution = Type.Object(
  {
    contributionId: localId,
    anchorId: localId,
    body: Type.String({ maxLength: 8_000 }),
    moves: Type.Array(canonicalMove, { maxItems: 1_000 }),
    languageTag,
    scopeKind: Type.Union([Type.Literal('global'), Type.Literal('context')]),
    contextId: Type.Optional(localId),
    contributionVersion: preferenceRevision,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  objectOptions,
);

const analysisRecord = Type.Object(
  {
    itemId: localId,
    revisionId: localId,
    rootAnchorId: localId,
    currentAnchorId: localId,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    languageTag,
    origin: analysisOrigin,
    sourceLine: Type.Optional(
      Type.Object(
        {
          sourceItemId: localId,
          sourceRevisionId: localId,
          sourceAnchorId: localId,
          sourceDisplayName: Type.String({ minLength: 1, maxLength: 160 }),
          root: chessState,
          rootTarget: Type.Object(
            { itemId: localId, revisionId: localId, anchorId: localId },
            objectOptions,
          ),
          steps: Type.Array(
            Type.Object(
              {
                before: chessState,
                move: canonicalMove,
                after: chessState,
                anchorId: localId,
                itemId: localId,
                revisionId: localId,
              },
              objectOptions,
            ),
            { maxItems: 1_000 },
          ),
          contributions: Type.Array(analysisContribution),
        },
        objectOptions,
      ),
    ),
    root: chessState,
    steps: Type.Array(analysisRecordStep, { maxItems: 1_000 }),
    cursor: Type.Integer({ minimum: 0, maximum: 1_000 }),
    contributions: Type.Array(analysisContribution),
    contextMember: Type.Boolean(),
    readOnlyPreview: Type.Boolean(),
  },
  objectOptions,
);

export const GetAnalysisWorkspaceArgumentsSchema = Type.Object(
  {
    scope: workScope,
    preview: Type.Optional(
      Type.Object(
        { itemId: localId, revisionId: localId, anchorId: localId },
        objectOptions,
      ),
    ),
  },
  objectOptions,
);

export const AnalysisWorkspaceSchema = Type.Object(
  {
    scope: workScope,
    dataRevision: revision,
    contextName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    resumeVersion: Type.Optional(preferenceRevision),
    scratch: Type.Optional(analysisScratch),
    record: Type.Optional(analysisRecord),
    currentState: chessState,
    legalMoves: Type.Array(canonicalMove),
    allowedActions: Type.Array(
      Type.Union([
        Type.Literal('start_scratch'),
        Type.Literal('apply_move'),
        Type.Literal('move_cursor'),
        Type.Literal('prepare_note'),
        Type.Literal('clear_note'),
        Type.Literal('discard_scratch'),
        Type.Literal('create_analysis_note'),
        Type.Literal('create_analysis_record'),
      ]),
    ),
  },
  objectOptions,
);

const moveInput = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('coordinates'),
      value: Type.String({ minLength: 4, maxLength: 5 }),
    },
    objectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal('notation'),
      value: Type.String({ minLength: 1, maxLength: 32 }),
      locale: uiLocale,
    },
    objectOptions,
  ),
]);

const analysisStartOrigin = Type.Union([
  Type.Object({ kind: Type.Literal('initial_position') }, objectOptions),
  Type.Object(
    {
      kind: Type.Literal('fen'),
      fen: Type.String({ minLength: 1, maxLength: 128 }),
    },
    objectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal('inventory_anchor'),
      itemId: localId,
      revisionId: localId,
      anchorId: localId,
    },
    objectOptions,
  ),
]);

export const UpdateAnalysisScratchArgumentsSchema = Type.Object(
  {
    scope: workScope,
    expectedScratchId: Type.Union([
      Type.String({ minLength: 1, maxLength: 160 }),
      Type.Null(),
    ]),
    expectedScratchRevision: Type.Union([preferenceRevision, Type.Null()]),
    action: Type.Union([
      Type.Object(
        { kind: Type.Literal('start'), origin: analysisStartOrigin },
        objectOptions,
      ),
      Type.Object(
        { kind: Type.Literal('apply_move'), move: moveInput },
        objectOptions,
      ),
      Type.Object(
        { kind: Type.Literal('move_cursor'), cursor: revision },
        objectOptions,
      ),
      Type.Object(
        {
          kind: Type.Literal('prepare_note'),
          body: Type.String({ maxLength: 8_000 }),
        },
        objectOptions,
      ),
      Type.Object({ kind: Type.Literal('clear_note') }, objectOptions),
      Type.Object({ kind: Type.Literal('discard') }, objectOptions),
    ]),
  },
  objectOptions,
);

export const UpdateAnalysisScratchResultSchema = Type.Object(
  {
    scratch: Type.Optional(analysisScratch),
    discarded: Type.Boolean(),
    dataRevision: revision,
    resumeVersion: Type.Optional(preferenceRevision),
  },
  objectOptions,
);

export const CreateAnalysisRecordArgumentsSchema = Type.Object(
  {
    scope: workScope,
    expectedScratchId: Type.String({ minLength: 1, maxLength: 160 }),
    expectedScratchRevision: preferenceRevision,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    languageTag,
    targetContextId: Type.Optional(localId),
    noteScope: Type.Optional(analysisNoteScope),
  },
  objectOptions,
);

export const CreateAnalysisRecordResultSchema = Type.Object(
  {
    itemId: localId,
    revisionId: localId,
    rootAnchorId: localId,
    contributionId: Type.Optional(localId),
    contextReferenceId: Type.Optional(localId),
    resumeUpdates: Type.Array(
      Type.Object(
        { contextId: localId, resumeVersion: preferenceRevision },
        objectOptions,
      ),
    ),
    dataRevision: revision,
  },
  objectOptions,
);

export const CreateAnalysisNoteArgumentsSchema = Type.Object(
  {
    scope: workScope,
    expectedScratchId: Type.String({ minLength: 1, maxLength: 160 }),
    expectedScratchRevision: preferenceRevision,
    languageTag,
    noteScope: analysisNoteScope,
  },
  objectOptions,
);

export const CreateAnalysisNoteResultSchema = Type.Object(
  {
    contributionId: localId,
    itemId: localId,
    revisionId: localId,
    anchorId: localId,
    scopeKind: Type.Union([Type.Literal('global'), Type.Literal('context')]),
    contextId: Type.Optional(localId),
    resumeUpdate: Type.Optional(
      Type.Object(
        { contextId: localId, resumeVersion: preferenceRevision },
        objectOptions,
      ),
    ),
    dataRevision: revision,
  },
  objectOptions,
);

export const CreatePositionNoteArgumentsSchema = Type.Object(
  {
    scope: workScope,
    itemId: localId,
    revisionId: localId,
    anchorId: localId,
    body: Type.String({ minLength: 1, maxLength: 8_000 }),
    languageTag,
    noteScope: analysisNoteScope,
  },
  objectOptions,
);

export const UpdateAnalysisNoteArgumentsSchema = Type.Object(
  {
    scope: workScope,
    contributionId: localId,
    expectedContributionVersion: preferenceRevision,
    body: Type.String({ minLength: 1, maxLength: 8_000 }),
  },
  objectOptions,
);

export const DeleteAnalysisNoteArgumentsSchema = Type.Object(
  {
    scope: workScope,
    contributionId: localId,
    expectedContributionVersion: preferenceRevision,
  },
  objectOptions,
);

export const AnalysisNoteMutationResultSchema = Type.Object(
  {
    contributionId: localId,
    itemId: localId,
    anchorId: localId,
    contributionVersion: preferenceRevision,
    dataRevision: revision,
  },
  objectOptions,
);

export const SearchInventoryArgumentsSchema = Type.Object(
  {
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    contextId: Type.Optional(localId),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(cursor),
  },
  objectOptions,
);

const inventorySearchItem = Type.Object(
  {
    itemId: localId,
    currentRevisionId: localId,
    rootAnchorId: localId,
    itemType: Type.Union([
      Type.Literal('game'),
      Type.Literal('analysis'),
      Type.Literal('source'),
    ]),
    originKind: Type.Union([
      Type.Literal('manual'),
      Type.Literal('structured_import'),
      Type.Literal('playout'),
      Type.Literal('live_observed'),
      Type.Literal('live_played'),
    ]),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    languageTag,
    contextIds: Type.Array(localId),
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  objectOptions,
);

export const SearchInventoryResultSchema = Type.Object(
  {
    items: Type.Array(inventorySearchItem),
    nextCursor: Type.Optional(cursor),
    dataRevision: revision,
  },
  objectOptions,
);

export const ListWorkingContextsArgumentsSchema = Type.Object(
  {
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(cursor),
  },
  objectOptions,
);

const workingContextSummary = Type.Object(
  {
    contextId: localId,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    boundary: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    nextStep: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    lifecycle: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
    pinnedOrder: Type.Optional(revision),
    contextVersion: preferenceRevision,
    referenceCount: revision,
    managementResumeVersion: Type.Optional(preferenceRevision),
    analysisResumeVersion: Type.Optional(preferenceRevision),
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  objectOptions,
);

export const ListWorkingContextsResultSchema = Type.Object(
  {
    contexts: Type.Array(workingContextSummary),
    nextCursor: Type.Optional(cursor),
    dataRevision: revision,
  },
  objectOptions,
);

export const GetWorkingContextWorkspaceArgumentsSchema = Type.Object(
  { contextId: localId },
  objectOptions,
);

const contextReference = Type.Object(
  {
    referenceId: localId,
    itemId: localId,
    currentRevisionId: localId,
    itemType: Type.Union([
      Type.Literal('game'),
      Type.Literal('analysis'),
      Type.Literal('source'),
    ]),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    anchorId: localId,
    anchorKind: Type.Union([
      Type.Literal('item'),
      Type.Literal('position'),
      Type.Literal('occurrence'),
      Type.Literal('move_node'),
    ]),
    createdAt: timestamp,
  },
  objectOptions,
);

const managementResume = Type.Object(
  {
    resumeVersion: preferenceRevision,
    presentation: Type.Union([Type.Literal('list'), Type.Literal('atlas')]),
    selectedItemId: Type.Optional(localId),
    selectedAnchorId: Type.Optional(localId),
    updatedAt: timestamp,
  },
  objectOptions,
);

const analysisResume = Type.Object(
  {
    resumeVersion: preferenceRevision,
    mode: Type.Union([
      Type.Literal('analyze'),
      Type.Literal('edit_inventory'),
      Type.Literal('edit_overlay'),
    ]),
    itemId: Type.Optional(localId),
    revisionId: Type.Optional(localId),
    anchorId: Type.Optional(localId),
    currentPositionId: localId,
    scratchId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    updatedAt: timestamp,
  },
  objectOptions,
);

export const WorkingContextWorkspaceSchema = Type.Object(
  {
    context: workingContextSummary,
    references: Type.Array(contextReference),
    managementResume: Type.Optional(managementResume),
    analysisResume: Type.Optional(analysisResume),
    dataRevision: revision,
  },
  objectOptions,
);

export const CreateWorkingContextArgumentsSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    boundary: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    nextStep: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  objectOptions,
);

export const CreateWorkingContextResultSchema = Type.Object(
  { context: workingContextSummary, dataRevision: revision },
  objectOptions,
);

export const AddContextReferenceArgumentsSchema = Type.Object(
  { contextId: localId, itemId: localId, anchorId: localId },
  objectOptions,
);

export const AddContextReferenceResultSchema = Type.Object(
  { reference: contextReference, dataRevision: revision },
  objectOptions,
);

export const SetWorkScopeResumeArgumentsSchema = Type.Object(
  {
    contextId: localId,
    area: Type.Union([Type.Literal('manage'), Type.Literal('analyze')]),
    expectedResumeVersion: Type.Union([preferenceRevision, Type.Null()]),
    presentation: Type.Optional(
      Type.Union([Type.Literal('list'), Type.Literal('atlas')]),
    ),
    selectedItemId: Type.Optional(localId),
    selectedAnchorId: Type.Optional(localId),
    mode: Type.Optional(
      Type.Union([
        Type.Literal('analyze'),
        Type.Literal('edit_inventory'),
        Type.Literal('edit_overlay'),
      ]),
    ),
    itemId: Type.Optional(localId),
    revisionId: Type.Optional(localId),
    anchorId: Type.Optional(localId),
  },
  objectOptions,
);

export const SetWorkScopeResumeResultSchema = Type.Union([
  Type.Object(
    {
      area: Type.Literal('manage'),
      resume: managementResume,
      dataRevision: revision,
    },
    objectOptions,
  ),
  Type.Object(
    {
      area: Type.Literal('analyze'),
      resume: analysisResume,
      dataRevision: revision,
    },
    objectOptions,
  ),
]);
