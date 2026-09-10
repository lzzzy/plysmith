import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs, {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  acquireHostOwnerLease,
  clearHostDiscovery,
  HostLifecycleProblem,
  publishHostDiscovery,
  readHostDiscovery,
} from '../../../app/infrastructure/adapters/platform/windows/index.ts';

test('holds one host owner lease and releases it explicitly', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const first = await acquireHostOwnerLease(applicationHome);
  const guardPath = path.join(applicationHome, 'runtime', 'host-owner.lock');
  const guardIdentity = (await stat(guardPath)).ino;

  await assert.rejects(
    acquireHostOwnerLease(applicationHome),
    hasLifecycleCode('host.already_running'),
  );

  await first.release();
  const second = await acquireHostOwnerLease(applicationHome);
  await second.release();
  assert.equal((await stat(guardPath)).ino, guardIdentity);
});

test('replaces a stale host owner lease', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const runtimeDirectory = path.join(applicationHome, 'runtime');
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(
    path.join(runtimeDirectory, 'host-owner.json'),
    `${JSON.stringify({ ownerId: 'stale', pid: 2_147_483_647 })}\n`,
    'utf8',
  );

  const lease = await acquireHostOwnerLease(applicationHome);
  assert.equal(lease.pid, process.pid);
  await lease.release();
});

test('recovers a lease when its host PID has been reused by another process', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const runtimeDirectory = path.join(applicationHome, 'runtime');
  const leasePath = path.join(runtimeDirectory, 'host-owner.json');
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(
    leasePath,
    `${JSON.stringify({
      ownerId: 'crashed-host',
      pid: process.pid,
      processStartedAtUtc: '2000-01-01T00:00:00.0000000Z',
    })}\n`,
    'utf8',
  );

  const lease = await acquireHostOwnerLease(applicationHome);
  const recovered = JSON.parse(await readFile(leasePath, 'utf8')) as {
    ownerId: string;
    pid: number;
    processStartedAtUtc: string;
  };
  assert.equal(recovered.ownerId, lease.ownerId);
  assert.equal(recovered.pid, process.pid);
  assert.notEqual(
    recovered.processStartedAtUtc,
    '2000-01-01T00:00:00.0000000Z',
  );
  await lease.release();
});

test('keeps an unverifiable lease fail-safe while its PID still exists', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const runtimeDirectory = path.join(applicationHome, 'runtime');
  const leasePath = path.join(runtimeDirectory, 'host-owner.json');
  await mkdir(runtimeDirectory, { recursive: true });

  for (const record of [
    { ownerId: 'legacy-host', pid: process.pid },
    {
      ownerId: 'malformed-host',
      pid: process.pid,
      processStartedAtUtc: 'not-a-process-start-time',
    },
  ]) {
    await writeFile(leasePath, `${JSON.stringify(record)}\n`, 'utf8');
    await assert.rejects(
      acquireHostOwnerLease(applicationHome),
      hasLifecycleCode('host.already_running'),
    );
  }
});

test('does not steal an empty lease while its owner transition holds the Windows lock', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const writer = await pauseLeaseWriter(context, applicationHome);
  const leasePath = path.join(applicationHome, 'runtime', 'host-owner.json');

  await assert.rejects(
    acquireHostOwnerLease(applicationHome),
    hasLifecycleCode('host.already_running'),
  );
  assert.equal(await readFile(leasePath, 'utf8'), '');

  await writer.complete();
  await assert.rejects(
    acquireHostOwnerLease(applicationHome),
    hasLifecycleCode('host.already_running'),
  );
  assert.equal(
    JSON.parse(await readFile(leasePath, 'utf8')).ownerId,
    'paused-owner',
  );
});

test('recovers an interrupted empty lease after Windows releases the crashed writer lock', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const writer = await pauseLeaseWriter(context, applicationHome);
  await writer.crash();

  const lease = await acquireHostOwnerLease(applicationHome);
  context.after(() => lease.release());
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(applicationHome, 'runtime', 'host-owner.json'),
        'utf8',
      ),
    ).ownerId,
    lease.ownerId,
  );
});

