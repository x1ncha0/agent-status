import { BrowserWindow, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fitBounds, MIN_SIZE, restoreBounds, type Bounds } from './window-state';

export function showWindow(win: BrowserWindow): void {
  win.showInactive();
  // Windows/portable launch có thể làm mất topmost khi showInactive chạy.
  // Áp lại sau native show, kể cả khi khôi phục từ tray.
  win.setAlwaysOnTop(true, 'floating');
}

export function createWindow(dataDir: string): BrowserWindow {
  const positionFile = path.join(dataDir, 'position.json');
  let saved: Partial<Bounds> | undefined;
  try {
    saved = JSON.parse(readFileSync(positionFile, 'utf8'));
  } catch { /* Lần chạy đầu chưa có vị trí. */ }
  const area = saved && Number.isSafeInteger(saved.x) && Number.isSafeInteger(saved.y)
    ? screen.getDisplayNearestPoint({ x: saved.x!, y: saved.y! }).workArea
    : screen.getPrimaryDisplay().workArea;
  const bounds = restoreBounds(saved, area);
  const win = new BrowserWindow({
    ...bounds, frame: false, backgroundColor: '#20252e',
    // Transparent Electron windows do not support native edge resizing.
    resizable: true, thickFrame: true, minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height,
    maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.once('ready-to-show', () => showWindow(win));
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (win.isDestroyed()) return;
    try { writeFileSync(positionFile, JSON.stringify(win.getBounds())); } catch (error) { console.error(error); }
  };
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 100); };
  win.on('moved', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('close', save);
  const reposition = () => {
    const current = win.getBounds();
    win.setBounds(fitBounds(current, screen.getDisplayNearestPoint(current).workArea));
    save();
  };
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  win.on('closed', () => {
    clearTimeout(saveTimer);
    screen.removeListener('display-removed', reposition);
    screen.removeListener('display-metrics-changed', reposition);
  });
  void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  return win;
}
