const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const cliWrapper = require('./lib/cli-wrapper');
const terminalManager = require('./lib/terminal-manager');
const statusPoller = require('./lib/status-poller');
const projectManager = require('./lib/project-manager');
const backend = require('./lib/backend');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0a0a0b',
    title: 'agent-tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── VM IPC handlers ──

ipcMain.handle('vm:list', async () => {
  return cliWrapper.list();
});

ipcMain.handle('vm:start', async (_, vmIndex) => {
  await cliWrapper.start(vmIndex);
});

ipcMain.handle('vm:stop', async (_, vmIndex) => {
  await cliWrapper.stop(vmIndex);
});

ipcMain.handle('vm:host', async (_, vmIndex) => {
  await cliWrapper.host(vmIndex);
});

ipcMain.handle('vm:unhost', async () => {
  await cliWrapper.unhost();
});

ipcMain.handle('vm:getBranch', async (_, vmIndex, project) => {
  return cliWrapper.getBranch(vmIndex, project);
});

// ── Terminal IPC handlers ──

ipcMain.handle('terminal:create', (_, vmIndex, opts = {}) => {
  const sessionId = terminalManager.createSession(vmIndex, (sid, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', sid, data);
    }
  }, {
    ...opts,
    onExit: (sid, exitCode) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', sid, exitCode);
      }
    },
  });
  return sessionId;
});

ipcMain.handle('terminal:write', (_, sessionId, data) => {
  terminalManager.write(sessionId, data);
});

ipcMain.handle('terminal:resize', (_, sessionId, cols, rows) => {
  terminalManager.resize(sessionId, cols, rows);
});

ipcMain.handle('terminal:kill', (_, sessionId) => {
  terminalManager.kill(sessionId);
});

// ── Sync IPC handlers ──

ipcMain.handle('sync:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('sync:computeSize', async (_, filePath) => {
  return cliWrapper.computeSize(filePath);
});

ipcMain.handle('sync:push', async (_, vmIndex, localPath, cwd) => {
  return cliWrapper.syncPush(vmIndex, localPath, cwd);
});

// ── Project IPC handlers ──

ipcMain.handle('project:list', () => {
  return projectManager.list();
});

ipcMain.handle('project:add', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const dirPath = result.filePaths[0];
  projectManager.add(dirPath);
  return projectManager.list();
});

ipcMain.handle('project:getVm', (_, vmIndex) => {
  return projectManager.getVmProject(vmIndex);
});

ipcMain.handle('project:setVm', (_, vmIndex, name) => {
  projectManager.setVmProject(vmIndex, name);
});

ipcMain.handle('project:getPath', (_, name) => {
  return projectManager.getProjectPath(name);
});

ipcMain.handle('project:setup', async (_, vmIndex, projectName) => {
  const projectPath = projectManager.getProjectPath(projectName);
  projectManager.setVmProject(vmIndex, projectName);
  return { projectPath, projectName };
});

// ── Backend IPC handlers ──

ipcMain.handle('backend:get', () => {
  return backend.getBackendName();
});

ipcMain.handle('backend:set', (_, name) => {
  backend.setBackendName(name);
});

ipcMain.handle('backend:list', () => {
  return Object.keys(backend.BACKENDS);
});

ipcMain.handle('backend:cliCmd', () => {
  return backend.getBackend().cliCmd;
});

// ── App lifecycle ──

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  statusPoller.start(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      statusPoller.start(mainWindow);
    }
  });
});

app.on('before-quit', () => {
  statusPoller.stop();
  terminalManager.killAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
