import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type LineProcessProblemCode =
  | 'process_start_failed'
  | 'process_exited'
  | 'process_timeout'
  | 'process_output_limit'
  | 'process_write_failed';

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
}

export class LineProcessSupervisor {
  async run<T>(
    options: LineProcessOptions,
    work: (session: LineProcessSession) => Promise<T>,
  ): Promise<T> {
    const process = spawn(options.executablePath, [...options.arguments], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: minimalEnvironment(),
    });
    const session = new ManagedLineProcess(process, options.maxOutputBytes);
    try {
      await session.waitForStart(options.startupTimeoutMs);
      return await work(session);
    } finally {
      await session.stop(options.stopTimeoutMs);
    }
  }
}

class ManagedLineProcess implements LineProcessSession {
  readonly #process: ChildProcessWithoutNullStreams;
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

  constructor(process: ChildProcessWithoutNullStreams, maxOutputBytes: number) {
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
    process.on('error', (error) =>
      this.#fail(new LineProcessProblem('process_start_failed', error)),
    );
    process.on('exit', () => {
      this.#exited = true;
      if (this.#failure === undefined && this.#readers.length > 0) {
        this.#fail(new LineProcessProblem('process_exited'));
      }
    });
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

  async stop(timeoutMs: number): Promise<void> {
    if (this.#exited) return;
    if (this.#process.stdin.writable) {
      try {
        this.#process.stdin.write('quit\n');
      } catch {
        // Hard termination below remains authoritative.
      }
    }
    const exited = await Promise.race([
      new Promise<true>((resolve) =>
        this.#process.once('exit', () => resolve(true)),
      ),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), timeoutMs),
      ),
    ]);
    if (!exited && !this.#exited) {
      this.#process.kill('SIGKILL');
      await Promise.race([
        new Promise<void>((resolve) =>
          this.#process.once('exit', () => resolve()),
        ),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
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
