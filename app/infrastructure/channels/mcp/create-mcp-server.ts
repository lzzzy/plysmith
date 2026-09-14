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
  analysisNoteMutationResultDto,
  analysisWorkspaceDto,
  createAnalysisRecordResultDto,
  createAnalysisNoteResultDto,
  createWorkingContextResultDto,
  languageResultDto,
  listWorkingContextsResultDto,
  preferencesDto,
  preferencesSummary,
  resourceResult,
  statusSummary,
  systemStatusDto,
  searchInventoryResultDto,
  setWorkScopeResumeResultDto,
  toolProblem,
  toolResult,
  updateAnalysisScratchResultDto,
  workingContextWorkspaceDto,
} from './responses.ts';
import {
  AddContextReferenceArgumentsSchema,
  AddContextReferenceResultSchema,
  AnalysisWorkspaceSchema,
  AnalysisNoteMutationResultSchema,
  CreateAnalysisRecordArgumentsSchema,
  CreateAnalysisRecordResultSchema,
  CreateAnalysisNoteArgumentsSchema,
  CreateAnalysisNoteResultSchema,
  CreatePositionNoteArgumentsSchema,
  DeleteAnalysisNoteArgumentsSchema,
  CreateWorkingContextArgumentsSchema,
  CreateWorkingContextResultSchema,
  EmptyArgumentsSchema,
  GetAnalysisWorkspaceArgumentsSchema,
  GetWorkingContextWorkspaceArgumentsSchema,
  HostProblemSchema,
  ListWorkingContextsArgumentsSchema,
  ListWorkingContextsResultSchema,
  SearchInventoryArgumentsSchema,
  SearchInventoryResultSchema,
  SetUiLanguageArgumentsSchema,
  SetUiLanguageResultSchema,
  SetWorkScopeResumeArgumentsSchema,
  SetWorkScopeResumeResultSchema,
  SystemStatusSchema,
  UpdateAnalysisScratchArgumentsSchema,
  UpdateAnalysisScratchResultSchema,
  UpdateAnalysisNoteArgumentsSchema,
  UserPreferencesSchema,
  WorkingContextWorkspaceSchema,
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
          const dto = analysisWorkspaceDto(
            await hostClient.getAnalysisWorkspace({
              scopeKind: args.scope.kind,
              ...(args.scope.kind === 'context'
                ? { contextId: args.scope.contextId }
                : {}),
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
        case 'set_work_scope_resume': {
          if (!Value.Check(SetWorkScopeResumeArgumentsSchema, args))
            return toolProblem(localProblem('request.invalid'));
          const request = resumeRequest(args);
          if (request === undefined)
            return toolProblem(localProblem('request.invalid'));
          const dto = setWorkScopeResumeResultDto(
            await hostClient.setWorkScopeResume(args.contextId, request),
          );
          return toolResult(
            dto,
            `${dto.area} resume revision ${dto.resume.resumeVersion}.`,
          );
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
    expectedResumeVersion: args.expectedResumeVersion,
    mode: args.mode,
    ...(args.itemId === undefined ? {} : { itemId: args.itemId }),
    ...(args.revisionId === undefined ? {} : { revisionId: args.revisionId }),
    ...(args.anchorId === undefined ? {} : { anchorId: args.anchorId }),
  } as const;
}

function inputSchema(name: string) {
  switch (name) {
    case 'get_system_status':
    case 'get_user_preferences':
      return EmptyArgumentsSchema;
    case 'set_ui_language':
      return SetUiLanguageArgumentsSchema;
    case 'get_analysis_workspace':
      return GetAnalysisWorkspaceArgumentsSchema;
    case 'update_analysis_scratch':
      return UpdateAnalysisScratchArgumentsSchema;
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
    case 'list_working_contexts':
      return ListWorkingContextsArgumentsSchema;
    case 'get_working_context_workspace':
      return GetWorkingContextWorkspaceArgumentsSchema;
    case 'create_working_context':
      return CreateWorkingContextArgumentsSchema;
    case 'add_context_reference':
      return AddContextReferenceArgumentsSchema;
    case 'set_work_scope_resume':
      return SetWorkScopeResumeArgumentsSchema;
    default:
      throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
  }
}
