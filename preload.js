const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // Async IPC wrappers
  getGames: () => ipcRenderer.invoke('getGames'),
  savePlugin: (plugin) => ipcRenderer.invoke('savePlugin', plugin),
  deletePlugin: (id, name) => ipcRenderer.invoke('deletePlugin', { id: id, name: name }),
  getProcessList: () => ipcRenderer.invoke('getProcessList'),
  getProcessIcons: (pathList) => ipcRenderer.invoke('getProcessIcons', pathList),
  filterScan: (pid, previousResults, newValue, dataType) => ipcRenderer.invoke('filterScan', pid, previousResults, newValue, dataType),
  writeMemory: (...args) => ipcRenderer.invoke('writeMemory', ...args),
  scanMemory: (...args) => ipcRenderer.invoke('scanMemory', ...args),
  stopScan: () => ipcRenderer.invoke('stopScan'),
  addCheatsToGame: (gameName, cheats) => ipcRenderer.invoke('addCheatsToGame', gameName, cheats),
  updateCheatValue: (gameName, idx, newValue) => ipcRenderer.invoke('updateCheatValue', gameName, idx, newValue),
  saveCurrentGame: (gameName) => ipcRenderer.invoke('saveCurrentGame', gameName),
  editGameInfo: (idx, newName, newDesc) => ipcRenderer.invoke('editGameInfo', idx, newName, newDesc),
  // i18n API
  i18nChangeLanguage: (lng) => ipcRenderer.invoke('i18nChangeLanguage', lng),
  i18nTranslate: (key, options) => ipcRenderer.invoke('i18nTranslate', key, options),
  // Main process log listener
  onMainLog: (callback) => ipcRenderer.on('main-log', (_event, message) => callback(message)),
  // Scan progress listener (real-time updates during memory scan)
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (_event, message) => callback(message)),
  // Keep a basic shim for direct access if needed (async)
  ipcRenderer: {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
  }
});
