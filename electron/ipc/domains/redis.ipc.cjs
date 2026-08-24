const { IPC_CHANNELS, REDIS_INVOKE_CHANNELS } = require('../channels.cjs')

function createRedisHandlers({
  assertTrustedSender,
  closeRedisConnectionSession,
  createPublicError,
  createRedisConnection,
  deleteRedisConnection,
  getRedisConnectionWithSecrets,
  listRedisConnections,
  mergeRedisTestConnectionSecrets,
  randomUUID,
  readRedisKey,
  redisInspectionForRenderer,
  redisOperations,
  redisSearchForRenderer,
  redisSummaryForRenderer,
  requireActiveWorkspace,
  runWorkspaceMutation,
  scanRedisKeys,
  searchRedisKeys,
  sendToRenderer,
  testRedisConnectionInput,
  updateRedisConnection,
  withCleanupDeadline,
}) {
  async function drainAndCloseConnection(workspacePath, connectionId) {
    const drain = redisOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === connectionId)
    try {
      await withCleanupDeadline(
        Promise.all([drain, closeRedisConnectionSession(workspacePath, connectionId)]),
        6_000,
        'redis-connection-runtime',
      )
    } catch (cause) {
      const error = createPublicError(
        'REDIS_DISCONNECT_FAILED',
        'Redis non ha confermato la disconnessione. La sessione resta disponibile: riprova prima di cambiare configurazione.',
      )
      try { Object.defineProperty(error, 'cause', { value: cause }) } catch { /* La causa tecnica resta best effort. */ }
      throw error
    }
  }

  return new Map([
    [IPC_CHANNELS.REDIS_LIST_CONNECTIONS, (event) => {
      assertTrustedSender(event)
      return listRedisConnections(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.REDIS_CREATE_CONNECTION, (event, input) => runWorkspaceMutation(event, 'redis:create-connection', (workspacePath) => createRedisConnection(workspacePath, input))],
    [IPC_CHANNELS.REDIS_UPDATE_CONNECTION, (event, id, input) => runWorkspaceMutation(event, 'redis:update-connection', async (workspacePath) => {
      const drain = redisOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
      await withCleanupDeadline(Promise.all([drain, closeRedisConnectionSession(workspacePath, id)]), 6_000, 'redis-connection-runtime')
      return updateRedisConnection(workspacePath, id, input)
    })],
    [IPC_CHANNELS.REDIS_DELETE_CONNECTION, (event, id) => runWorkspaceMutation(event, 'redis:delete-connection', async (workspacePath) => {
      const drain = redisOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
      await withCleanupDeadline(Promise.all([drain, closeRedisConnectionSession(workspacePath, id)]), 6_000, 'redis-connection-runtime')
      deleteRedisConnection(workspacePath, id)
      return { deleted: true }
    })],
    [IPC_CHANNELS.REDIS_TEST_CONNECTION, async (event, input, connectionId) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      let testInput = input
      if (connectionId !== undefined) {
        const stored = getRedisConnectionWithSecrets(workspacePath, connectionId)
        if (!stored) throw createPublicError('REDIS_CONNECTION_NOT_FOUND', 'La connessione Redis del workspace non è più disponibile. Aggiorna l’elenco e riprova.')
        testInput = mergeRedisTestConnectionSecrets(input, stored)
      }
      const operation = redisOperations.start({ operationId: randomUUID(), senderId: event.sender.id, workspacePath, connectionId: connectionId ?? 'draft' })
      try {
        return await testRedisConnectionInput(testInput, { signal: operation.signal })
      } finally {
        operation.finish()
      }
    }],
    [IPC_CHANNELS.REDIS_SCAN_KEYS, async (event, connectionId, input) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const operation = redisOperations.start({ operationId: randomUUID(), senderId: event.sender.id, workspacePath, connectionId })
      try {
        const page = await scanRedisKeys(workspacePath, connectionId, {
          cursor: input?.cursor,
          match: input?.match,
          type: input?.type,
          count: input?.count,
          signal: operation.signal,
        })
        return {
          cursor: page.nextCursor,
          keys: page.items.map(redisSummaryForRenderer),
          scanned: page.scanned,
          hasMore: !page.complete,
        }
      } finally {
        operation.finish()
      }
    }],
    [IPC_CHANNELS.REDIS_READ_KEY, async (event, connectionId, encodedKey, input) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const operation = redisOperations.start({ operationId: randomUUID(), senderId: event.sender.id, workspacePath, connectionId })
      try {
        const inspection = await readRedisKey(workspacePath, connectionId, { encoded: encodedKey }, {
          cursor: input?.cursor,
          offset: input?.offset,
          count: input?.count,
          signal: operation.signal,
        })
        return redisInspectionForRenderer(inspection)
      } finally {
        operation.finish()
      }
    }],
    [IPC_CHANNELS.REDIS_DISCONNECT, async (event, connectionId) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      await drainAndCloseConnection(workspacePath, connectionId)
      return { disconnected: true }
    }],
    [IPC_CHANNELS.REDIS_RECONNECT, async (event, connectionId) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      await drainAndCloseConnection(workspacePath, connectionId)
      return { reconnected: true }
    }],
    [IPC_CHANNELS.REDIS_SEARCH_PAYLOADS, async (event, connectionId, input) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const operation = redisOperations.start({
        operationId: input?.operationId,
        senderId: event.sender.id,
        workspacePath,
        connectionId,
      })
      try {
        return redisSearchForRenderer(await searchRedisKeys(workspacePath, connectionId, {
          operationId: input?.operationId,
          query: input?.query,
          keyRef: input?.keyRef,
          keyPattern: input?.keyPattern,
          type: input?.type,
          count: input?.count,
          limit: input?.limit,
          maxScanned: input?.maxScanned,
          signal: operation.signal,
        }, (progress) => {
          sendToRenderer(IPC_CHANNELS.REDIS_SEARCH_PROGRESS, redisSearchForRenderer(progress))
        }))
      } finally {
        operation.finish()
      }
    }],
    [IPC_CHANNELS.REDIS_CANCEL, (event, operationId) => {
      assertTrustedSender(event)
      const result = redisOperations.cancel(operationId, event.sender.id)
      return { cancelled: result.cancelled }
    }],
  ])
}

function registerRedisIpc({ ipcMain, ...dependencies }) {
  const handlers = createRedisHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: REDIS_INVOKE_CHANNELS })
}

module.exports = {
  REDIS_INVOKE_CHANNELS,
  createRedisHandlers,
  registerRedisIpc,
}
