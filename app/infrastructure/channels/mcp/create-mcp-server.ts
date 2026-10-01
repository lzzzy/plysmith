import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Resource,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Value } from '@sinclair/typebox/value';
import type { HostClient } from './host-client.ts';
import { hostProblem, localProblem } from './problems.ts';
import {
  addContextReferenceResultDto,
  removeContextItemResultDto,
  analysisNoteMutationResultDto,
  analysisWorkspaceDto,
  createAnalysisRecordResultDto,
  createAnalysisNoteResultDto,
  createDiagnosticReportResultDto,
  createWorkingContextResultDto,
  diagnosticLogLevelResultDto,
  diagnosticReportManifestDto,
  diagnosticSettingsDto,
  languageResultDto,
  listPositionAnalysisProvidersResultDto,
  listWorkingContextsResultDto,
  preferencesDto,
  preferencesSummary,
  resourceResult,
  statusSummary,
  systemStatusDto,
  searchInventoryResultDto,
  analysisRecordDto,
  inventoryRevisionPreviewDto,
  listInventoryRevisionsResultDto,
  pendingRevisionImpactDto,
  positionAnalysisSnapshotDto,
  resolvePendingRevisionImpactResultDto,
  saveInventoryRevisionResultDto,
  startInventoryRevisionResultDto,
  setWorkScopeResumeResultDto,
  setManagementPresentationResultDto,
  toolProblem,
  toolResult,
  updateAnalysisScratchResultDto,
  validateAnalysisSetupResultDto,
  workingContextWorkspaceDto,
} from './responses.ts';
import {
  AddContextReferenceArgumentsSchema,
  InventoryOrganizationQuerySchema,
  InventoryOrganizationSchema,
  ChangeInventoryOrganizationBodySchema,
  ChangeInventoryOrganizationResultSchema,
  ContextFolderRemovalQuerySchema,
  ContextFolderRemovalPreviewSchema,
  InventoryNameAvailabilityQuerySchema,
  InventoryNameAvailabilitySchema,
  GetWorkScopeWorkspaceArgumentsSchema,
  WorkScopeWorkspaceSchema,
  StartupResumeSchema,
  SetStartupResumeArgumentsSchema,
  PreviewContextItemRemovalArgumentsSchema,
  ContextRemovalPreviewSchema,
  PreviewWorkingContextDeletionArgumentsSchema,
  DeleteWorkingContextArgumentsSchema,
  DeleteWorkingContextResultSchema,
  PreviewInventoryItemDeletionArgumentsSchema,
  InventoryItemDeletionPreviewSchema,
  DeleteInventoryItemArgumentsSchema,
  DeleteInventoryItemResultSchema,
  AddContextReferenceResultSchema,
  RemoveContextItemArgumentsSchema,
  RemoveContextItemResultSchema,
  AnalysisWorkspaceSchema,
  AnalysisNoteMutationResultSchema,
  CreateAnalysisRecordArgumentsSchema,
  CreateAnalysisRecordResultSchema,
  CreateAnalysisNoteArgumentsSchema,
  CreateAnalysisNoteResultSchema,
  CreateDiagnosticReportArgumentsSchema,
  CreateDiagnosticReportResultSchema,
  CreatePositionNoteArgumentsSchema,
  DeleteAnalysisNoteArgumentsSchema,
  DiagnosticReportManifestSchema,
  DiagnosticSettingsSchema,
  CreateWorkingContextArgumentsSchema,
  UpdateWorkingContextMetadataArgumentsSchema,
  CreateWorkingContextResultSchema,
  EmptyArgumentsSchema,
  GetAnalysisWorkspaceArgumentsSchema,
  GetWorkingContextWorkspaceArgumentsSchema,
  HostProblemSchema,
  ListWorkingContextsArgumentsSchema,
  ListWorkingContextsResultSchema,
  ListPositionAnalysisProvidersResultSchema,
  SearchInventoryArgumentsSchema,
  SearchInventoryResultSchema,
  AnalysisRecordSchema,
  GetInventoryRevisionArgumentsSchema,
  GetPendingRevisionImpactArgumentsSchema,
  InventoryRevisionPreviewSchema,
  ListInventoryRevisionsArgumentsSchema,
  ListInventoryRevisionsResultSchema,
  PendingRevisionImpactSchema,
  PreviewInventoryRevisionArgumentsSchema,
  PromoteAnalysisToInventoryRevisionArgumentsSchema,
  ResolvePendingRevisionImpactArgumentsSchema,
  ResolvePendingRevisionImpactResultSchema,
  SaveInventoryRevisionArgumentsSchema,
  SaveInventoryRevisionResultSchema,
  StartInventoryRevisionArgumentsSchema,
  StartInventoryRevisionResultSchema,
  SetUiLanguageArgumentsSchema,
  SetUiLanguageResultSchema,
  SetDiagnosticLogLevelArgumentsSchema,
  SetDiagnosticLogLevelResultSchema,
  SetWorkScopeResumeArgumentsSchema,
  SetManagementPresentationArgumentsSchema,
  SetManagementPresentationResultSchema,
  SetWorkScopeResumeResultSchema,
  SystemStatusSchema,
  UpdateAnalysisScratchArgumentsSchema,
  UpdateAnalysisScratchResultSchema,
  UpdateAnalysisNoteArgumentsSchema,
  UserPreferencesSchema,
  ValidateAnalysisSetupArgumentsSchema,
  ValidateAnalysisSetupResultSchema,
  WorkingContextWorkspaceSchema,
  AnalyzePositionArgumentsSchema,
  PositionAnalysisSnapshotSchema,
  ListMovePolicyProvidersResultSchema,
  PlayoutResultSchema,
  GetPlayoutArgumentsSchema,
  GetPlayoutResultSchema,
  StartPlayoutArgumentsSchema,
  ExpectedPlayoutArgumentsSchema,
  SubmitPlayoutMoveArgumentsSchema,
  CompletePlayoutArgumentsSchema,
  CompletePlayoutResultSchema,
  DiscardPlayoutResultSchema,
} from './schemas.ts';

