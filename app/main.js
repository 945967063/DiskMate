const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { execSync, spawn } = require('child_process');
const path = require('path');

function isElevated() {
  if (process.platform !== 'win32') return true;
  try { execSync('net session', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: 'DiskMate 磁盘管家',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0F172A',
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.on('maximize', () => win.webContents.send('win-state', true));
  win.on('unmaximize', () => win.webContents.send('win-state', false));
}

app.whenReady().then(() => {
  if (process.platform === 'win32' && !isElevated() && !process.env.DISKMATE_NO_ELEVATE) {
    try {
      const exe = process.execPath.replace(/'/g, "''");
      spawn('powershell.exe',
        ['-NoProfile', '-Command', `Start-Process -FilePath '${exe}' -Verb RunAs`],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      app.quit();
      return;
    } catch (e) { /* 提权失败则继续普通权限 */ }
  }
  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

ipcMain.handle('pick-folder', async (e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || '选择目录', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('is-admin', () => isElevated());
ipcMain.handle('pick-files', async (e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || '选择文件', properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('open-path', (e, p) => shell.openPath(p));
ipcMain.handle('show-in-folder', (e, p) => shell.showItemInFolder(p));
ipcMain.on('win-min', () => win.minimize());
ipcMain.on('win-max', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('win-close', () => win.close());
