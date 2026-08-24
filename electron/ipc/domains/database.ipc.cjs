const DATABASE_INVOKE_CHANNELS = Object.freeze([
  'database:listConnections',
  'database:createConnection',
  'database:updateConnection',
  'database:deleteConnection',
  'database:connect',
  'database:execute',
  'database:cancel',
  'database:begin',
  'database:commit',
  'database:rollback',
  'database:inspectSchema',
  'database:inspectRoutine',
  'database:tableRows',
  'database:updateTableRows',
  'database:listSavedQueries',
  'database:saveQuery',
  'database:updateSavedQuery',
  'database:deleteSavedQuery',
  'database:listHistory',
  'database:clearHistory',
])

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
  getApplicationErrorLogMetadata,
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
  toApplicationError,
  updateConnection,
  updateSavedQuery,
  updateTableRows,
  withCleanupDeadline,
}) {
  return new Map([
    ['database:listConnections', (event) => { assertTrustedSender(event); return listConnections(requireActiveWorkspace()) }],
    ['database:createConnection', (event, input) => { assertTrustedSender(event); return createConnection(requireActiveWorkspace(), input) }],
    ['database:updateConnection', (event, id, input) => runWorkspaceMutation(event, 'database:update-connection', async (workspacePath) => {
      const drain = databaseOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
      await withCleanupDeadline(Promise.all([drain, closeConnectionSession(workspacePath, id)]), 6_000, 'database-connection-runtime')
      return updateConnection(workspacePath, id, input)
    })],
    ['database:deleteConnection', (event, id) => runWorkspaceMutation(event, 'database:delete-connection', async (workspacePath) => {
      const drain = databaseOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
      await withCleanupDeadline(Promise.all([drain, closeConnectionSession(workspacePath, id)]), 6_000, 'database-connection-runtime')
      deleteConnection(workspacePath, id)
      return { deleted: true }
    })],
    ['database:connect', (event, id) => { assertTrustedSender(event); return openConnection(requireActiveWorkspace(), id) }],
    ['database:execute', async (event, id, sql, options) => {
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
    ['database:cancel', (event, operationId) => {
      assertTrustedSender(event)
      return databaseOperations.cancel(operationId, event.sender.id)
    }],
    ['database:begin', (event, id) => runWorkspaceMutation(event, 'database:begin', (workspacePath) => beginTransaction(workspacePath, id))],
    ['database:commit', (event, id) => runWorkspaceMutation(event, 'database:commit', (workspacePath) => commitTransaction(workspacePath, id))],
    ['database:rollback', (event, id) => runWorkspaceMutation(event, 'database:rollback', (workspacePath) => rollbackTransaction(workspacePath, id))],
    ['database:inspectSchema', (event, id, options) => { assertTrustedSender(event); return inspectSchema(requireActiveWorkspace(), id, options) }],
    ['database:inspectRoutine', (event, id, routineName, kind) => { assertTrustedSender(event); return inspectRoutine(requireActiveWorkspace(), id, routineName, kind) }],
    ['database:tableRows', async (event, id, tableName, options) => {
      assertTrustedSender(event)
      try {
        const page = await readTableRows(requireActiveWorkspace(), id, tableName, options)
        log('info', 'database_table_rows_read', { rows: page.rows.length })
        return page
      } catch (error) {
        const incident = toApplicationError(error, { channel: 'database:tableRows' })
        log(incident.severity, 'database_table_rows_failed', getApplicationErrorLogMetadata(incident))
        throw incident
      }
    }],
    ['database:updateTableRows', (event, id, tableName, changes) => runWorkspaceMutation(event, 'database:update-table-rows', (workspacePath) => updateTableRows(workspacePath, id, tableName, changes))],
    ['database:listSavedQueries', (event, id) => { assertTrustedSender(event); return listSavedQueries(requireActiveWorkspace(), id) }],
    ['database:saveQuery', (event, input) => { assertTrustedSender(event); return saveQuery(requireActiveWorkspace(), input) }],
    ['database:updateSavedQuery', (event, id, input) => { assertTrustedSender(event); return updateSavedQuery(requireActiveWorkspace(), id, input) }],
    ['database:deleteSavedQuery', (event, id) => { assertTrustedSender(event); deleteSavedQuery(requireActiveWorkspace(), id); return { deleted: true } }],
    ['database:listHistory', (event, id, limit) => { assertTrustedSender(event); return listHistory(requireActiveWorkspace(), id, limit) }],
    ['database:clearHistory', (event, id) => { assertTrustedSender(event); return clearHistory(requireActiveWorkspace(), id) }],
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
