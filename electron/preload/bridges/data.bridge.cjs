const { IPC_CHANNELS } = require('../../ipc/channels.cjs')

function createDataBridge(ipcRenderer) {
  return {
    database: {
      listConnections: () => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_LIST_CONNECTIONS),
      createConnection: (input) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_CREATE_CONNECTION, input),
      updateConnection: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_UPDATE_CONNECTION, id, input),
      deleteConnection: (id) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_DELETE_CONNECTION, id),
      connect: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_CONNECT, connectionId),
      disconnect: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_DISCONNECT, connectionId),
      execute: (connectionId, sql, options) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_EXECUTE, connectionId, sql, options),
      cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_CANCEL, operationId),
      begin: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_BEGIN, connectionId),
      commit: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_COMMIT, connectionId),
      rollback: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_ROLLBACK, connectionId),
      inspectSchema: (connectionId, options) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_INSPECT_SCHEMA, connectionId, options),
      inspectRoutine: (connectionId, routineName, kind) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_INSPECT_ROUTINE, connectionId, routineName, kind),
      tableRows: (connectionId, tableName, options) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_TABLE_ROWS, connectionId, tableName, options),
      updateTableRows: (connectionId, tableName, changes) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_UPDATE_TABLE_ROWS, connectionId, tableName, changes),
      listSavedQueries: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_LIST_SAVED_QUERIES, connectionId),
      saveQuery: (input) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_SAVE_QUERY, input),
      updateSavedQuery: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_UPDATE_SAVED_QUERY, id, input),
      deleteSavedQuery: (id) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_DELETE_SAVED_QUERY, id),
      listHistory: (connectionId, limit) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_LIST_HISTORY, connectionId, limit),
      clearHistory: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE_CLEAR_HISTORY, connectionId),
    },
    redis: {
      listConnections: () => ipcRenderer.invoke(IPC_CHANNELS.REDIS_LIST_CONNECTIONS),
      createConnection: (input) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_CREATE_CONNECTION, input),
      updateConnection: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_UPDATE_CONNECTION, id, input),
      deleteConnection: (id) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_DELETE_CONNECTION, id),
      disconnect: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_DISCONNECT, connectionId),
      testConnection: (input, connectionId) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_TEST_CONNECTION, input, connectionId),
      scanKeys: (connectionId, input) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_SCAN_KEYS, connectionId, input),
      readKey: (connectionId, keyRef, input) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_READ_KEY, connectionId, keyRef, input),
      reconnect: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_RECONNECT, connectionId),
      searchPayloads: (connectionId, input) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_SEARCH_PAYLOADS, connectionId, input),
      cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.REDIS_CANCEL, operationId),
      onSearchProgress: (listener) => {
        const handler = (_event, progress) => listener(progress)
        ipcRenderer.on(IPC_CHANNELS.REDIS_SEARCH_PROGRESS, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.REDIS_SEARCH_PROGRESS, handler)
      },
    },
  }
}

module.exports = { createDataBridge }
