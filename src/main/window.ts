import { BrowserWindow, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function showWindow(win: BrowserWindow): void {
  win.showInactive();
  // Windows/portable launch có thể làm mất topmost khi showInactive chạy.
  // Áp lại sau native show, kể cả khi khôi phục từ tray.
  win.setAlwaysOnTop(true, 'floating');
}

export function createWindow(dataDir: string): BrowserWindow {
  const positionFile = path.join(dataDir, 'position.json');
  const area = screen.getPrimaryDisplay().workArea;
  let position = { x: area.x + area.width - 126, y: area.y + area.height - 71 };
  try {
    const saved = JSON.parse(readFileSync(positionFile, 'utf8'));
    if (Number.isInteger(saved.x) && Number.isInteger(saved.y)) position = saved;
  } catch { /* Lần chạy đầu chưa có vị trí. */ }
  const clamp = () => {
    const work = screen.getDisplayNearestPoint(position).workArea;
    position.x = Math.max(work.x, Math.min(position.x, work.x + work.width - 110));
    position.y = Math.max(work.y, Math.min(position.y, work.y + work.height - 55));
  };
  clamp();
  const win = new BrowserWindow({
    ...position, width: 110, height: 55, frame: false, transparent: true,
    resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.once('ready-to-show', () => showWindow(win));
  win.on('moved', () => {
    const [x, y] = win.getPosition();
    position = { x, y };
    try { writeFileSync(positionFile, JSON.stringify(position)); } catch (error) { console.error(error); }
  });
  const reposition = () => { clamp(); win.setPosition(position.x, position.y); };
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  win.on('closed', () => {
    screen.removeListener('display-removed', reposition);
    screen.removeListener('display-metrics-changed', reposition);
  });
  void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  return win;
}
