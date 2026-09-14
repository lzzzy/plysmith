import { randomUUID } from 'node:crypto';

import { withPrivateWindowsRuntime } from './private-runtime.ts';

export interface HostOwnerLease {
  readonly ownerId: string;
  readonly pid: number;
  release(): Promise<void>;
}

export type DevelopmentWatchLease = HostOwnerLease;

// The persistent guard is never unlinked. FileShare.None serializes the complete
// read/recover/write transition; Windows releases the handle on helper crashes.
const ownerLockScript = `
$leasePath = [IO.Path]::Combine($runtimePath, $inputData.leaseStem + '.json')
$guardPath = [IO.Path]::Combine($runtimePath, $inputData.leaseStem + '.lock')
$guard = $null
for ($attempt = 0; $null -eq $guard; $attempt++) {
  try {
    $guard = Open-PrivateFile $guardPath OpenOrCreate
  } catch {
    $cause = $_.Exception.GetBaseException()
    if (($cause.HResult -band 0xffff) -notin 32, 33) { throw }
    if (-not $inputData.release -or $attempt -ge 100) {
      throw 'host.already_running'
    }
    Start-Sleep -Milliseconds 20
  }
}
try {
  if ($inputData.release -and -not [IO.File]::Exists($leasePath)) { return }
  $lease = Open-PrivateFile $leasePath OpenOrCreate
  try {
    $reader = [IO.StreamReader]::new($lease, [Text.Encoding]::UTF8, $true, 1024, $true)
    try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $record = $null
    try { $record = $content | ConvertFrom-Json } catch { }

    if ($inputData.release) {
      $removeOwnedLease = $null -ne $record -and $record.ownerId -eq $inputData.ownerId
    } else {
      if ($null -ne $record -and $null -ne $record.pid) {
        $ownerPid = 0
        if (-not [int]::TryParse([string] $record.pid, [ref] $ownerPid) -or $ownerPid -lt 1) {
          throw 'Invalid owner process.'
        }
        $ownerExists = $false
        try {
          $owner = [Diagnostics.Process]::GetProcessById($ownerPid)
          try {
            $ownerExists = $true
            $ownerStartedAtUtc = $owner.StartTime.ToUniversalTime()
          } finally {
            $owner.Dispose()
          }
        } catch [ArgumentException] {
          # Only a definitely absent process permits recovery of a valid lease.
        }
        $recordStartedAtUtc = [DateTime]::MinValue
        $hasStartIdentity = [DateTime]::TryParseExact(
          [string] $record.processStartedAtUtc,
          'O',
          [Globalization.CultureInfo]::InvariantCulture,
          [Globalization.DateTimeStyles]::RoundtripKind,
          [ref] $recordStartedAtUtc)
        if ($ownerExists -and
            (-not $hasStartIdentity -or
             $recordStartedAtUtc.ToUniversalTime().Ticks -eq $ownerStartedAtUtc.Ticks)) {
          # Legacy or malformed identities stay fail-safe while their PID exists.
          throw 'host.already_running'
        }
      }

      $current = [Diagnostics.Process]::GetProcessById([int] $inputData.pid)
      try {
        $processStartedAtUtc = $current.StartTime.ToUniversalTime().ToString(
          'O', [Globalization.CultureInfo]::InvariantCulture)
      } finally {
        $current.Dispose()
      }
      $nextRecord = @{
        ownerId = [string] $inputData.ownerId
        pid = [int] $inputData.pid
        processStartedAtUtc = $processStartedAtUtc
      } | ConvertTo-Json -Compress
      $bytes = [Text.Encoding]::UTF8.GetBytes($nextRecord + [Environment]::NewLine)
      $lease.Position = 0
      $lease.SetLength(0)
      $lease.Write($bytes, 0, $bytes.Length)
      $lease.Flush($true)
    }
  } finally {
    $lease.Dispose()
  }
  if ($inputData.release -and $removeOwnedLease) {
    [IO.File]::Delete($leasePath)
  }
} finally {
  $guard.Dispose()
}
`;

export async function acquireHostOwnerLease(
  applicationHome: string,
): Promise<HostOwnerLease> {
  return acquireRuntimeOwnerLease(applicationHome, 'host-owner');
}

export async function acquireDevelopmentWatchLease(
  applicationHome: string,
): Promise<DevelopmentWatchLease> {
  return acquireRuntimeOwnerLease(applicationHome, 'development-watch');
}

async function acquireRuntimeOwnerLease(
  applicationHome: string,
  leaseStem: 'host-owner' | 'development-watch',
): Promise<HostOwnerLease> {
  const ownerId = randomUUID();
  await withPrivateWindowsRuntime(applicationHome, ownerLockScript, {
    ownerId,
    pid: process.pid,
    release: false,
    leaseStem,
  });

  let releasePromise: Promise<void> | undefined;
  return Object.freeze({
    ownerId,
    pid: process.pid,
    release() {
      releasePromise ??= withPrivateWindowsRuntime(
        applicationHome,
        ownerLockScript,
        { ownerId, release: true, leaseStem },
      );
      return releasePromise;
    },
  });
}
