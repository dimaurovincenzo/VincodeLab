function createApplicationStartupRuntime({
  activatePendingUpdates,
  app,
  checkUpdates,
  configureDatabaseSecretStorage,
  configureRedisSecretStorage,
  createInstanceRegistry,
  createMenu,
  createWindow,
  dialog,
  externalMutations,
  fatalErrorExperience,
  getAppearance,
  getApplicationErrorLogMetadata,
  getDatabase,
  getManagedSsh,
  getMainWindow,
  getOpenWindows,
  instanceId,
  log,
  migrateLegacyConnectionSecrets,
  nativeTheme,
  openWorkspace,
  piAgentRoot,
  processArguments,
  processId,
  readWorkspaceArgument,
  reconcileManagedPiPackages,
  registerIpc,
  resolvePiExecutable,
  safeStorage,
  scheduleImmediate = setImmediate,
  scheduleInterval = setInterval,
  cancelInterval = clearInterval,
  toApplicationError,
}) {
  let instanceRegistry
  let instanceHeartbeat

  function migrateLegacyDatabaseSecretsInBatches() {
    try {
      const outcome = migrateLegacyConnectionSecrets({ limit: 25 })
      if (outcome.scrubbed > 0) log('info', 'database_secrets_migrated', { total: outcome.scrubbed })
      if (outcome.remaining) scheduleImmediate(migrateLegacyDatabaseSecretsInBatches)
    } catch (error) {
      const incident = toApplicationError(error, {
        category: 'persistence',
        code: 'PERSISTENCE_DATABASE_SECRET_MIGRATION_FAILED',
        domain: 'persistence',
        message: 'Impossibile completare la protezione delle credenziali database.',
        operation: 'migrate-database-secrets',
        recoverable: true,
        severity: 'warning',
      })
      log('warning', 'database_secrets_migration_deferred', getApplicationErrorLogMetadata(incident))
    }
  }

  function releaseInstanceRegistration() {
    if (instanceHeartbeat) cancelInterval(instanceHeartbeat)
    instanceHeartbeat = undefined
    instanceRegistry?.unregister(instanceId)
  }

  async function initialize() {
    configureDatabaseSecretStorage(safeStorage)
    configureRedisSecretStorage(safeStorage)
    migrateLegacyDatabaseSecretsInBatches()
    instanceRegistry = createInstanceRegistry({ database: getDatabase() })
    const admission = instanceRegistry.register({ instanceId, pid: processId })
    if (!admission.accepted) {
      dialog.showErrorBox('VincodeLab è già aperto', 'Puoi usare al massimo due finestre contemporaneamente.')
      app.quit()
      return
    }
    instanceHeartbeat = scheduleInterval(() => {
      try {
        instanceRegistry.heartbeat(instanceId)
      } catch (error) {
        // Il coordinamento tra finestre è degradato, ma il workspace corrente può continuare a funzionare.
        const incident = toApplicationError(error, {
          code: 'INSTANCE_HEARTBEAT_FAILED',
          domain: 'persistence',
          message: 'Impossibile aggiornare lo stato di questa finestra.',
          operation: 'instance-heartbeat',
          severity: 'warning',
        })
        log('warning', 'instance_heartbeat_failed', getApplicationErrorLogMetadata(incident))
      }
    }, 5_000)
    instanceHeartbeat.unref()

    nativeTheme.themeSource = getAppearance()
    try {
      getManagedSsh()
    } catch {
      // L'assenza di OpenSSH disabilita soltanto i file remoti; il terminale locale resta operativo.
      log('warn', 'managed_ssh_unavailable')
    }
    createMenu()
    const startupWorkspacePath = readWorkspaceArgument(processArguments)
    if (startupWorkspacePath) {
      const result = await openWorkspace(startupWorkspacePath)
      if (!result.path) {
        dialog.showErrorBox('Workspace non disponibile', result.error ?? 'Impossibile aprire il workspace richiesto.')
        app.quit()
        return
      }
    }
    createWindow()
    void externalMutations.run({ ownerId: 0, workspacePath: null, type: 'startup:managed-updates' }, async () => {
      const piExecutable = resolvePiExecutable()
      if (piExecutable) await reconcileManagedPiPackages(() => piExecutable, piAgentRoot)
      const activated = await activatePendingUpdates()
      if (activated.length) log('info', 'managed_updates_activated', { total: activated.length, failed: activated.filter((item) => !item.success).length })
      const checked = await checkUpdates()
      if (checked.length) log('info', 'managed_updates_checked', { total: checked.length, failed: checked.filter((item) => item.status === 'error').length })
    }).catch(() => log('error', 'managed_updates_startup_failed'))

    nativeTheme.on('updated', () => {
      getMainWindow()?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececec')
    })

    registerIpc(instanceRegistry)
    app.on('activate', () => {
      if (getOpenWindows().length === 0) createWindow()
    })
  }

  function start() {
    app.whenReady().then(() => {
      void initialize().catch((error) => {
        void fatalErrorExperience.handleStartup(error)
      })
    })
  }

  return {
    getInstanceRegistry: () => instanceRegistry,
    initialize,
    migrateLegacyDatabaseSecretsInBatches,
    releaseInstanceRegistration,
    start,
  }
}

module.exports = { createApplicationStartupRuntime }
