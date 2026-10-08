!macro customCheckAppRunning
  System::Call 'kernel32::SetEnvironmentVariable(t "PLYSMITH_INSTALL_ROOT", t "$INSTDIR") i.r0'
  ${If} $0 == 0
    SetErrorLevel 1
    Quit
  ${EndIf}
  nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "try { $$root = [IO.Path]::GetFullPath($$env:PLYSMITH_INSTALL_ROOT); $$targets = @([IO.Path]::Combine($$root, 'Plysmith.exe'), [IO.Path]::Combine($$root, 'resources', 'runtime', 'node.exe')); $$running = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $$_.ExecutablePath -and ($$targets -contains $$_.ExecutablePath) }); if ($$running.Count -gt 0) { exit 2 }; exit 0 } catch { exit 3 }"`
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Close Plysmith and its Host before installing or uninstalling, then try again." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

!macro customInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro GetDParameter $1
  ${If} $0 == ""
    ${If} $1 == ""
      ${StdUtils.GetParentPath} $0 "$INSTDIR"
      StrCpy $INSTDIR "$0\Plysmith"
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "PLYSMITH_INSTALL_ROOT", t "$INSTDIR") i.r0'
  ${If} $0 == 0
    SetErrorLevel 1
    Quit
  ${EndIf}
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "try { $$root = [IO.Path]::GetFullPath($$env:PLYSMITH_INSTALL_ROOT); $$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($$root)); if ($$drive.AvailableFreeSpace -lt 700MB) { exit 2 }; exit 0 } catch { exit 3 }"`
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Plysmith needs at least 700 MB of free disk space to install." /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

!macro removeCachedInstaller
  Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  ${StdUtils.GetParentPath} $0 "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  RMDir "$0"
!macroend

!macro customInstall
  !insertmacro removeCachedInstaller
!macroend

!macro customUnInstall
  !insertmacro removeCachedInstaller
!macroend
