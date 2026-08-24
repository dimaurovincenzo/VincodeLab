const { IPC_CHANNELS } = require('../../ipc/channels.cjs')

function createCoreBridge(ipcRenderer) {
  return {
    lifecycle: {
      respondToClose: (requestId, decision) => ipcRenderer.send(IPC_CHANNELS.LIFECYCLE_CLOSE_RESPONSE, { requestId, decision }),
      onCloseRequested: (listener) => {
        const handler = (_event, request) => listener(request)
        ipcRenderer.on(IPC_CHANNELS.LIFECYCLE_CLOSE_REQUESTED, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.LIFECYCLE_CLOSE_REQUESTED, handler)
      },
    },
    appMenu: {
      setContext: (section) => ipcRenderer.send(IPC_CHANNELS.APP_MENU_SET_CONTEXT, section),
      onCommand: (listener) => {
        const handler = (_event, command) => listener(command)
        ipcRenderer.on(IPC_CHANNELS.APP_MENU_COMMAND, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_MENU_COMMAND, handler)
      },
    },
    contextMenu: {
      open: (request) => ipcRenderer.invoke(IPC_CHANNELS.CONTEXT_MENU_OPEN, request),
      onAction: (listener) => {
        const handler = (_event, action) => listener(action)
        ipcRenderer.on(IPC_CHANNELS.CONTEXT_MENU_ACTION, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CONTEXT_MENU_ACTION, handler)
      },
    },
    workspace: {
      open: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN),
      getActive: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_ACTIVE),
      listRecent: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LIST_RECENT),
      reveal: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_REVEAL),
      openRecent: (workspacePath) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_RECENT, workspacePath),
      instanceStatus: (workspacePath) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_INSTANCE_STATUS, workspacePath),
      openInNewInstance: (workspacePath) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN_IN_NEW_INSTANCE, workspacePath),
      onOpened: (listener) => {
        const handler = (_event, result) => listener(result)
        ipcRenderer.on(IPC_CHANNELS.WORKSPACE_OPENED, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.WORKSPACE_OPENED, handler)
      },
    },
    workspaceSession: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SESSION_GET),
      save: (snapshot) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SESSION_SAVE, snapshot),
    },
    volatileDrafts: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.VOLATILE_DRAFTS_LIST),
      write: (draft) => ipcRenderer.invoke(IPC_CHANNELS.VOLATILE_DRAFTS_WRITE, draft),
      discard: (identity) => ipcRenderer.invoke(IPC_CHANNELS.VOLATILE_DRAFTS_DISCARD, identity),
    },
    appearance: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.APPEARANCE_GET),
      set: (appearance) => ipcRenderer.invoke(IPC_CHANNELS.APPEARANCE_SET, appearance),
    },
    preferences: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_GET),
      setGlobal: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_SET_GLOBAL, key, value),
      setWorkspace: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_SET_WORKSPACE, key, value),
      clearWorkspace: (key) => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_CLEAR_WORKSPACE, key),
      clearAllWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.PREFERENCES_CLEAR_ALL_WORKSPACE),
    },
    updates: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_LIST),
      check: (id) => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_CHECK, id),
      download: (id) => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_DOWNLOAD, id),
      downloadAll: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_DOWNLOAD_ALL),
      setPolicy: (id, policy) => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_SET_POLICY, id, policy),
      rollback: (id) => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_ROLLBACK, id),
      activatePending: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATES_ACTIVATE_PENDING),
    },
  }
}

module.exports = { createCoreBridge }
