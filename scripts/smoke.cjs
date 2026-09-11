// Chỉ chạy bằng Electron: npm run smoke. Không gọi Claude/Codex hoặc mạng.
const { app, BrowserWindow, dialog, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve('.test-data', `smoke-${Date.now()}`);
process.env.AGENT_STATUS_DATA_DIR = root;
process.env.AGENT_STATUS_CLAUDE_HOME = path.join(root, 'claude');
process.env.AGENT_STATUS_CODEX_HOME = path.join(root, 'codex');
const setupDialogs = [];
dialog.showMessageBox = async (_window, options) => {
  setupDialogs.push(options);
  return { response: setupDialogs.length === 1 ? 1 : 0, checkboxChecked: false };
};
const report = { checks: [], errors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
require('../dist/main/main.js');
const { showWindow } = require('../dist/main/window.js');
async function until(check) {
  for (let i = 0; i < 80; i++) { if (await check()) return; await sleep(100); }
  throw new Error('Timeout while waiting for UI');
}
async function sendEvent(agent, hook, session = 'smoke-session') {
  const directory = path.join(root, 'events', agent);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${require('node:crypto').randomUUID()}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify({ agent, session_id: session, hook_event_name: hook, timestamp: Date.now() }));
  await fs.rename(`${file}.tmp`, file);
}
const visibleAgents = win => win.webContents.executeJavaScript("[...document.querySelectorAll('.agent')].filter(element => element.getBoundingClientRect().width > 0).map(element => element.id)");
app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length > 0);
    const win = BrowserWindow.getAllWindows()[0];
    let shown = false;
    win.on('show', () => { shown = true; });
    await until(() => !win.webContents.isLoading());
    await until(async () => {
      try { return Boolean(JSON.parse(await fs.readFile(path.join(root, 'setup.json'), 'utf8')).deferred); }
      catch { return false; }
    });
    assert.equal(setupDialogs[0].message, 'Kết nối với Claude Code và Codex');
    await assert.rejects(fs.access(path.join(root, 'claude/settings.json')));
    await assert.rejects(fs.access(path.join(root, 'codex/hooks.json')));
    const setup = require('../dist/main/integration.js').createIntegrationSetup(win, {
      dataDir: root, integrationDir: path.resolve('integration'),
      claudeHome: process.env.AGENT_STATUS_CLAUDE_HOME, codexHome: process.env.AGENT_STATUS_CODEX_HOME
    });
    await setup.checkOnStartup();
    assert.equal(setupDialogs.length, 1, 'Deferred setup does not repeat at startup');
    await setup.show();
    assert.equal(setupDialogs.length, 3);
    assert.equal(setupDialogs[2].message, 'Đã cài kết nối');
    assert.ok(setupDialogs[2].detail.includes('/hooks'));
    await fs.access(path.join(root, 'claude/settings.json'));
    await fs.access(path.join(root, 'codex/hooks.json'));
    await setup.checkOnStartup();
    assert.equal(setupDialogs.length, 3, 'Configured machines start without setup prompts');
    assert.ok(setup.hint('codex').includes('terminal mới'));
    report.checks.push('First launch offers setup; defer writes no CLI settings; manual setup installs to isolated homes; subsequent launch is silent; Codex trust/new-session guidance present');
    assert.equal(shown, false, 'Empty startup never flashes the status window');
    assert.equal(win.isVisible(), false);
    assert.deepEqual(await visibleAgents(win), []);
    app.emit('second-instance');
    assert.equal(win.isVisible(), false, 'Reopening the app with no active agents does not show an empty window');
    await sendEvent('claude', 'SessionStart');
    await until(async () => win.isVisible() && (await visibleAgents(win)).join() === 'claude');
    const centered = await win.webContents.executeJavaScript('({ center: document.querySelector("#claude .dot").getBoundingClientRect().x + document.querySelector("#claude .dot").getBoundingClientRect().width / 2, viewport: innerWidth })');
    assert.ok(Math.abs(centered.center - centered.viewport / 2) < 1);
    report.checks.push('Empty startup stays hidden; first active agent restores window; hollow dot is hidden and the single agent is centered');
    assert.deepEqual(win.getSize(), [110, 55]);
    assert.equal(win.isResizable(), true);
    assert.deepEqual(win.getMinimumSize(), [90, 45]);
    report.checks.push('Window visible, default 110x55 DIP, resizable, minimum 90x45 DIP');
    const prefs = win.webContents.getLastWebPreferences();
    assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.nodeIntegration, false);
    assert.equal(await win.webContents.executeJavaScript('typeof window.agentStatus.get'), 'function');
    assert.equal(await win.webContents.executeJavaScript('typeof window.require'), 'undefined');
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.status-content')).getPropertyValue('-webkit-app-region')"), 'drag');
    assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('main')).getPropertyValue('-webkit-app-region')"), 'no-drag');
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
    const area = screen.getPrimaryDisplay().workArea;
    win.setPosition(area.x + 150, area.y + 150);
    win.focus();
    await sleep(250);
    const nativeHandle = win.getNativeWindowHandle().readBigUInt64LE().toString();
    const { execFile } = require('node:child_process');
    const resizeChecks = await new Promise((resolve, reject) => execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-File', path.resolve('scripts/Test-WindowResize.ps1'), '-Handle', nativeHandle
    ], { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout))));
    assert.equal(resizeChecks.length, 4);
    const resized = win.getBounds();
    await until(async () => JSON.stringify(JSON.parse(await fs.readFile(path.join(root, 'position.json'), 'utf8'))) === JSON.stringify(resized));
    assert.ok(resized.width > 110 && resized.height > 55);
    const layout = await win.webContents.executeJavaScript('({width: document.querySelector("main").offsetWidth, height: document.querySelector("main").offsetHeight, viewportWidth: innerWidth, viewportHeight: innerHeight})');
    assert.equal(layout.width, layout.viewportWidth); assert.equal(layout.height, layout.viewportHeight);
    const scaled = await win.webContents.executeJavaScript('({ scale: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")), font: parseFloat(getComputedStyle(document.body).fontSize), dot: document.querySelector(".dot").getBoundingClientRect().width })');
    assert.ok(scaled.scale > 1 && scaled.font > 10 && scaled.dot > 10);
    report.checks.push('Text and status dots scale with enlarged window');
    const restored = require('../dist/main/window.js').createWindow(root);
    restored.once('ready-to-show', () => showWindow(restored));
    await until(() => restored.isVisible() && !restored.webContents.isLoading());
    assert.deepEqual(restored.getBounds(), resized);
    restored.destroy();
    report.checks.push('Real mouse resizing: right, bottom, NW corner, SE shrinking; layout fills window; position and size persist and restore');
    win.setSize(90, 45);
    await sleep(150);
    assert.deepEqual(win.getSize(), [90, 45]);
    await fs.writeFile(path.join(root, 'minimum-size.png'), (await win.webContents.capturePage()).toPNG());
    win.setBounds(resized);
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
        assert.ok((await visibleAgents(win)).includes(agent), `${agent} remains visible when ${status}`);
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
    assert.deepEqual(await visibleAgents(win), ['claude', 'codex']);
    await sendEvent('claude', 'SessionStart', 'another-session');
    await sendEvent('claude', 'SessionEnd');
    await until(async () => (await win.webContents.executeJavaScript('window.agentStatus.get()')).find(state => state.agent === 'claude').reason === 'Session đã bắt đầu');
    assert.deepEqual(await visibleAgents(win), ['claude', 'codex'], 'A second active session keeps its agent visible');
    await sendEvent('claude', 'SessionEnd', 'another-session');
    await until(async () => (await visibleAgents(win)).join() === 'codex');
    assert.equal(win.isVisible(), true);
    await fs.writeFile(path.join(root, 'single-agent.png'), (await win.webContents.capturePage()).toPNG());
    await sendEvent('codex', 'SessionEnd');
    await until(async () => !win.isVisible() && (await visibleAgents(win)).length === 0);
    app.emit('second-instance');
    assert.equal(win.isVisible(), false);
    await sendEvent('codex', 'UserPromptSubmit', 'new-session');
    await until(async () => win.isVisible() && (await visibleAgents(win)).join() === 'codex');
    assert.deepEqual(win.getBounds(), resized, 'Automatic hide/show preserves position and size');
    win.hide();
    await sendEvent('codex', 'PermissionRequest', 'new-session');
    await until(() => win.webContents.executeJavaScript("document.querySelector('#codex .dot').className === 'dot stuck'"));
    await sleep(650);
    assert.equal(win.isVisible(), false, 'Status changes do not undo manual Hide');
    app.emit('second-instance');
    assert.equal(win.isVisible(), true, 'Manual reopen still works with active agents');
    win.hide();
    await sendEvent('codex', 'SessionEnd', 'new-session');
    await until(async () => (await visibleAgents(win)).length === 0);
    await sendEvent('claude', 'SessionStart', 'returning-session');
    await until(async () => win.isVisible() && (await visibleAgents(win)).join() === 'claude');
    report.checks.push('Both agents display; ending one of multiple sessions retains its agent; final session removes it; ending all hides window; new sessions restore it with saved bounds; manual Hide survives status updates and resets after all sessions close');
  } catch (error) { report.errors.push(error.stack); process.exitCode = 1; }
  finally {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ root, ...report }, null, 2));
    app.exit(report.errors.length ? 1 : 0);
  }
});
