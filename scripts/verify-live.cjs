// Run after closing the normal app. Reads the installed integration through the real main/preload/DOM.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
require('../dist/main/main.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    let state;
    let win;
    for (let i = 0; i < 100; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoading()) {
        state = await win.webContents.executeJavaScript('window.agentStatus.get()');
        if (state.find((s) => s.agent === 'codex')?.observed) break;
      }
      await sleep(100);
    }
    const codex = state?.find((s) => s.agent === 'codex');
    assert.equal(codex?.observed, true, JSON.stringify(state));
    assert.equal(codex.status, 'working', JSON.stringify(codex));
    const dot = await win.webContents.executeJavaScript(
      "document.querySelector('#codex .dot').className",
    );
    assert.equal(dot, 'dot working');
    const directory = path.resolve('.test-data/live');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'window.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await fs.writeFile(
      path.join(directory, 'report.json'),
      JSON.stringify({ state, dot }, null, 2),
    );
    console.log(
      JSON.stringify(
        { state, dot, result: 'Live Codex hook -> monitor -> IPC -> yellow DOM' },
        null,
        2,
      ),
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
