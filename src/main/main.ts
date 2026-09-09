import { app, ipcMain, Tray } from 'electron';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createWindow, showWindow } from './window';
import { createTray } from './tray';
import { FileMonitor } from '../monitor/file-monitor';
import { classifyClaude } from '../monitor/claude';
import { classifyCodex } from '../monitor/codex';

const dataDir = process.env.AGENT_STATUS_DATA_DIR || path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'AgentStatus');
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, 'electron'));
let tray: Tray;
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(() => {
  let timeoutMs = 0;
  try {
    const config = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    if (typeof config.noProgressMinutes === 'number' && Number.isFinite(config.noProgressMinutes) && config.noProgressMinutes >= 1)
      timeoutMs = config.noProgressMinutes * 60000;
  } catch { /* Timeout mặc định tắt. */ }
  const monitors = [
    new FileMonitor(path.join(dataDir, 'events/claude'), 'claude', classifyClaude, timeoutMs),
    new FileMonitor(path.join(dataDir, 'events/codex'), 'codex', classifyCodex, timeoutMs)
  ];
  const snapshot = () => monitors.map(monitor => monitor.snapshot());
  ipcMain.handle('status:get', snapshot);
  const win = createWindow(dataDir);
  tray = createTray(win);
  app.on('second-instance', () => showWindow(win));
  let previous = '';
  const tick = async () => {
    await Promise.all(monitors.map(monitor => monitor.poll()));
    const states = snapshot();
    const serialized = JSON.stringify(states);
    if (serialized !== previous && !win.isDestroyed()) {
      previous = serialized;
      win.webContents.send('status:changed', states);
      tray.setToolTip(states.map(s => `${s.agent}: ${s.observed ? s.status : 'Chưa nhận event'}`).join('\n'));
    }
  };
  const timer = setInterval(() => void tick(), 500);
  void tick();
  app.on('before-quit', () => { clearInterval(timer); tray.destroy(); });
});
app.on('window-all-closed', () => app.quit());
