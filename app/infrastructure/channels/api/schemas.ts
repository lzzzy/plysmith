import { Type, type Static } from '@sinclair/typebox';

import { ENGINE_PROVIDER_TIMEOUT_LIMITS } from '../../../../contracts/host/engine-provider-configuration.ts';

const objectOptions = { additionalProperties: false } as const;
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const positiveRevision = Type.Integer({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
const timestamp = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
});
const identifier = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^[A-Za-z0-9._:-]+$',
});
const localId = Type.String({ pattern: '^[1-9]\\d{0,15}$' });
const cursor = Type.String({ minLength: 1, maxLength: 512 });
const pageSize = Type.String({ pattern: '^(?:[1-9]|[1-9]\\d|100)$' });
const languageTag = Type.String({ minLength: 1, maxLength: 35 });

export const UiLocaleSchema = Type.Union([
  Type.Literal('de-DE'),
  Type.Literal('en-GB'),
]);

export const EmptyQuerySchema = Type.Object({}, objectOptions);

export const UserPreferencesSchema = Type.Object(
  {
    uiLocale: UiLocaleSchema,
    preferenceRevision: positiveRevision,
    dataRevision: revision,
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'UserPreferences' },
);

export const SetUiLanguageBodySchema = Type.Object(
  { uiLocale: UiLocaleSchema, expectedRevision: positiveRevision },
  { ...objectOptions, $id: 'SetUiLanguageBody' },
);

export const SetUiLanguageResultSchema = Type.Object(
  { changed: Type.Boolean(), preferences: Type.Ref(UserPreferencesSchema) },
  { ...objectOptions, $id: 'SetUiLanguageResult' },
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
      { schemaVersion: positiveRevision, dataRevision: revision },
      objectOptions,
    ),
    productRelease: Type.String({ minLength: 1 }),
    contractFingerprint: Type.String({ minLength: 1 }),
  },
  { ...objectOptions, $id: 'SystemStatus' },
);

export const DiagnosticLogLevelSchema = Type.Union(
  [
    Type.Literal('off'),
    Type.Literal('error'),
    Type.Literal('info'),
    Type.Literal('debug'),
  ],
  { $id: 'DiagnosticLogLevel' },
);

const configurationRevision = Type.String({
  pattern: '^sha256:[a-f0-9]{64}$',
});

export const DiagnosticSettingsSchema = Type.Object(
  {
    configuredLevel: Type.Ref(DiagnosticLogLevelSchema),
    activeLevel: Type.Ref(DiagnosticLogLevelSchema),
    configurationRevision,
    restartRequired: Type.Boolean(),
  },
  { ...objectOptions, $id: 'DiagnosticSettings' },
);

export const SetDiagnosticLogLevelBodySchema = Type.Object(
  {
    level: Type.Ref(DiagnosticLogLevelSchema),
    expectedConfigurationRevision: configurationRevision,
  },
  { ...objectOptions, $id: 'SetDiagnosticLogLevelBody' },
);

export const SetDiagnosticLogLevelResultSchema = Type.Object(
  {
    changed: Type.Boolean(),
    settings: Type.Ref(DiagnosticSettingsSchema),
  },
  { ...objectOptions, $id: 'SetDiagnosticLogLevelResult' },
);

const engineProviderConfigurationBase = {
  instanceId: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 80 }),
  displayName: Type.String({ minLength: 1, maxLength: 160 }),
  executablePath: Type.String({ minLength: 1, maxLength: 1_024 }),
  startupTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.startup),
  stopTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.stop),
  maxOutputBytes: Type.Integer({ minimum: 1_024, maximum: 16_777_216 }),
};

const stockfishUciEngineProviderConfiguration = {
  ...engineProviderConfigurationBase,
  providerType: Type.Literal('stockfish-uci'),
  moveTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.stockfishMove),
  arguments: Type.Array(Type.String({ maxLength: 1_024 }), { maxItems: 32 }),
  threads: Type.Integer({ minimum: 1, maximum: 256 }),
  hashMb: Type.Integer({ minimum: 1, maximum: 65_536 }),
  moveTimeMs: Type.Integer({ minimum: 10, maximum: 600_000 }),
};

export const StockfishUciEngineProviderConfigurationInputSchema = Type.Object(
  stockfishUciEngineProviderConfiguration,
  { ...objectOptions, $id: 'StockfishUciEngineProviderConfigurationInput' },
);

const maiaChessEngineProviderConfiguration = {
  ...engineProviderConfigurationBase,
  providerType: Type.Literal('maia-chess'),
  moveTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.maiaMove),
  weightsPath: Type.String({ minLength: 1, maxLength: 1_024 }),
};

export const MaiaChessEngineProviderConfigurationInputSchema = Type.Object(
  maiaChessEngineProviderConfiguration,
  { ...objectOptions, $id: 'MaiaChessEngineProviderConfigurationInput' },
);

export const EngineProviderConfigurationInputSchema = Type.Union(
  [
    Type.Ref(StockfishUciEngineProviderConfigurationInputSchema),
    Type.Ref(MaiaChessEngineProviderConfigurationInputSchema),
  ],
  { $id: 'EngineProviderConfigurationInput' },
);

const engineProviderConfigurationMetadata = {
  configurationRevision,
  effectiveFingerprint: Type.String({ minLength: 1, maxLength: 160 }),
  restartRequired: Type.Boolean(),
};

export const EngineProviderConfigurationSchema = Type.Union(
  [
    Type.Object(
      {
        ...stockfishUciEngineProviderConfiguration,
        ...engineProviderConfigurationMetadata,
      },
      objectOptions,
    ),
    Type.Object(
      {
        ...maiaChessEngineProviderConfiguration,
        ...engineProviderConfigurationMetadata,
      },
      objectOptions,
    ),
  ],
  { $id: 'EngineProviderConfiguration' },
);

export const ListEngineProviderConfigurationsResultSchema = Type.Object(
  { providers: Type.Array(Type.Ref(EngineProviderConfigurationSchema)) },
  { ...objectOptions, $id: 'ListEngineProviderConfigurationsResult' },
);

export const PreviewEngineProviderConfigurationBodySchema = Type.Ref(
  EngineProviderConfigurationInputSchema,
  { $id: 'PreviewEngineProviderConfigurationBody' },
);

export const EngineProviderConfigurationPreviewSchema = Type.Object(
  {
    valid: Type.Boolean(),
    issues: Type.Array(
      Type.Union([
        Type.Literal('executable_not_found'),
        Type.Literal('weights_not_found'),
        Type.Literal('configuration_invalid'),
      ]),
      { uniqueItems: true },
    ),
  },
  { ...objectOptions, $id: 'EngineProviderConfigurationPreview' },
);

