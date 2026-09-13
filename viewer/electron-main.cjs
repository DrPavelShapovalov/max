// Electron: открывает собранный вьюпорт (dist/) в отдельном окне.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1100, minHeight: 720,
    title: 'OSSA 3D — Craniofacial Distraction Planner',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#081116',
    autoHideMenuBar: true,
    show: false,                                  // покажем развёрнутым, когда готово
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  // окно сразу на весь экран (развёрнуто) после загрузки — как просили
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
