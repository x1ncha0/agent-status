import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from 'electron';
import path from 'node:path';
import { showWindow } from './window';

const RELEASES_API = 'https://api.github.com/repos/x1ncha0/agent-status/releases/latest';

async function checkForUpdates(): Promise<void> {
  try {
    const response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const release = await response.json() as { tag_name?: string; html_url?: string };
    const latest = (release.tag_name || '').replace(/^v/i, '');
    const current = app.getVersion().replace(/^v/i, '');
    const newer = latest && latest !== current && latest.localeCompare(current, undefined, { numeric: true }) > 0;
    if (newer) {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'Có bản cập nhật mới',
        message: `Agent Status ${release.tag_name} đã có sẵn.`,
        detail: `Phiên bản hiện tại: ${app.getVersion()}`,
        buttons: ['Tải bản cập nhật', 'Để sau'],
        defaultId: 0,
        cancelId: 1
      });
      if (result.response === 0 && release.html_url) await shell.openExternal(release.html_url);
      return;
    }
    await dialog.showMessageBox({ type: 'info', title: 'Agent Status', message: 'Bạn đang dùng phiên bản mới nhất.' });
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', title: 'Không thể kiểm tra cập nhật', message: 'Không kết nối được GitHub để kiểm tra bản phát hành mới.' });
    console.error('Update check failed:', error);
  }
}

export function createTray(win: BrowserWindow, setup?: () => void, show = () => showWindow(win)): Tray {
  const iconFile = path.join(app.getAppPath(), 'assets/icon.png');
  const tray = new Tray(nativeImage.createFromPath(iconFile).resize({ width: 16, height: 16 }));
  tray.setToolTip('Agent Status');
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const toggle = () => { if (win.isVisible()) win.hide(); else show(); };
  let checking = false;
  const update = () => {
    if (checking) return;
    checking = true;
    void checkForUpdates().finally(() => { checking = false; });
  };
  const refresh = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: win.isVisible() ? 'Hide' : 'Show', click: toggle },
    ...(setup ? [{ label: 'Thiết lập kết nối…', click: setup }] : []),
    { label: 'Kiểm tra cập nhật', click: update },
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
