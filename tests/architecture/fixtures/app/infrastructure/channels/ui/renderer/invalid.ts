import { readFile } from 'node:fs';
import { app } from 'electron';
import { workspacePublic } from '../../../../domain/workspace/index.ts';

export { basename } from 'node:path';
export { default as Database } from 'better-sqlite3';
export { default as fastify } from 'fastify';
export { default as cors } from '@fastify/cors';
export { sqliteAdapterProbe } from '../../../adapters/persistence/sqlite/probe.ts';
export { workspacePublic as applicationPublic } from '../../../../application/workspace/index.ts';
export const invalidImports = [readFile, app, workspacePublic];