export const SaveEngineProviderConfigurationBodySchema = Type.Object(
  {
    input: Type.Ref(EngineProviderConfigurationInputSchema),
    expectedConfigurationRevision: Type.Union([
      configurationRevision,
      Type.Null(),
    ]),
  },
  { ...objectOptions, $id: 'SaveEngineProviderConfigurationBody' },
);

export const EngineProviderInstanceParamsSchema = Type.Object(
  {
    instanceId: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 80 }),
  },
  { ...objectOptions, $id: 'EngineProviderInstanceParams' },
);

export const RemoveEngineProviderConfigurationBodySchema = Type.Object(
  { expectedConfigurationRevision: configurationRevision },
  { ...objectOptions, $id: 'RemoveEngineProviderConfigurationBody' },
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
  { ...objectOptions, $id: 'DiagnosticReportManifest' },
);

export const CreateDiagnosticReportBodySchema = Type.Object(
  {
    acceptedManifestVersion: Type.Literal(1),
    destinationPath: Type.String({ minLength: 1, maxLength: 1_024 }),
  },
  { ...objectOptions, $id: 'CreateDiagnosticReportBody' },
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
  { ...objectOptions, $id: 'CreateDiagnosticReportResult' },
);

export const WorkScopeSchema = Type.Union(
  [
    Type.Object({ kind: Type.Literal('free') }, objectOptions),
    Type.Object(
      { kind: Type.Literal('context'), contextId: localId },
      objectOptions,
    ),
  ],
  { $id: 'WorkScope' },
);

export const AnalysisNoteScopeSchema = Type.Union(
  [
    Type.Object({ kind: Type.Literal('global') }, objectOptions),
    Type.Object(
      { kind: Type.Literal('context'), contextId: localId },
      objectOptions,
    ),
  ],
  { $id: 'AnalysisNoteScope' },
);

export const CanonicalMoveSchema = Type.Object(
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
  { ...objectOptions, $id: 'CanonicalMove' },
);

export const ChessStateSchema = Type.Object(
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
        fullmoveNumber: positiveRevision,
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
  { ...objectOptions, $id: 'ChessState' },
);

export const AnalysisSetupPieceSchema = Type.Object(
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
  { ...objectOptions, $id: 'AnalysisSetupPiece' },
);

export const AnalysisSetupSchema = Type.Object(
  {
    pieces: Type.Array(Type.Ref(AnalysisSetupPieceSchema), { maxItems: 32 }),
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
    fullmoveNumber: positiveRevision,
  },
  { ...objectOptions, $id: 'AnalysisSetup' },
);

export const AnalysisSetupIssueSchema = Type.Object(
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
  { ...objectOptions, $id: 'AnalysisSetupIssue' },
);

