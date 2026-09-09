import { app, ipcMain, Tray } from 'electron';
import { mkdirSync } from 'node:fs';
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
  const monitors = [
    new FileMonitor(path.join(dataDir, 'events/claude'), 'claude', classifyClaude),
    new FileMonitor(path.join(dataDir, 'events/codex'), 'codex', classifyCodex)
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
      const labels = { available: 'Sẵn sàng', working: 'Đang suy nghĩ / làm việc', stuck: 'Cần bạn can thiệp' };
      tray.setToolTip(states.map(s => `${s.agent}: ${s.observed ? labels[s.status] : 'Chưa kết nối'}`).join('\n'));
    }
  };
  const timer = setInterval(() => void tick(), 500);
  void tick();
  app.on('before-quit', () => { clearInterval(timer); tray.destroy(); });
});
app.on('window-all-closed', () => app.quit());
