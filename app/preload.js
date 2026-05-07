const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // VM ops
  vmList: () => ipcRenderer.invoke('vm:list'),
  vmStart: (vmIndex) => ipcRenderer.invoke('vm:start', vmIndex),
  vmStop: (vmIndex) => ipcRenderer.invoke('vm:stop', vmIndex),
  vmHost: (vmIndex) => ipcRenderer.invoke('vm:host', vmIndex),
  vmUnhost: () => ipcRenderer.invoke('vm:unhost'),
  vmGetBranch: (vmIndex, project) => ipcRenderer.invoke('vm:getBranch', vmIndex, project),

  // Terminal
  terminalCreate: (vmIndex, opts) => ipcRenderer.invoke('terminal:create', vmIndex, opts),
  terminalWrite: (sessionId, data) => ipcRenderer.invoke('terminal:write', sessionId, data),
  terminalResize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  terminalKill: (sessionId) => ipcRenderer.invoke('terminal:kill', sessionId),
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal:data', (_, sessionId, data) => callback(sessionId, data));
  },
  onTerminalExit: (callback) => {
    ipcRenderer.on('terminal:exit', (_, sessionId, exitCode) => callback(sessionId, exitCode));
  },

  // Sync
  syncPickFolder: () => ipcRenderer.invoke('sync:pickFolder'),
  syncComputeSize: (path) => ipcRenderer.invoke('sync:computeSize', path),
  syncPush: (vmIndex, localPath, cwd) => ipcRenderer.invoke('sync:push', vmIndex, localPath, cwd),

  // Projects
  projectList: () => ipcRenderer.invoke('project:list'),
  projectAdd: () => ipcRenderer.invoke('project:add'),
  projectGetVm: (vmIndex) => ipcRenderer.invoke('project:getVm', vmIndex),
  projectSetVm: (vmIndex, name) => ipcRenderer.invoke('project:setVm', vmIndex, name),
  projectGetPath: (name) => ipcRenderer.invoke('project:getPath', name),
  projectSetup: (vmIndex, projectName) => ipcRenderer.invoke('project:setup', vmIndex, projectName),

  // Status
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_, data) => callback(data));
  },

  // Backend
  backendGet: () => ipcRenderer.invoke('backend:get'),
  backendSet: (name) => ipcRenderer.invoke('backend:set', name),
  backendList: () => ipcRenderer.invoke('backend:list'),
  backendCliCmd: () => ipcRenderer.invoke('backend:cliCmd'),

});
