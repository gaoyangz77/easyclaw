; Custom NSIS macros for RivonClaw installer (included via electron-builder).
;
; The gateway child process runs as RivonClaw.exe (with ELECTRON_RUN_AS_NODE=1,
; detached=true) and can survive after the user quits the main Electron app.
; When the user manually reinstalls/upgrades, the default NSIS logic detects
; orphaned processes or the old uninstaller fails due to file locks, showing
; a blocking "RivonClaw cannot be closed" dialog.
;
; We use four hooks to prevent this:
;   1. customInit            — kill processes + nuke old uninstaller registry
;   2. customCheckAppRunning — replaces _CHECK_APP_RUNNING (no dialog)
;   3. customUnInstallCheck  — gracefully handles old-uninstaller failure
;   4. customUnInit          — same cleanup for the uninstaller binary
;   5. customInstall         — install the OpenClaw CLI shim into user PATH
;   6. customUnInstall       — remove the user-level CLI shim

; ---------------------------------------------------------------------------
; Shared helper: kill all RivonClaw-related processes
; ---------------------------------------------------------------------------
!macro _killRivonClawProcesses
  nsExec::ExecToLog 'taskkill /f /im RivonClaw.exe'
  Pop $0
  ; Also kill pre-rebrand EasyClaw processes (upgrade from old version).
  nsExec::ExecToLog 'taskkill /f /im EasyClaw.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /t /im openclaw-gateway.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /t /im openclaw.exe'
  Pop $0
  nsExec::ExecToLog 'wmic process where "name='"'"'node.exe'"'"' and commandline like '"'"'%rivonclaw%'"'"'" call terminate'
  Pop $0
  nsExec::ExecToLog 'wmic process where "name='"'"'node.exe'"'"' and commandline like '"'"'%easyclaw%'"'"'" call terminate'
  Pop $0
  Sleep 5000
!macroend

; ---------------------------------------------------------------------------
; Shared helper: install OpenClaw CLI shim for the current user
; ---------------------------------------------------------------------------
!macro _installOpenClawCliShim
  SetShellVarContext current
  CreateDirectory "$LOCALAPPDATA\RivonClaw\bin"
  FileOpen $0 "$LOCALAPPDATA\RivonClaw\bin\openclaw.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "setlocal$\r$\n"
  FileWrite $0 "set $\"ELECTRON_RUN_AS_NODE=1$\"$\r$\n"
  FileWrite $0 "set $\"RIVONCLAW_ELECTRON_BIN=$INSTDIR\RivonClaw.exe$\"$\r$\n"
  FileWrite $0 "set $\"RIVONCLAW_DESKTOP_USER_DATA=$APPDATA\@easyclaw\desktop$\"$\r$\n"
  FileWrite $0 "$\"$INSTDIR\RivonClaw.exe$\" $\"$INSTDIR\resources\cli\openclaw-launcher.cjs$\" %*$\r$\n"
  FileWrite $0 "exit /b %ERRORLEVEL%$\r$\n"
  FileClose $0

  ; Add the shim dir to HKCU Path idempotently. This affects new terminals;
  ; Desktop also rewrites the shim on startup with the current state/config paths.
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$bin=[Environment]::ExpandEnvironmentVariables(''%LOCALAPPDATA%\RivonClaw\bin''); $path=[Environment]::GetEnvironmentVariable(''Path'',''User''); $entries=@(); if($path){$entries=$path -split '';'' | ? { $_ }}; if(-not ($entries | ? { $_.TrimEnd([char]92) -ieq $bin.TrimEnd([char]92) })){ [Environment]::SetEnvironmentVariable(''Path'', (($entries + $bin) | ? { $_ }) -join '';'', ''User'') }"'
  Pop $0
!macroend

