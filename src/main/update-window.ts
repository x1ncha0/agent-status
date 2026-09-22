import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import { cornerBounds } from './window-state';

export type UpdatePhase =
  'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
export type UpdateAction = 'download' | 'later' | 'cancel' | 'retry' | 'open' | 'dismiss';
export interface UpdateView {
  phase: UpdatePhase;
  current: string;
  version?: string;
  received?: number;
  total?: number;
  message?: string;
}

const SIZE = { width: 360, height: 132 };
const ACTIONS: UpdateAction[] = ['download', 'later', 'cancel', 'retry', 'open', 'dismiss'];

export function createUpdatePopup(
  onAction: (action: UpdateAction) => void,
  anchor?: BrowserWindow,
) {
  let win: BrowserWindow | undefined;
  let loaded = false;
  let pending: UpdateView | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  ipcMain.on('update:action', (event, action) => {
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (ACTIONS.includes(action as UpdateAction)) onAction(action as UpdateAction);
  });

  const close = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
    loaded = false;
    if (win && !win.isDestroyed()) win.destroy();
    win = undefined;
  };

  const open = () => {
    const work =
      anchor && !anchor.isDestroyed()
        ? screen.getDisplayNearestPoint(anchor.getBounds()).workArea
        : screen.getPrimaryDisplay().workArea;
    const popup = new BrowserWindow({
      ...cornerBounds(SIZE, work),
      frame: false,
      backgroundColor: '#20252e',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'update-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', (event) => event.preventDefault());
    popup.once('ready-to-show', () => {
      popup.showInactive();
      // Giữ popup nổi trên cửa sổ khác mà không giành focus của CLI.
      popup.setAlwaysOnTop(true, 'floating');
    });
    popup.webContents.once('did-finish-load', () => {
      loaded = true;
      if (pending) popup.webContents.send('update:state', pending);
    });
    popup.on('closed', () => {
      if (popup === win) {
        win = undefined;
        loaded = false;
      }
    });
    void popup.loadFile(path.join(__dirname, '../renderer/update.html'));
    return popup;
  };

  return {
    render(view: UpdateView, closeIn?: number): void {
      clearTimeout(timer);
      timer = closeIn ? setTimeout(close, closeIn) : undefined;
      pending = view;
      if (!win || win.isDestroyed()) win = open();
      else if (loaded) win.webContents.send('update:state', view);
    },
    close,
  };
}
