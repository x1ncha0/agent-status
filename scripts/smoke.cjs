// Chỉ chạy bằng Electron: npm run smoke. Không gọi Claude/Codex hoặc mạng.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve('.test-data', `smoke-${Date.now()}`);
process.env.AGENT_STATUS_DATA_DIR = root;
const report = { checks: [], errors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
require('../dist/main/main.js');
const { showWindow } = require('../dist/main/window.js');
async function until(check) {
  for (let i = 0; i < 80; i++) { if (await check()) return; await sleep(100); }
  throw new Error('Timeout while waiting for UI');
}
app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length > 0);
    const win = BrowserWindow.getAllWindows()[0];
    await until(() => win.isVisible() && !win.webContents.isLoading());
    assert.deepEqual(win.getSize(), [110, 55]);
    assert.equal(win.isResizable(), false);
    report.checks.push('Window visible, 110x55 DIP, alwaysOnTop=true, resizable=false');
    const prefs = win.webContents.getLastWebPreferences();
    assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.nodeIntegration, false);
    assert.equal(await win.webContents.executeJavaScript('typeof window.agentStatus.get'), 'function');
    assert.equal(await win.webContents.executeJavaScript('typeof window.require'), 'undefined');
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('main')).getPropertyValue('-webkit-app-region')"), 'drag');
    report.checks.push('Sandbox/preload IPC present; renderer has no require; CSS drag region present');
    const original = win.getPosition();
    win.setPosition(original[0] - 30, original[1] - 30);
    await sleep(300);
    assert.deepEqual(win.getPosition(), [original[0] - 30, original[1] - 30]);
    report.checks.push('Programmatic window movement');
    win.hide(); assert.equal(win.isVisible(), false);
    let topmostEvent = false;
    win.once('always-on-top-changed', (_event, value) => { topmostEvent = value; });
    showWindow(win); assert.equal(win.isVisible(), true);
    await sleep(100);
    report.checks.push(`Native hide/show applies alwaysOnTop; event=${topmostEvent}`);
    for (const agent of ['claude', 'codex']) {
      for (const [hook, status] of [['SessionStart', 'available'], ['UserPromptSubmit', 'working'], ['PermissionRequest', 'stuck'], ['PostToolUse', 'working'], ['Stop', 'available']]) {
        const input = JSON.stringify({ session_id: 'smoke-session', hook_event_name: hook });
        await new Promise((resolve, reject) => {
          const { spawn } = require('node:child_process');
          const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.resolve('integration/Write-AgentEvent.ps1'), '-Agent', agent, '-DataDir', root], { windowsHide: true });
          child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Hook exit ${code}`)));
          child.stdin.end(input);
        });
        await until(() => win.webContents.executeJavaScript(`document.querySelector('#${agent} .dot').className === 'dot ${status}'`));
        report.checks.push(`${agent}: ${hook} -> ${status}, PowerShell/file/IPC/DOM`);
      }
    }
    await fs.writeFile(path.join(root, 'window.png'), (await win.webContents.capturePage()).toPNG());
    report.screenshot = path.join(root, 'window.png');
  } catch (error) { report.errors.push(error.stack); process.exitCode = 1; }
  finally {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ root, ...report }, null, 2));
    app.exit(report.errors.length ? 1 : 0);
  }
});
