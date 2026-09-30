import { isMac, isWindows } from '../common/platform';
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';

export function createTray(
  win: BrowserWindow,
  setup: () => void,
  show: () => void,
  update: () => void,
  hasAgents: () => boolean,
): { tray: Tray; refresh: () => void } {
  const iconFile = path.join(app.getAppPath(), 'assets/icon.png');
  const size = isMac ? 18 : 16;
  const tray = new Tray(nativeImage.createFromPath(iconFile).resize({ width: size, height: size }));
  tray.setToolTip('Agent Status');
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const loginItem = () =>
    isMac ? app.getLoginItemSettings() : app.getLoginItemSettings({ path: executable });
  const toggle = () => {
    if (win.isVisible()) win.hide();
    else show();
  };
  const refresh = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        win.isVisible()
          ? { label: 'Hide', click: toggle }
          : hasAgents()
            ? { label: 'Show', click: toggle }
            : // Cửa sổ chỉ hiện khi có agent; bật lại tự động khi agent chạy.
              { label: 'Show (không có agent đang chạy)', enabled: false },
        { label: 'Thiết lập kết nối…', click: setup },
        { label: 'Kiểm tra cập nhật', click: update },
        {
          label: isMac ? 'Start at login' : 'Start with Windows',
          type: 'checkbox',
          enabled: app.isPackaged && (isWindows || isMac),
          checked: app.isPackaged && loginItem().openAtLogin,
          click: (item) =>
            app.setLoginItemSettings(
              isMac
                ? { openAtLogin: item.checked }
                : { openAtLogin: item.checked, path: executable, args: [] },
            ),
        },
        { type: 'separator' },
        { label: 'Exit', click: () => app.quit() },
      ]),
    );
  win.on('show', refresh);
  win.on('hide', refresh);
  tray.on('double-click', toggle);
  refresh();
  return { tray, refresh };
}
