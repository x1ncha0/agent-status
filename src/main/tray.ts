import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { showWindow } from './window';

export function createTray(win: BrowserWindow, setup?: () => void): Tray {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4;
    const dot = (x - 5) ** 2 + (y - 8) ** 2 < 9 || (x - 11) ** 2 + (y - 8) ** 2 < 9;
    pixels[i] = dot ? 128 : 46; pixels[i + 1] = dot ? 222 : 37;
    pixels[i + 2] = dot ? 74 : 32; pixels[i + 3] = 255;
  }
  const tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }));
  tray.setToolTip('Agent Status');
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const toggle = () => { if (win.isVisible()) win.hide(); else showWindow(win); };
  const refresh = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: win.isVisible() ? 'Hide' : 'Show', click: toggle },
    ...(setup ? [{ label: 'Thiết lập kết nối…', click: setup }] : []),
    { label: 'Start with Windows', type: 'checkbox', enabled: app.isPackaged && process.platform === 'win32',
      checked: app.isPackaged && app.getLoginItemSettings({ path: executable }).openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, path: executable, args: [] }) },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() }
  ]));
  win.on('show', refresh); win.on('hide', refresh);
  tray.on('double-click', toggle);
  refresh();
  return tray;
}
