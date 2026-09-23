import { spawn, type ChildProcess } from 'node:child_process';
import { join as pathJoin } from 'node:path';

type GuardedChildProcess = ChildProcess & {
  readonly stdin: NonNullable<ChildProcess['stdin']>;
  readonly stdout: NonNullable<ChildProcess['stdout']>;
  readonly stderr: NonNullable<ChildProcess['stderr']>;
};

export type LineProcessProblemCode =
  | 'process_start_failed'
  | 'process_exited'
  | 'process_timeout'
  | 'process_output_limit'
  | 'process_write_failed'
  | 'process_busy'
  | 'process_interrupted';

export class LineProcessProblem extends Error {
  readonly code: LineProcessProblemCode;

  constructor(code: LineProcessProblemCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'LineProcessProblem';
    this.code = code;
  }
}

export interface LineProcessOptions {
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly startupTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface LineProcessSession {
  writeLine(line: string): void;
  readLine(timeoutMs: number): Promise<string>;
  resetOutputBudget(): void;
}

export interface LineProcessHandle {
  readonly processId: number;
  readonly session: LineProcessSession;
  waitForExit(timeoutMs: number): Promise<boolean>;
  terminate(timeoutMs: number): Promise<void>;
}

export class LineProcessSupervisor {
  async open(options: LineProcessOptions): Promise<LineProcessHandle> {
    const process = spawnGuardedProcess(options);
    const handle = new ManagedLineProcess(process, options.maxOutputBytes);
    try {
      await handle.waitForStart(options.startupTimeoutMs);
      return handle;
    } catch (error) {
      await handle.terminate(options.stopTimeoutMs);
      throw error;
    }
  }
}

function spawnGuardedProcess(options: LineProcessOptions): GuardedChildProcess {
  const payload = Buffer.from(
    JSON.stringify({
      executablePath: options.executablePath,
      arguments: options.arguments,
    }),
    'utf8',
  ).toString('base64url');
  const child = spawn(process.execPath, ['-e', guardianSource, payload], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: minimalEnvironment(),
  });
  if (child.stdin === null || child.stdout === null || child.stderr === null) {
    child.kill();
    throw new LineProcessProblem('process_start_failed');
  }
  return child as GuardedChildProcess;
}

class ManagedLineProcess implements LineProcessHandle, LineProcessSession {
  readonly session: LineProcessSession = this;
  readonly #process: GuardedChildProcess;
  readonly #maxOutputBytes: number;
  readonly #lines: string[] = [];
  readonly #readers: Array<{
    resolve: (line: string) => void;
    reject: (error: unknown) => void;
  }> = [];
  #buffer = '';
  #outputBytes = 0;
  #failure: LineProcessProblem | undefined;
  #exited = false;
  #targetProcessId: number | undefined;
  #targetExited = false;
  #orphanCleanup: Promise<void> = Promise.resolve();

  constructor(process: GuardedChildProcess, maxOutputBytes: number) {
    this.#process = process;
    this.#maxOutputBytes = maxOutputBytes;
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) =>
      this.#acceptOutput(chunk, true),
    );
    process.stderr.on('data', (chunk: string) =>
      this.#acceptOutput(chunk, false),
    );
    process.stdin.on('error', (error) =>
      this.#fail(new LineProcessProblem('process_write_failed', error)),
    );
    process.on('error', (error) =>
      this.#fail(new LineProcessProblem('process_start_failed', error)),
    );
    process.on('message', (message: unknown) => {
      if (!isGuardianMessage(message)) return;
      if (message.kind === 'target_started') {
        this.#targetProcessId = message.processId;
      } else if (message.processId === this.#targetProcessId) {
        this.#targetExited = true;
      }
    });
    process.on('exit', () => {
      this.#exited = true;
      if (!this.#targetExited && this.#targetProcessId !== undefined) {
        this.#orphanCleanup = terminateProcessTree(this.#targetProcessId);
      }
      if (this.#failure === undefined && this.#readers.length > 0) {
        this.#fail(new LineProcessProblem('process_exited'));
      }
    });
  }

  get processId(): number {
    const processId = this.#process.pid;
    if (processId === undefined) {
      throw new LineProcessProblem('process_start_failed');
    }
    return processId;
  }

  async waitForStart(timeoutMs: number): Promise<void> {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#process.pid !== undefined) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new LineProcessProblem('process_timeout')),
        timeoutMs,
      );
      this.#process.once('spawn', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.#process.once('error', (error) => {
        clearTimeout(timeout);
        reject(new LineProcessProblem('process_start_failed', error));
      });
    });
  }

  writeLine(line: string): void {
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#exited || !this.#process.stdin.writable) {
      throw new LineProcessProblem('process_write_failed');
    }
    if (line.includes('\n') || line.includes('\r')) {
      throw new LineProcessProblem('process_write_failed');
    }
    this.#process.stdin.write(`${line}\n`, 'utf8', (error) => {
      if (error !== null) {
        this.#fail(new LineProcessProblem('process_write_failed', error));
      }
    });
  }

  readLine(timeoutMs: number): Promise<string> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    const line = this.#lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.#exited) {
      return Promise.reject(new LineProcessProblem('process_exited'));
    }
    return new Promise<string>((resolve, reject) => {
      const reader = {
        resolve: (value: string) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      const timeout = setTimeout(() => {
        const index = this.#readers.indexOf(reader);
        if (index >= 0) this.#readers.splice(index, 1);
        reject(new LineProcessProblem('process_timeout'));
      }, timeoutMs);
      this.#readers.push(reader);
    });
  }

  resetOutputBudget(): void {
    this.#outputBytes = 0;
  }

  async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.#exited) {
      await this.#orphanCleanup;
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const finish = (exited: boolean): void => {
        clearTimeout(timeout);
        this.#process.removeListener('exit', onExit);
        resolve(exited);
      };
      const onExit = (): void => {
        void this.#orphanCleanup.then(() => finish(true));
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      this.#process.once('exit', onExit);
    });
  }

  async terminate(timeoutMs: number): Promise<void> {
    if (this.#exited) {
      await this.#orphanCleanup;
      return;
    }
    this.#process.stdin.end();
    if (await this.waitForExit(timeoutMs)) return;
    this.#process.kill('SIGKILL');
    await this.waitForExit(timeoutMs);
  }

  #acceptOutput(chunk: string, parseLines: boolean): void {
    this.#outputBytes += Buffer.byteLength(chunk, 'utf8');
    if (this.#outputBytes > this.#maxOutputBytes) {
      this.#fail(new LineProcessProblem('process_output_limit'));
      this.#process.kill('SIGKILL');
      return;
    }
    if (!parseLines) return;
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(newline + 1);
      const reader = this.#readers.shift();
      if (reader === undefined) this.#lines.push(line);
      else reader.resolve(line);
    }
  }

  #fail(problem: LineProcessProblem): void {
    if (this.#failure !== undefined) return;
    this.#failure = problem;
    for (const reader of this.#readers.splice(0)) reader.reject(problem);
  }
}

