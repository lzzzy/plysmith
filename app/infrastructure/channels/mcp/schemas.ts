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

const diagnosticLogLevel = Type.Union([
  Type.Literal('off'),
  Type.Literal('error'),
  Type.Literal('info'),
  Type.Literal('debug'),
]);
const configurationRevision = Type.String({
  pattern: '^sha256:[a-f0-9]{64}$',
});

export const DiagnosticSettingsSchema = Type.Object(
  {
    configuredLevel: diagnosticLogLevel,
    activeLevel: diagnosticLogLevel,
    configurationRevision,
    restartRequired: Type.Boolean(),
  },
  objectOptions,
);

export const SetDiagnosticLogLevelArgumentsSchema = Type.Object(
  {
    level: diagnosticLogLevel,
    expectedConfigurationRevision: configurationRevision,
  },
  objectOptions,
);

export const SetDiagnosticLogLevelResultSchema = Type.Object(
  { changed: Type.Boolean(), settings: DiagnosticSettingsSchema },
  objectOptions,
);

const diagnosticReportIncludedCategory = Type.Union([
  Type.Literal('product_identity'),
  Type.Literal('runtime_environment'),
  Type.Literal('diagnostic_settings'),
  Type.Literal('redacted_diagnostic_events'),
  Type.Literal('excluded_data_declaration'),
]);
const diagnosticReportExcludedCategory = Type.Union([
  Type.Literal('secrets_and_credentials'),
  Type.Literal('active_configuration'),
  Type.Literal('database_and_backups'),
  Type.Literal('local_paths'),
  Type.Literal('chess_and_user_content'),
  Type.Literal('external_identities'),
  Type.Literal('provider_payloads'),
  Type.Literal('memory_and_raw_errors'),
]);

export const DiagnosticReportManifestSchema = Type.Object(
  {
    manifestVersion: Type.Literal(1),
    format: Type.Literal('plysmith-diagnostics-json-gzip-v1'),
    suggestedFileName: Type.String({
      pattern: '^plysmith-diagnostics-[A-Za-z0-9-]+\\.json\\.gz$',
      maxLength: 160,
    }),
    maximumBytes: Type.Integer({ minimum: 1, maximum: 10_485_760 }),
    includedCategories: Type.Array(diagnosticReportIncludedCategory, {
      minItems: 5,
      maxItems: 5,
      uniqueItems: true,
    }),
    excludedCategories: Type.Array(diagnosticReportExcludedCategory, {
      minItems: 8,
      maxItems: 8,
      uniqueItems: true,
    }),
  },
  objectOptions,
);

export const CreateDiagnosticReportArgumentsSchema = Type.Object(
  {
    acceptedManifestVersion: Type.Literal(1),
    destinationPath: Type.String({ minLength: 1, maxLength: 1_024 }),
  },
  objectOptions,
);

