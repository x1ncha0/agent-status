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
    for (const [hook, tool, id, status] of [
      ['PreToolUse', 'request_user_input', 'question', 'stuck'],
      ['PostToolUse', 'Bash', 'parallel-tool', 'stuck'],
      ['PostToolUse', 'request_user_input', 'question', 'working'],
      ['Stop', '', '', 'available']
    ]) {
      await fs.mkdir(path.join(root, 'events/codex'), { recursive: true });
      await fs.writeFile(path.join(root, 'events/codex', `${require('node:crypto').randomUUID()}.json`), JSON.stringify({
        agent: 'codex', session_id: 'smoke-session', hook_event_name: hook, tool_name: tool, tool_use_id: id, timestamp: Date.now()
      }));
      await until(() => win.webContents.executeJavaScript(`document.querySelector('#codex .dot').className === 'dot ${status}'`));
      if (status === 'stuck') {
        assert.ok((await win.webContents.executeJavaScript("document.getElementById('codex').title")).includes('Cần bạn can thiệp'));
      }
      report.checks.push(`codex: ${hook}/${tool} -> ${status}, question and parallel tool`);
    }
    const colors = await win.webContents.executeJavaScript(`['available','working','stuck'].map(status => {
      const dot = document.createElement('span'); dot.className = 'dot ' + status;
      document.body.appendChild(dot); const color = getComputedStyle(dot).backgroundColor; dot.remove(); return color;
    })`);
    assert.deepEqual(colors, ['rgb(74, 222, 128)', 'rgb(250, 204, 21)', 'rgb(248, 113, 113)']);
    report.checks.push('Green=ready, yellow=thinking/working, red=needs user; Vietnamese tooltip');
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
