function createWorkspaceRuntimeCleanup({
  closeDatabaseWorkspaceSessions,
  closeRedisWorkspaceSessions,
  closeShellSessions,
  databaseOperations,
  externalMutations,
  getWindow,
  githubOperations,
  redisOperations,
  remoteRuntime,
  stopPiConfig,
  stopTerminal,
  withCleanupDeadline,
}) {
  return async function cleanupWorkspaceRuntime(workspacePath, reason) {
    const window = getWindow()
    const ownerId = window && !window.isDestroyed() ? window.webContents.id : null
    await withCleanupDeadline(
      externalMutations.waitMatching((operation) => operation.workspacePath === workspacePath
        || (ownerId !== null && operation.ownerId === ownerId)),
      13_000,
      'external-mutations',
    )
    await stopTerminal(reason)
    const databaseDrain = databaseOperations.abortAndWaitMatching(
      (operation) => !workspacePath || operation.workspacePath === workspacePath,
    )
    const databaseSessionCleanup = workspacePath
      ? closeDatabaseWorkspaceSessions(workspacePath)
      : Promise.resolve()
    await withCleanupDeadline(Promise.all([databaseDrain, databaseSessionCleanup]), 6_000, 'database-runtime')
    const redisDrain = redisOperations.abortAndWaitMatching(
      (operation) => !workspacePath || operation.workspacePath === workspacePath,
    )
    const redisSessionCleanup = workspacePath
      ? closeRedisWorkspaceSessions(workspacePath)
      : Promise.resolve()
    await withCleanupDeadline(Promise.all([redisDrain, redisSessionCleanup]), 6_000, 'redis-runtime')
    await withCleanupDeadline(
      githubOperations.abortAndWaitMatching((operation) => !workspacePath || operation.workspacePath === workspacePath),
      4_000,
      'github-operations',
    )
    if (workspacePath) {
      await remoteRuntime.closeWorkspace(workspacePath, withCleanupDeadline)
      await closeShellSessions(workspacePath)
    }
    await stopPiConfig()
  }
}

module.exports = { createWorkspaceRuntimeCleanup }
