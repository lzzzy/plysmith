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
  languageResultDto,
  preferencesDto,
  preferencesSummary,
  resourceResult,
  statusSummary,
  systemStatusDto,
  toolProblem,
  toolResult,
} from './responses.ts';
import {
  EmptyArgumentsSchema,
  HostProblemSchema,
  SetUiLanguageArgumentsSchema,
  SetUiLanguageResultSchema,
  SystemStatusSchema,
  UserPreferencesSchema,
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
    const schema =
      params.name === 'set_ui_language'
        ? SetUiLanguageArgumentsSchema
        : EmptyArgumentsSchema;
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