export const ValidateAnalysisSetupBodySchema = Type.Object(
  {
    input: Type.Union([
      Type.Object(
        {
          kind: Type.Literal('position_setup'),
          setup: Type.Ref(AnalysisSetupSchema),
        },
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
  { ...objectOptions, $id: 'ValidateAnalysisSetupBody' },
);

export const ValidateAnalysisSetupResultSchema = Type.Union(
  [
    Type.Object(
      {
        valid: Type.Literal(true),
        setup: Type.Ref(AnalysisSetupSchema),
        state: Type.Ref(ChessStateSchema),
      },
      objectOptions,
    ),
    Type.Object(
      {
        valid: Type.Literal(false),
        issues: Type.Array(Type.Ref(AnalysisSetupIssueSchema), {
          minItems: 1,
          maxItems: 64,
        }),
      },
      objectOptions,
    ),
  ],
  { $id: 'ValidateAnalysisSetupResult' },
);

export const AnalysisStepSchema = Type.Object(
  {
    before: Type.Ref(ChessStateSchema),
    move: Type.Ref(CanonicalMoveSchema),
    after: Type.Ref(ChessStateSchema),
  },
  { ...objectOptions, $id: 'AnalysisStep' },
);

export const AnalysisOriginSchema = Type.Union(
  [
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
  ],
  { $id: 'AnalysisOrigin' },
);

export const InventoryRevisionModeSchema = Type.Union(
  [
    Type.Literal('extend'),
    Type.Literal('truncate_after'),
    Type.Literal('replace_move'),
    Type.Literal('metadata'),
  ],
  { $id: 'InventoryRevisionMode' },
);

export const AnalysisScratchIntentSchema = Type.Union(
  [
    Type.Object({ kind: Type.Literal('exploration') }, objectOptions),
    Type.Object(
      {
        kind: Type.Literal('inventory_revision'),
        mode: Type.Ref(InventoryRevisionModeSchema),
        itemId: localId,
        baseRevisionId: localId,
        cutAnchorId: localId,
        returnAnchorId: localId,
        displayName: Type.String({ minLength: 1, maxLength: 200 }),
        summary: Type.Optional(Type.String({ maxLength: 2_000 })),
      },
      objectOptions,
    ),
  ],
  { $id: 'AnalysisScratchIntent' },
);

export const AnalysisScratchSchema = Type.Object(
  {
    scratchId: identifier,
    scratchRevision: positiveRevision,
    origin: Type.Ref(AnalysisOriginSchema),
    intent: Type.Ref(AnalysisScratchIntentSchema),
    root: Type.Ref(ChessStateSchema),
    steps: Type.Array(Type.Ref(AnalysisStepSchema), { maxItems: 1_000 }),
    cursor: Type.Integer({ minimum: 0, maximum: 1_000 }),
    noteDraft: Type.Optional(
      Type.Object(
        {
          moves: Type.Array(Type.Ref(CanonicalMoveSchema), { maxItems: 1_000 }),
          body: Type.String({ maxLength: 8_000 }),
        },
        objectOptions,
      ),
    ),
  },
  { ...objectOptions, $id: 'AnalysisScratch' },
);

export const AnalysisContributionSchema = Type.Object(
  {
    contributionId: localId,
    anchorId: localId,
    body: Type.String({ maxLength: 8_000 }),
    moves: Type.Array(Type.Ref(CanonicalMoveSchema), { maxItems: 1_000 }),
    languageTag,
    scopeKind: Type.Union([Type.Literal('global'), Type.Literal('context')]),
    contextId: Type.Optional(localId),
    contributionVersion: positiveRevision,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'AnalysisContribution' },
);

export const AnalysisRecordStepSchema = Type.Object(
  {
    before: Type.Ref(ChessStateSchema),
    move: Type.Ref(CanonicalMoveSchema),
    after: Type.Ref(ChessStateSchema),
    anchorId: localId,
  },
  { ...objectOptions, $id: 'AnalysisRecordStep' },
);

export const AnalysisSourceLineSchema = Type.Object(
  {
    sourceItemId: localId,
    sourceRevisionId: localId,
    sourceAnchorId: localId,
    sourceDisplayName: Type.String({ minLength: 1, maxLength: 160 }),
    root: Type.Ref(ChessStateSchema),
    rootTarget: Type.Object(
      { itemId: localId, revisionId: localId, anchorId: localId },
      objectOptions,
    ),
    steps: Type.Array(
      Type.Object(
        {
          before: Type.Ref(ChessStateSchema),
          move: Type.Ref(CanonicalMoveSchema),
          after: Type.Ref(ChessStateSchema),
          anchorId: localId,
          itemId: localId,
          revisionId: localId,
        },
        objectOptions,
      ),
      { maxItems: 1_000 },
    ),
    contributions: Type.Array(Type.Ref(AnalysisContributionSchema)),
  },
  { ...objectOptions, $id: 'AnalysisSourceLine' },
);

const analysisRecordGameOutcome = Type.Union([
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

export const HumanMovePolicyProfileSchema = Type.Object(
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
  { ...objectOptions, $id: 'HumanMovePolicyProfile' },
);

const movePolicyBindingBase = {
  providerInstanceId: identifier,
  providerFingerprint: Type.String({ minLength: 1, maxLength: 160 }),
  providerType: identifier,
  providerDisplayName: Type.String({ minLength: 1, maxLength: 160 }),
};

export const MovePolicyBindingSchema = Type.Union(
  [
    Type.Object(
      { ...movePolicyBindingBase, capability: Type.Literal('best_move') },
      objectOptions,
    ),
    Type.Object(
      {
        ...movePolicyBindingBase,
        capability: Type.Literal('human_profile'),
        profile: Type.Ref(HumanMovePolicyProfileSchema),
      },
      objectOptions,
    ),
  ],
  { $id: 'MovePolicyBinding' },
);

export const AnalysisRecordSchema = Type.Object(
  {
    itemType: Type.Union([Type.Literal('analysis'), Type.Literal('game')]),
    itemId: localId,
    revisionId: localId,
    currentRevisionId: localId,
    revisionNumber: positiveRevision,
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
          outcome: analysisRecordGameOutcome,
          policy: Type.Ref(MovePolicyBindingSchema),
        },
        objectOptions,
      ),
    ),
    origin: Type.Ref(AnalysisOriginSchema),
    sourceLine: Type.Optional(Type.Ref(AnalysisSourceLineSchema)),
    root: Type.Ref(ChessStateSchema),
    steps: Type.Array(Type.Ref(AnalysisRecordStepSchema), { maxItems: 1_000 }),
    cursor: Type.Integer({ minimum: 0, maximum: 1_000 }),
    contributions: Type.Array(Type.Ref(AnalysisContributionSchema)),
    contextMember: Type.Boolean(),
    readOnlyPreview: Type.Boolean(),
    historical: Type.Boolean(),
  },
  { ...objectOptions, $id: 'AnalysisRecord' },
);

export const AnalysisWorkspaceSchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    dataRevision: revision,
    contextName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    resumeVersion: Type.Optional(positiveRevision),
    scratch: Type.Optional(Type.Ref(AnalysisScratchSchema)),
    record: Type.Optional(Type.Ref(AnalysisRecordSchema)),
    currentState: Type.Ref(ChessStateSchema),
    legalMoves: Type.Array(Type.Ref(CanonicalMoveSchema)),
    allowedActions: Type.Array(
      Type.Union([
        Type.Literal('start_scratch'),
        Type.Literal('apply_move'),
        Type.Literal('move_cursor'),
        Type.Literal('remove_last_move'),
        Type.Literal('prepare_note'),
        Type.Literal('clear_note'),
        Type.Literal('discard_scratch'),
        Type.Literal('create_analysis_note'),
        Type.Literal('create_analysis_record'),
      ]),
    ),
  },
  { ...objectOptions, $id: 'AnalysisWorkspace' },
);

export const GetAnalysisWorkspaceQuerySchema = Type.Object(
  {
    scopeKind: Type.Union([Type.Literal('free'), Type.Literal('context')]),
    contextId: Type.Optional(localId),
    mode: Type.Optional(
      Type.Union([Type.Literal('current'), Type.Literal('initial_position')]),
    ),
    itemId: Type.Optional(localId),
    revisionId: Type.Optional(localId),
    anchorId: Type.Optional(localId),
  },
  { ...objectOptions, $id: 'GetAnalysisWorkspaceQuery' },
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
      locale: UiLocaleSchema,
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
      kind: Type.Literal('position_setup'),
      setup: Type.Ref(AnalysisSetupSchema),
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

export const UpdateAnalysisScratchBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    expectedScratchId: Type.Union([identifier, Type.Null()]),
    expectedScratchRevision: Type.Union([positiveRevision, Type.Null()]),
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
      Type.Object({ kind: Type.Literal('discard') }, objectOptions),
    ]),
  },
  { ...objectOptions, $id: 'UpdateAnalysisScratchBody' },
);

export const UpdateAnalysisScratchResultSchema = Type.Object(
  {
    scratch: Type.Optional(Type.Ref(AnalysisScratchSchema)),
    discarded: Type.Boolean(),
    dataRevision: revision,
    resumeVersion: Type.Optional(positiveRevision),
  },
  { ...objectOptions, $id: 'UpdateAnalysisScratchResult' },
);

export const CreateAnalysisRecordBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    expectedScratchId: identifier,
    expectedScratchRevision: positiveRevision,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    languageTag,
    targetContextId: Type.Optional(localId),
    noteScope: Type.Optional(Type.Ref(AnalysisNoteScopeSchema)),
  },
  { ...objectOptions, $id: 'CreateAnalysisRecordBody' },
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
        { contextId: localId, resumeVersion: positiveRevision },
        objectOptions,
      ),
    ),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'CreateAnalysisRecordResult' },
);

export const MovePolicyProviderSchema = Type.Object(
  {
    instanceId: identifier,
    providerType: identifier,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    fingerprint: Type.String({ minLength: 1, maxLength: 160 }),
    capabilities: Type.Array(
      Type.Union([Type.Literal('best_move'), Type.Literal('human_profile')]),
      { maxItems: 1, uniqueItems: true },
    ),
    profile: Type.Optional(Type.Ref(HumanMovePolicyProfileSchema)),
    readiness: Type.Union([
      Type.Literal('cold'),
      Type.Literal('warming_up'),
      Type.Literal('ready'),
    ]),
    status: Type.Union([
      Type.Literal('available'),
      Type.Literal('unavailable'),
    ]),
    problemCode: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  },
  { ...objectOptions, $id: 'MovePolicyProvider' },
);