interface GuardianMessage {
  readonly kind: 'target_started' | 'target_exited';
  readonly processId: number;
}

function isGuardianMessage(value: unknown): value is GuardianMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<GuardianMessage>;
  return (
    (candidate.kind === 'target_started' ||
      candidate.kind === 'target_exited') &&
    Number.isSafeInteger(candidate.processId) &&
    (candidate.processId ?? 0) > 0
  );
}

async function terminateProcessTree(processId: number): Promise<void> {
  if (process.platform === 'win32') {
    const systemRoot =
      process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
    const taskkill = pathJoin(systemRoot, 'System32', 'taskkill.exe');
    await new Promise<void>((resolve) => {
      const killer = spawn(taskkill, ['/PID', String(processId), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }
  try {
    process.kill(-processId, 'SIGKILL');
  } catch {
    try {
      process.kill(processId, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

const guardianSource = String.raw`
const { spawn } = require('node:child_process');
const path = require('node:path');
const configuration = JSON.parse(
  Buffer.from(process.argv[1], 'base64url').toString('utf8'),
);
const child = spawn(
  configuration.executablePath,
  configuration.arguments,
  {
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  },
);
let closing = false;
child.once('spawn', () => {
  if (typeof process.send === 'function' && child.pid !== undefined) {
    process.send({ kind: 'target_started', processId: child.pid });
  }
});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

async function closeTree() {
  if (closing) return;
  closing = true;
  if (child.pid !== undefined) {
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
      await new Promise((resolve) => {
        const killer = spawn(
          taskkill,
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' },
        );
        killer.once('error', resolve);
        killer.once('exit', resolve);
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
    }
  }
}

process.stdin.once('end', () => void closeTree());
process.stdin.once('close', () => void closeTree());
process.once('SIGINT', () => void closeTree());
process.once('SIGTERM', () => void closeTree());
child.once('error', (error) => {
  process.stderr.write(String(error && error.message || error));
  process.exit(1);
});
child.once('exit', (code) => {
  const exit = () => {
    process.exitCode = code === null ? 1 : code;
    process.exit();
  };
  if (typeof process.send === 'function' && child.pid !== undefined) {
    process.send(
      { kind: 'target_exited', processId: child.pid },
      exit,
    );
  } else {
    exit();
  }
});
`;

function minimalEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'HOME',
    'TMP',
    'TEMP',
  ]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