export interface McpServerOptions {
  readonly hostClient: HostClient;
  readonly productRelease: string;
}

export function createMcpServer({
  hostClient,
  productRelease,
}: McpServerOptions): Server {
  if (productRelease.trim().length === 0)
    throw new Error('A product release is required');

  // Explicit SDK handlers let TypeBox validation keep raw errors off the wire.
  const server = new Server(
    { name: 'Plysmith', version: productRelease },
    { capabilities: { tools: {}, resources: {} } },
  );
  const readAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const problemMetadata = { 'plysmith/problemSchema': HostProblemSchema };
  const writeAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  };
  const destructiveWriteAnnotations = {
    ...writeAnnotations,
    destructiveHint: true,
  };
  const tools: Tool[] = [
    {
      name: 'get_system_status',
      title: 'Get system status',
      description:
        'Read safe host status, store revisions and release identity.',
      inputSchema: EmptyArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [SystemStatusSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_user_preferences',
      title: 'Get user preferences',
      description:
        'Read the global UI language and current preferenceRevision before changing it.',
      inputSchema: EmptyArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [UserPreferencesSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_diagnostic_settings',
      title: 'Get diagnostic settings',
      description:
        'Read the configured and active diagnostic log level and whether Plysmith must be restarted.',
      inputSchema: EmptyArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [DiagnosticSettingsSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'set_diagnostic_log_level',
      title: 'Set diagnostic log level',
      description:
        'Set off, error, info or debug using the current configuration revision. ' +
        'The new level becomes active after the user restarts Plysmith. This sends one write only.',
      inputSchema: SetDiagnosticLogLevelArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [SetDiagnosticLogLevelResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_diagnostic_report_manifest',
      title: 'Get diagnostic report manifest',
      description:
        'Read the fixed included and excluded data categories before creating a local diagnostic report.',
      inputSchema: EmptyArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [DiagnosticReportManifestSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'create_diagnostic_report',
      title: 'Create diagnostic report',
      description:
        'Create one redacted local diagnostic report at an explicit new .json.gz path after accepting the current manifest version. ' +
        'The report is never transmitted and existing files are not replaced.',
      inputSchema: CreateDiagnosticReportArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [CreateDiagnosticReportResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'set_ui_language',
      title: 'Set UI language',
      description:
        'Set de-DE or en-GB using the current preferenceRevision as expectedRevision. ' +
        'The host reports changed=false for an unchanged language. A stale revision is a conflict. ' +
        'This sends one write only; after a failed response, read preferences before deciding on another write.',
      inputSchema: SetUiLanguageArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [SetUiLanguageResultSchema, HostProblemSchema],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: problemMetadata,
    },
    {
      name: 'get_analysis_workspace',
      title: 'Get analysis workspace',
      description:
        'Read the authoritative free or context-bound analysis workspace. An optional inventory preview is read-only.',
      inputSchema: GetAnalysisWorkspaceArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [AnalysisWorkspaceSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'validate_analysis_setup',
      title: 'Validate analysis setup',
      description:
        'Validate and normalize a structured chess position or FEN without changing application state.',
      inputSchema: ValidateAnalysisSetupArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ValidateAnalysisSetupResultSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'update_analysis_scratch',
      title: 'Update analysis scratch',
      description:
        'Start, extend, navigate, prepare or clear a note draft, or discard an analysis scratch using its current revision.',
      inputSchema: UpdateAnalysisScratchArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [UpdateAnalysisScratchResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'create_analysis_record',
      title: 'Create analysis record',
      description:
        'Store the current scratch path as a new analysis record. A prepared note is optional.',
      inputSchema: CreateAnalysisRecordArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [CreateAnalysisRecordResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'create_analysis_note',
      title: 'Create analysis note',
      description:
        'Store the prepared scratch path as a note on its existing inventory source anchor without creating another inventory item.',
      inputSchema: CreateAnalysisNoteArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [CreateAnalysisNoteResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'create_position_note',
      title: 'Create position note',
      description:
        'Create a plain user note at an exact persisted analysis position without creating a scratch path or inventory item.',
      inputSchema: CreatePositionNoteArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [AnalysisNoteMutationResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'update_analysis_note',
      title: 'Update analysis note',
      description:
        'Update a user-owned analysis note using its current contribution version.',
      inputSchema: UpdateAnalysisNoteArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [AnalysisNoteMutationResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'delete_analysis_note',
      title: 'Delete analysis note',
      description:
        'Archive a user-owned analysis note using its current contribution version.',
      inputSchema: DeleteAnalysisNoteArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [AnalysisNoteMutationResultSchema, HostProblemSchema],
      },
      annotations: destructiveWriteAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_inventory_organization',
      title: 'get inventory organization',
      description: 'Read inventory folders and context links.',
      inputSchema: InventoryOrganizationQuerySchema,
      outputSchema: {
        type: 'object',
        anyOf: [InventoryOrganizationSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'change_inventory_organization',
      title: 'change inventory organization',
      description:
        'Change inventory folders, placement or context links using the current data revision.',
      inputSchema: ChangeInventoryOrganizationBodySchema,
      outputSchema: {
        type: 'object',
        anyOf: [ChangeInventoryOrganizationResultSchema, HostProblemSchema],
      },
      annotations: destructiveWriteAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'preview_context_folder_removal',
      title: 'preview context folder removal',
      description:
        'Preview concrete work lost when removing a folder subtree from a context.',
      inputSchema: ContextFolderRemovalQuerySchema,
      outputSchema: {
        type: 'object',
        anyOf: [ContextFolderRemovalPreviewSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'check_inventory_name_availability',
      title: 'check inventory name availability',
      description:
        'Check global inventory name availability and a suggested name.',
      inputSchema: InventoryNameAvailabilityQuerySchema,
      outputSchema: {
        type: 'object',
        anyOf: [InventoryNameAvailabilitySchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'search_inventory',
      title: 'Search inventory',
      description:
        'Search the authoritative inventory by title text and optional working-context membership.',
      inputSchema: SearchInventoryArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [SearchInventoryResultSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'start_inventory_revision',
      title: 'Start inventory revision',
      description:
        'Start an extend, truncate-after or replace-move revision draft from the current revision and an exact anchor. Replaces the scope scratch using optimistic concurrency.',
      inputSchema: StartInventoryRevisionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [StartInventoryRevisionResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'preview_inventory_revision',
      title: 'Preview inventory revision',
      description:
        'Preview the exact immutable revision and all affected working contexts before saving. Use the returned fingerprint for the save.',
      inputSchema: PreviewInventoryRevisionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [InventoryRevisionPreviewSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'promote_analysis_to_inventory_revision',
      title: 'Replace continuation with explored line',
      description:
        'Promote the current transient exploration from an inventory anchor into a truncate-after revision draft without replaying its moves.',
      inputSchema: PromoteAnalysisToInventoryRevisionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [StartInventoryRevisionResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'save_inventory_revision',
      title: 'Save inventory revision',
      description:
        'Publish the previewed draft as a new immutable current revision. Affected contexts remain pinned until their impacts are resolved. This sends one write only.',
      inputSchema: SaveInventoryRevisionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [SaveInventoryRevisionResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_inventory_revision',
      title: 'Get inventory revision',
      description:
        'Read an exact current or historical inventory revision, optionally focused on one anchor and within a working-context scope.',
      inputSchema: GetInventoryRevisionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [AnalysisRecordSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'list_inventory_revisions',
      title: 'List inventory revisions',
      description:
        'List immutable revisions of one inventory item in revision order.',
      inputSchema: ListInventoryRevisionsArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ListInventoryRevisionsResultSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_pending_revision_impact',
      title: 'Get pending revision impact',
      description:
        'Read one pending working-context impact, including every affected reference, contribution and resume decision.',
      inputSchema: GetPendingRevisionImpactArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [PendingRevisionImpactSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'resolve_pending_revision_impact',
      title: 'Resolve pending revision impact',
      description:
        'Resolve every entry of one pending context impact atomically, then advance the context to the new revision. This sends one write only.',
      inputSchema: ResolvePendingRevisionImpactArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ResolvePendingRevisionImpactResultSchema, HostProblemSchema],
      },
      annotations: destructiveWriteAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_work_scope_workspace',
      title: 'get work scope workspace',
      description: 'Read the authoritative resume slots for one work scope.',
      inputSchema: GetWorkScopeWorkspaceArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [WorkScopeWorkspaceSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_startup_resume',
      title: 'get startup resume',
      description:
        'Read the startup scope, area and unavailable-context cause.',
      inputSchema: EmptyArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [StartupResumeSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'set_startup_resume',
      title: 'set startup resume',
      description:
        'Set the startup scope and area using the observed startup version.',
      inputSchema: SetStartupResumeArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [StartupResumeSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'preview_context_item_removal',
      title: 'preview context item removal',
      description:
        'Read concrete local-work losses before removing an item from a context.',
      inputSchema: PreviewContextItemRemovalArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ContextRemovalPreviewSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'preview_working_context_deletion',
      title: 'preview working context deletion',
      description:
        'Read concrete work losses before deleting a working context.',
      inputSchema: PreviewWorkingContextDeletionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ContextRemovalPreviewSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'delete_working_context',
      title: 'delete working context',
      description:
        'Delete the working context confirmed by the preview versions.',
      inputSchema: DeleteWorkingContextArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [DeleteWorkingContextResultSchema, HostProblemSchema],
      },
      annotations: destructiveWriteAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'preview_inventory_item_deletion',
      title: 'preview inventory item deletion',
      description:
        'Read context and global work affected by deleting an inventory item.',
      inputSchema: PreviewInventoryItemDeletionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [InventoryItemDeletionPreviewSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'delete_inventory_item',
      title: 'delete inventory item',
      description:
        'Delete the inventory item confirmed by the preview versions.',
      inputSchema: DeleteInventoryItemArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [DeleteInventoryItemResultSchema, HostProblemSchema],
      },
      annotations: destructiveWriteAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'list_working_contexts',
      title: 'List working contexts',
      description:
        'List active working contexts with compact reference and resume status.',
      inputSchema: ListWorkingContextsArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ListWorkingContextsResultSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_working_context_workspace',
      title: 'Get working-context workspace',
      description:
        'Read one working context, its references and both authoritative resume slots.',
      inputSchema: GetWorkingContextWorkspaceArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [WorkingContextWorkspaceSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'update_working_context_metadata',
      title: 'Update working context metadata',
      description:
        'Update the name and description of a working context with an explicit version check.',
      inputSchema: UpdateWorkingContextMetadataArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [CreateWorkingContextResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'create_working_context',
      title: 'Create working context',
      description:
        'Create an explicitly named, durable working context without adding inventory automatically.',
      inputSchema: CreateWorkingContextArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [CreateWorkingContextResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'add_context_reference',
      title: 'Add context reference',
      description:
        'Reference an existing inventory anchor from a working context without copying the item.',
      inputSchema: AddContextReferenceArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [AddContextReferenceResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'remove_context_item',
      title: 'Remove item from context',
      description:
        'Remove an inventory item and its context-specific content from a working context without deleting the inventory item.',
      inputSchema: RemoveContextItemArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [RemoveContextItemResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'set_management_presentation',
      title: 'Set management presentation',
      description:
        'Remember the folders or origins view for a work scope while preserving its current selection.',
      inputSchema: SetManagementPresentationArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [SetManagementPresentationResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'set_work_scope_resume',
      title: 'Set work-scope resume',
      description:
        'Replace the manage or analyze resume slot using the current resume revision.',
      inputSchema: SetWorkScopeResumeArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [SetWorkScopeResumeResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
  ];
  tools.push(
    {
      name: 'list_position_analysis_providers',
      title: 'List position-analysis providers',
      description:
        'List engine-neutral objective and human-policy providers available for position analysis.',
      inputSchema: EmptyArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ListPositionAnalysisProvidersResultSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'analyze_position',
      title: 'Analyze position',
      description:
        'Analyze the exact visible focus with one configured objective or human-policy provider. A newer request for the same consumer and lane replaces the previous request.',
      inputSchema: AnalyzePositionArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [PositionAnalysisSnapshotSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'list_move_policy_providers',
      title: 'List playout providers',
      description:
        'List engine-neutral move-policy providers available for playout.',
      inputSchema: EmptyArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [ListMovePolicyProvidersResultSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'get_playout',
      title: 'Get playout',
      description:
        'Read the current playout draft for a free or working-context scope.',
      inputSchema: GetPlayoutArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [GetPlayoutResultSchema, HostProblemSchema],
      },
      annotations: readAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'start_playout',
      title: 'Start playout',
      description:
        'Start a playout from an explicit position or inventory anchor with either the first user move or the provider moving first. The selected move-policy provider remains bound to the game.',
      inputSchema: StartPlayoutArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [PlayoutResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'submit_playout_move',
      title: 'Submit playout move',
      description: 'Submit one legal user move to the current playout draft.',
      inputSchema: SubmitPlayoutMoveArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [PlayoutResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    ...(['retry', 'pause', 'resume', 'stop'] as const).map(
      (operation): Tool => ({
        name: `${operation}_playout`,
        title: `${operation[0]!.toUpperCase()}${operation.slice(1)} playout`,
        description: `${operation[0]!.toUpperCase()}${operation.slice(1)} the current playout draft using its current revision.`,
        inputSchema: ExpectedPlayoutArgumentsSchema,
        outputSchema: {
          type: 'object',
          anyOf: [PlayoutResultSchema, HostProblemSchema],
        },
        annotations: writeAnnotations,
        _meta: problemMetadata,
      }),
    ),
    {
      name: 'cancel_playout_completion',
      title: 'Cancel playout completion',
      description:
        'Cancel completion of a stopped playout draft and leave it paused without requesting a provider move.',
      inputSchema: ExpectedPlayoutArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [PlayoutResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'complete_playout',
      title: 'Complete playout',
      description: 'Store a stopped or terminal playout once as a game record.',
      inputSchema: CompletePlayoutArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [CompletePlayoutResultSchema, HostProblemSchema],
      },
      annotations: writeAnnotations,
      _meta: problemMetadata,
    },
    {
      name: 'discard_playout',
      title: 'Discard playout',
      description:
        'Discard the current transient playout draft without creating a game record.',
      inputSchema: ExpectedPlayoutArgumentsSchema,
      outputSchema: {
        type: 'object',
        anyOf: [DiscardPlayoutResultSchema, HostProblemSchema],
      },
      annotations: destructiveWriteAnnotations,
      _meta: problemMetadata,
    },
  );
  const resources: Resource[] = [
    {
      name: 'system_status',
      title: 'System status',
      uri: 'plysmith://system/status',
      description: 'The same current status JSON as get_system_status.',
      mimeType: 'application/json',
      _meta: {
        'plysmith/outputSchema': SystemStatusSchema,
        ...problemMetadata,
      },
    },
    {
      name: 'user_preferences',
      title: 'User preferences',
      uri: 'plysmith://user/preferences',
      description: 'The same current preferences JSON as get_user_preferences.',
      mimeType: 'application/json',
      _meta: {
        'plysmith/outputSchema': UserPreferencesSchema,
        ...problemMetadata,
      },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = tools.find((entry) => entry.name === params.name);
    if (tool === undefined)
      throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
    if (params.task !== undefined) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Task execution is not supported',
      );
    }
    const args = params.arguments ?? {};
    const schema = inputSchema(params.name);
    if (!Value.Check(schema, args))
      return toolProblem(localProblem('request.invalid'));

    try {
      switch (params.name) {
        case 'get_system_status': {
          const dto = systemStatusDto(await hostClient.getSystemStatus());
          return toolResult(dto, statusSummary(dto));
        }
        case 'get_user_preferences': {
          const dto = preferencesDto(await hostClient.getUserPreferences());
          return toolResult(dto, preferencesSummary(dto));
        }
        case 'get_diagnostic_settings': {
          const dto = diagnosticSettingsDto(
            await hostClient.getDiagnosticSettings(),
          );
          return toolResult(
            dto,
            `Diagnostic level: ${dto.configuredLevel}; active level: ${dto.activeLevel}.`,
          );
        }
        case 'set_diagnostic_log_level': {
          if (!Value.Check(SetDiagnosticLogLevelArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = diagnosticLogLevelResultDto(
            await hostClient.setDiagnosticLogLevel(args),
          );
          return toolResult(
            dto,
            dto.settings.restartRequired
              ? 'Diagnostic level saved. Restart Plysmith to activate it.'
              : `Diagnostic level ${dto.settings.configuredLevel} is active.`,
          );
        }
        case 'get_diagnostic_report_manifest': {
          const dto = diagnosticReportManifestDto(
            await hostClient.getDiagnosticReportManifest(),
          );
          return toolResult(
            dto,
            `Diagnostic report manifest ${dto.manifestVersion}: ${dto.includedCategories.length} included and ${dto.excludedCategories.length} excluded categories.`,
          );
        }
        case 'create_diagnostic_report': {
          if (!Value.Check(CreateDiagnosticReportArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = createDiagnosticReportResultDto(
            await hostClient.createDiagnosticReport(args),
          );
          return toolResult(
            dto,
            `Diagnostic report created with ${dto.eventCount} redacted events.`,
          );
        }
        case 'set_ui_language': {
          if (!Value.Check(SetUiLanguageArgumentsSchema, args)) {
            return toolProblem(localProblem('request.invalid'));
          }
          const dto = languageResultDto(
            await hostClient.setUiLanguage({
              uiLocale: args.uiLocale,
              expectedRevision: args.expectedRevision,
            }),
          );
          return toolResult(
            dto,
            `${dto.changed ? 'Language updated.' : 'Language unchanged.'} ${preferencesSummary(dto.preferences)}`,
          );
        }
        case 'get_analysis_workspace': {
          if (!Value.Check(GetAnalysisWorkspaceArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          if (args.mode === 'initial_position' && args.preview !== undefined)
            return toolProblem(localProblem('request.invalid'));
          const dto = analysisWorkspaceDto(
            await hostClient.getAnalysisWorkspace({
              scopeKind: args.scope.kind,
              ...(args.scope.kind === 'context'
                ? { contextId: args.scope.contextId }
                : {}),
              ...(args.mode === undefined ? {} : { mode: args.mode }),
              ...(args.preview === undefined
                ? {}
                : {
                    itemId: args.preview.itemId,
                    revisionId: args.preview.revisionId,
                    anchorId: args.preview.anchorId,
                  }),
            }),
          );
          return toolResult(
            dto,
            `Analysis workspace at revision ${dto.dataRevision}.`,
          );
        }
        case 'validate_analysis_setup': {
          if (!Value.Check(ValidateAnalysisSetupArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = validateAnalysisSetupResultDto(
            await hostClient.validateAnalysisSetup(args),
          );
          return toolResult(
            dto,
            dto.valid
              ? 'Analysis setup is valid.'
              : `Analysis setup has ${dto.issues.length} issue(s).`,
          );
        }
        case 'update_analysis_scratch': {
          if (!Value.Check(UpdateAnalysisScratchArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = updateAnalysisScratchResultDto(
            await hostClient.updateAnalysisScratch(args),
          );
          return toolResult(
            dto,
            dto.discarded
              ? 'Analysis scratch discarded.'
              : `Analysis scratch revision ${dto.scratch?.scratchRevision ?? 'unknown'}.`,
          );
        }
        case 'create_analysis_record': {
          if (!Value.Check(CreateAnalysisRecordArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = createAnalysisRecordResultDto(
            await hostClient.createAnalysisRecord(args),
          );
          return toolResult(dto, `Analysis record ${dto.itemId} created.`);
        }
        case 'create_analysis_note': {
          if (!Value.Check(CreateAnalysisNoteArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = createAnalysisNoteResultDto(
            await hostClient.createAnalysisNote(args),
          );
          return toolResult(
            dto,
            `Analysis note ${dto.contributionId} created at anchor ${dto.anchorId}.`,
          );
        }
        case 'create_position_note': {
          if (!Value.Check(CreatePositionNoteArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = analysisNoteMutationResultDto(
            await hostClient.createPositionNote(args),
          );
          return toolResult(
            dto,
            `Position note ${dto.contributionId} created at anchor ${dto.anchorId}.`,
          );
        }
        case 'update_analysis_note': {
          if (!Value.Check(UpdateAnalysisNoteArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = analysisNoteMutationResultDto(
            await hostClient.updateAnalysisNote(args.contributionId, {
              scope: args.scope,
              expectedContributionVersion: args.expectedContributionVersion,
              body: args.body,
            }),
          );
          return toolResult(
            dto,
            `Analysis note ${dto.contributionId} updated to version ${dto.contributionVersion}.`,
          );
        }
        case 'delete_analysis_note': {
          if (!Value.Check(DeleteAnalysisNoteArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = analysisNoteMutationResultDto(
            await hostClient.deleteAnalysisNote(args.contributionId, {
              scope: args.scope,
              expectedContributionVersion: args.expectedContributionVersion,
            }),
          );
          return toolResult(
            dto,
            `Analysis note ${dto.contributionId} archived.`,
          );
        }
        case 'get_inventory_organization': {
          if (!Value.Check(InventoryOrganizationQuerySchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.getInventoryOrganization(args);
          if (!Value.Check(InventoryOrganizationSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Inventory organization request completed.');
        }
        case 'change_inventory_organization': {
          if (!Value.Check(ChangeInventoryOrganizationBodySchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.changeInventoryOrganization(args);
          if (!Value.Check(ChangeInventoryOrganizationResultSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Inventory organization request completed.');
        }
        case 'preview_context_folder_removal': {
          if (!Value.Check(ContextFolderRemovalQuerySchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.previewContextFolderRemoval(args);
          if (!Value.Check(ContextFolderRemovalPreviewSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Inventory organization request completed.');
        }
        case 'check_inventory_name_availability': {
          if (!Value.Check(InventoryNameAvailabilityQuerySchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.checkInventoryNameAvailability(args);
          if (!Value.Check(InventoryNameAvailabilitySchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Inventory organization request completed.');
        }
        case 'search_inventory': {
          if (!Value.Check(SearchInventoryArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = searchInventoryResultDto(
            await hostClient.searchInventory({
              ...(args.query === undefined ? {} : { query: args.query }),
              ...(args.contextId === undefined
                ? {}
                : { contextId: args.contextId }),
              ...(args.pageSize === undefined
                ? {}
                : { pageSize: String(args.pageSize) }),
              ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
            }),
          );
          return toolResult(dto, `${dto.items.length} inventory items found.`);
        }
        case 'start_inventory_revision': {
          if (!Value.Check(StartInventoryRevisionArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = startInventoryRevisionResultDto(
            await hostClient.startInventoryRevision(args.itemId, {
              scope: args.scope,
              baseRevisionId: args.baseRevisionId,
              anchorId: args.anchorId,
              mode: args.mode,
              expectedScratchId: args.expectedScratchId,
              expectedScratchRevision: args.expectedScratchRevision,
              ...(args.displayName === undefined
                ? {}
                : { displayName: args.displayName }),
              ...(args.summary === undefined ? {} : { summary: args.summary }),
              ...(args.firstMove === undefined
                ? {}
                : { firstMove: args.firstMove }),
            }),
          );
          return toolResult(
            dto,
            `Inventory revision scratch ${dto.scratch.scratchId} started.`,
          );
        }
        case 'preview_inventory_revision': {
          if (!Value.Check(PreviewInventoryRevisionArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = inventoryRevisionPreviewDto(
            await hostClient.previewInventoryRevision(args),
          );
          return toolResult(
            dto,
            `Revision preview affects ${dto.affectedContexts.length} working contexts.`,
          );
        }
        case 'promote_analysis_to_inventory_revision': {
          if (
            !Value.Check(
              PromoteAnalysisToInventoryRevisionArgumentsSchema,
              args,
            )
          )
            return toolProblem(localProblem('request.invalid'));
          const dto = startInventoryRevisionResultDto(
            await hostClient.promoteAnalysisToInventoryRevision(args.itemId, {
              scope: args.scope,
              baseRevisionId: args.baseRevisionId,
              anchorId: args.anchorId,
              expectedScratchId: args.expectedScratchId,
              expectedScratchRevision: args.expectedScratchRevision,
            }),
          );
          return toolResult(
            dto,
            `Explored line promoted to inventory revision scratch ${dto.scratch.scratchId}.`,
          );
        }
        case 'save_inventory_revision': {
          if (!Value.Check(SaveInventoryRevisionArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = saveInventoryRevisionResultDto(
            await hostClient.saveInventoryRevision(args),
          );
          return toolResult(
            dto,
            dto.noOp
              ? 'Inventory revision is unchanged.'
              : `Inventory revision ${dto.revisionNumber} saved.`,
          );
        }
        case 'get_inventory_revision': {
          if (!Value.Check(GetInventoryRevisionArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = analysisRecordDto(
            await hostClient.getInventoryRevision(
              args.itemId,
              args.revisionId,
              {
                scopeKind: args.scope.kind,
                ...(args.scope.kind === 'context'
                  ? { contextId: args.scope.contextId }
                  : {}),
                ...(args.anchorId === undefined
                  ? {}
                  : { anchorId: args.anchorId }),
              },
            ),
          );
          return toolResult(
            dto,
            `Inventory revision ${dto.revisionNumber}${dto.historical ? ' (historical)' : ''}.`,
          );
        }
        case 'list_inventory_revisions': {
          if (!Value.Check(ListInventoryRevisionsArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = listInventoryRevisionsResultDto(
            await hostClient.listInventoryRevisions(args.itemId, {
              ...(args.pageSize === undefined
                ? {}
                : { pageSize: String(args.pageSize) }),
              ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
            }),
          );
          return toolResult(
            dto,
            `${dto.revisions.length} inventory revisions found.`,
          );
        }
        case 'get_pending_revision_impact': {
          if (!Value.Check(GetPendingRevisionImpactArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = pendingRevisionImpactDto(
            await hostClient.getPendingRevisionImpact(args.impactId),
          );
          return toolResult(
            dto,
            `Revision impact for ${dto.contextName} requires one context decision.`,
          );
        }
        case 'resolve_pending_revision_impact': {
          if (!Value.Check(ResolvePendingRevisionImpactArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = resolvePendingRevisionImpactResultDto(
            await hostClient.resolvePendingRevisionImpact(args.impactId, {
              expectedImpactVersion: args.expectedImpactVersion,
              expectedDataRevision: args.expectedDataRevision,
              resolution: args.resolution,
            }),
          );
          return toolResult(dto, `Revision impact ${dto.impactId} resolved.`);
        }
        case 'get_work_scope_workspace': {
          if (!Value.Check(GetWorkScopeWorkspaceArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.getWorkScopeWorkspace(args);
          if (!Value.Check(WorkScopeWorkspaceSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace state read.');
        }
        case 'get_startup_resume': {
          if (!Value.Check(EmptyArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.getStartupResume();
          if (!Value.Check(StartupResumeSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace state read.');
        }
        case 'set_startup_resume': {
          if (!Value.Check(SetStartupResumeArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.setStartupResume(args);
          if (!Value.Check(StartupResumeSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace change completed.');
        }
        case 'preview_context_item_removal': {
          if (!Value.Check(PreviewContextItemRemovalArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.previewContextItemRemoval(
            args.contextId,
            args.itemId,
          );
          if (!Value.Check(ContextRemovalPreviewSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace state read.');
        }
        case 'preview_working_context_deletion': {
          if (!Value.Check(PreviewWorkingContextDeletionArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.previewWorkingContextDeletion(
            args.contextId,
          );
          if (!Value.Check(ContextRemovalPreviewSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace state read.');
        }
        case 'delete_working_context': {
          if (!Value.Check(DeleteWorkingContextArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.deleteWorkingContext(args.contextId, {
            expectedContextVersion: args.expectedContextVersion,
            expectedDataRevision: args.expectedDataRevision,
          });
          if (!Value.Check(DeleteWorkingContextResultSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace change completed.');
        }
        case 'preview_inventory_item_deletion': {
          if (!Value.Check(PreviewInventoryItemDeletionArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.previewInventoryItemDeletion(
            args.itemId,
          );
          if (!Value.Check(InventoryItemDeletionPreviewSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace state read.');
        }
        case 'delete_inventory_item': {
          if (!Value.Check(DeleteInventoryItemArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.deleteInventoryItem(args.itemId, {
            expectedCurrentRevisionId: args.expectedCurrentRevisionId,
            expectedDataRevision: args.expectedDataRevision,
          });
          if (!Value.Check(DeleteInventoryItemResultSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, 'Workspace change completed.');
        }
        case 'list_working_contexts': {
          if (!Value.Check(ListWorkingContextsArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = listWorkingContextsResultDto(
            await hostClient.listWorkingContexts({
              ...(args.pageSize === undefined
                ? {}
                : { pageSize: String(args.pageSize) }),
              ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
            }),
          );
          return toolResult(
            dto,
            `${dto.contexts.length} working contexts found.`,
          );
        }
        case 'get_working_context_workspace': {
          if (!Value.Check(GetWorkingContextWorkspaceArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = workingContextWorkspaceDto(
            await hostClient.getWorkingContextWorkspace(args.contextId),
          );
          return toolResult(dto, `Working context ${dto.context.displayName}.`);
        }
        case 'update_working_context_metadata': {
          if (!Value.Check(UpdateWorkingContextMetadataArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const { contextId, ...request } = args;
          const dto = createWorkingContextResultDto(
            await hostClient.updateWorkingContextMetadata(contextId, request),
          );
          return toolResult(
            dto,
            `Working context ${dto.context.displayName} updated.`,
          );
        }
        case 'create_working_context': {
          if (!Value.Check(CreateWorkingContextArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = createWorkingContextResultDto(
            await hostClient.createWorkingContext(args),
          );
          return toolResult(
            dto,
            `Working context ${dto.context.displayName} created.`,
          );
        }
        case 'add_context_reference': {
          if (!Value.Check(AddContextReferenceArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = addContextReferenceResultDto(
            await hostClient.addContextReference(args.contextId, {
              itemId: args.itemId,
              anchorId: args.anchorId,
            }),
          );
          return toolResult(
            dto,
            `Context reference ${dto.reference.referenceId} added.`,
          );
        }
        case 'remove_context_item': {
          if (!Value.Check(RemoveContextItemArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = removeContextItemResultDto(
            await hostClient.removeContextItem(args.contextId, args.itemId, {
              expectedContextVersion: args.expectedContextVersion,
              expectedDataRevision: args.expectedDataRevision,
            }),
          );
          return toolResult(dto, `Item ${dto.itemId} removed from context.`);
        }
        case 'set_management_presentation': {
          if (!Value.Check(SetManagementPresentationArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = setManagementPresentationResultDto(
            await hostClient.setManagementPresentation(args),
          );
          return toolResult(
            dto,
            `Management resume revision ${dto.resume.resumeVersion}.`,
          );
        }
        case 'set_work_scope_resume': {
          if (!Value.Check(SetWorkScopeResumeArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const request = resumeRequest(args);
          if (request === undefined)
            return toolProblem(localProblem('request.invalid'));
          const dto = setWorkScopeResumeResultDto(
            await hostClient.setWorkScopeResume(request),
          );
          return toolResult(
            dto,
            `${dto.area} resume revision ${dto.resume.resumeVersion}.`,
          );
        }
        case 'list_position_analysis_providers': {
          const dto = listPositionAnalysisProvidersResultDto(
            await hostClient.listPositionAnalysisProviders(),
          );
          return toolResult(
            dto,
            `${dto.providers.length} position-analysis provider(s).`,
          );
        }
        case 'analyze_position': {
          if (!Value.Check(AnalyzePositionArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = positionAnalysisSnapshotDto(
            await hostClient.analyzePosition(args),
          );
          return toolResult(
            dto,
            `${dto.providerDisplayName} returned ${dto.candidates.length} candidate(s) for ${dto.focusKey}.`,
          );
        }
        case 'list_move_policy_providers': {
          const dto = await hostClient.listMovePolicyProviders();
          return toolResult(
            {
              providers: dto.providers.map((provider) => ({
                ...provider,
                capabilities: [...provider.capabilities],
              })),
            },
            `${dto.providers.length} playout provider(s).`,
          );
        }
        case 'get_playout': {
          if (!Value.Check(GetPlayoutArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const playout = await hostClient.getPlayout({
            scopeKind: args.scope.kind,
            ...(args.scope.kind === 'context'
              ? { contextId: args.scope.contextId }
              : {}),
          });
          return toolResult(
            playout === null ? {} : { playout },
            playout === null
              ? 'No playout draft exists in this scope.'
              : `Playout draft revision ${playout.draft.draftRevision}.`,
          );
        }
        case 'start_playout': {
          if (!Value.Check(StartPlayoutArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.startPlayout(args);
          return toolResult(dto, `Playout draft ${dto.draft.draftId} started.`);
        }
        case 'submit_playout_move': {
          if (!Value.Check(SubmitPlayoutMoveArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.submitPlayoutMove(args);
          return toolResult(
            dto,
            `Playout advanced to revision ${dto.draft.draftRevision}.`,
          );
        }
        case 'retry_playout':
        case 'pause_playout':
        case 'resume_playout':
        case 'stop_playout': {
          if (!Value.Check(ExpectedPlayoutArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto =
            params.name === 'retry_playout'
              ? await hostClient.retryPlayout(args)
              : params.name === 'pause_playout'
                ? await hostClient.pausePlayout(args)
                : params.name === 'resume_playout'
                  ? await hostClient.resumePlayout(args)
                  : await hostClient.stopPlayout(args);
          return toolResult(dto, `Playout is ${dto.draft.status.kind}.`);
        }
        case 'cancel_playout_completion': {
          if (!Value.Check(ExpectedPlayoutArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.cancelPlayoutCompletion(args);
          return toolResult(dto, `Playout is ${dto.draft.status.kind}.`);
        }
        case 'complete_playout': {
          if (!Value.Check(CompletePlayoutArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.completePlayout(args);
          if (!Value.Check(CompletePlayoutResultSchema, dto))
            throw new Error('Invalid host response');
          return toolResult(dto, `Game record ${dto.itemId} created.`);
        }
        case 'discard_playout': {
          if (!Value.Check(ExpectedPlayoutArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const dto = await hostClient.discardPlayout(args);
          return toolResult(dto, 'Playout draft discarded.');
        }
      }
      throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
    } catch (error) {
      return toolProblem(hostProblem(error));
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    if (!resources.some((entry) => entry.uri === params.uri)) {
      throw new McpError(ErrorCode.InvalidParams, 'Unknown resource');
    }
    try {
      const dto =
        params.uri === 'plysmith://system/status'
          ? systemStatusDto(await hostClient.getSystemStatus())
          : preferencesDto(await hostClient.getUserPreferences());
      return resourceResult(params.uri, dto);
    } catch (error) {
      const problem = hostProblem(error);
      throw new McpError(ErrorCode.InternalError, problem.title, {
        ...problem,
      });
    }
  });
  return server;
}

function resumeRequest(args: typeof SetWorkScopeResumeArgumentsSchema.static) {
  if (args.area === 'manage') {
    if (
      args.presentation === undefined ||
      args.mode !== undefined ||
      args.itemId !== undefined ||
      args.revisionId !== undefined ||
      args.anchorId !== undefined
    ) {
      return undefined;
    }
    return {
      area: args.area,
      scope: args.scope,
      expectedResumeVersion: args.expectedResumeVersion,
      presentation: args.presentation,
      ...(args.selectedItemId === undefined
        ? {}
        : { selectedItemId: args.selectedItemId }),
      ...(args.selectedAnchorId === undefined
        ? {}
        : { selectedAnchorId: args.selectedAnchorId }),
    } as const;
  }
  if (
    args.mode === undefined ||
    args.presentation !== undefined ||
    args.selectedItemId !== undefined ||
    args.selectedAnchorId !== undefined
  ) {
    return undefined;
  }
  return {
    area: args.area,
    scope: args.scope,
    expectedResumeVersion: args.expectedResumeVersion,
    mode: args.mode,
    ...(args.itemId === undefined ? {} : { itemId: args.itemId }),
    ...(args.revisionId === undefined ? {} : { revisionId: args.revisionId }),
    ...(args.anchorId === undefined ? {} : { anchorId: args.anchorId }),
  } as const;
}

function inputSchema(name: string) {
  switch (name) {
    case 'get_work_scope_workspace':
      return GetWorkScopeWorkspaceArgumentsSchema;
    case 'get_startup_resume':
      return EmptyArgumentsSchema;
    case 'set_startup_resume':
      return SetStartupResumeArgumentsSchema;
    case 'preview_context_item_removal':
      return PreviewContextItemRemovalArgumentsSchema;
    case 'preview_working_context_deletion':
      return PreviewWorkingContextDeletionArgumentsSchema;
    case 'delete_working_context':
      return DeleteWorkingContextArgumentsSchema;
    case 'preview_inventory_item_deletion':
      return PreviewInventoryItemDeletionArgumentsSchema;
    case 'delete_inventory_item':
      return DeleteInventoryItemArgumentsSchema;
    case 'get_system_status':
    case 'get_user_preferences':
    case 'get_diagnostic_settings':
    case 'get_diagnostic_report_manifest':
    case 'list_position_analysis_providers':
    case 'list_move_policy_providers':
      return EmptyArgumentsSchema;
    case 'set_diagnostic_log_level':
      return SetDiagnosticLogLevelArgumentsSchema;
    case 'create_diagnostic_report':
      return CreateDiagnosticReportArgumentsSchema;
    case 'set_ui_language':
      return SetUiLanguageArgumentsSchema;
    case 'get_analysis_workspace':
      return GetAnalysisWorkspaceArgumentsSchema;
    case 'validate_analysis_setup':
      return ValidateAnalysisSetupArgumentsSchema;
    case 'update_analysis_scratch':
      return UpdateAnalysisScratchArgumentsSchema;
    case 'get_inventory_organization':
      return InventoryOrganizationQuerySchema;
    case 'change_inventory_organization':
      return ChangeInventoryOrganizationBodySchema;
    case 'preview_context_folder_removal':
      return ContextFolderRemovalQuerySchema;
    case 'check_inventory_name_availability':
      return InventoryNameAvailabilityQuerySchema;
    case 'create_analysis_record':
      return CreateAnalysisRecordArgumentsSchema;
    case 'create_analysis_note':
      return CreateAnalysisNoteArgumentsSchema;
    case 'create_position_note':
      return CreatePositionNoteArgumentsSchema;
    case 'update_analysis_note':
      return UpdateAnalysisNoteArgumentsSchema;
    case 'delete_analysis_note':
      return DeleteAnalysisNoteArgumentsSchema;
    case 'search_inventory':
      return SearchInventoryArgumentsSchema;
    case 'start_inventory_revision':
      return StartInventoryRevisionArgumentsSchema;
    case 'preview_inventory_revision':
      return PreviewInventoryRevisionArgumentsSchema;
    case 'promote_analysis_to_inventory_revision':
      return PromoteAnalysisToInventoryRevisionArgumentsSchema;
    case 'save_inventory_revision':
      return SaveInventoryRevisionArgumentsSchema;
    case 'get_inventory_revision':
      return GetInventoryRevisionArgumentsSchema;
    case 'list_inventory_revisions':
      return ListInventoryRevisionsArgumentsSchema;
    case 'get_pending_revision_impact':
      return GetPendingRevisionImpactArgumentsSchema;
    case 'resolve_pending_revision_impact':
      return ResolvePendingRevisionImpactArgumentsSchema;
    case 'list_working_contexts':
      return ListWorkingContextsArgumentsSchema;
    case 'get_working_context_workspace':
      return GetWorkingContextWorkspaceArgumentsSchema;
    case 'create_working_context':
      return CreateWorkingContextArgumentsSchema;
    case 'update_working_context_metadata':
      return UpdateWorkingContextMetadataArgumentsSchema;
    case 'add_context_reference':
      return AddContextReferenceArgumentsSchema;
    case 'remove_context_item':
      return RemoveContextItemArgumentsSchema;
    case 'set_work_scope_resume':
      return SetWorkScopeResumeArgumentsSchema;
    case 'set_management_presentation':
      return SetManagementPresentationArgumentsSchema;
    case 'analyze_position':
      return AnalyzePositionArgumentsSchema;
    case 'get_playout':
      return GetPlayoutArgumentsSchema;
    case 'start_playout':
      return StartPlayoutArgumentsSchema;
    case 'submit_playout_move':
      return SubmitPlayoutMoveArgumentsSchema;
    case 'retry_playout':
    case 'pause_playout':
    case 'resume_playout':
    case 'stop_playout':
    case 'discard_playout':
    case 'cancel_playout_completion':
      return ExpectedPlayoutArgumentsSchema;
    case 'complete_playout':
      return CompletePlayoutArgumentsSchema;
    default:
      throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
  }
}