export const ListMovePolicyProvidersResultSchema = Type.Object(
  {
    providers: Type.Array(Type.Ref(MovePolicyProviderSchema), { maxItems: 32 }),
  },
  { ...objectOptions, $id: 'ListMovePolicyProvidersResult' },
);

export const PositionAnalysisProviderSchema = Type.Object(
  {
    instanceId: identifier,
    providerType: identifier,
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
    problemCode: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  },
  { ...objectOptions, $id: 'PositionAnalysisProvider' },
);

export const ListPositionAnalysisProvidersResultSchema = Type.Object(
  {
    providers: Type.Array(Type.Ref(PositionAnalysisProviderSchema), {
      maxItems: 32,
    }),
  },
  { ...objectOptions, $id: 'ListPositionAnalysisProvidersResult' },
);

const objectiveAnalysisBudget = Type.Union([
  Type.Literal('fast'),
  Type.Literal('thorough'),
  Type.Literal('very_deep'),
]);

export const AnalyzePositionBodySchema = Type.Object(
  {
    consumerId: Type.String({ minLength: 1, maxLength: 128 }),
    laneId: Type.String({ minLength: 1, maxLength: 128 }),
    providerInstanceId: identifier,
    candidateCount: Type.Integer({ minimum: 1, maximum: 8 }),
    focus: Type.Object(
      {
        focusKey: Type.String({ minLength: 1, maxLength: 256 }),
        root: Type.Ref(ChessStateSchema),
        moves: Type.Array(Type.Ref(CanonicalMoveSchema), { maxItems: 1_000 }),
        current: Type.Ref(ChessStateSchema),
      },
      objectOptions,
    ),
    mode: Type.Union([
      Type.Object(
        { kind: Type.Literal('objective'), budget: objectiveAnalysisBudget },
        objectOptions,
      ),
      Type.Object({ kind: Type.Literal('human_policy') }, objectOptions),
    ]),
  },
  { ...objectOptions, $id: 'AnalyzePositionBody' },
);

export const AnalysisWdlSchema = Type.Object(
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
  { ...objectOptions, $id: 'AnalysisWdl' },
);

const objectiveEvaluation = Type.Union([
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
]);

const positionAnalysisSnapshotBase = {
  focusKey: Type.String({ minLength: 1, maxLength: 256 }),
  providerInstanceId: identifier,
  providerDisplayName: Type.String({ minLength: 1, maxLength: 160 }),
  historyCompleteness: Type.Union([
    Type.Literal('complete'),
    Type.Literal('partial'),
    Type.Literal('unknown'),
  ]),
};

export const PositionAnalysisSnapshotSchema = Type.Union(
  [
    Type.Object(
      {
        ...positionAnalysisSnapshotBase,
        kind: Type.Literal('objective'),
        budget: objectiveAnalysisBudget,
        rootWdl: Type.Optional(Type.Ref(AnalysisWdlSchema)),
        candidates: Type.Array(
          Type.Object(
            {
              rank: Type.Integer({ minimum: 1, maximum: 8 }),
              move: Type.Ref(CanonicalMoveSchema),
              evaluation: objectiveEvaluation,
              wdl: Type.Optional(Type.Ref(AnalysisWdlSchema)),
              principalVariation: Type.Array(Type.Ref(CanonicalMoveSchema), {
                maxItems: 32,
              }),
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
        rootWdl: Type.Optional(Type.Ref(AnalysisWdlSchema)),
        candidates: Type.Array(
          Type.Object(
            {
              rank: Type.Integer({ minimum: 1, maximum: 8 }),
              move: Type.Ref(CanonicalMoveSchema),
              policyPercent: Type.Number({ minimum: 0, maximum: 100 }),
              wdl: Type.Ref(AnalysisWdlSchema),
            },
            objectOptions,
          ),
          { maxItems: 8 },
        ),
      },
      objectOptions,
    ),
  ],
  { $id: 'PositionAnalysisSnapshot' },
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

const terminalReason = Type.Union([
  Type.Literal('checkmate'),
  Type.Literal('stalemate'),
  Type.Literal('insufficient_material'),
  Type.Literal('threefold_repetition'),
  Type.Literal('seventy_five_move'),
]);

export const PlayoutStatusSchema = Type.Union(
  [
    Type.Object({ kind: Type.Literal('active') }, objectOptions),
    Type.Object(
      { kind: Type.Literal('awaiting_policy'), decisionId: positiveRevision },
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
        reason: terminalReason,
        outcome: playoutOutcome,
      },
      objectOptions,
    ),
  ],
  { $id: 'PlayoutStatus' },
);

export const PlayoutStepSchema = Type.Object(
  {
    before: Type.Ref(ChessStateSchema),
    move: Type.Ref(CanonicalMoveSchema),
    after: Type.Ref(ChessStateSchema),
    actor: Type.Union([Type.Literal('user'), Type.Literal('provider')]),
    decisionId: Type.Optional(positiveRevision),
  },
  { ...objectOptions, $id: 'PlayoutStep' },
);

export const PlayoutSourcePathSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    root: Type.Ref(ChessStateSchema),
    steps: Type.Array(
      Type.Object(
        {
          before: Type.Ref(ChessStateSchema),
          move: Type.Ref(CanonicalMoveSchema),
          after: Type.Ref(ChessStateSchema),
        },
        objectOptions,
      ),
      { maxItems: 1_000 },
    ),
  },
  { ...objectOptions, $id: 'PlayoutSourcePath' },
);

export const PlayoutDraftSchema = Type.Object(
  {
    draftId: localId,
    draftRevision: positiveRevision,
    decisionGeneration: revision,
    origin: Type.Ref(AnalysisOriginSchema),
    sourcePath: Type.Optional(Type.Ref(PlayoutSourcePathSchema)),
    root: Type.Ref(ChessStateSchema),
    playerSide: Type.Union([Type.Literal('white'), Type.Literal('black')]),
    policy: Type.Ref(MovePolicyBindingSchema),
    steps: Type.Array(Type.Ref(PlayoutStepSchema), { maxItems: 1_000 }),
    status: Type.Ref(PlayoutStatusSchema),
  },
  { ...objectOptions, $id: 'PlayoutDraft' },
);

export const PlayoutResultSchema = Type.Object(
  {
    draft: Type.Ref(PlayoutDraftSchema),
    legalMoves: Type.Array(Type.Ref(CanonicalMoveSchema)),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'PlayoutResult' },
);

export const GetPlayoutQuerySchema = Type.Object(
  {
    scopeKind: Type.Union([Type.Literal('free'), Type.Literal('context')]),
    contextId: Type.Optional(localId),
  },
  { ...objectOptions, $id: 'GetPlayoutQuery' },
);

export const GetPlayoutResultSchema = Type.Union(
  [Type.Ref(PlayoutResultSchema), Type.Null()],
  { $id: 'GetPlayoutResult' },
);

export const StartPlayoutBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    start: analysisStartOrigin,
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
    providerInstanceId: identifier,
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
  { ...objectOptions, $id: 'StartPlayoutBody' },
);

