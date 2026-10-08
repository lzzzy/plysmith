import { spawn } from 'node:child_process';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export async function discoverTestFiles(): Promise<readonly string[]> {
  const files: string[] = [];
  for await (const file of glob('tests/**/*.test.ts', {
    cwd: repositoryRoot,
  })) {
    files.push(file.replaceAll('\\', '/'));
  }
  return files.sort();
}

export function partitionTestFiles(files: readonly string[]) {
  const parallel: string[] = [];
  const serial: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/');
    if (seen.has(normalized))
      throw new Error(`Duplicate test file: ${normalized}`);
    seen.add(normalized);
    // Integration files own OS processes, ports or stores. Keep their peak bounded.
    (normalized.startsWith('tests/integration/') ? serial : parallel).push(
      normalized,
    );
  }
  return { parallel: parallel.sort(), serial: serial.sort() };
}

async function runTests(): Promise<void> {
  const files = await discoverTestFiles();
  if (files.length === 0) throw new Error('No test files found.');
  const { parallel, serial } = partitionTestFiles(files);
  let failed = false;
  for (const phase of [
    {
      name: 'domain, application and contracts',
      files: parallel,
      concurrency: 2,
    },
    { name: 'integration', files: serial, concurrency: 1 },
  ]) {
    if (phase.files.length === 0) continue;
    console.log(
      `Test phase: ${phase.name}; ${phase.files.length} files; concurrency ${phase.concurrency}`,
    );
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--test', `--test-concurrency=${phase.concurrency}`, ...phase.files],
        { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true },
      );
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 1));
    });
    failed = exitCode !== 0 || failed;
  }
  process.exitCode = failed ? 1 : 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runTests();
}