test('elects exactly one owner when two acquisitions recover the same stale lease', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const runtimeDirectory = path.join(applicationHome, 'runtime');
  await mkdir(runtimeDirectory);
  await writeFile(
    path.join(runtimeDirectory, 'host-owner.json'),
    JSON.stringify({ ownerId: 'stale', pid: 2_147_483_647 }),
  );

  const results = await Promise.allSettled([
    acquireHostOwnerLease(applicationHome),
    acquireHostOwnerLease(applicationHome),
  ]);
  for (const result of results) {
    if (result.status === 'fulfilled')
      context.after(() => result.value.release());
  }
  const winners = results.filter((result) => result.status === 'fulfilled');
  const losers = results.filter((result) => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.ok(hasLifecycleCode('host.already_running')(losers[0]?.reason));
  assert.equal(
    JSON.parse(
      await readFile(path.join(runtimeDirectory, 'host-owner.json'), 'utf8'),
    ).ownerId,
    winners[0]?.value.ownerId,
  );
});

test('never clears another owner lease on release', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const lease = await acquireHostOwnerLease(applicationHome);
  const leasePath = path.join(applicationHome, 'runtime', 'host-owner.json');
  const replacement = JSON.stringify({
    ownerId: 'replacement',
    pid: process.pid,
  });
  await writeFile(leasePath, replacement);
  await Promise.all([lease.release(), lease.release()]);
  assert.equal(await readFile(leasePath, 'utf8'), replacement);
});

test('repairs permissive Windows ACLs without ownership privileges and protects the discovery temp file before writing the token', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const runtimeDirectory = path.join(applicationHome, 'runtime');
  const discoveryPath = path.join(runtimeDirectory, 'host.json');
  const leasePath = path.join(runtimeDirectory, 'host-owner.json');
  const guardPath = path.join(runtimeDirectory, 'host-owner.lock');
  await mkdir(runtimeDirectory);
  await writeFile(discoveryPath, '{}');
  await writeFile(
    leasePath,
    JSON.stringify({ ownerId: 'stale', pid: 2_147_483_647 }),
  );
  await writeFile(guardPath, '');
  await runPowerShell(
    `
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($filePath in $inputData.paths) {
      $item = if ([IO.Directory]::Exists($filePath)) {
        [IO.DirectoryInfo]::new($filePath)
      } else { [IO.FileInfo]::new($filePath) }
      $acl = $item.GetAccessControl()
      foreach ($group in @('S-1-5-32-545', 'S-1-5-11')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
          [Security.Principal.SecurityIdentifier]::new($group), 'Modify', 'Allow'))
      }
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $sid, 'TakeOwnership', 'Deny'))
      $item.SetAccessControl($acl)
    }
  `,
    { paths: [runtimeDirectory, discoveryPath, leasePath, guardPath] },
  );
  const before = await readAcl(discoveryPath);
  assert.ok(before.rules.some((rule) => rule.sid === 'S-1-5-32-545'));
  assert.ok(before.rules.some((rule) => rule.sid === 'S-1-5-11'));
  assert.equal(before.owner, before.currentUser);
  assert.ok(
    before.rules.some(
      (rule) =>
        !rule.allow &&
        rule.sid === before.currentUser &&
        rule.rights === 0x80000,
    ),
  );

  const lease = await acquireHostOwnerLease(applicationHome);
  context.after(() => lease.release());
  let checkedTemporaryFiles = 0;
  const originalWriteFile = fs.writeFile;
  const writeMock = context.mock.method(
    fs,
    'writeFile',
    async (...args: Parameters<typeof fs.writeFile>) => {
      const filePath = args[0];
      if (
        typeof filePath === 'string' &&
        path.basename(filePath).startsWith('.host-')
      ) {
        assert.equal((await stat(filePath)).size, 0);
        await assertUserExclusiveAcl(filePath);
        checkedTemporaryFiles += 1;
      }
      return originalWriteFile(...args);
    },
  );
  syncBuiltinESMExports();
  context.after(() => {
    writeMock.mock.restore();
    syncBuiltinESMExports();
  });

  const record = discoveryRecord(lease.ownerId);
  await publishHostDiscovery(applicationHome, record);
  assert.equal(checkedTemporaryFiles, 1);
  assert.deepEqual(await readHostDiscovery(applicationHome), record);
  for (const filePath of [
    runtimeDirectory,
    discoveryPath,
    leasePath,
    guardPath,
  ]) {
    await assertUserExclusiveAcl(filePath);
  }
});