const expectedPlayoutFields = {
  scope: Type.Ref(WorkScopeSchema),
  draftId: localId,
  expectedDraftRevision: positiveRevision,
};

export const ExpectedPlayoutBodySchema = Type.Object(expectedPlayoutFields, {
  ...objectOptions,
  $id: 'ExpectedPlayoutBody',
});

export const SubmitPlayoutMoveBodySchema = Type.Object(
  { ...expectedPlayoutFields, move: moveInput },
  { ...objectOptions, $id: 'SubmitPlayoutMoveBody' },
);

export const CompletePlayoutBodySchema = Type.Object(
  {
    ...expectedPlayoutFields,
    completionId: identifier,
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    languageTag,
    targetContextId: Type.Optional(localId),
  },
  { ...objectOptions, $id: 'CompletePlayoutBody' },
);

export const CompletePlayoutResultSchema = Type.Object(
  {
    itemId: localId,
    revisionId: localId,
    rootAnchorId: localId,
    contextReferenceId: Type.Optional(localId),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'CompletePlayoutResult' },
);

export const DiscardPlayoutResultSchema = Type.Object(
  { dataRevision: revision },
  { ...objectOptions, $id: 'DiscardPlayoutResult' },
);

export const CreateAnalysisNoteBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    expectedScratchId: identifier,
    expectedScratchRevision: positiveRevision,
    languageTag,
    noteScope: Type.Ref(AnalysisNoteScopeSchema),
  },
  { ...objectOptions, $id: 'CreateAnalysisNoteBody' },
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
        { contextId: localId, resumeVersion: positiveRevision },
        objectOptions,
      ),
    ),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'CreateAnalysisNoteResult' },
);

export const ContributionIdParamsSchema = Type.Object(
  { contributionId: localId },
  { ...objectOptions, $id: 'ContributionIdParams' },
);

export const CreatePositionNoteBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    itemId: localId,
    revisionId: localId,
    anchorId: localId,
    body: Type.String({ minLength: 1, maxLength: 8_000 }),
    languageTag,
    noteScope: Type.Ref(AnalysisNoteScopeSchema),
  },
  { ...objectOptions, $id: 'CreatePositionNoteBody' },
);

export const UpdateAnalysisNoteBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    expectedContributionVersion: positiveRevision,
    body: Type.String({ minLength: 1, maxLength: 8_000 }),
  },
  { ...objectOptions, $id: 'UpdateAnalysisNoteBody' },
);

export const DeleteAnalysisNoteBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    expectedContributionVersion: positiveRevision,
  },
  { ...objectOptions, $id: 'DeleteAnalysisNoteBody' },
);

export const AnalysisNoteMutationResultSchema = Type.Object(
  {
    contributionId: localId,
    itemId: localId,
    anchorId: localId,
    contributionVersion: positiveRevision,
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'AnalysisNoteMutationResult' },
);

export const InventorySearchQuerySchema = Type.Object(
  {
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    contextId: Type.Optional(localId),
    pageSize: Type.Optional(pageSize),
    cursor: Type.Optional(cursor),
  },
  { ...objectOptions, $id: 'InventorySearchQuery' },
);

export const InventorySearchItemSchema = Type.Object(
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
  { ...objectOptions, $id: 'InventorySearchItem' },
);

export const SearchInventoryResultSchema = Type.Object(
  {
    items: Type.Array(Type.Ref(InventorySearchItemSchema)),
    nextCursor: Type.Optional(cursor),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'SearchInventoryResult' },
);

export const InventoryItemIdParamsSchema = Type.Object(
  { itemId: localId },
  { ...objectOptions, $id: 'InventoryItemIdParams' },
);

export const InventoryRevisionParamsSchema = Type.Object(
  { itemId: localId, revisionId: localId },
  { ...objectOptions, $id: 'InventoryRevisionParams' },
);

export const InventoryRevisionReadQuerySchema = Type.Object(
  {
    scopeKind: Type.Union([Type.Literal('free'), Type.Literal('context')]),
    contextId: Type.Optional(localId),
    anchorId: Type.Optional(localId),
  },
  { ...objectOptions, $id: 'InventoryRevisionReadQuery' },
);

export const StartInventoryRevisionBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    baseRevisionId: localId,
    anchorId: localId,
    mode: Type.Ref(InventoryRevisionModeSchema),
    expectedScratchId: Type.Union([identifier, Type.Null()]),
    expectedScratchRevision: Type.Union([positiveRevision, Type.Null()]),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    summary: Type.Optional(
      Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
    ),
    firstMove: Type.Optional(moveInput),
  },
  { ...objectOptions, $id: 'StartInventoryRevisionBody' },
);

export const StartInventoryRevisionResultSchema = Type.Object(
  {
    scratch: Type.Ref(AnalysisScratchSchema),
    dataRevision: revision,
    resumeVersion: Type.Optional(positiveRevision),
  },
  { ...objectOptions, $id: 'StartInventoryRevisionResult' },
);

export const PromoteAnalysisToInventoryRevisionBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    baseRevisionId: localId,
    anchorId: localId,
    expectedScratchId: identifier,
    expectedScratchRevision: positiveRevision,
  },
  { ...objectOptions, $id: 'PromoteAnalysisToInventoryRevisionBody' },
);

export const InventoryRevisionScratchBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    expectedScratchId: identifier,
    expectedScratchRevision: positiveRevision,
  },
  { ...objectOptions, $id: 'InventoryRevisionScratchBody' },
);

export const InventoryRevisionContextImpactSummarySchema = Type.Object(
  {
    contextId: localId,
    contextName: Type.String({ minLength: 1, maxLength: 160 }),
    referenceCount: revision,
    contributionCount: revision,
    managementResumeCount: revision,
    analysisResumeCount: revision,
  },
  { ...objectOptions, $id: 'InventoryRevisionContextImpactSummary' },
);

export const InventoryRevisionFollowingContextSummarySchema = Type.Object(
  {
    contextId: localId,
    contextName: Type.String({ minLength: 1, maxLength: 160 }),
    updatedAutomatically: Type.Boolean(),
    referenceCount: revision,
    contributionCount: revision,
    managementResumeCount: revision,
    analysisResumeCount: revision,
  },
  { ...objectOptions, $id: 'InventoryRevisionFollowingContextSummary' },
);

