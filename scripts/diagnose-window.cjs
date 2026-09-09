const { app, BrowserWindow, screen } = require('electron');
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  const variants = [{}, {resizable: false}, {maximizable: false}, {fullscreenable: false}, {x: area.width - 126, y: area.height - 71}, {resizable: false, maximizable: false, fullscreenable: false}];
  for (const extra of variants) {
    const win = new BrowserWindow({ width: 110, height: 55, frame: false, transparent: true, show: false, alwaysOnTop: true, skipTaskbar: true, ...extra });
    await new Promise(resolve => {
      win.once('ready-to-show', () => { win.showInactive(); win.setAlwaysOnTop(true); resolve(); });
      win.loadURL('data:text/html,<html><body>test</body></html>');
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    console.log(extra, 'shown', win.isAlwaysOnTop());
    win.destroy();
  }
  app.quit();
});
