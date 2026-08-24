function createDataBridge(ipcRenderer) {
  return {
    database: {
      listConnections: () => ipcRenderer.invoke('database:listConnections'),
      createConnection: (input) => ipcRenderer.invoke('database:createConnection', input),
      updateConnection: (id, input) => ipcRenderer.invoke('database:updateConnection', id, input),
      deleteConnection: (id) => ipcRenderer.invoke('database:deleteConnection', id),
      execute: (connectionId, sql, options) => ipcRenderer.invoke('database:execute', connectionId, sql, options),
      cancel: (operationId) => ipcRenderer.invoke('database:cancel', operationId),
      begin: (connectionId) => ipcRenderer.invoke('database:begin', connectionId),
      commit: (connectionId) => ipcRenderer.invoke('database:commit', connectionId),
      rollback: (connectionId) => ipcRenderer.invoke('database:rollback', connectionId),
      inspectSchema: (connectionId, options) => ipcRenderer.invoke('database:inspectSchema', connectionId, options),
      tableRows: (connectionId, tableName, options) => ipcRenderer.invoke('database:tableRows', connectionId, tableName, options),
      updateTableRows: (connectionId, tableName, changes) => ipcRenderer.invoke('database:updateTableRows', connectionId, tableName, changes),
      listSavedQueries: (connectionId) => ipcRenderer.invoke('database:listSavedQueries', connectionId),
      saveQuery: (input) => ipcRenderer.invoke('database:saveQuery', input),
      updateSavedQuery: (id, input) => ipcRenderer.invoke('database:updateSavedQuery', id, input),
      deleteSavedQuery: (id) => ipcRenderer.invoke('database:deleteSavedQuery', id),
      listHistory: (connectionId, limit) => ipcRenderer.invoke('database:listHistory', connectionId, limit),
      clearHistory: (connectionId) => ipcRenderer.invoke('database:clearHistory', connectionId),
    },
    redis: {
      listConnections: () => ipcRenderer.invoke('redis:listConnections'),
      createConnection: (input) => ipcRenderer.invoke('redis:createConnection', input),
      updateConnection: (id, input) => ipcRenderer.invoke('redis:updateConnection', id, input),
      deleteConnection: (id) => ipcRenderer.invoke('redis:deleteConnection', id),
      testConnection: (input, connectionId) => ipcRenderer.invoke('redis:testConnection', input, connectionId),
      scanKeys: (connectionId, input) => ipcRenderer.invoke('redis:scanKeys', connectionId, input),
      readKey: (connectionId, keyRef, input) => ipcRenderer.invoke('redis:readKey', connectionId, keyRef, input),
      reconnect: (connectionId) => ipcRenderer.invoke('redis:reconnect', connectionId),
      searchPayloads: (connectionId, input) => ipcRenderer.invoke('redis:searchPayloads', connectionId, input),
      cancel: (operationId) => ipcRenderer.invoke('redis:cancel', operationId),
      onSearchProgress: (listener) => {
        const handler = (_event, progress) => listener(progress)
        ipcRenderer.on('redis:searchProgress', handler)
        return () => ipcRenderer.removeListener('redis:searchProgress', handler)
      },
    },
  }
}

module.exports = { createDataBridge }