export const InventoryRevisionPreviewSchema = Type.Object(
  {
    itemId: localId,
    baseRevisionId: localId,
    mode: Type.Ref(InventoryRevisionModeSchema),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    preservedMoveCount: revision,
    addedSteps: Type.Array(Type.Ref(AnalysisStepSchema), { maxItems: 1_000 }),
    removedSteps: Type.Array(Type.Ref(AnalysisStepSchema), { maxItems: 1_000 }),
    historicalGlobalContributionCount: revision,
    affectedContexts: Type.Array(
      Type.Ref(InventoryRevisionContextImpactSummarySchema),
    ),
    followingContexts: Type.Array(
      Type.Ref(InventoryRevisionFollowingContextSummarySchema),
    ),
    noOp: Type.Boolean(),
    previewFingerprint: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'InventoryRevisionPreview' },
);

export const SaveInventoryRevisionBodySchema = Type.Object(
  {
    scope: Type.Ref(WorkScopeSchema),
    expectedScratchId: identifier,
    expectedScratchRevision: positiveRevision,
    previewFingerprint: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
  },
  { ...objectOptions, $id: 'SaveInventoryRevisionBody' },
);

export const SaveInventoryRevisionResultSchema = Type.Object(
  {
    itemId: localId,
    revisionId: localId,
    revisionNumber: positiveRevision,
    currentAnchorId: localId,
    impacts: Type.Array(
      Type.Object({ impactId: localId, contextId: localId }, objectOptions),
    ),
    noOp: Type.Boolean(),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'SaveInventoryRevisionResult' },
);

export const InventoryRevisionSummarySchema = Type.Object(
  {
    itemId: localId,
    revisionId: localId,
    revisionNumber: positiveRevision,
    baseRevisionId: Type.Optional(localId),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    changeKind: Type.Union([
      Type.Literal('created'),
      Type.Ref(InventoryRevisionModeSchema),
    ]),
    createdAt: timestamp,
    current: Type.Boolean(),
  },
  { ...objectOptions, $id: 'InventoryRevisionSummary' },
);

export const ListInventoryRevisionsResultSchema = Type.Object(
  {
    revisions: Type.Array(Type.Ref(InventoryRevisionSummarySchema)),
    nextCursor: Type.Optional(cursor),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'ListInventoryRevisionsResult' },
);

export const RevisionImpactIdParamsSchema = Type.Object(
  { impactId: localId },
  { ...objectOptions, $id: 'RevisionImpactIdParams' },
);

export const PendingRevisionImpactSchema = Type.Object(
  {
    impactId: localId,
    contextId: localId,
    contextName: Type.String({ minLength: 1, maxLength: 160 }),
    itemId: localId,
    pinnedRevisionId: localId,
    targetRevisionId: localId,
    targetAnchorId: localId,
    impactVersion: positiveRevision,
    referenceCount: revision,
    contributionCount: revision,
    managementResumeAffected: Type.Boolean(),
    analysisResumeAffected: Type.Boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'PendingRevisionImpact' },
);

export const ResolvePendingRevisionImpactBodySchema = Type.Object(
  {
    expectedImpactVersion: positiveRevision,
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
  { ...objectOptions, $id: 'ResolvePendingRevisionImpactBody' },
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
  { ...objectOptions, $id: 'ResolvePendingRevisionImpactResult' },
);

export const PageQuerySchema = Type.Object(
  { pageSize: Type.Optional(pageSize), cursor: Type.Optional(cursor) },
  { ...objectOptions, $id: 'PageQuery' },
);

export const ContextIdParamsSchema = Type.Object(
  { contextId: localId },
  { ...objectOptions, $id: 'ContextIdParams' },
);

export const ContextItemParamsSchema = Type.Object(
  { contextId: localId, itemId: localId },
  { ...objectOptions, $id: 'ContextItemParams' },
);

export const WorkingContextSummarySchema = Type.Object(
  {
    contextId: localId,
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    boundary: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    nextStep: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    lifecycle: Type.Union([Type.Literal('active'), Type.Literal('archived')]),
    pinnedOrder: Type.Optional(revision),
    contextVersion: positiveRevision,
    referenceCount: revision,
    pendingRevisionImpactCount: revision,
    managementResumeVersion: Type.Optional(positiveRevision),
    analysisResumeVersion: Type.Optional(positiveRevision),
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'WorkingContextSummary' },
);

export const ListWorkingContextsResultSchema = Type.Object(
  {
    contexts: Type.Array(Type.Ref(WorkingContextSummarySchema)),
    nextCursor: Type.Optional(cursor),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'ListWorkingContextsResult' },
);

export const ContextReferenceSummarySchema = Type.Object(
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
  { ...objectOptions, $id: 'ContextReferenceSummary' },
);

export const ManagementResumeSchema = Type.Object(
  {
    resumeVersion: positiveRevision,
    presentation: Type.Union([Type.Literal('list'), Type.Literal('atlas')]),
    selectedItemId: Type.Optional(localId),
    selectedAnchorId: Type.Optional(localId),
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'ManagementResume' },
);

export const AnalysisResumeSchema = Type.Object(
  {
    resumeVersion: positiveRevision,
    mode: Type.Union([
      Type.Literal('analyze'),
      Type.Literal('edit_inventory'),
      Type.Literal('edit_overlay'),
    ]),
    itemId: Type.Optional(localId),
    revisionId: Type.Optional(localId),
    anchorId: Type.Optional(localId),
    currentPositionId: localId,
    scratchId: Type.Optional(identifier),
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'AnalysisResume' },
);

export const WorkingContextRevisionImpactSummarySchema = Type.Object(
  {
    impactId: localId,
    itemId: localId,
    pinnedRevisionId: localId,
    targetRevisionId: localId,
    impactVersion: positiveRevision,
    entryCount: positiveRevision,
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'WorkingContextRevisionImpactSummary' },
);

export const WorkingContextWorkspaceSchema = Type.Object(
  {
    context: Type.Ref(WorkingContextSummarySchema),
    references: Type.Array(Type.Ref(ContextReferenceSummarySchema)),
    pendingRevisionImpacts: Type.Array(
      Type.Ref(WorkingContextRevisionImpactSummarySchema),
    ),
    managementResume: Type.Optional(Type.Ref(ManagementResumeSchema)),
    analysisResume: Type.Optional(Type.Ref(AnalysisResumeSchema)),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'WorkingContextWorkspace' },
);

export const CreateWorkingContextBodySchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    boundary: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    nextStep: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { ...objectOptions, $id: 'CreateWorkingContextBody' },
);