test('fails closed on denied ACL access without replacing discovery or granting a lease', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const runtimeDirectory = path.join(applicationHome, 'runtime');
  await mkdir(runtimeDirectory);
  const paths = ['host.json', 'host-owner.json'].map((name) =>
    path.join(runtimeDirectory, name),
  );
  for (const filePath of paths) await writeFile(filePath, 'unchanged');
  await runPowerShell(
    `
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($filePath in $inputData.paths) {
      $item = [IO.FileInfo]::new($filePath)
      $acl = $item.GetAccessControl()
      $acl.SetAccessRuleProtection($true, $true)
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $sid, 'WriteData', 'Deny'))
      $item.SetAccessControl($acl)
    }
  `,
    { paths },
  );

  await assert.rejects(
    readHostDiscovery(applicationHome),
    hasLifecycleCode('host.lease_unavailable'),
  );
  await assert.rejects(
    publishHostDiscovery(applicationHome, discoveryRecord('blocked')),
    (error: unknown) => {
      assert.ok(error instanceof HostLifecycleProblem);
      assert.equal(error.code, 'host.lease_unavailable');
      assert.ok(error.cause instanceof Error);
      assert.match(
        error.cause.message,
        /UnauthorizedAccessException \(HRESULT 0x80070005\)/,
      );
      return true;
    },
  );
  await assert.rejects(
    acquireHostOwnerLease(applicationHome),
    hasLifecycleCode('host.lease_unavailable'),
  );
  for (const filePath of paths)
    assert.equal(await readFile(filePath, 'utf8'), 'unchanged');
  assert.ok(
    (await readdir(runtimeDirectory)).every((name) => !name.endsWith('.tmp')),
  );
});

test('rejects a redirected runtime directory before touching its target', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const target = await createApplicationHome(context);
  await symlink(target, path.join(applicationHome, 'runtime'), 'junction');
  await assert.rejects(
    acquireHostOwnerLease(applicationHome),
    hasLifecycleCode('host.lease_unavailable'),
  );
  await assert.rejects(
    publishHostDiscovery(applicationHome, discoveryRecord('redirected')),
    hasLifecycleCode('host.lease_unavailable'),
  );
  await assert.rejects(
    readHostDiscovery(applicationHome),
    hasLifecycleCode('host.lease_unavailable'),
  );
  assert.deepEqual(await readdir(target), []);
});

test('rejects permissive discovery ACLs without repairing them while reading', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const discoveryPath = path.join(applicationHome, 'runtime', 'host.json');
  await publishHostDiscovery(applicationHome, discoveryRecord('owner-1'));
  await runPowerShell(
    `
    $item = [IO.FileInfo]::new($inputData.filePath)
    $acl = $item.GetAccessControl()
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      [Security.Principal.SecurityIdentifier]::new('S-1-5-11'), 'Read', 'Allow'))
    $item.SetAccessControl($acl)
  `,
    { filePath: discoveryPath },
  );

  await assert.rejects(
    readHostDiscovery(applicationHome),
    hasLifecycleCode('host.lease_unavailable'),
  );
  assert.ok(
    (await readAcl(discoveryPath)).rules.some(
      (rule) => rule.allow && rule.sid === 'S-1-5-11',
    ),
  );
});

test('publishes, reads and owner-clears a loopback discovery record', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const record = {
    ownerId: 'owner-1',
    pid: process.pid,
    endpoint: 'http://127.0.0.1:43121/',
    productRelease: '0.0.0',
    contractFingerprint: 'fingerprint-1',
    token: 'a'.repeat(32),
  } as const;

  await publishHostDiscovery(applicationHome, record);
  assert.deepEqual(await readHostDiscovery(applicationHome), record);

  await clearHostDiscovery(applicationHome, 'another-owner');
  assert.deepEqual(await readHostDiscovery(applicationHome), record);
  await clearHostDiscovery(applicationHome, record.ownerId);
  await assert.rejects(
    readHostDiscovery(applicationHome),
    hasLifecycleCode('host.discovery_missing'),
  );
});

test('rejects non-loopback or malformed discovery data', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const discoveryPath = path.join(applicationHome, 'runtime', 'host.json');
  await publishHostDiscovery(applicationHome, discoveryRecord('owner-1'));

  for (const candidate of [
    '{',
    JSON.stringify({ endpoint: 'https://example.com' }),
  ]) {
    await writeFile(discoveryPath, candidate, 'utf8');
    await assert.rejects(
      readHostDiscovery(applicationHome),
      hasLifecycleCode('host.discovery_invalid'),
    );
  }
});

