/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-independent',
      severity: 'error',
      from: { path: '^app/domain' },
      to: { path: '^app/(application|infrastructure|bootstrap)' },
    },
    {
      name: 'application-does-not-use-infrastructure',
      severity: 'error',
      from: { path: '^app/application' },
      to: { path: '^app/(infrastructure|bootstrap)' },
    },
    {
      name: 'channels-do-not-use-outbound-adapters',
      severity: 'error',
      from: { path: '^app/infrastructure/channels' },
      to: { path: '^app/infrastructure/adapters' },
    },
    {
      name: 'renderer-has-no-node-runtime',
      severity: 'error',
      from: { path: '^app/infrastructure/channels/ui/renderer' },
      to: {
        dependencyTypes: ['core'],
        pathNot: '^(react|react-dom)$',
      },
    },
    {
      name: 'host-client-has-no-node-runtime',
      severity: 'error',
      from: { path: '^app/infrastructure/channels/host_client' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'host-client-uses-only-the-api-contract',
      severity: 'error',
      from: { path: '^app/infrastructure/channels/host_client' },
      to: {
        path: '^app/infrastructure/channels/api',
        pathNot: '^app/infrastructure/channels/api/contract\\.ts$',
      },
    },
    {
      name: 'contracts-are-inert',
      severity: 'error',
      from: { path: '^contracts' },
      to: { path: '^app' },
    },
    {
      name: 'domain-and-application-do-not-use-transport-contracts',
      severity: 'error',
      from: { path: '^app/(domain|application)' },
      to: { path: '^contracts' },
    },
    {
      name: 'bootstrap-is-entry-only',
      severity: 'error',
      from: { path: '^app/(domain|application|infrastructure)' },
      to: { path: '^app/bootstrap' },
    },
    {
      name: 'client-bootstraps-do-not-compose-the-application',
      severity: 'error',
      from: { path: '^app/bootstrap/(mcp|desktop)' },
      to: { path: '^app/(domain|application|bootstrap/host)' },
    },
    {
      name: 'client-bootstraps-use-only-platform-adapters',
      severity: 'error',
      from: { path: '^app/bootstrap/(mcp|desktop)' },
      to: {
        path: '^app/infrastructure/adapters',
        pathNot: '^app/infrastructure/adapters/platform/windows(?:/|$)',
      },
    },
    {
      name: 'mcp-channel-stays-behind-the-host-client',
      severity: 'error',
      from: { path: '^app/infrastructure/channels/mcp' },
      to: {
        path: '^app/(domain|application|infrastructure/(adapters|channels/api))',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