export const CreateWorkingContextResultSchema = Type.Object(
  { context: Type.Ref(WorkingContextSummarySchema), dataRevision: revision },
  { ...objectOptions, $id: 'CreateWorkingContextResult' },
);

export const AddContextReferenceBodySchema = Type.Object(
  { itemId: localId, anchorId: localId },
  { ...objectOptions, $id: 'AddContextReferenceBody' },
);

export const AddContextReferenceResultSchema = Type.Object(
  {
    reference: Type.Ref(ContextReferenceSummarySchema),
    dataRevision: revision,
  },
  { ...objectOptions, $id: 'AddContextReferenceResult' },
);

export const RemoveContextItemResultSchema = Type.Object(
  { contextId: localId, itemId: localId, dataRevision: revision },
  { ...objectOptions, $id: 'RemoveContextItemResult' },
);

export const SetWorkScopeResumeBodySchema = Type.Union(
  [
    Type.Object(
      {
        area: Type.Literal('manage'),
        expectedResumeVersion: Type.Union([positiveRevision, Type.Null()]),
        presentation: Type.Union([Type.Literal('list'), Type.Literal('atlas')]),
        selectedItemId: Type.Optional(localId),
        selectedAnchorId: Type.Optional(localId),
      },
      objectOptions,
    ),
    Type.Object(
      {
        area: Type.Literal('analyze'),
        expectedResumeVersion: Type.Union([positiveRevision, Type.Null()]),
        mode: Type.Union([
          Type.Literal('analyze'),
          Type.Literal('edit_inventory'),
          Type.Literal('edit_overlay'),
        ]),
        itemId: Type.Optional(localId),
        revisionId: Type.Optional(localId),
        anchorId: Type.Optional(localId),
      },
      objectOptions,
    ),
  ],
  { $id: 'SetWorkScopeResumeBody' },
);

export const SetWorkScopeResumeResultSchema = Type.Union(
  [
    Type.Object(
      {
        area: Type.Literal('manage'),
        resume: Type.Ref(ManagementResumeSchema),
        dataRevision: revision,
      },
      objectOptions,
    ),
    Type.Object(
      {
        area: Type.Literal('analyze'),
        resume: Type.Ref(AnalysisResumeSchema),
        dataRevision: revision,
      },
      objectOptions,
    ),
  ],
  { $id: 'SetWorkScopeResumeResult' },
);

export const ProblemDetailsSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.String(),
    instance: Type.String(),
    code: Type.String(),
    correlationId: identifier,
    retryable: Type.Boolean(),
    parameters: Type.Object(
      {
        expectedRevision: Type.Optional(revision),
        currentRevision: Type.Optional(revision),
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'ProblemDetails' },
);

const eventMetadata = {
  eventId: identifier,
  sequence: revision,
  dataRevision: revision,
  occurredAt: timestamp,
  subscriptionRevision: positiveRevision,
  correlationId: identifier,
};

export const UiLanguageChangedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('preference.ui-language-changed'),
    preferenceRevision: positiveRevision,
    payload: Type.Object(
      { previousUiLocale: UiLocaleSchema, uiLocale: UiLocaleSchema },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'UiLanguageChangedEvent' },
);

export const AnalysisScratchChangedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('analysis.scratch-changed'),
    payload: Type.Object(
      {
        scope: Type.Ref(WorkScopeSchema),
        scratchId: Type.Optional(identifier),
        scratchRevision: Type.Optional(positiveRevision),
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'AnalysisScratchChangedEvent' },
);

export const AnalysisContributionCreatedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('analysis.contribution-created'),
    payload: Type.Object(
      { itemId: localId, contributionId: localId },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'AnalysisContributionCreatedEvent' },
);

export const AnalysisContributionChangedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('analysis.contribution-changed'),
    payload: Type.Object(
      {
        itemId: localId,
        contributionId: localId,
        changeKind: Type.Union([
          Type.Literal('updated'),
          Type.Literal('deleted'),
        ]),
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'AnalysisContributionChangedEvent' },
);

export const InventoryItemCreatedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('inventory.item-created'),
    payload: Type.Object(
      { itemId: localId, revisionId: localId },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'InventoryItemCreatedEvent' },
);

export const InventoryRevisionSavedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('inventory.revision-saved'),
    payload: Type.Object(
      { itemId: localId, revisionId: localId },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'InventoryRevisionSavedEvent' },
);

export const PlayoutChangedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('playout.changed'),
    payload: Type.Object(
      {
        scope: Type.Ref(WorkScopeSchema),
        draftId: localId,
        draftRevision: positiveRevision,
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'PlayoutChangedEvent' },
);

export const WorkspaceRevisionImpactChangedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('workspace.revision-impact-changed'),
    payload: Type.Object(
      {
        contextId: localId,
        itemId: localId,
        impactId: localId,
        status: Type.Union([Type.Literal('open'), Type.Literal('resolved')]),
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'WorkspaceRevisionImpactChangedEvent' },
);

export const WorkspaceContextCreatedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('workspace.context-created'),
    payload: Type.Object(
      { contextId: localId, contextVersion: positiveRevision },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'WorkspaceContextCreatedEvent' },
);

export const WorkspaceReferenceAddedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('workspace.reference-added'),
    payload: Type.Object(
      { contextId: localId, referenceId: localId },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'WorkspaceReferenceAddedEvent' },
);

export const WorkspaceItemRemovedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('workspace.item-removed'),
    payload: Type.Object(
      { contextId: localId, itemId: localId },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'WorkspaceItemRemovedEvent' },
);

export const WorkspaceResumeUpdatedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('workspace.resume-updated'),
    payload: Type.Object(
      {
        contextId: localId,
        area: Type.Union([Type.Literal('manage'), Type.Literal('analyze')]),
        resumeVersion: positiveRevision,
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'WorkspaceResumeUpdatedEvent' },
);

export const ReplayGapEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('host.replay-gap'),
    payload: Type.Object(
      {
        reason: Type.Union([
          Type.Literal('replay_unavailable'),
          Type.Literal('slow_consumer'),
        ]),
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'ReplayGapEvent' },
);

export const HostEventSchema = Type.Union(
  [
    Type.Ref(UiLanguageChangedEventSchema),
    Type.Ref(AnalysisScratchChangedEventSchema),
    Type.Ref(AnalysisContributionCreatedEventSchema),
    Type.Ref(AnalysisContributionChangedEventSchema),
    Type.Ref(InventoryItemCreatedEventSchema),
    Type.Ref(InventoryRevisionSavedEventSchema),
    Type.Ref(PlayoutChangedEventSchema),
    Type.Ref(WorkspaceRevisionImpactChangedEventSchema),
    Type.Ref(WorkspaceContextCreatedEventSchema),
    Type.Ref(WorkspaceReferenceAddedEventSchema),
    Type.Ref(WorkspaceItemRemovedEventSchema),
    Type.Ref(WorkspaceResumeUpdatedEventSchema),
    Type.Ref(ReplayGapEventSchema),
  ],
  { $id: 'HostEvent' },
);

