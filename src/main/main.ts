import { defaultDataDir, isMac, isWindows } from '../common/platform';
import { createMacBackend } from './integration-mac';
import { app, ipcMain, shell, Tray } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createWindow, showWindow } from './window';
import { createTray } from './tray';
import { trayTooltip } from './tray-tooltip';
import { FileMonitor } from '../monitor/file-monitor';
import { classifyClaude } from '../monitor/claude';
import { classifyCodex } from '../monitor/codex';
import { createWindowsBackend, type SetupPaths } from './integration-backend';
import { createIntegrationSetup } from './integration';
import { createAttentionNotifier } from './attention';
import { cleanupPreviousUpdate, createUpdater } from './updater';

const dataDir = defaultDataDir(process.platform, process.env, app.getPath('appData'));
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, 'electron'));
let tray: Tray;
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app.whenReady().then(() => {
    const monitors = [
      new FileMonitor(path.join(dataDir, 'events/claude'), 'claude', classifyClaude),
      new FileMonitor(path.join(dataDir, 'events/codex'), 'codex', classifyCodex),
    ];
    const win = createWindow(dataDir);
    const setupPaths: SetupPaths = {
      dataDir,
      integrationDir: path.join(
        app.isPackaged ? process.resourcesPath : path.join(__dirname, '../..'),
        'integration',
      ),
      claudeHome: process.env.AGENT_STATUS_CLAUDE_HOME || path.join(app.getPath('home'), '.claude'),
      codexHome:
        process.env.AGENT_STATUS_CODEX_HOME ||
        process.env.CODEX_HOME ||
        path.join(app.getPath('home'), '.codex'),
    };
    const setup = createIntegrationSetup(
      win,
      dataDir,
      isWindows
        ? createWindowsBackend(setupPaths)
        : isMac
          ? createMacBackend(setupPaths)
          : undefined,
    );
    const snapshot = () => monitors.map((monitor) => monitor.snapshot());
    ipcMain.handle('status:get', snapshot);
    let ready = false;
    let hasAgents = false;
    const show = () => {
      if (ready && hasAgents && !win.isDestroyed()) showWindow(win);
    };
    const updater = createUpdater(win);
    void cleanupPreviousUpdate();
    const trayMenu = createTray(
      win,
      () => {
        void setup.show();
      },
      show,
      updater.check,
      () => hasAgents,
    );
    tray = trayMenu.tray;
    win.once('ready-to-show', () => {
      ready = true;
      show();
      void setup.checkOnStartup();
    });
    app.on('second-instance', show);
    let previous = '';
    const notifyAttention = createAttentionNotifier(() => shell.beep());
    // Only restore on an empty -> active transition, preserving manual Hide while agents run.
    const updateVisibility = (active: boolean) => {
      if (active === hasAgents) return;
      hasAgents = active;
      if (active) show();
      else win.hide();
      trayMenu.refresh();
    };
    const tick = async () => {
      await Promise.all(monitors.map((monitor) => monitor.poll()));
      const states = snapshot();
      notifyAttention(states);
      const serialized = JSON.stringify(states);
      if (serialized === previous || win.isDestroyed()) return;
      previous = serialized;
      win.webContents.send('status:changed', states);
      updateVisibility(states.some((state) => state.observed));
      tray.setToolTip(trayTooltip(states));
    };
    const timer = setInterval(() => void tick(), 500);
    void tick();
    app.on('before-quit', () => {
      clearInterval(timer);
      tray.destroy();
    });
  });
app.on('window-all-closed', () => app.quit());
