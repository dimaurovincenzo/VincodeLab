function withCleanupDeadline(promise, timeoutMs, operation, {
  cancelTimer = clearTimeout,
  scheduleTimer = setTimeout,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cancelTimer(timer)
      callback(value)
    }
    const timer = scheduleTimer(() => {
      const error = new Error(`Cleanup non completato: ${operation}.`)
      error.code = 'CLEANUP_TIMEOUT'
      finish(reject, error)
    }, timeoutMs)
    timer.unref?.()
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )
  })
}

function createApplicationShutdownRuntime({
  app,
  benchmarkMode,
  closeDatabase,
  closeDatabaseWorkspaceSessions,
  closeRedisWorkspaceSessions,
  databaseOperations,
  dialog,
  disposeRendererRecovery,
  externalMutations,
  flushLogs,
  getActiveWorkspacePath,
  getMainWindow,
  githubOperations,
  lifecycleCloseGuard,
  log,
  platform,
  projectFileIndex,
  redisOperations,
  releaseInstanceRegistration,
  remoteRuntime,
  shellSessionManager,
  stopPiConfig,
  stopTerminal,
  withDeadline = withCleanupDeadline,
  writeBenchmarkTrace = () => undefined,
}) {
  let quitCleanupPromise
  let quitCleanupComplete = false

  function benchmarkTrace(operation) {
    if (benchmarkMode) writeBenchmarkTrace(`[reliability-benchmark] ${operation}\n`)
  }

  async function shutdownApplication() {
    benchmarkTrace('shutdown-start')
    log('info', 'app_stopping')
    disposeRendererRecovery()
    projectFileIndex.clear()
    await withDeadline(externalMutations.waitAll(), 13_000, 'external-mutations')
    await stopTerminal('shutdown')
    benchmarkTrace('pi-stopped')
    const databaseDrain = databaseOperations.abortAll()
    const databaseWorkspacePath = getActiveWorkspacePath()
    const databaseSessionCleanup = databaseWorkspacePath ? closeDatabaseWorkspaceSessions(databaseWorkspacePath) : Promise.resolve()
    await withDeadline(Promise.all([databaseDrain, databaseSessionCleanup]), 6_000, 'database-runtime')
    const redisDrain = redisOperations.abortAll()
    const redisWorkspacePath = getActiveWorkspacePath()
    const redisSessionCleanup = redisWorkspacePath ? closeRedisWorkspaceSessions(redisWorkspacePath) : Promise.resolve()
    await withDeadline(Promise.all([redisDrain, redisSessionCleanup]), 6_000, 'redis-runtime')
    await withDeadline(githubOperations.abortAndWaitMatching(), 4_000, 'github-operations')
    benchmarkTrace('github-stopped')
    benchmarkTrace('database-stopped')
    // I trasferimenti devono drenarsi prima di terminare il relativo ControlMaster.
    await remoteRuntime.closeAll(withDeadline)
    benchmarkTrace('remote-files-stopped')
    benchmarkTrace('ssh-stopped')
    await stopPiConfig()
    await shellSessionManager.dispose()
    benchmarkTrace('pty-stopped')
    await withDeadline(flushLogs(), 1_500, 'logs')
    benchmarkTrace('logs-flushed')
    // L'istanza resta registrata finché tutte le risorse hanno confermato il cleanup.
    releaseInstanceRegistration()
    benchmarkTrace('shutdown-complete')
  }

  function beginApprovedQuit() {
    if (quitCleanupComplete || quitCleanupPromise) return
    quitCleanupPromise = Promise.resolve()
      .then(() => shutdownApplication())
      .then(() => {
        quitCleanupComplete = true
        lifecycleCloseGuard.dispose()
        app.quit()
      })
      .catch(() => {
        benchmarkTrace('shutdown-failed')
        quitCleanupPromise = undefined
        log('error', 'app_shutdown_failed')
        try {
          dialog.showErrorBox('Chiusura non completata', 'Una risorsa non ha confermato l’arresto. VincodeLab resta aperto per evitare processi orfani o connessioni incomplete; riprova dopo qualche istante.')
        } catch {
          // Il log persistente resta disponibile anche se Electron non può più mostrare dialoghi.
        }
      })
  }

  function install() {
    app.on('window-all-closed', () => {
      if (platform === 'darwin' || quitCleanupComplete || quitCleanupPromise) return
      beginApprovedQuit()
    })
    app.on('before-quit', (event) => {
      if (quitCleanupComplete) return
      event.preventDefault()
      if (quitCleanupPromise) return
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed()) {
        beginApprovedQuit()
        return
      }
      lifecycleCloseGuard.request('quit')
    })
    app.on('will-quit', closeDatabase)
  }

  return {
    beginApprovedQuit,
    getQuitCleanupComplete: () => quitCleanupComplete,
    getQuitCleanupPromise: () => quitCleanupPromise,
    install,
    setQuitCleanupComplete: (value) => { quitCleanupComplete = value },
    setQuitCleanupPromise: (value) => { quitCleanupPromise = value },
    shutdownApplication,
  }
}

module.exports = { createApplicationShutdownRuntime, withCleanupDeadline }
