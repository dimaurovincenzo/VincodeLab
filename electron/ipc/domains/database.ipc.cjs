const { DATABASE_INVOKE_CHANNELS, IPC_CHANNELS } = require('../channels.cjs')

function createDatabaseHandlers({
  assertTrustedSender,
  beginTransaction,
  classifySql,
  clearHistory,
  closeConnectionSession,
  commitTransaction,
  createConnection,
  databaseOperations,
  deleteConnection,
  deleteSavedQuery,
  executeQuery,
  inspectRoutine,
  inspectSchema,
  listConnections,
  listHistory,
  listSavedQueries,
  log,
  openConnection,
  readTableRows,
  requireActiveWorkspace,
  rollbackTransaction,
  runWorkspaceMutation,
  saveQuery,
  updateConnection,
  updateSavedQuery,
  updateTableRows,
  withCleanupDeadline,
}) {
  return new Map([
    [IPC_CHANNELS.DATABASE_LIST_CONNECTIONS, (event) => { assertTrustedSender(event); return listConnections(requireActiveWorkspace()) }],
    [IPC_CHANNELS.DATABASE_CREATE_CONNECTION, (event, input) => { assertTrustedSender(event); return createConnection(requireActiveWorkspace(), input) }],
    [IPC_CHANNELS.DATABASE_UPDATE_CONNECTION, (event, id, input) => runWorkspaceMutation(event, 'database:update-connection', async (workspacePath) => {
      const drain = databaseOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
      await withCleanupDeadline(Promise.all([drain, closeConnectionSession(workspacePath, id)]), 6_000, 'database-connection-runtime')
      return updateConnection(workspacePath, id, input)
    })],
    [IPC_CHANNELS.DATABASE_DELETE_CONNECTION, (event, id) => runWorkspaceMutation(event, 'database:delete-connection', async (workspacePath) => {
      const drain = databaseOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
      await withCleanupDeadline(Promise.all([drain, closeConnectionSession(workspacePath, id)]), 6_000, 'database-connection-runtime')
      deleteConnection(workspacePath, id)
      return { deleted: true }
    })],
    [IPC_CHANNELS.DATABASE_CONNECT, (event, id) => { assertTrustedSender(event); return openConnection(requireActiveWorkspace(), id) }],
    [IPC_CHANNELS.DATABASE_DISCONNECT, async (event, id) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const drain = databaseOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
      await withCleanupDeadline(Promise.all([drain, closeConnectionSession(workspacePath, id)]), 6_000, 'database-connection-runtime')
      return { disconnected: true }
    }],
    [IPC_CHANNELS.DATABASE_EXECUTE, async (event, id, sql, options) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const operationId = options?.operationId
      const operation = databaseOperations.start({
        operationId,
        senderId: event.sender.id,
        workspacePath,
        connectionId: id,
        mutative: classifySql(sql).mutative,
      })
      try {
        const { operationId: _operationId, ...queryOptions } = options
        return await executeQuery(workspacePath, id, sql, { ...queryOptions, signal: operation.signal })
      } finally {
        operation.finish()
      }
    }],
    [IPC_CHANNELS.DATABASE_CANCEL, (event, operationId) => {
      assertTrustedSender(event)
      return databaseOperations.cancel(operationId, event.sender.id)
    }],
    [IPC_CHANNELS.DATABASE_BEGIN, (event, id) => runWorkspaceMutation(event, IPC_CHANNELS.DATABASE_BEGIN, (workspacePath) => beginTransaction(workspacePath, id))],
    [IPC_CHANNELS.DATABASE_COMMIT, (event, id) => runWorkspaceMutation(event, IPC_CHANNELS.DATABASE_COMMIT, (workspacePath) => commitTransaction(workspacePath, id))],
    [IPC_CHANNELS.DATABASE_ROLLBACK, (event, id) => runWorkspaceMutation(event, IPC_CHANNELS.DATABASE_ROLLBACK, (workspacePath) => rollbackTransaction(workspacePath, id))],
    [IPC_CHANNELS.DATABASE_INSPECT_SCHEMA, (event, id, options) => { assertTrustedSender(event); return inspectSchema(requireActiveWorkspace(), id, options) }],
    [IPC_CHANNELS.DATABASE_INSPECT_ROUTINE, (event, id, routineName, kind) => { assertTrustedSender(event); return inspectRoutine(requireActiveWorkspace(), id, routineName, kind) }],
    [IPC_CHANNELS.DATABASE_TABLE_ROWS, async (event, id, tableName, options) => {
      assertTrustedSender(event)
      const page = await readTableRows(requireActiveWorkspace(), id, tableName, options)
      log('info', 'database_table_rows_read', { rows: page.rows.length })
      return page
    }],
    [IPC_CHANNELS.DATABASE_UPDATE_TABLE_ROWS, (event, id, tableName, changes) => runWorkspaceMutation(event, 'database:update-table-rows', (workspacePath) => updateTableRows(workspacePath, id, tableName, changes))],
    [IPC_CHANNELS.DATABASE_LIST_SAVED_QUERIES, (event, id) => { assertTrustedSender(event); return listSavedQueries(requireActiveWorkspace(), id) }],
    [IPC_CHANNELS.DATABASE_SAVE_QUERY, (event, input) => { assertTrustedSender(event); return saveQuery(requireActiveWorkspace(), input) }],
    [IPC_CHANNELS.DATABASE_UPDATE_SAVED_QUERY, (event, id, input) => { assertTrustedSender(event); return updateSavedQuery(requireActiveWorkspace(), id, input) }],
    [IPC_CHANNELS.DATABASE_DELETE_SAVED_QUERY, (event, id) => { assertTrustedSender(event); deleteSavedQuery(requireActiveWorkspace(), id); return { deleted: true } }],
    [IPC_CHANNELS.DATABASE_LIST_HISTORY, (event, id, limit) => { assertTrustedSender(event); return listHistory(requireActiveWorkspace(), id, limit) }],
    [IPC_CHANNELS.DATABASE_CLEAR_HISTORY, (event, id) => { assertTrustedSender(event); return clearHistory(requireActiveWorkspace(), id) }],
  ])
}

function registerDatabaseIpc({ ipcMain, ...dependencies }) {
  const handlers = createDatabaseHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: DATABASE_INVOKE_CHANNELS })
}

module.exports = {
  DATABASE_INVOKE_CHANNELS,
  createDatabaseHandlers,
  registerDatabaseIpc,
}
