import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PlysmithConfigurationSchema,
  SqliteProviderConfigurationSchema,
} from '../app/infrastructure/adapters/configuration/filesystem/configuration-schema.ts';

const defaultOutputDirectory = path.resolve('configuration', 'schemas');

export async function generateConfigurationSchemas(
  outputDirectory = defaultOutputDirectory,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeSchema(
      outputDirectory,
      'plysmith.schema.json',
      PlysmithConfigurationSchema,
    ),
    writeSchema(
      outputDirectory,
      'sqlite-provider.schema.json',
      SqliteProviderConfigurationSchema,
    ),
  ]);
}

async function writeSchema(
  outputDirectory: string,
  fileName: string,
  schema: unknown,
): Promise<void> {
  await writeFile(
    path.join(outputDirectory, fileName),
    `${JSON.stringify(sortObject(schema), null, 2)}\n`,
    'utf8',
  );
}

if (isMainModule()) {
  await generateConfigurationSchemas();
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return (
    entryPoint !== undefined &&
    path.resolve(entryPoint) === fileURLToPath(import.meta.url)
  );
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortObject(nested)]),
  );
}
