function createCoreBridge(ipcRenderer) {
  return {
    lifecycle: {
      respondToClose: (requestId, decision) => ipcRenderer.send('lifecycle:closeResponse', { requestId, decision }),
      onCloseRequested: (listener) => {
        const handler = (_event, request) => listener(request)
        ipcRenderer.on('lifecycle:closeRequested', handler)
        return () => ipcRenderer.removeListener('lifecycle:closeRequested', handler)
      },
    },
    appMenu: {
      setContext: (section) => ipcRenderer.send('appMenu:setContext', section),
      onCommand: (listener) => {
        const handler = (_event, command) => listener(command)
        ipcRenderer.on('appMenu:command', handler)
        return () => ipcRenderer.removeListener('appMenu:command', handler)
      },
    },
    contextMenu: {
      open: (request) => ipcRenderer.invoke('contextMenu:open', request),
      onAction: (listener) => {
        const handler = (_event, action) => listener(action)
        ipcRenderer.on('contextMenu:action', handler)
        return () => ipcRenderer.removeListener('contextMenu:action', handler)
      },
    },
    workspace: {
      open: () => ipcRenderer.invoke('workspace:open'),
      getActive: () => ipcRenderer.invoke('workspace:getActive'),
      listRecent: () => ipcRenderer.invoke('workspace:listRecent'),
      reveal: () => ipcRenderer.invoke('workspace:reveal'),
      openRecent: (workspacePath) => ipcRenderer.invoke('workspace:openRecent', workspacePath),
      instanceStatus: (workspacePath) => ipcRenderer.invoke('workspace:instanceStatus', workspacePath),
      openInNewInstance: (workspacePath) => ipcRenderer.invoke('workspace:openInNewInstance', workspacePath),
      onOpened: (listener) => {
        const handler = (_event, result) => listener(result)
        ipcRenderer.on('workspace:opened', handler)
        return () => ipcRenderer.removeListener('workspace:opened', handler)
      },
    },
    workspaceSession: {
      get: () => ipcRenderer.invoke('workspaceSession:get'),
      save: (snapshot) => ipcRenderer.invoke('workspaceSession:save', snapshot),
    },
    volatileDrafts: {
      list: () => ipcRenderer.invoke('volatileDrafts:list'),
      write: (draft) => ipcRenderer.invoke('volatileDrafts:write', draft),
      discard: (identity) => ipcRenderer.invoke('volatileDrafts:discard', identity),
    },
    appearance: {
      get: () => ipcRenderer.invoke('appearance:get'),
      set: (appearance) => ipcRenderer.invoke('appearance:set', appearance),
    },
    preferences: {
      get: () => ipcRenderer.invoke('preferences:get'),
      setGlobal: (key, value) => ipcRenderer.invoke('preferences:setGlobal', key, value),
      setWorkspace: (key, value) => ipcRenderer.invoke('preferences:setWorkspace', key, value),
      clearWorkspace: (key) => ipcRenderer.invoke('preferences:clearWorkspace', key),
      clearAllWorkspace: () => ipcRenderer.invoke('preferences:clearAllWorkspace'),
    },
    updates: {
      list: () => ipcRenderer.invoke('updates:list'),
      check: (id) => ipcRenderer.invoke('updates:check', id),
      download: (id) => ipcRenderer.invoke('updates:download', id),
      downloadAll: () => ipcRenderer.invoke('updates:downloadAll'),
      setPolicy: (id, policy) => ipcRenderer.invoke('updates:setPolicy', id, policy),
      rollback: (id) => ipcRenderer.invoke('updates:rollback', id),
      activatePending: () => ipcRenderer.invoke('updates:activatePending'),
    },
  }
}

module.exports = { createCoreBridge }
