import { execFile } from 'node:child_process';
import path from 'node:path';

import {
  HostLifecycleProblem,
  type HostLifecycleProblemCode,
} from './host-lifecycle-problem.ts';

// Windows PowerShell exposes the native ACL/FileShare APIs absent from Node's fs.
// Paths and data travel on stdin, never through PowerShell source interpolation.
export async function withPrivateWindowsRuntime(
  applicationHome: string,
  operation: string,
  input: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await runPrivateWindowsRuntime(
    applicationHome,
    `
    Assert-RegularPath $runtimePath
    $directory = [IO.Directory]::CreateDirectory($runtimePath, (New-PrivateAcl $true $true))
    Assert-CurrentOwner $directory.GetAccessControl()
    # Existing owners need WRITE_DAC, not WRITE_OWNER, to replace their DACL.
    $directory.SetAccessControl((New-PrivateAcl $true))
    Assert-PrivateAcl $directory.GetAccessControl()
    ${operation}
    `,
    input,
  );
}

export function readPrivateWindowsRuntimeFile(
  applicationHome: string,
  fileName: string,
): Promise<string> {
  return runPrivateWindowsRuntime(
    applicationHome,
    `
    Assert-RegularPath $runtimePath
    if (-not [IO.Directory]::Exists($runtimePath)) {
      throw 'host.discovery_missing'
    }
    $directory = [IO.DirectoryInfo]::new($runtimePath)
    Assert-PrivateAcl $directory.GetAccessControl()

    if ([IO.Path]::GetFileName($inputData.fileName) -ne $inputData.fileName) {
      throw 'Invalid runtime file name.'
    }
    $filePath = [IO.Path]::Combine($runtimePath, $inputData.fileName)
    Assert-RegularPath $filePath
    if (-not [IO.File]::Exists($filePath)) {
      throw 'host.discovery_missing'
    }
    $stream = [IO.FileStream]::new($filePath, [IO.FileMode]::Open,
      [Security.AccessControl.FileSystemRights] 'Read, ReadPermissions, Synchronize',
      [IO.FileShare]::Read, 4096, [IO.FileOptions]::SequentialScan)
    try {
      Assert-PrivateAcl $stream.GetAccessControl()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true, 1024, $true)
      try {
        [Console]::Out.Write($reader.ReadToEnd())
      } finally {
        $reader.Dispose()
      }
    } finally {
      $stream.Dispose()
    }
    `,
    { fileName },
  );
}

async function runPrivateWindowsRuntime(
  applicationHome: string,
  operation: string,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  const systemRoot = process.env.SystemRoot;
  if (process.platform !== 'win32' || !systemRoot) {
    throw new HostLifecycleProblem('host.lease_unavailable');
  }

  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $runtimePath = $inputData.runtimePath
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User

  function New-PrivateAcl([bool] $directory, [bool] $setOwner = $false) {
    # Persistence clears .NET change flags, so each call returns a fresh descriptor.
    $acl = if ($directory) {
      [Security.AccessControl.DirectorySecurity]::new()
    } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    if ($setOwner) { $acl.SetOwner($sid) }
    $inheritance = if ($directory) { 'ContainerInherit, ObjectInherit' } else { 'None' }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $sid, 'FullControl', $inheritance, 'None', 'Allow'))
    return $acl
  }

  function Assert-CurrentOwner([Security.AccessControl.FileSystemSecurity] $acl) {
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
      throw 'Runtime storage belongs to another user.'
    }
  }

  function Assert-PrivateAcl([Security.AccessControl.FileSystemSecurity] $acl) {
    Assert-CurrentOwner $acl
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if (-not $acl.AreAccessRulesProtected -or
        $rules.Count -ne 1 -or $rules[0].IsInherited -or
        $rules[0].IdentityReference.Value -ne $sid.Value -or
        $rules[0].AccessControlType -ne 'Allow' -or
        $rules[0].FileSystemRights -ne 'FullControl') {
      throw 'Runtime storage is not private to the current user.'
    }
  }

  function Assert-RegularPath([string] $filePath) {
    if (Test-Path -LiteralPath $filePath) {
      $attributes = [IO.File]::GetAttributes($filePath)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Reparse points are not runtime storage.'
      }
    }
  }

  function Open-PrivateFile([string] $filePath, [IO.FileMode] $mode) {
    Assert-RegularPath $filePath
    $stream = [IO.FileStream]::new($filePath, $mode,
      [Security.AccessControl.FileSystemRights] 'Read, Write, ChangePermissions, Synchronize',
      [IO.FileShare]::None, 4096, [IO.FileOptions]::None, (New-PrivateAcl $false $true))
    try {
      Assert-CurrentOwner $stream.GetAccessControl()
      $stream.SetAccessControl((New-PrivateAcl $false))
      Assert-PrivateAcl $stream.GetAccessControl()
      return $stream
    } catch {
      $stream.Dispose()
      throw
    }
  }

  ${operation}
} catch {
  if ($_.Exception.Message -in @('host.already_running', 'host.discovery_missing')) {
    [Console]::Out.Write($_.Exception.Message)
  } else {
    $cause = $_.Exception.GetBaseException()
    [Console]::Error.WriteLine(('{0} (HRESULT 0x{1:X8}): {2}' -f
      $cause.GetType().FullName, $cause.HResult, $cause.Message))
  }
  exit 1
}
`;

  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      path.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 4096 },
      (error, stdout, stderr) => {
        if (error) {
          const reportedCode = stdout.trim();
          const code: HostLifecycleProblemCode =
            reportedCode === 'host.already_running' ||
            reportedCode === 'host.discovery_missing'
              ? reportedCode
              : 'host.lease_unavailable';
          const problem = new HostLifecycleProblem(code);
          problem.cause = new Error(
            stderr.trim() || `Windows runtime helper failed (${error.code}).`,
          );
          reject(problem);
        } else {
          resolve(stdout);
        }
      },
    );
    child.stdin?.on('error', () => {
      // execFile reports early process exit through its completion callback.
    });
    child.stdin?.end(
      JSON.stringify({
        ...input,
        runtimePath: path.resolve(applicationHome, 'runtime'),
      }),
    );
  });
}
