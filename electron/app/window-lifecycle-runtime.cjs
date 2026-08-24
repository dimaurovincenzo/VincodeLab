function createWindowLifecycleRuntime({
  BrowserWindow,
  benchmarkMode,
  beginApprovedQuit,
  cleanupWorkspaceRuntime,
  closeDatabaseWorkspaceSessions,
  closeRedisWorkspaceSessions,
  createLifecycleCloseController,
  createRendererRecoveryController,
  createWindowCloseCoordinator,
  databaseOperations,
  dialog,
  faultInjectionMode,
  getActiveWorkspacePath,
  getInstanceRegistry,
  getMainWindow,
  getQuitCleanupComplete,
  getQuitCleanupPromise,
  getApplicationErrorLogMetadata,
  installNavigationGuards,
  instanceId,
  log,
  nativeTheme,
  parseRendererDiagnosticMessage,
  preloadPath,
  redisOperations,
  rendererEntryPath,
  reportPreloadFailure,
  screenshotCaptureMode,
  screenshotViewport,
  sendToRenderer,
  setActiveWorkspaceError,
  setActiveWorkspaceIncident,
  setActiveWorkspacePath,
  setMainWindow,
  toApplicationError,
  withCleanupDeadline,
}) {
  let allowWindowCloseOnce = false
  let rendererRecoveryController

  async function handleWindowCleanupFailure() {
    log('error', 'window_cleanup_failed')
    const options = {
      type: 'error',
      buttons: ['Resta aperto', 'Riprova chiusura'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Chiusura non completata',
      message: 'VincodeLab non ha ancora terminato tutte le attività.',
      detail: 'La finestra resta aperta per evitare processi orfani o connessioni incomplete. Puoi attendere e riprovare la chiusura.',
    }
    try {
      const mainWindow = getMainWindow()
      const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
      const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
      return result.response === 1
    } catch {
      log('error', 'window_cleanup_dialog_failed')
      return false
    }
  }

  const windowCloseCoordinator = createWindowCloseCoordinator({
    cleanup: ({ workspacePath }) => cleanupWorkspaceRuntime(workspacePath, 'window-close'),
    closeWindow: ({ window }) => {
      if (!window || window.isDestroyed() || getMainWindow() !== window) return
      allowWindowCloseOnce = true
      try {
        window.close()
      } catch (error) {
        allowWindowCloseOnce = false
        throw error
      }
      setImmediate(() => {
        if (getMainWindow() !== window || window.isDestroyed()) return
        allowWindowCloseOnce = false
      })
    },
    onFailure: handleWindowCleanupFailure,
  })

  function handleLifecycleCloseProceed(reason) {
    if (reason === 'quit') {
      beginApprovedQuit()
      return
    }
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    if (process.platform !== 'darwin') {
      beginApprovedQuit()
      return
    }
    void windowCloseCoordinator.request({ window, workspacePath: getActiveWorkspacePath() })
  }

  async function handleLifecycleCloseTimeout(request) {
    log('warn', 'lifecycle_close_response_timeout', { reason: request.reason })
    const options = {
      type: 'warning',
      buttons: ['Resta aperto', 'Chiudi comunque'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Modifiche non verificate',
      message: 'VincodeLab non ha ricevuto la conferma necessaria per chiudere.',
      detail: 'Per evitare perdite di lavoro la chiusura è stata sospesa. Scegli “Chiudi comunque” soltanto se vuoi procedere senza una verifica delle modifiche non salvate.',
    }
    try {
      const mainWindow = getMainWindow()
      const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
      const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
      lifecycleCloseGuard.respondTimeout(request.requestId, result.response === 1 ? 'proceed' : 'cancel')
    } catch {
      log('error', 'lifecycle_close_fallback_failed')
    }
  }

  const lifecycleCloseGuard = createLifecycleCloseController({
    sendRequest: (request) => sendToRenderer('lifecycle:closeRequested', request),
    onProceed: handleLifecycleCloseProceed,
    onCancel: (reason) => log('info', 'lifecycle_close_cancelled', { reason }),
    onTimeout: handleLifecycleCloseTimeout,
    onError: () => log('error', 'lifecycle_close_guard_failed'),
  })

  function disposeRendererRecovery() {
    rendererRecoveryController?.dispose()
    rendererRecoveryController = undefined
  }

  function createWindow() {
    const window = new BrowserWindow({
      width: screenshotCaptureMode ? screenshotViewport.width : 1280,
      height: screenshotCaptureMode ? screenshotViewport.height : 800,
      minWidth: 900,
      minHeight: 600,
      show: !screenshotCaptureMode,
      titleBarStyle: 'hiddenInset',
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececec',
      webPreferences: {
        backgroundThrottling: !screenshotCaptureMode,
        additionalArguments: benchmarkMode
          ? [
              '--vincodelab-reliability-benchmark',
              ...(faultInjectionMode ? ['--vincodelab-reliability-fault-injection'] : []),
              ...(screenshotCaptureMode ? ['--vincodelab-screenshot-capture'] : []),
            ]
          : [],
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    setMainWindow(window)
    disposeRendererRecovery()
    const recoveryController = createRendererRecoveryController({
      chooseRecovery: async (incident) => {
        log('error', 'renderer_recovery_requested', incident)
        if (faultInjectionMode) return 'reload'
        const reference = typeof incident.correlationId === 'string' ? `\n\nRiferimento ${incident.correlationId}.` : ''
        const result = await dialog.showMessageBox(window, {
          type: 'error',
          buttons: ['Ricarica interfaccia', 'Resta aperto'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          title: 'Interfaccia non disponibile',
          message: 'L’interfaccia di VincodeLab si è interrotta.',
          detail: `Puoi ricaricare soltanto l’interfaccia. Terminali, connessioni e servizi del workspace restano gestiti dal processo principale.${reference}`,
        })
        return result.response === 0 ? 'reload' : 'stay'
      },
      reload: () => window.webContents.reload(),
      isDestroyed: () => window.isDestroyed() || window.webContents.isDestroyed(),
      isClosing: () => getQuitCleanupComplete() || Boolean(getQuitCleanupPromise()) || windowCloseCoordinator.isPending(),
      onError: () => log('error', 'renderer_recovery_failed'),
    })
    rendererRecoveryController = recoveryController

    if (!screenshotCaptureMode) window.once('ready-to-show', () => window.maximize())
    installNavigationGuards(window.webContents)
    window.webContents.on('render-process-gone', (_event, details) => {
      const incident = toApplicationError(new Error('Il processo renderer si è interrotto.'), {
        category: 'process',
        code: 'RENDERER_PROCESS_GONE',
        domain: 'internal',
        message: 'L’interfaccia di VincodeLab si è interrotta.',
        operation: 'renderer-process',
        recoverable: true,
        severity: 'error',
      })
      log('error', 'renderer_process_gone', getApplicationErrorLogMetadata(incident))
      const workspacePath = getActiveWorkspacePath()
      const databaseOwnerDrain = databaseOperations.abortOwner(window.webContents.id)
      const databaseSessionCleanup = workspacePath ? closeDatabaseWorkspaceSessions(workspacePath) : Promise.resolve()
      void withCleanupDeadline(Promise.all([databaseOwnerDrain, databaseSessionCleanup]), 6_000, 'database-owner-runtime')
        .catch(() => log('error', 'database_owner_cleanup_failed'))
      const redisOwnerDrain = redisOperations.abortOwner(window.webContents.id)
      const redisSessionCleanup = workspacePath ? closeRedisWorkspaceSessions(workspacePath) : Promise.resolve()
      void withCleanupDeadline(Promise.all([redisOwnerDrain, redisSessionCleanup]), 6_000, 'redis-owner-runtime')
        .catch(() => log('error', 'redis_owner_cleanup_failed'))
      void recoveryController.handleProcessGone({ ...details, correlationId: incident.correlationId })
    })
    window.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      log('error', 'renderer_load_failed', { errorCode, isMainFrame })
      void recoveryController.handleLoadFailure({ errorCode, isMainFrame })
    })
    window.webContents.on('did-finish-load', () => {
      recoveryController.handleLoadFinished()
      const pending = lifecycleCloseGuard.getPending()
      if (pending?.phase === 'waiting') sendToRenderer('lifecycle:closeRequested', { requestId: pending.requestId, reason: pending.reason })
    })
    window.webContents.on('preload-error', (_event, _preloadPath, error) => {
      reportPreloadFailure(error, {
        log,
        recover: (details) => recoveryController.handlePreloadFailure(details),
      })
    })
    window.webContents.on('console-message', (details) => {
      if (details.level < 2) return
      const diagnostic = parseRendererDiagnosticMessage(details.message)
      if (diagnostic) log(diagnostic.level ?? 'error', diagnostic.event, { ...diagnostic.fields, line: details.lineNumber })
      else log('error', 'renderer_console_error', { line: details.lineNumber })
    })
    window.on('close', (event) => {
      if (getQuitCleanupComplete()) return
      if (allowWindowCloseOnce) {
        allowWindowCloseOnce = false
        return
      }
      event.preventDefault()
      if (!getQuitCleanupPromise() && !windowCloseCoordinator.isPending()) lifecycleCloseGuard.request('window')
    })
    window.on('closed', () => {
      recoveryController.dispose()
      if (rendererRecoveryController === recoveryController) rendererRecoveryController = undefined
      const workspacePath = getActiveWorkspacePath()
      if (!windowCloseCoordinator.isPending() && !getQuitCleanupPromise() && !getQuitCleanupComplete()) {
        void cleanupWorkspaceRuntime(workspacePath, 'window-destroyed').catch(() => log('error', 'window_fallback_cleanup_failed'))
      }
      getInstanceRegistry()?.setWorkspace(instanceId, null)
      setActiveWorkspacePath(undefined)
      setActiveWorkspaceError(undefined)
      setActiveWorkspaceIncident(undefined)
      if (getMainWindow() === window) setMainWindow(undefined)
    })

    const devServerUrl = process.env.VITE_DEV_SERVER_URL
    try {
      const loadPromise = devServerUrl ? window.loadURL(devServerUrl) : window.loadFile(rendererEntryPath)
      void Promise.resolve(loadPromise).catch(() => {
        // `did-fail-load` possiede logging e recovery; questo catch osserva la
        // Promise senza duplicare lo stesso incidente come unhandled rejection.
      })
    } catch (error) {
      const incident = toApplicationError(error, {
        channel: 'renderer:load',
        code: 'RENDERER_LOAD_START_FAILED',
        domain: 'internal',
        message: 'L’interfaccia di VincodeLab non è stata caricata.',
        operation: 'load',
        recoverable: true,
      })
      log(incident.severity, 'renderer_load_start_failed', getApplicationErrorLogMetadata(incident))
      void recoveryController.handleLoadFailure({ correlationId: incident.correlationId, errorCode: -2, isMainFrame: true })
    }
    return window
  }

  return {
    createWindow,
    disposeRendererRecovery,
    lifecycleCloseGuard,
    windowCloseCoordinator,
  }
}

module.exports = { createWindowLifecycleRuntime }