function hasLifecycleCode(code: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof HostLifecycleProblem && error.code === code;
}

function discoveryRecord(ownerId: string) {
  return {
    ownerId,
    pid: process.pid,
    endpoint: 'http://127.0.0.1:43121/',
    productRelease: '0.0.0',
    contractFingerprint: 'fingerprint-1',
    token: 'a'.repeat(32),
  } as const;
}

const powershellPath = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

async function runPowerShell(
  script: string,
  input: Record<string, unknown>,
): Promise<string> {
  const source = `$ErrorActionPreference = 'Stop'; $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json; ${script}`;
  return new Promise((resolve, reject) => {
    const child = execFile(
      powershellPath,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(source, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr, { cause: error }));
        else resolve(stdout);
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(input));
  });
}

interface WindowsAcl {
  owner: string;
  currentUser: string;
  protected: boolean;
  rules: { sid: string; allow: boolean; inherited: boolean; rights: number }[];
}

async function readAcl(filePath: string): Promise<WindowsAcl> {
  return JSON.parse(
    await runPowerShell(
      `
    $item = if ([IO.Directory]::Exists($inputData.filePath)) {
      [IO.DirectoryInfo]::new($inputData.filePath)
    } else { [IO.FileInfo]::new($inputData.filePath) }
    $acl = $item.GetAccessControl()
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
      @{ sid = $_.IdentityReference.Value; allow = $_.AccessControlType -eq 'Allow';
         inherited = $_.IsInherited; rights = [int] $_.FileSystemRights }
    })
    @{ owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;
       currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
       protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Depth 4 -Compress
  `,
      { filePath },
    ),
  ) as WindowsAcl;
}

async function assertUserExclusiveAcl(filePath: string): Promise<void> {
  const acl = await readAcl(filePath);
  assert.equal(acl.owner, acl.currentUser, filePath);
  assert.equal(acl.protected, true, filePath);
  for (const group of ['S-1-5-32-545', 'S-1-5-11']) {
    assert.equal(
      acl.rules.some((rule) => rule.allow && rule.sid === group),
      false,
      `${filePath}: access for ${group}`,
    );
  }
  assert.deepEqual(
    acl.rules,
    [
      {
        sid: acl.currentUser,
        allow: true,
        inherited: false,
        rights: 2_032_127,
      },
    ],
    filePath,
  );
}

async function pauseLeaseWriter(context: TestContext, applicationHome: string) {
  const runtimeDirectory = path.join(applicationHome, 'runtime');
  // Initialize the real guard/ACLs, then hold precisely the empty-record window.
  const initial = await acquireHostOwnerLease(applicationHome);
  await initial.release();
  const source = `
    $ErrorActionPreference = 'Stop'
    $inputData = [Console]::In.ReadLine() | ConvertFrom-Json
    $guard = [IO.File]::Open([IO.Path]::Combine($inputData.runtimeDirectory, 'host-owner.lock'),
      [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
      $leasePath = [IO.Path]::Combine($inputData.runtimeDirectory, 'host-owner.json')
      [IO.File]::WriteAllText($leasePath, '')
      [Console]::Out.WriteLine('ready')
      if ([Console]::In.ReadLine() -eq 'complete') {
        [IO.File]::WriteAllText($leasePath, $inputData.record)
      }
    } finally { $guard.Dispose() }
  `;
  const child = spawn(
    powershellPath,
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, stdio: 'pipe', timeout: 15_000 },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  context.after(async () => {
    if (child.exitCode === null) child.kill();
    await closed;
  });
  const ready = new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('ready')) resolve();
    });
    void closed.then(() => reject(new Error(stderr)), reject);
  });
  child.stdin.write(
    `${JSON.stringify({ runtimeDirectory, record: JSON.stringify({ ownerId: 'paused-owner', pid: process.pid }) })}\n`,
  );
  await ready;
  return {
    async complete() {
      child.stdin.end('complete\n');
      assert.equal(await closed, 0, stderr);
    },
    async crash() {
      child.kill();
      await closed;
    },
  };
}

async function createApplicationHome(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-host-'));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