; ---------------------------------------------------------------------------
; Hook 1: customInit — runs in .onInit after initMultiUser
;
; Kill orphaned processes, then remove the old UninstallString from the
; registry.  This makes uninstallOldVersion() return immediately without
; entering the 5-retry loop that shows the blocking "cannot be closed"
; dialog when the OLD uninstaller fails (file locks, its own
; CHECK_APP_RUNNING, etc.).  The new installer will overwrite old files
; and write fresh registry entries.
; ---------------------------------------------------------------------------
!macro customInit
  !insertmacro _killRivonClawProcesses

  ; Wipe the old UninstallString so uninstallOldVersion() exits early.
  ; SHCTX resolves to HKLM or HKCU based on SetShellVarContext (set by
  ; initMultiUser which runs before customInit).  Note: "SHELL_CONTEXT"
  ; is NOT a valid NSIS root-key constant — only SHCTX is.  The previous
  ; code silently failed to delete anything, which let uninstallOldVersion
  ; find the old uninstaller, run it, and show the "cannot be closed" dialog.
  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue SHCTX "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif
  ; Also cover HKCU for per-all-users → per-user migration edge case.
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif

  ; Delete the old uninstaller binary (belt-and-suspenders).
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"

  ; Clean stale vendor build artifacts from previous installations.
  ; The bundle pipeline reduces file count (plugin-sdk chunks deleted,
  ; .ts sources replaced by pre-bundled .js), but NSIS only overwrites
  ; existing files — it never deletes files absent from the new version.
  ; Stale .ts and chunk files cause jiti to parse the full 16.6MB
  ; plugin-sdk monolith on every gateway restart (~20s regression).
  ; Stale dist-runtime/ wrappers cause "failed to load" errors when
  ; an extension is removed upstream (e.g. modelstudio → qwen merge).
  ; Only clean dist/, dist-runtime/, and extensions/ (small, fast).
  ; Deliberately skip node_modules/ (~7K files) — it doesn't cause
  ; the regression and would be slow to delete.
  RMDir /r "$INSTDIR\resources\vendor\openclaw\dist"
  RMDir /r "$INSTDIR\resources\vendor\openclaw\dist-runtime"
  RMDir /r "$INSTDIR\resources\vendor\openclaw\extensions"

  ; Remove gateway lock files so the new version starts clean.
  RMDir /r "$TEMP\openclaw"
!macroend

; ---------------------------------------------------------------------------
; Hook 1b: customInstall — install user-level OpenClaw CLI shim
; ---------------------------------------------------------------------------
!macro customInstall
  !insertmacro _installOpenClawCliShim
!macroend

; ---------------------------------------------------------------------------
; Hook 2: customCheckAppRunning — replaces the default _CHECK_APP_RUNNING
;
; The default logic detects ANY process under $INSTDIR via PowerShell and
; shows a blocking dialog.  We replace it with a silent kill-and-continue.
; ---------------------------------------------------------------------------
!macro customCheckAppRunning
  !insertmacro _killRivonClawProcesses
!macroend

; ---------------------------------------------------------------------------
; Hook 3: customUnInstallCheck — handles old-uninstaller failure
;
; If uninstallOldVersion somehow still runs the old uninstaller and it fails,
; this intercepts handleUninstallResult to log the error instead of blocking.
; ---------------------------------------------------------------------------
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Old uninstaller exited with code $R0 (ignored — files will be overwritten)."
  ${endif}
!macroend

; ---------------------------------------------------------------------------
; Hook 4: customUnInit — same cleanup for the uninstaller binary
; ---------------------------------------------------------------------------
!macro customUnInit
  !insertmacro _killRivonClawProcesses
  RMDir /r "$TEMP\openclaw"
!macroend

; ---------------------------------------------------------------------------
; Hook 5: customUnInstall — remove user-level CLI shim
; ---------------------------------------------------------------------------
!macro customUnInstall
  SetShellVarContext current
  Delete "$LOCALAPPDATA\RivonClaw\bin\openclaw.cmd"
!macroend
