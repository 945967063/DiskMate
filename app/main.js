const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { execSync, spawn } = require('child_process');
const path = require('path');

function isElevated() {
  if (process.platform !== 'win32') return true;
  try { execSync('net session', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ── 未提权：先以管理员身份重启自己，再退出 ──
// 关键：此分支绝不请求单实例锁，否则会与提权后的新实例抢锁导致“双击没反应”
if (process.platform === 'win32' && !isElevated() && !process.env.DISKMATE_NO_ELEVATE) {
  try {
    const exe = process.execPath.replace(/'/g, "''");
    spawn('powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
       `Start-Process -FilePath '${exe}' -Verb RunAs`],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) { /* 提权失败：兜底直接以普通权限启动 */ }
  // 立即退出当前非提权实例（子进程已独立启动，UAC 会弹出）
  app.quit();
  setTimeout(() => { try { app.exit(0); } catch { } }, 300);
} else {
  // ── 已提权（或非 Windows）：正常启动 ──
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    let win = null;

    function createWindow() {
      win = new BrowserWindow({
        width: 1200, height: 800, minWidth: 980, minHeight: 640,
        title: 'DiskMate 磁盘管家',
        frame: false, autoHideMenuBar: true, backgroundColor: '#EEF2FB',
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: { nodeIntegration: true, contextIsolation: false, spellcheck: false },
      });
      win.setMenuBarVisibility(false);
      win.loadFile('index.html');
      win.on('maximize', () => win.webContents.send('win-state', true));
      win.on('unmaximize', () => win.webContents.send('win-state', false));
      // F12 / Ctrl+Shift+I 打开开发者工具（方便调试与实时修改界面），Ctrl+R 刷新
      win.webContents.on('before-input-event', (e, input) => {
        if (input.type !== 'keyDown') return;
        const k = (input.key || '').toLowerCase();
        if (k === 'f12' || (input.control && input.shift && k === 'i')) { win.webContents.toggleDevTools(); }
        else if (input.control && k === 'r') { win.webContents.reloadIgnoringCache(); }
      });
    }

    app.on('second-instance', () => {
      if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    });
    app.on('window-all-closed', () => app.quit());
    app.whenReady().then(createWindow);

    ipcMain.handle('pick-folder', async (e, title) => {
      const r = await dialog.showOpenDialog(win, { title: title || '选择目录', properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('pick-files', async (e, title) => {
      const r = await dialog.showOpenDialog(win, { title: title || '选择文件', properties: ['openFile', 'multiSelections'] });
      return r.canceled ? [] : r.filePaths;
    });
    ipcMain.handle('is-admin', () => isElevated());
    ipcMain.handle('open-path', (e, p) => shell.openPath(p));
    ipcMain.handle('show-in-folder', (e, p) => shell.showItemInFolder(p));
    ipcMain.handle('open-external', (e, u) => shell.openExternal(u));
    ipcMain.handle('toggle-devtools', () => win && win.webContents.toggleDevTools());
    // 运行安装包并退出当前程序（用于应用内更新）
    ipcMain.handle('run-and-quit', (e, filePath) => {
      try { spawn(filePath, [], { detached: true, stdio: 'ignore' }).unref(); } catch (err) { return String(err); }
      setTimeout(() => app.quit(), 600);
      return 'ok';
    });
    ipcMain.on('win-min', () => win && win.minimize());
    ipcMain.on('win-max', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
    ipcMain.on('win-close', () => win && win.close());
  }
}