export const CreateDiagnosticReportResultSchema = Type.Object(
  {
    created: Type.Literal(true),
    generatedAt: timestamp,
    format: Type.Literal('plysmith-diagnostics-json-gzip-v1'),
    bytesWritten: Type.Integer({ minimum: 1, maximum: 10_485_760 }),
    eventCount: revision,
    discardedLineCount: revision,
    truncated: Type.Boolean(),
  },
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

const analysisSetup = Type.Object(
  {
    pieces: Type.Array(
      Type.Object(
        {
          square: Type.String({ pattern: '^[a-h][1-8]$' }),
          color: Type.Union([Type.Literal('white'), Type.Literal('black')]),
          role: Type.Union([
            Type.Literal('king'),
            Type.Literal('queen'),
            Type.Literal('rook'),
            Type.Literal('bishop'),
            Type.Literal('knight'),
            Type.Literal('pawn'),
          ]),
        },
        objectOptions,
      ),
      { maxItems: 32 },
    ),
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
    enPassantSquare: Type.Optional(Type.String({ pattern: '^[a-h][1-8]$' })),
    halfmoveClock: revision,
    fullmoveNumber: preferenceRevision,
  },
  objectOptions,
);

const analysisSetupIssue = Type.Object(
  {
    code: Type.Union([
      Type.Literal('invalid_square'),
      Type.Literal('duplicate_square'),
      Type.Literal('white_king_required'),
      Type.Literal('black_king_required'),
      Type.Literal('multiple_white_kings'),
      Type.Literal('multiple_black_kings'),
      Type.Literal('adjacent_kings'),
      Type.Literal('pawn_on_back_rank'),
      Type.Literal('invalid_castling_rights'),
      Type.Literal('invalid_en_passant_square'),
      Type.Literal('invalid_halfmove_clock'),
      Type.Literal('invalid_fullmove_number'),
      Type.Literal('invalid_position'),
      Type.Literal('invalid_fen'),
    ]),
    field: Type.Optional(
      Type.Union([
        Type.Literal('pieces'),
        Type.Literal('castlingRights'),
        Type.Literal('enPassantSquare'),
        Type.Literal('halfmoveClock'),
        Type.Literal('fullmoveNumber'),
        Type.Literal('fen'),
      ]),
    ),
    square: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
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
  Type.Object({ kind: Type.Literal('position_setup') }, objectOptions),
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

const inventoryRevisionMode = Type.Union([
  Type.Literal('extend'),
  Type.Literal('truncate_after'),
  Type.Literal('replace_move'),
  Type.Literal('metadata'),
]);

const analysisScratchIntent = Type.Union([
  Type.Object({ kind: Type.Literal('exploration') }, objectOptions),
  Type.Object(
    {
      kind: Type.Literal('inventory_revision'),
      mode: inventoryRevisionMode,
      itemId: localId,
      baseRevisionId: localId,
      cutAnchorId: localId,
      returnAnchorId: localId,
      displayName: Type.String({ minLength: 1, maxLength: 200 }),
      summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    },
    objectOptions,
  ),
]);

const analysisScratch = Type.Object(
  {
    scratchId: Type.String({ minLength: 1, maxLength: 160 }),
    scratchRevision: preferenceRevision,
    origin: analysisOrigin,
    intent: analysisScratchIntent,
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

const analysisGameOutcome = Type.Union([
  Type.Object({ kind: Type.Literal('draw') }, objectOptions),
  Type.Object(
    {
      kind: Type.Literal('win'),
      winner: Type.Union([Type.Literal('white'), Type.Literal('black')]),
    },
    objectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal('draw'),
      reason: Type.Union([
        Type.Literal('stalemate'),
        Type.Literal('insufficient_material'),
        Type.Literal('threefold_repetition'),
        Type.Literal('seventy_five_move'),
      ]),
    },
    objectOptions,
  ),
  Type.Object({ kind: Type.Literal('unfinished') }, objectOptions),
]);

const humanMovePolicyProfile = Type.Object(
  {
    modelName: Type.String({ minLength: 1, maxLength: 160 }),
    selectionMode: Type.Union([
      Type.Literal('most_likely'),
      Type.Literal('sampled'),
    ]),
    historyMode: Type.Union([
      Type.Literal('known_position_history'),
      Type.Literal('position_only'),
    ]),
    reproducibility: Type.Union([
      Type.Literal('deterministic'),
      Type.Literal('stochastic'),
    ]),
  },
  objectOptions,
);

const movePolicyBindingBase = {
  providerInstanceId: Type.String({ minLength: 1, maxLength: 160 }),
  providerFingerprint: Type.String({ minLength: 1, maxLength: 160 }),
  providerType: Type.String({ minLength: 1, maxLength: 160 }),
  providerDisplayName: Type.String({ minLength: 1, maxLength: 160 }),
};

const movePolicyBinding = Type.Union([
  Type.Object(
    { ...movePolicyBindingBase, capability: Type.Literal('best_move') },
    objectOptions,
  ),
  Type.Object(
    {
      ...movePolicyBindingBase,
      capability: Type.Literal('human_profile'),
      profile: humanMovePolicyProfile,
    },
    objectOptions,
  ),
]);

export const AnalysisRecordSchema = Type.Object(
  {
    itemType: Type.Union([Type.Literal('analysis'), Type.Literal('game')]),
    itemId: localId,
    revisionId: localId,
    currentRevisionId: localId,
    revisionNumber: preferenceRevision,
    rootAnchorId: localId,
    currentAnchorId: localId,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    languageTag,
    game: Type.Optional(
      Type.Object(
        {
          playerSide: Type.Union([
            Type.Literal('white'),
            Type.Literal('black'),
          ]),
          outcome: analysisGameOutcome,
          outcomeSource: Type.Union([
            Type.Literal('manual'),
            Type.Literal('automatic'),
          ]),
          policy: movePolicyBinding,
        },
        objectOptions,
      ),
    ),
    origin: analysisOrigin,
    sourceLine: Type.Optional(
      Type.Object(
        {
          sourceItemId: localId,
          sourceItemType: Type.Union([
            Type.Literal('analysis'),
            Type.Literal('game'),
          ]),
          sourceRevisionId: localId,
          sourceAnchorId: localId,
          sourceDisplayName: Type.String({ minLength: 1, maxLength: 160 }),
          root: chessState,
          rootTarget: Type.Optional(
            Type.Object(
              { itemId: localId, revisionId: localId, anchorId: localId },
              objectOptions,
            ),
          ),
          steps: Type.Array(
            Type.Object(
              {
                before: chessState,
                move: canonicalMove,
                after: chessState,
                anchorId: Type.Optional(localId),
                itemId: Type.Optional(localId),
                revisionId: Type.Optional(localId),
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
    sourcePath: Type.Optional(
      Type.Object(
        {
          displayName: Type.String({ minLength: 1, maxLength: 200 }),
          root: chessState,
          steps: Type.Array(
            Type.Object(
              { before: chessState, move: canonicalMove, after: chessState },
              objectOptions,
            ),
            { maxItems: 1_000 },
          ),
        },
        objectOptions,
      ),
    ),
    steps: Type.Array(analysisRecordStep, { maxItems: 1_000 }),
    cursor: Type.Integer({ minimum: 0, maximum: 1_000 }),
    contributions: Type.Array(analysisContribution),
    contextMember: Type.Boolean(),
    historical: Type.Boolean(),
  },
  objectOptions,
);

export const GetAnalysisWorkspaceArgumentsSchema = Type.Object(
  {
    scope: workScope,
    mode: Type.Optional(
      Type.Union([Type.Literal('current'), Type.Literal('initial_position')]),
    ),
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
    record: Type.Optional(AnalysisRecordSchema),
    currentState: chessState,
    legalMoves: Type.Array(canonicalMove),
    allowedActions: Type.Array(
      Type.Union([
        Type.Literal('start_scratch'),
        Type.Literal('apply_move'),
        Type.Literal('move_cursor'),
        Type.Literal('remove_last_move'),
        Type.Literal('prepare_note'),
        Type.Literal('clear_note'),
        Type.Literal('continue_exploration'),
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
    { kind: Type.Literal('position_setup'), setup: analysisSetup },
    objectOptions,
  ),
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

export const ValidateAnalysisSetupArgumentsSchema = Type.Object(
  {
    input: Type.Union([
      Type.Object(
        { kind: Type.Literal('position_setup'), setup: analysisSetup },
        objectOptions,
      ),
      Type.Object(
        {
          kind: Type.Literal('fen'),
          fen: Type.String({ minLength: 1, maxLength: 128 }),
        },
        objectOptions,
      ),
    ]),
  },
  objectOptions,
);

export const ValidateAnalysisSetupResultSchema = Type.Union([
  Type.Object(
    { valid: Type.Literal(true), setup: analysisSetup, state: chessState },
    objectOptions,
  ),
  Type.Object(
    {
      valid: Type.Literal(false),
      issues: Type.Array(analysisSetupIssue, { minItems: 1, maxItems: 64 }),
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
        {
          kind: Type.Literal('start'),
          origin: analysisStartOrigin,
          firstMove: Type.Optional(moveInput),
        },
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
      Type.Object({ kind: Type.Literal('remove_last_move') }, objectOptions),
      Type.Object(
        {
          kind: Type.Literal('prepare_note'),
          body: Type.String({ maxLength: 8_000 }),
        },
        objectOptions,
      ),
      Type.Object({ kind: Type.Literal('clear_note') }, objectOptions),
      Type.Object(
        { kind: Type.Literal('continue_exploration') },
        objectOptions,
      ),
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
    lifecycle: Type.Union([
      Type.Literal('active'),
      Type.Literal('archived'),
      Type.Literal('trashed'),
      Type.Literal('tombstone'),
    ]),
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
    ancestors: Type.Array(inventorySearchItem),
    provenanceEdges: Type.Array(
      Type.Object(
        {
          itemId: localId,
          sourceItemId: localId,
          sourceRevisionId: localId,
          sourceAnchorId: localId,
        },
        objectOptions,
      ),
    ),
    nextCursor: Type.Optional(cursor),
    dataRevision: revision,
  },
  objectOptions,
);

export const StartInventoryRevisionArgumentsSchema = Type.Object(
  {
    scope: workScope,
    itemId: localId,
    baseRevisionId: localId,
    anchorId: localId,
    mode: inventoryRevisionMode,
    expectedScratchId: Type.Union([
      Type.String({ minLength: 1, maxLength: 160 }),
      Type.Null(),
    ]),
    expectedScratchRevision: Type.Union([preferenceRevision, Type.Null()]),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    summary: Type.Optional(
      Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    ),
    firstMove: Type.Optional(moveInput),
  },
  objectOptions,
);

export const StartInventoryRevisionResultSchema = Type.Object(
  {
    scratch: analysisScratch,
    dataRevision: revision,
    resumeVersion: Type.Optional(preferenceRevision),
  },
  objectOptions,
);

export const PromoteAnalysisToInventoryRevisionArgumentsSchema = Type.Object(
  {
    scope: workScope,
    itemId: localId,
    baseRevisionId: localId,
    anchorId: localId,
    expectedScratchId: Type.String({ minLength: 1, maxLength: 160 }),
    expectedScratchRevision: preferenceRevision,
  },
  objectOptions,
);

export const PreviewInventoryRevisionArgumentsSchema = Type.Object(
  {
    scope: workScope,
    expectedScratchId: Type.String({ minLength: 1, maxLength: 160 }),
    expectedScratchRevision: preferenceRevision,
  },
  objectOptions,
);

const inventoryRevisionContextImpactSummary = Type.Object(
  {
    contextId: localId,
    contextName: Type.String({ minLength: 1, maxLength: 160 }),
    referenceCount: revision,
    contributionCount: revision,
    managementResumeCount: revision,
    analysisResumeCount: revision,
  },
  objectOptions,
);

const inventoryRevisionFollowingContextSummary = Type.Object(
  {
    contextId: localId,
    contextName: Type.String({ minLength: 1, maxLength: 160 }),
    updatedAutomatically: Type.Boolean(),
    referenceCount: revision,
    contributionCount: revision,
    managementResumeCount: revision,
    analysisResumeCount: revision,
  },
  objectOptions,
);

export const InventoryRevisionPreviewSchema = Type.Object(
  {
    itemId: localId,
    baseRevisionId: localId,
    mode: inventoryRevisionMode,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    preservedMoveCount: revision,
    addedSteps: Type.Array(analysisStep, { maxItems: 1_000 }),
    removedSteps: Type.Array(analysisStep, { maxItems: 1_000 }),
    historicalGlobalContributionCount: revision,
    affectedContexts: Type.Array(inventoryRevisionContextImpactSummary),
    followingContexts: Type.Array(inventoryRevisionFollowingContextSummary),
    noOp: Type.Boolean(),
    previewFingerprint: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
    dataRevision: revision,
  },
  objectOptions,
);

export const SaveInventoryRevisionArgumentsSchema = Type.Object(
  {
    scope: workScope,
    expectedScratchId: Type.String({ minLength: 1, maxLength: 160 }),
    expectedScratchRevision: preferenceRevision,
    previewFingerprint: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  },
  objectOptions,
);

export const SaveInventoryRevisionResultSchema = Type.Object(
  {
    itemId: localId,
    revisionId: localId,
    revisionNumber: preferenceRevision,
    currentAnchorId: localId,
    impacts: Type.Array(
      Type.Object({ impactId: localId, contextId: localId }, objectOptions),
    ),
    noOp: Type.Boolean(),
    dataRevision: revision,
  },
  objectOptions,
);

export const GetInventoryRevisionArgumentsSchema = Type.Object(
  {
    scope: workScope,
    itemId: localId,
    revisionId: localId,
    anchorId: Type.Optional(localId),
  },
  objectOptions,
);

export const ListInventoryRevisionsArgumentsSchema = Type.Object(
  {
    itemId: localId,
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(cursor),
  },
  objectOptions,
);

const inventoryRevisionSummary = Type.Object(
  {
    itemId: localId,
    revisionId: localId,
    revisionNumber: preferenceRevision,
    baseRevisionId: Type.Optional(localId),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    changeKind: Type.Union([Type.Literal('created'), inventoryRevisionMode]),
    createdAt: timestamp,
    current: Type.Boolean(),
  },
  objectOptions,
);

export const ListInventoryRevisionsResultSchema = Type.Object(
  {
    revisions: Type.Array(inventoryRevisionSummary),
    nextCursor: Type.Optional(cursor),
    dataRevision: revision,
  },
  objectOptions,
);

export const GetPendingRevisionImpactArgumentsSchema = Type.Object(
  { impactId: localId },
  objectOptions,
);

export const InventoryItemUsageSummarySchema = Type.Object(
  {
    referenceCount: revision,
    activeNoteCount: revision,
    noteMoveCount: revision,
    scratchCount: revision,
    scratchMoveCount: revision,
    scratchNoteCount: revision,
    managementResumeAffected: Type.Boolean(),
    analysisResumeAffected: Type.Boolean(),
  },
  objectOptions,
);

export const PendingRevisionImpactSchema = Type.Object(
  {
    dataRevision: revision,
    useTargetLoss: InventoryItemUsageSummarySchema,
    removeFromContextLoss: InventoryItemUsageSummarySchema,
    impactId: localId,
    contextId: localId,
    contextName: Type.String({ minLength: 1, maxLength: 160 }),
    itemId: localId,
    pinnedRevisionId: localId,
    targetRevisionId: localId,
    targetAnchorId: localId,
    impactVersion: preferenceRevision,
    referenceCount: revision,
    contributionCount: revision,
    managementResumeAffected: Type.Boolean(),
    analysisResumeAffected: Type.Boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  objectOptions,
);

export const ResolvePendingRevisionImpactArgumentsSchema = Type.Object(
  {
    impactId: localId,
    expectedImpactVersion: preferenceRevision,
    expectedDataRevision: revision,
    resolution: Type.Union([
      Type.Object({ kind: Type.Literal('use_target') }, objectOptions),
      Type.Object(
        {
          kind: Type.Literal('keep_copy'),
          displayName: Type.String({ minLength: 1, maxLength: 200 }),
        },
        objectOptions,
      ),
      Type.Object({ kind: Type.Literal('remove_from_context') }, objectOptions),
    ]),
  },
  objectOptions,
);

export const ResolvePendingRevisionImpactResultSchema = Type.Object(
  {
    impactId: localId,
    contextId: localId,
    itemId: localId,
    resolution: Type.Union([
      Type.Literal('use_target'),
      Type.Literal('keep_copy'),
      Type.Literal('remove_from_context'),
    ]),
    contextItemId: Type.Optional(localId),
    contextRevisionId: Type.Optional(localId),
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
    pendingRevisionImpactCount: revision,
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

const workingContextRevisionImpactSummary = Type.Object(
  {
    impactId: localId,
    itemId: localId,
    pinnedRevisionId: localId,
    targetRevisionId: localId,
    impactVersion: preferenceRevision,
    entryCount: preferenceRevision,
    updatedAt: timestamp,
  },
  objectOptions,
);

export const WorkingContextWorkspaceSchema = Type.Object(
  {
    context: workingContextSummary,
    references: Type.Array(contextReference),
    pendingRevisionImpacts: Type.Array(workingContextRevisionImpactSummary),
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

export const UpdateWorkingContextMetadataArgumentsSchema = Type.Object(
  {
    contextId: localId,
    expectedContextVersion: preferenceRevision,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    purpose: Type.Optional(
      Type.Union([
        Type.String({ minLength: 1, maxLength: 2_000 }),
        Type.Null(),
      ]),
    ),
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

export const RemoveContextItemArgumentsSchema = Type.Object(
  {
    contextId: localId,
    itemId: localId,
    expectedContextVersion: preferenceRevision,
    expectedDataRevision: revision,
  },
  objectOptions,
);

export const RemoveContextItemResultSchema = Type.Object(
  { contextId: localId, itemId: localId, dataRevision: revision },
  objectOptions,
);

export const SetWorkScopeResumeArgumentsSchema = Type.Object(
  {
    scope: workScope,
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

export const InventoryItemDeletionPreviewSchema = Type.Object(
  {
    itemId: localId,
    currentRevisionId: localId,
    displayName: Type.String(),
    itemType: Type.Union([
      Type.Literal('game'),
      Type.Literal('analysis'),
      Type.Literal('source'),
    ]),
    contexts: Type.Array(
      Type.Object(
        {
          ...InventoryItemUsageSummarySchema.properties,
          contextId: localId,
          contextName: Type.String(),
        },
        objectOptions,
      ),
    ),
    global: InventoryItemUsageSummarySchema,
    retainedDerivedItemCount: revision,
    retainedPlayoutCount: revision,
    dataRevision: revision,
  },
  objectOptions,
);

export const DeleteInventoryItemArgumentsSchema = Type.Object(
  {
    itemId: localId,
    expectedCurrentRevisionId: localId,
    expectedDataRevision: revision,
  },
  objectOptions,
);

export const DeleteInventoryItemResultSchema = Type.Object(
  {
    itemId: localId,
    dataRevision: revision,
  },
  objectOptions,
);

export const GetWorkScopeWorkspaceArgumentsSchema = Type.Object(
  {
    scopeKind: Type.Union([Type.Literal('free'), Type.Literal('context')]),
    contextId: Type.Optional(localId),
  },
  objectOptions,
);

export const WorkScopeWorkspaceSchema = Type.Object(
  {
    scope: workScope,
    managementResume: Type.Optional(managementResume),
    analysisResume: Type.Optional(analysisResume),
    dataRevision: revision,
  },
  objectOptions,
);

const workspaceArea = Type.Union([
  Type.Literal('manage'),
  Type.Literal('analyze'),
  Type.Literal('playout'),
  Type.Literal('settings'),
]);

export const StartupResumeSchema = Type.Object(
  {
    scope: workScope,
    area: workspaceArea,
    startupVersion: Type.Union([preferenceRevision, Type.Null()]),
    dataRevision: revision,
    unavailableContext: Type.Optional(
      Type.Object(
        {
          contextId: localId,
          displayName: Type.Optional(Type.String()),
          reason: Type.Union([
            Type.Literal('deleted'),
            Type.Literal('missing'),
          ]),
        },
        objectOptions,
      ),
    ),
  },
  objectOptions,
);

export const SetStartupResumeArgumentsSchema = Type.Object(
  {
    scope: workScope,
    area: workspaceArea,
    expectedStartupVersion: Type.Union([preferenceRevision, Type.Null()]),
  },
  objectOptions,
);

const contextPlayoutWork = Type.Object(
  {
    draftId: localId,
    draftRevision: preferenceRevision,
    moveCount: revision,
    status: Type.Union([
      Type.Literal('active'),
      Type.Literal('awaiting_policy'),
      Type.Literal('paused'),
      Type.Literal('stopped'),
      Type.Literal('terminal'),
    ]),
    sourceItemId: Type.Optional(localId),
  },
  objectOptions,
);

export const ContextRemovalPreviewSchema = Type.Object(
  {
    contextId: localId,
    contextName: Type.String(),
    contextVersion: preferenceRevision,
    dataRevision: revision,
    items: Type.Array(
      Type.Object(
        { itemId: localId, displayName: Type.String() },
        objectOptions,
      ),
    ),
    referenceCount: revision,
    losses: Type.Object(
      {
        notes: Type.Array(
          Type.Object(
            {
              contributionId: localId,
              body: Type.String(),
              moveCount: revision,
              itemId: Type.Optional(localId),
            },
            objectOptions,
          ),
        ),
        scratch: Type.Optional(
          Type.Object(
            {
              scratchId: Type.String({
                minLength: 1,
                maxLength: 160,
                pattern: '^[A-Za-z0-9._:-]+$',
              }),
              scratchRevision: preferenceRevision,
              stepCount: revision,
              noteBody: Type.Optional(Type.String()),
              intent: Type.Union([
                Type.Literal('exploration'),
                Type.Literal('inventory_revision'),
              ]),
              itemId: Type.Optional(localId),
            },
            objectOptions,
          ),
        ),
        managementResume: Type.Optional(managementResume),
        analysisResume: Type.Optional(analysisResume),
        playout: Type.Optional(contextPlayoutWork),
      },
      objectOptions,
    ),
    retainedPlayout: Type.Optional(contextPlayoutWork),
  },
  objectOptions,
);

export const DeleteWorkingContextArgumentsSchema = Type.Object(
  {
    contextId: localId,
    expectedContextVersion: preferenceRevision,
    expectedDataRevision: revision,
  },
  objectOptions,
);

export const DeleteWorkingContextResultSchema = Type.Object(
  {
    contextId: localId,
    dataRevision: revision,
  },
  objectOptions,
);

export const PreviewInventoryItemDeletionArgumentsSchema = Type.Object(
  { itemId: localId },
  objectOptions,
);
export const PreviewContextItemRemovalArgumentsSchema = Type.Object(
  { contextId: localId, itemId: localId },
  objectOptions,
);
export const PreviewWorkingContextDeletionArgumentsSchema = Type.Object(
  { contextId: localId },
  objectOptions,
);

export const ListPositionAnalysisProvidersResultSchema = Type.Object(
  {
    providers: Type.Array(
      Type.Object(
        {
          instanceId: Type.String({ minLength: 1, maxLength: 160 }),
          providerType: Type.String({ minLength: 1, maxLength: 160 }),
          displayName: Type.String({ minLength: 1, maxLength: 160 }),
          capability: Type.Union([
            Type.Literal('objective_position_analysis'),
            Type.Literal('human_policy_analysis'),
          ]),
          readiness: Type.Union([
            Type.Literal('cold'),
            Type.Literal('warming_up'),
            Type.Literal('ready'),
          ]),
          status: Type.Union([
            Type.Literal('available'),
            Type.Literal('unavailable'),
          ]),
          problemCode: Type.Optional(
            Type.String({ minLength: 1, maxLength: 160 }),
          ),
        },
        objectOptions,
      ),
      { maxItems: 32 },
    ),
  },
  objectOptions,
);

const objectiveAnalysisBudget = Type.Union([
  Type.Literal('fast'),
  Type.Literal('thorough'),
  Type.Literal('very_deep'),
]);

export const AnalyzePositionArgumentsSchema = Type.Object(
  {
    work: Type.Object(
      {
        scope: workScope,
        subject: Type.Union([
          Type.Object({ kind: Type.Literal('position') }, objectOptions),
          Type.Object(
            { kind: Type.Literal('inventory_item'), itemId: localId },
            objectOptions,
          ),
        ]),
      },
      objectOptions,
    ),
    consumerId: Type.String({ minLength: 1, maxLength: 128 }),
    laneId: Type.String({ minLength: 1, maxLength: 128 }),
    providerInstanceId: Type.String({ minLength: 1, maxLength: 160 }),
    candidateCount: Type.Integer({ minimum: 1, maximum: 8 }),
    focus: Type.Object(
      {
        focusKey: Type.String({ minLength: 1, maxLength: 256 }),
        root: chessState,
        moves: Type.Array(canonicalMove, { maxItems: 1_000 }),
        current: chessState,
      },
      objectOptions,
    ),
    mode: Type.Union([
      Type.Object(
        {
          kind: Type.Literal('objective'),
          budget: objectiveAnalysisBudget,
          rootMoves: Type.Optional(
            Type.Array(canonicalMove, { minItems: 1, maxItems: 8 }),
          ),
        },
        objectOptions,
      ),
      Type.Object({ kind: Type.Literal('human_policy') }, objectOptions),
    ]),
  },
  objectOptions,
);

const analysisWdl = Type.Object(
  {
    wins: Type.Integer({ minimum: 0, maximum: 1_000 }),
    draws: Type.Integer({ minimum: 0, maximum: 1_000 }),
    losses: Type.Integer({ minimum: 0, maximum: 1_000 }),
    perspective: Type.Union([Type.Literal('white'), Type.Literal('black')]),
    semantics: Type.Union([
      Type.Literal('stockfish_selfplay'),
      Type.Literal('human_outcome'),
    ]),
  },
  objectOptions,
);

const positionAnalysisSnapshotBase = {
  focusKey: Type.String({ minLength: 1, maxLength: 256 }),
  providerInstanceId: Type.String({ minLength: 1, maxLength: 160 }),
  providerDisplayName: Type.String({ minLength: 1, maxLength: 160 }),
  historyCompleteness: Type.Union([
    Type.Literal('complete'),
    Type.Literal('partial'),
    Type.Literal('unknown'),
  ]),
};

export const PositionAnalysisSnapshotSchema = Type.Union([
  Type.Object(
    {
      ...positionAnalysisSnapshotBase,
      kind: Type.Literal('objective'),
      perspective: Type.Union([Type.Literal('white'), Type.Literal('black')]),
      budget: objectiveAnalysisBudget,
      rootWdl: Type.Optional(analysisWdl),
      candidates: Type.Array(
        Type.Object(
          {
            rank: Type.Integer({ minimum: 1, maximum: 8 }),
            move: canonicalMove,
            evaluation: Type.Union([
              Type.Object(
                {
                  kind: Type.Literal('centipawns'),
                  value: Type.Integer({ minimum: -100_000, maximum: 100_000 }),
                  bound: Type.Union([
                    Type.Literal('exact'),
                    Type.Literal('lower'),
                    Type.Literal('upper'),
                  ]),
                },
                objectOptions,
              ),
              Type.Object(
                {
                  kind: Type.Literal('mate'),
                  moves: Type.Integer({ minimum: -10_000, maximum: 10_000 }),
                  bound: Type.Union([
                    Type.Literal('exact'),
                    Type.Literal('lower'),
                    Type.Literal('upper'),
                  ]),
                },
                objectOptions,
              ),
              Type.Object({ kind: Type.Literal('unknown') }, objectOptions),
            ]),
            wdl: Type.Optional(analysisWdl),
            principalVariation: Type.Array(canonicalMove, { maxItems: 32 }),
          },
          objectOptions,
        ),
        { maxItems: 8 },
      ),
      search: Type.Object(
        {
          limiter: Type.Object(
            {
              kind: Type.Literal('movetime'),
              value: Type.Integer({ minimum: 1, maximum: 60_000 }),
            },
            objectOptions,
          ),
          depth: Type.Optional(revision),
          selectiveDepth: Type.Optional(revision),
          nodes: Type.Optional(revision),
          elapsedMilliseconds: Type.Optional(revision),
          nodesPerSecond: Type.Optional(revision),
          hashfullPermille: Type.Optional(
            Type.Integer({ minimum: 0, maximum: 1_000 }),
          ),
          tablebaseHits: Type.Optional(revision),
        },
        objectOptions,
      ),
    },
    objectOptions,
  ),
  Type.Object(
    {
      ...positionAnalysisSnapshotBase,
      kind: Type.Literal('human_policy'),
      profileName: Type.String({ minLength: 1, maxLength: 160 }),
      modelName: Type.String({ minLength: 1, maxLength: 260 }),
      rootWdl: Type.Optional(analysisWdl),
      candidates: Type.Array(
        Type.Object(
          {
            rank: Type.Integer({ minimum: 1, maximum: 8 }),
            move: canonicalMove,
            policyPercent: Type.Number({ minimum: 0, maximum: 100 }),
            wdl: analysisWdl,
          },
          objectOptions,
        ),
        { maxItems: 8 },
      ),
    },
    objectOptions,
  ),
]);

export const ListMovePolicyProvidersResultSchema = Type.Object(
  {
    providers: Type.Array(
      Type.Object(
        {
          instanceId: Type.String({ minLength: 1, maxLength: 160 }),
          providerType: Type.String({ minLength: 1, maxLength: 160 }),
          displayName: Type.String({ minLength: 1, maxLength: 160 }),
          fingerprint: Type.String({ minLength: 1, maxLength: 160 }),
          capabilities: Type.Array(
            Type.Union([
              Type.Literal('best_move'),
              Type.Literal('human_profile'),
            ]),
            { maxItems: 1, uniqueItems: true },
          ),
          profile: Type.Optional(humanMovePolicyProfile),
          readiness: Type.Union([
            Type.Literal('cold'),
            Type.Literal('warming_up'),
            Type.Literal('ready'),
          ]),
          status: Type.Union([
            Type.Literal('available'),
            Type.Literal('unavailable'),
          ]),
          problemCode: Type.Optional(
            Type.String({ minLength: 1, maxLength: 160 }),
          ),
        },
        objectOptions,
      ),
      { maxItems: 32 },
    ),
  },
  objectOptions,
);

const playoutOutcome = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('win'),
      winner: Type.Union([Type.Literal('white'), Type.Literal('black')]),
    },
    objectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal('draw'),
      reason: Type.Union([
        Type.Literal('stalemate'),
        Type.Literal('insufficient_material'),
        Type.Literal('threefold_repetition'),
        Type.Literal('seventy_five_move'),
      ]),
    },
    objectOptions,
  ),
  Type.Object({ kind: Type.Literal('unfinished') }, objectOptions),
]);

const playoutStatus = Type.Union([
  Type.Object({ kind: Type.Literal('active') }, objectOptions),
  Type.Object(
    { kind: Type.Literal('awaiting_policy'), decisionId: preferenceRevision },
    objectOptions,
  ),
  Type.Object({ kind: Type.Literal('paused') }, objectOptions),
  Type.Object(
    { kind: Type.Literal('stopped'), outcome: playoutOutcome },
    objectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal('terminal'),
      reason: Type.Union([
        Type.Literal('checkmate'),
        Type.Literal('stalemate'),
        Type.Literal('insufficient_material'),
        Type.Literal('threefold_repetition'),
        Type.Literal('seventy_five_move'),
      ]),
      outcome: playoutOutcome,
    },
    objectOptions,
  ),
]);

export const PlayoutResultSchema = Type.Object(
  {
    draft: Type.Object(
      {
        draftId: localId,
        draftRevision: preferenceRevision,
        decisionGeneration: revision,
        origin: analysisOrigin,
        sourcePath: Type.Optional(
          Type.Object(
            {
              displayName: Type.String({ minLength: 1, maxLength: 200 }),
              root: chessState,
              steps: Type.Array(
                Type.Object(
                  {
                    before: chessState,
                    move: canonicalMove,
                    after: chessState,
                  },
                  objectOptions,
                ),
                { maxItems: 1_000 },
              ),
            },
            objectOptions,
          ),
        ),
        root: chessState,
        playerSide: Type.Union([Type.Literal('white'), Type.Literal('black')]),
        policy: movePolicyBinding,
        steps: Type.Array(
          Type.Object(
            {
              before: chessState,
              move: canonicalMove,
              after: chessState,
              actor: Type.Union([
                Type.Literal('user'),
                Type.Literal('provider'),
              ]),
              decisionId: Type.Optional(preferenceRevision),
            },
            objectOptions,
          ),
          { maxItems: 1_000 },
        ),
        status: playoutStatus,
      },
      objectOptions,
    ),
    legalMoves: Type.Array(canonicalMove),
    dataRevision: revision,
  },
  objectOptions,
);

export const GetPlayoutArgumentsSchema = Type.Object(
  { scope: workScope },
  objectOptions,
);

export const GetPlayoutResultSchema = Type.Object(
  { playout: Type.Optional(PlayoutResultSchema) },
  objectOptions,
);

export const StartPlayoutArgumentsSchema = Type.Object(
  {
    scope: workScope,
    start: Type.Union([
      analysisStartOrigin,
      Type.Object(
        {
          kind: Type.Literal('inventory_anchor'),
          itemId: localId,
          revisionId: localId,
          anchorId: localId,
          continuation: Type.Array(moveInput, { maxItems: 1_000 }),
        },
        objectOptions,
      ),
    ]),
    sourcePath: Type.Optional(
      Type.Object(
        {
          displayName: Type.String({ minLength: 1, maxLength: 200 }),
          rootFen: Type.String({ minLength: 1, maxLength: 128 }),
          moves: Type.Array(moveInput, { maxItems: 1_000 }),
        },
        objectOptions,
      ),
    ),
    providerInstanceId: Type.String({ minLength: 1, maxLength: 160 }),
    capability: Type.Union([
      Type.Literal('best_move'),
      Type.Literal('human_profile'),
    ]),
    opening: Type.Union([
      Type.Object(
        { kind: Type.Literal('user_move'), move: moveInput },
        objectOptions,
      ),
      Type.Object({ kind: Type.Literal('provider_move') }, objectOptions),
    ]),
  },
  objectOptions,
);

const expectedPlayoutFields = {
  scope: workScope,
  draftId: localId,
  expectedDraftRevision: preferenceRevision,
};

export const ExpectedPlayoutArgumentsSchema = Type.Object(
  expectedPlayoutFields,
  objectOptions,
);

export const SubmitPlayoutMoveArgumentsSchema = Type.Object(
  { ...expectedPlayoutFields, move: moveInput },
  objectOptions,
);

export const CompletePlayoutArgumentsSchema = Type.Object(
  {
    ...expectedPlayoutFields,
    manualResult: Type.Optional(
      Type.Union([
        Type.Literal('white_win'),
        Type.Literal('black_win'),
        Type.Literal('draw'),
        Type.Literal('unfinished'),
      ]),
    ),
    completionId: Type.String({ minLength: 1, maxLength: 160 }),
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    languageTag,
    targetContextId: Type.Optional(localId),
  },
  objectOptions,
);

export const CompletePlayoutResultSchema = Type.Object(
  {
    outcome: analysisGameOutcome,
    outcomeSource: Type.Union([
      Type.Literal('manual'),
      Type.Literal('automatic'),
    ]),
    itemId: localId,
    revisionId: localId,
    rootAnchorId: localId,
    contextReferenceId: Type.Optional(localId),
    dataRevision: revision,
  },
  objectOptions,
);

export const DiscardPlayoutResultSchema = Type.Object(
  { dataRevision: revision },
  objectOptions,
);
