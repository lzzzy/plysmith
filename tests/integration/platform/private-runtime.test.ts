import assert from 'node:assert/strict';
import childProcess, {
  type ExecFileException,
  type ExecFileOptions,
} from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';

import {
  acquireHostOwnerLease,
  HostLifecycleProblem,
} from '../../../app/infrastructure/adapters/platform/windows/index.ts';

type Completion = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;
interface HelperCall {
  file: string;
  args: readonly string[];
  options: ExecFileOptions;
  complete: Completion;
  stdin: PassThrough;
  input: string;
}
const applicationHome = path.resolve("build/verification/helper's home");
const windowsOnly = { skip: process.platform !== 'win32' };

function interceptHelper(
  context: TestContext,
  simulate: (call: HelperCall) => void,
): HelperCall[] {
  const calls: HelperCall[] = [];
  const stub = context.mock.method(childProcess, 'execFile', ((
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
    complete: Completion,
  ) => {
    const call: HelperCall = {
      file,
      args,
      options,
      complete,
      stdin: new PassThrough(),
      input: '',
    };
    call.stdin.on('data', (chunk: Buffer) => {
      call.input += chunk.toString('utf8');
    });
    calls.push(call);
    simulate(call);
    const child = new childProcess.ChildProcess();
    child.stdin = call.stdin;
    return child;
  }) as typeof childProcess.execFile);
  syncBuiltinESMExports();
  context.after(() => {
    stub.mock.restore();
    syncBuiltinESMExports();
  });
  return calls;
}

function helperError(
  code: Exclude<ExecFileException['code'], undefined>,
  killed = false,
  signal?: NodeJS.Signals,
): ExecFileException {
  return Object.assign(
    new Error('Do not echo the raw command or stdin secret'),
    {
      code,
      killed,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}

test(
  'a single slow Windows helper cold start succeeds beyond 15 seconds and release stays idempotent',
  windowsOnly,
  async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = interceptHelper(context, (call) => {
      const completion = setTimeout(() => {
        clearTimeout(deadline);
        call.complete(null, '', '');
      }, 20_000);
      const deadline = setTimeout(() => {
        clearTimeout(completion);
        call.complete(helperError(null, true, 'SIGTERM'), '', '');
      }, call.options.timeout);
    });
    const pending = acquireHostOwnerLease(applicationHome);
    context.mock.timers.tick(20_000);
    const lease = await pending;
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.options.timeout, 60_000);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.maxBuffer, 4096);
    assert.equal(
      call.file,
      path.join(
        process.env.SystemRoot!,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
    );
    assert.deepEqual(call.args.slice(0, 3), [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
    ]);
    const input = JSON.parse(call.input);
    assert.equal(input.runtimePath, path.join(applicationHome, 'runtime'));
    assert.equal(input.release, false);
    assert.equal(input.ownerId, lease.ownerId);
    const script = Buffer.from(call.args[3]!, 'base64').toString('utf16le');
    assert.ok(!script.includes(applicationHome));
    assert.ok(!script.includes(lease.ownerId));
    const release = lease.release();
    assert.equal(lease.release(), release);
    context.mock.timers.tick(20_000);
    await release;
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.options.timeout, 60_000);
    assert.equal(JSON.parse(calls[1]!.input).release, true);
  },
);

test(
  'Windows helper deadline remains bounded, fails closed and reports timeout even with stderr',
  windowsOnly,
  async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = interceptHelper(context, (call) => {
      setTimeout(
        () =>
          call.complete(
            helperError(null, true, 'SIGTERM'),
            '',
            'Helper interrupted.',
          ),
        call.options.timeout,
      );
    });
    const pending = assert.rejects(
      acquireHostOwnerLease(applicationHome),
      (error) => {
        assert.ok(error instanceof HostLifecycleProblem);
        assert.equal(error.code, 'host.lease_unavailable');
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /timed out after 60000ms/);
        assert.match(error.cause.message, /Helper interrupted/);
        assert.doesNotMatch(error.cause.message, /raw command|stdin secret/);
        return true;
      },
    );
    context.mock.timers.tick(60_000);
    await pending;
    assert.equal(calls.length, 1);
  },
);

for (const code of [
  'host.already_running',
  'host.discovery_missing',
] as const) {
  test(
    `Windows helper preserves ${code} and tolerates early stdin closure without retry`,
    windowsOnly,
    async (context) => {
      const calls = interceptHelper(context, (call) => {
        queueMicrotask(() => {
          call.stdin.emit('error', new Error('EPIPE'));
          call.complete(helperError(1), ` ${code}\n`, '');
        });
      });
      await assert.rejects(acquireHostOwnerLease(applicationHome), (error) => {
        assert.ok(error instanceof HostLifecycleProblem);
        assert.equal(error.code, code);
        return true;
      });
      assert.equal(calls.length, 1);
    },
  );
}

test(
  'Windows helper permission failure remains immediate, specific and fail-closed without retry',
  windowsOnly,
  async (context) => {
    const calls = interceptHelper(context, (call) => {
      queueMicrotask(() =>
        call.complete(
          helperError(1),
          '',
          'Access is denied (HRESULT 0x80070005).',
        ),
      );
    });
    await assert.rejects(acquireHostOwnerLease(applicationHome), (error) => {
      assert.ok(error instanceof HostLifecycleProblem);
      assert.equal(error.code, 'host.lease_unavailable');
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /0x80070005/);
      assert.doesNotMatch(
        error.cause.message,
        /timed out|raw command|stdin secret/,
      );
      return true;
    });
    assert.equal(calls.length, 1);
  },
);

test(
  'Windows helper output budget failure is not misreported as a timeout',
  windowsOnly,
  async (context) => {
    const calls = interceptHelper(context, (call) => {
      queueMicrotask(() =>
        call.complete(
          helperError('ERR_CHILD_PROCESS_STDIO_MAXBUFFER', true, 'SIGTERM'),
          '',
          '',
        ),
      );
    });
    await assert.rejects(acquireHostOwnerLease(applicationHome), (error) => {
      assert.ok(error instanceof HostLifecycleProblem);
      assert.equal(error.code, 'host.lease_unavailable');
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /ERR_CHILD_PROCESS_STDIO_MAXBUFFER/);
      assert.doesNotMatch(
        error.cause.message,
        /timed out|raw command|stdin secret/,
      );
      return true;
    });
    assert.equal(calls.length, 1);
  },
);

test(
  'Windows helper external termination reports the signal without claiming a timeout',
  windowsOnly,
  async (context) => {
    interceptHelper(context, (call) => {
      queueMicrotask(() =>
        call.complete(helperError(null, false, 'SIGKILL'), '', ''),
      );
    });
    await assert.rejects(acquireHostOwnerLease(applicationHome), (error) => {
      assert.ok(error instanceof HostLifecycleProblem);
      assert.equal(error.code, 'host.lease_unavailable');
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /SIGKILL/);
      assert.doesNotMatch(
        error.cause.message,
        /timed out|raw command|stdin secret/,
      );
      return true;
    });
  },
);