export const EventHeadersSchema = Type.Object(
  { 'last-event-id': Type.Optional(identifier) },
  objectOptions,
);

export const apiSchemas = [
  UserPreferencesSchema,
  SetUiLanguageBodySchema,
  SetUiLanguageResultSchema,
  SystemStatusSchema,
  DiagnosticLogLevelSchema,
  DiagnosticSettingsSchema,
  SetDiagnosticLogLevelBodySchema,
  SetDiagnosticLogLevelResultSchema,
  StockfishUciEngineProviderConfigurationInputSchema,
  MaiaChessEngineProviderConfigurationInputSchema,
  EngineProviderConfigurationInputSchema,
  EngineProviderConfigurationSchema,
  ListEngineProviderConfigurationsResultSchema,
  PreviewEngineProviderConfigurationBodySchema,
  EngineProviderConfigurationPreviewSchema,
  SaveEngineProviderConfigurationBodySchema,
  EngineProviderInstanceParamsSchema,
  RemoveEngineProviderConfigurationBodySchema,
  DiagnosticReportManifestSchema,
  CreateDiagnosticReportBodySchema,
  CreateDiagnosticReportResultSchema,
  WorkScopeSchema,
  AnalysisNoteScopeSchema,
  CanonicalMoveSchema,
  ChessStateSchema,
  AnalysisSetupPieceSchema,
  AnalysisSetupSchema,
  AnalysisSetupIssueSchema,
  ValidateAnalysisSetupBodySchema,
  ValidateAnalysisSetupResultSchema,
  AnalysisStepSchema,
  AnalysisOriginSchema,
  InventoryRevisionModeSchema,
  AnalysisScratchIntentSchema,
  AnalysisScratchSchema,
  AnalysisContributionSchema,
  AnalysisRecordStepSchema,
  AnalysisSourceLineSchema,
  AnalysisRecordSchema,
  AnalysisWorkspaceSchema,
  GetAnalysisWorkspaceQuerySchema,
  UpdateAnalysisScratchBodySchema,
  UpdateAnalysisScratchResultSchema,
  CreateAnalysisRecordBodySchema,
  CreateAnalysisRecordResultSchema,
  HumanMovePolicyProfileSchema,
  MovePolicyBindingSchema,
  MovePolicyProviderSchema,
  ListMovePolicyProvidersResultSchema,
  PositionAnalysisProviderSchema,
  ListPositionAnalysisProvidersResultSchema,
  AnalyzePositionBodySchema,
  AnalysisWdlSchema,
  PositionAnalysisSnapshotSchema,
  PlayoutStatusSchema,
  PlayoutStepSchema,
  PlayoutSourcePathSchema,
  PlayoutDraftSchema,
  PlayoutResultSchema,
  GetPlayoutQuerySchema,
  GetPlayoutResultSchema,
  StartPlayoutBodySchema,
  ExpectedPlayoutBodySchema,
  SubmitPlayoutMoveBodySchema,
  CompletePlayoutBodySchema,
  CompletePlayoutResultSchema,
  DiscardPlayoutResultSchema,
  CreateAnalysisNoteBodySchema,
  CreateAnalysisNoteResultSchema,
  ContributionIdParamsSchema,
  CreatePositionNoteBodySchema,
  UpdateAnalysisNoteBodySchema,
  DeleteAnalysisNoteBodySchema,
  AnalysisNoteMutationResultSchema,
  InventorySearchQuerySchema,
  InventorySearchItemSchema,
  SearchInventoryResultSchema,
  InventoryItemIdParamsSchema,
  InventoryRevisionParamsSchema,
  InventoryRevisionReadQuerySchema,
  StartInventoryRevisionBodySchema,
  StartInventoryRevisionResultSchema,
  PromoteAnalysisToInventoryRevisionBodySchema,
  InventoryRevisionScratchBodySchema,
  InventoryRevisionContextImpactSummarySchema,
  InventoryRevisionFollowingContextSummarySchema,
  InventoryRevisionPreviewSchema,
  SaveInventoryRevisionBodySchema,
  SaveInventoryRevisionResultSchema,
  InventoryRevisionSummarySchema,
  ListInventoryRevisionsResultSchema,
  RevisionImpactIdParamsSchema,
  PendingRevisionImpactSchema,
  ResolvePendingRevisionImpactBodySchema,
  ResolvePendingRevisionImpactResultSchema,
  PageQuerySchema,
  ContextIdParamsSchema,
  ContextItemParamsSchema,
  WorkingContextSummarySchema,
  ListWorkingContextsResultSchema,
  ContextReferenceSummarySchema,
  ManagementResumeSchema,
  AnalysisResumeSchema,
  WorkingContextRevisionImpactSummarySchema,
  WorkingContextWorkspaceSchema,
  CreateWorkingContextBodySchema,
  CreateWorkingContextResultSchema,
  AddContextReferenceBodySchema,
  AddContextReferenceResultSchema,
  RemoveContextItemResultSchema,
  SetWorkScopeResumeBodySchema,
  SetWorkScopeResumeResultSchema,
  ProblemDetailsSchema,
  UiLanguageChangedEventSchema,
  AnalysisScratchChangedEventSchema,
  AnalysisContributionCreatedEventSchema,
  AnalysisContributionChangedEventSchema,
  InventoryItemCreatedEventSchema,
  InventoryRevisionSavedEventSchema,
  PlayoutChangedEventSchema,
  WorkspaceRevisionImpactChangedEventSchema,
  WorkspaceContextCreatedEventSchema,
  WorkspaceReferenceAddedEventSchema,
  WorkspaceItemRemovedEventSchema,
  WorkspaceResumeUpdatedEventSchema,
  ReplayGapEventSchema,
  HostEventSchema,
] as const;

export type HostEvent = Static<typeof HostEventSchema>;
export type ProblemDetails = Static<typeof ProblemDetailsSchema>;

export const problemResponses = {
  400: problemResponse(),
  401: problemResponse(),
  403: problemResponse(),
  404: problemResponse(),
  406: problemResponse(),
  409: problemResponse(),
  413: problemResponse(),
  415: problemResponse(),
  500: problemResponse(),
};

function problemResponse() {
  return {
    description: 'A safe, stable Plysmith problem.',
    content: {
      'application/problem+json': { schema: Type.Ref(ProblemDetailsSchema) },
    },
  };
}
