; Custom NSIS macros for EasyClaw installer (included via electron-builder).
;
; The gateway child process runs as EasyClaw.exe (with ELECTRON_RUN_AS_NODE=1,
; detached=true) and can survive after the user quits the main Electron app.
; When the user manually reinstalls/upgrades, the default NSIS logic detects
; orphaned processes or the old uninstaller fails due to file locks, showing
; a blocking "EasyClaw cannot be closed" dialog.
;
; We use four hooks to prevent this:
;   1. customInit            — kill processes + nuke old uninstaller registry
;   2. customCheckAppRunning — replaces _CHECK_APP_RUNNING (no dialog)
;   3. customUnInstallCheck  — gracefully handles old-uninstaller failure
;   4. customUnInit          — same cleanup for the uninstaller binary

; ---------------------------------------------------------------------------
; Shared helper: kill all EasyClaw-related processes
; ---------------------------------------------------------------------------
!macro _killEasyClawProcesses
  nsExec::ExecToLog 'taskkill /f /im EasyClaw.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /t /im openclaw-gateway.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /t /im openclaw.exe'
  Pop $0
  nsExec::ExecToLog 'wmic process where "name='"'"'node.exe'"'"' and commandline like '"'"'%easyclaw%'"'"'" call terminate'
  Pop $0
  Sleep 5000
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
  !insertmacro _killEasyClawProcesses

  ; Wipe the old UninstallString so uninstallOldVersion() exits early.
  ; SHELL_CONTEXT is set by initMultiUser (runs before customInit).
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif
  ; Also cover HKCU for per-all-users → per-user migration edge case.
  DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString

  ; Delete the old uninstaller binary (belt-and-suspenders).
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"

  ; Clean stale vendor build artifacts from previous installations.
  ; The bundle pipeline reduces file count (plugin-sdk chunks deleted,
  ; .ts sources replaced by pre-bundled .js), but NSIS only overwrites
  ; existing files — it never deletes files absent from the new version.
  ; Stale .ts and chunk files cause jiti to parse the full 16.6MB
  ; plugin-sdk monolith on every gateway restart (~20s regression).
  ; Only clean dist/ and extensions/ (small, fast). Deliberately skip
  ; node_modules/ (~7K files) — it doesn't cause the regression and
  ; would be slow to delete.
  RMDir /r "$INSTDIR\resources\vendor\openclaw\dist"
  RMDir /r "$INSTDIR\resources\vendor\openclaw\extensions"

  ; Remove gateway lock files so the new version starts clean.
  RMDir /r "$TEMP\openclaw"
!macroend

; ---------------------------------------------------------------------------
; Hook 2: customCheckAppRunning — replaces the default _CHECK_APP_RUNNING
;
; The default logic detects ANY process under $INSTDIR via PowerShell and
; shows a blocking dialog.  We replace it with a silent kill-and-continue.
; ---------------------------------------------------------------------------
!macro customCheckAppRunning
  !insertmacro _killEasyClawProcesses
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
  !insertmacro _killEasyClawProcesses
  RMDir /r "$TEMP\openclaw"
!macroend
