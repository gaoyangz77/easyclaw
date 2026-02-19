import { spawn } from "node:child_process";
import { writeFile, mkdir, access, constants } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createLogger } from "@easyclaw/logger";

const log = createLogger("updater:installer");

/**
 * Write a helper batch script that:
 * 1. Waits for the current app process to fully exit (releasing file locks)
 * 2. Runs the NSIS installer silently
 * 3. Relaunches the app
 * 4. Cleans up temp files
 */
export async function installWindows(exePath: string, quitApp: () => void): Promise<void> {
  const tempDir = dirname(exePath);
  const scriptPath = join(tempDir, "easyclaw-update.cmd");
  const launcherPath = join(tempDir, "easyclaw-update-launcher.vbs");
  const progressPath = join(tempDir, "easyclaw-update-progress.hta");
  const appExePath = process.execPath;
  const installerName = basename(exePath);

  log.info(`Writing update helper script: ${scriptPath}`);

  // HTA progress dialog shown during silent NSIS install.
  // Uses mshta.exe (built into Windows) — no extra dependencies.
  const progressHta = `<html>\r
<head>\r
<title>EasyClaw Update</title>\r
<HTA:APPLICATION INNERBORDER="no" BORDER="thin" SCROLL="no"\r
  SINGLEINSTANCE="yes" MAXIMIZEBUTTON="no" MINIMIZEBUTTON="no"\r
  SYSMENU="no" CONTEXTMENU="no" SHOWINTASKBAR="yes" />\r
<script>\r
window.resizeTo(420,140);\r
window.moveTo((screen.width-420)/2,(screen.height-140)/2);\r
var pos=-30;setInterval(function(){pos+=1;if(pos>100)pos=-30;document.getElementById('b').style.left=pos+'%';},30);\r
</script>\r
</head>\r
<body style="font-family:'Segoe UI',sans-serif;text-align:center;padding:24px 20px 16px;background:#f3f3f3;overflow:hidden">\r
<p style="margin:0 0 14px;font-size:14px;color:#333">Updating EasyClaw, please wait...</p>\r
<div style="width:90%;height:16px;background:#e0e0e0;border-radius:8px;overflow:hidden;margin:0 auto;position:relative">\r
<div id="b" style="width:30%;height:100%;background:#0078d4;position:absolute;left:-30%;border-radius:8px"></div>\r
</div>\r
</body></html>`;

  const script = `@echo off\r
:: EasyClaw auto-update helper script\r
\r
:: Wait for the old process to exit (max 30s)\r
set WAIT=0\r
:waitapp\r
tasklist /fi "pid eq ${process.pid}" /nh 2>nul | find "${process.pid}" >nul\r
if not errorlevel 1 (\r
  if %WAIT% GEQ 30 goto timeout\r
  timeout /t 1 /nobreak >nul\r
  set /a WAIT+=1\r
  goto waitapp\r
)\r
\r
:: Kill orphan gateway/openclaw child processes that may hold file locks\r
taskkill /f /im openclaw-gateway.exe 2>nul\r
taskkill /f /im openclaw.exe 2>nul\r
\r
:: Extra delay to ensure all file handles are released\r
timeout /t 3 /nobreak >nul\r
\r
:: Show progress dialog during installation\r
start "" mshta.exe "${progressPath}"\r
\r
:: Run NSIS installer silently (blocks until complete)\r
"${exePath}" /S\r
\r
:: Wait for installer process to finish (in case it detaches, max 120s)\r
set WAIT=0\r
:waitinst\r
tasklist /fi "imagename eq ${installerName}" /nh 2>nul | find /i "${installerName}" >nul\r
if not errorlevel 1 (\r
  if %WAIT% GEQ 120 goto relaunch\r
  timeout /t 1 /nobreak >nul\r
  set /a WAIT+=1\r
  goto waitinst\r
)\r
\r
:relaunch\r
:: Close progress dialog\r
taskkill /f /im mshta.exe 2>nul\r
\r
timeout /t 2 /nobreak >nul\r
\r
:: Relaunch the app\r
start "" "${appExePath}"\r
\r
:: Cleanup\r
del "${exePath}" 2>nul\r
del "${progressPath}" 2>nul\r
del "${launcherPath}" 2>nul\r
del "%~f0"\r
goto :eof\r
\r
:timeout\r
echo Timeout waiting for process to exit\r
taskkill /f /im mshta.exe 2>nul\r
del "${progressPath}" 2>nul\r
del "${launcherPath}" 2>nul\r
del "%~f0"\r
`;

  await writeFile(progressPath, progressHta);
  await writeFile(scriptPath, script);

  // Use a VBS launcher to run the batch script in a fully hidden window.
  // windowsHide on spawn() only hides the parent cmd.exe process; child
  // processes like find.exe (used in the tasklist polling loop) still create
  // visible console windows. The VBS WshShell.Run with window style 0 (vbHide)
  // ensures the entire process tree stays hidden.
  const launcherScript =
    `Set WshShell = CreateObject("WScript.Shell")\r\n` +
    `WshShell.Run "cmd /c ""${scriptPath}""", 0, False\r\n`;
  await writeFile(launcherPath, launcherScript);

  log.info(`Spawning update helper via VBS launcher: ${launcherPath}`);
  const child = spawn("wscript.exe", [launcherPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  setTimeout(() => {
    quitApp();
  }, 500);
}

/**
 * Extract the zip, write a helper shell script that swaps the .app bundle
 * after this process exits, then quit.
 *
 * @throws If the app's parent directory is not writable.
 */
export async function installMacOS(
  zipPath: string,
  appBundlePath: string,
  quitApp: () => void,
): Promise<void> {
  const tempDir = dirname(zipPath);
  const extractDir = join(tempDir, "easyclaw-update-extract");

  // Check write permissions on the app's parent directory
  const appParent = dirname(appBundlePath);
  try {
    await access(appParent, constants.W_OK);
  } catch {
    throw new Error(
      `No write permission to ${appParent}. Please update manually.`,
    );
  }

  // Extract using ditto (macOS native, handles resource forks correctly)
  await mkdir(extractDir, { recursive: true });
  log.info(`Extracting ${zipPath} to ${extractDir}`);

  await new Promise<void>((res, rej) => {
    const child = spawn("ditto", ["-xk", zipPath, extractDir]);
    child.on("close", (code) => {
      if (code === 0) res();
      else rej(new Error(`ditto extract failed with exit code ${code}`));
    });
    child.on("error", rej);
  });

  // electron-builder zip contains EasyClaw.app at the root
  const appName = "EasyClaw.app";
  const newAppPath = join(extractDir, appName);

  // Write updater shell script
  const scriptPath = join(tempDir, "easyclaw-update.sh");
  const script = `#!/bin/bash
# EasyClaw auto-update helper script
PID=${process.pid}
APP_PATH="${appBundlePath}"
NEW_APP="${newAppPath}"

# Wait for the old process to exit (max 30s)
WAIT=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.5
  WAIT=$((WAIT + 1))
  if [ "$WAIT" -gt 60 ]; then
    echo "Timeout waiting for process to exit"
    exit 1
  fi
done

sleep 0.5

# Move old app to trash
if [ -d "$APP_PATH" ]; then
  mv "$APP_PATH" "$HOME/.Trash/EasyClaw-old-$(date +%s).app" 2>/dev/null || rm -rf "$APP_PATH"
fi

# Move new app into place
mv "$NEW_APP" "$APP_PATH"

# Clear quarantine attribute
xattr -cr "$APP_PATH" 2>/dev/null

# Relaunch
open "$APP_PATH"

# Cleanup
rm -rf "${extractDir}"
rm -f "${zipPath}"
rm -f "$0"
`;

  await writeFile(scriptPath, script, { mode: 0o755 });

  log.info(`Spawning update helper script: ${scriptPath}`);
  const child = spawn("bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  setTimeout(() => {
    quitApp();
  }, 500);
}

/**
 * Resolve the path to the current .app bundle on macOS.
 * process.resourcesPath → .../EasyClaw.app/Contents/Resources
 * We go up 2 levels to get the .app directory.
 */
export function resolveAppBundlePath(): string {
  return resolve(process.resourcesPath, "..", "..");
}
