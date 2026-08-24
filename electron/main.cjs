const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, shell } = require('electron')
const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
const { flushLogs, log, parseRendererDiagnosticMessage } = require('./logger.cjs')
const { getApplicationErrorLogMetadata, installIpcMainErrorHandling, toApplicationError } = require('./application-error.cjs')
const { createFatalErrorExperience } = require('./fatal-error-experience.cjs')
const { wrapIpcListener } = require('./ipc-one-way-error.cjs')
const { installNavigationGuards, isTrustedIpcEvent } = require('./ipc-security.cjs')
const { createPublicError, toPublicErrorMessage } = require('./public-error.cjs')
const { safeKillPty } = require('./pty-lifecycle.cjs')
const { createPiSessionController } = require('./pi-session-controller.cjs')
const { environmentForPi, resolvePiExecutable } = require('./pi-executable.cjs')
const { prepareTerminalAttachment } = require('./terminal-attachments.cjs')
const { MAX_PASTE_BYTES, createTerminalInputController } = require('./terminal-input.cjs')
const { createTerminalDiagnosticsReport, sanitizeRendererMetrics } = require('./terminal-diagnostics.cjs')
const { createTerminalStreamController } = require('./terminal-stream-controller.cjs')
const { createSystemSkill, deleteSystemSkill, getSystemSkill, listSystemSkills, updateSystemSkill } = require('./system-skills.cjs')
const { getPiSystemStatus, installPiPackage, listPiPackageSkills, listPiPackages, removePiPackage, updatePiPackage } = require('./pi-system-service.cjs')
const { clearProjectInstructions, getProjectInstructions, saveProjectInstructions } = require('./project-instructions.cjs')
const { createProjectDirectory, createProjectFile, duplicateProjectEntry, listDirectoryEntries, listProjectFiles, openProjectFileWith, prepareProjectFileAttachment, readProjectFile, readProjectPreview, renameProjectEntry, resolveProjectDirectory, resolveProjectFile, saveProjectFile } = require('./project-files.cjs')
const { createProjectFileIndex } = require('./project-file-index.cjs')
const { createShellSessionManager } = require('./shell-session-manager.cjs')
const { reportShellSessionOneWayFailure } = require('./shell-session-error-event.cjs')
const { createProjectSkill, deleteProjectSkill, getProjectSkill, listProjectSkills, updateProjectSkill } = require('./project-skills.cjs')
const { createCommandCategory, createWorkspaceCommand, deleteCommandCategory, deleteWorkspaceCommand, getWorkspaceCommand, listWorkspaceCommands, moveWorkspaceCommand, updateCommandCategory, updateWorkspaceCommand } = require('./workspace-commands.cjs')
const { clearHistory, configureDatabaseSecretStorage, createConnection, deleteConnection, deleteSavedQuery, listConnections, listHistory, listSavedQueries, migrateLegacyConnectionSecrets, saveQuery, updateConnection, updateSavedQuery } = require('./database-store.cjs')
const { beginTransaction, classifySql, closeConnectionSession, closeWorkspaceSessions, commitTransaction, executeQuery, inspectSchema, readTableRows, rollbackTransaction, updateTableRows } = require('./database-service.cjs')
const { createDatabaseOperationRegistry } = require('./database-operation-registry.cjs')
const { configureRedisSecretStorage, createRedisConnection, deleteRedisConnection, getRedisConnectionWithSecrets, listRedisConnections, updateRedisConnection } = require('./redis-store.cjs')
const { mergeRedisTestConnectionSecrets } = require('./redis-connection-input.cjs')
const { closeConnectionSession: closeRedisConnectionSession, closeWorkspaceSessions: closeRedisWorkspaceSessions, readKey: readRedisKey, scanKeys: scanRedisKeys, searchKeys: searchRedisKeys, testConnectionInput: testRedisConnectionInput } = require('./redis-service.cjs')
const { createRedisOperationRegistry } = require('./redis-operation-registry.cjs')
const { createGithubOperationRegistry } = require('./github-operation-registry.cjs')
const { createExternalMutationRegistry } = require('./external-mutation-registry.cjs')
const { addGitHubRemote, addWorkspaceIssueToProject, archiveWorkspaceProjectItem, closeWorkspaceProject, commit, createBranch, createGitHubRepository, createIssue, createWorkspaceProject, createWorkspaceProjectDraft, editWorkspaceProject, fetchRemote, getCachedGitHubData, getCachedGitStatus, getCachedProjectBoard, getFileDiff, getWorkspaceProjectItemFields, initializeGitRepository, listBranches, pullRebase, push, revertCommit, stageFiles, switchBranch, unstageFiles, updateIssue, updateWorkspaceProjectItem } = require('./github-service.cjs')
const { closeDatabase, getAppearance, getDataDirectory, getDatabase, isDirectory, listRecentWorkspaces, recordWorkspace, setAppearance } = require('./workspace-store.cjs')
const { revealWorkspace } = require('./workspace-reveal.cjs')
const { getWorkspaceSession, saveWorkspaceSession } = require('./workspace-session-store.cjs')
const { createVolatileDraftRegistry } = require('./volatile-draft-registry.cjs')
const { clearAllWorkspacePreferences, clearWorkspacePreference, getPreferences, setGlobalPreference, setWorkspacePreference } = require('./app-preferences.cjs')
const { activatePendingUpdates, checkUpdates, downloadAllUpdates, listManagedUpdates, rollbackManagedUpdate, setManagedUpdatePolicy, stageManagedUpdate } = require('./update-service.cjs')
const { reconcileManagedPiPackages } = require('./update-discovery.cjs')
const { APP_SECTIONS, createApplicationMenuTemplate, isApplicationMenuCommand } = require('./application-menu.cjs')
const { createContextMenuTemplate } = require('./context-menu.cjs')
const { createManagedSshService } = require('./managed-ssh-service.cjs')
const { createSftpService } = require('./sftp-service.cjs')
const { createRemoteFileStore } = require('./remote-file-store.cjs')
const { createRemoteFileService } = require('./remote-file-service.cjs')
const { createInstanceRegistry } = require('./instance-registry.cjs')
const { launchWorkspaceInstance, readWorkspaceArgument } = require('./instance-launcher.cjs')
const { createLifecycleCloseController } = require('./lifecycle-close-controller.cjs')
const { reportPreloadFailure } = require('./preload-error-experience.cjs')
const { createReliabilityFaultInjection } = require('./reliability-fault-injection.cjs')
const { createRendererRecoveryController } = require('./renderer-recovery-controller.cjs')
const { createWindowCloseCoordinator } = require('./window-close-coordinator.cjs')
const { createPtyRuntime } = require('./pty-runtime.cjs')
const { getRuntimeCapabilities } = require('./runtime-capabilities.cjs')
const { registerPreferencesIpc } = require('./ipc/domains/preferences.ipc.cjs')
const { registerRuntimeIpc } = require('./ipc/domains/runtime.ipc.cjs')

// Ogni invoke attraversa lo stesso confine: gli errori raw restano nel main,
// mentre renderer e log condividono categoria, operazione e correlation ID.
installIpcMainErrorHandling(ipcMain, { log })

// Allinea i metadati esposti dalle API Electron; il binario host di sviluppo può
// continuare a mostrare "Electron", mentre il bundle distribuito usa productName.
app.setName('VincodeLab')

const fatalErrorExperience = globalThis[Symbol.for('vincodelab.fatal-error-experience')]
  ?? createFatalErrorExperience({ app, clipboard, dialog, flushLogs, log })

let mainWindow
let activeWorkspacePath
let activeWorkspaceError
let activeWorkspaceIncident
let activeAppSection = 'home'
let piConfigProcess
let piConfigExit
let managedSsh
let sftpService
let remoteFileStore
let remoteFileService
let instanceRegistry
let instanceHeartbeat
let launchInProgress = false
let workspaceOpenGeneration = 0
let allowWindowCloseOnce = false
let quitCleanupPromise
let quitCleanupComplete = false
let rendererRecoveryController
const instanceId = randomUUID()
const REMOTE_CONTEXT_KINDS = new Set(['remote-file', 'remote-directory', 'remote-local-file', 'remote-transfer', 'editor-remote-tab'])
const WORKSPACE_FILE_CONTEXT_KINDS = new Set(['workspace-file', 'editor-workspace-tab'])
const WORKSPACE_DIRECTORY_CONTEXT_KIND = 'workspace-directory'
const WORKSPACE_ROOT_CONTEXT_KIND = 'workspace-root'
const RECENT_WORKSPACE_CONTEXT_KIND = 'recent-workspace'
const TERMINAL_TAB_CONTEXT_KIND = 'terminal-tab'
const GIT_FILE_CONTEXT_KINDS = new Set(['git-unstaged-file', 'git-staged-file'])
const REDIS_KEY_CONTEXT_KIND = 'redis-key'
const REDIS_KEY_REF_PATTERN = /^[A-Za-z0-9+/_=-]{1,21848}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RELIABILITY_BENCHMARK_MODE = process.argv.includes('--reliability-benchmark')
const RELIABILITY_FAULT_INJECTION_MODE = RELIABILITY_BENCHMARK_MODE && process.argv.includes('--reliability-fault-injection')
const CLEAN_MACHINE_SMOKE_MODE = RELIABILITY_BENCHMARK_MODE && process.argv.includes('--clean-machine-smoke')
// La cattura documentale usa il renderer reale, ma non deve aprire sul desktop
// una finestra con viewport emulata più grande dell'area visibile dell'utente.
const SCREENSHOT_CAPTURE_MODE = RELIABILITY_BENCHMARK_MODE && process.argv.includes('--screenshot-capture')
const SCREENSHOT_CAPTURE_VIEWPORT = Object.freeze({ width: 1440, height: 900 })
const RELIABILITY_BENCHMARK_COMMANDS = new Set(['workbench.commandPalette', 'workbench.quickOpen'])
const reliabilityFaultInjection = RELIABILITY_FAULT_INJECTION_MODE
  ? createReliabilityFaultInjection({
      enabled: true,
      getDatabase,
      getWorkspacePath: () => activeWorkspacePath,
    })
  : null
const systemSkillsRoot = path.join(app.getPath('home'), '.pi', 'agent', 'skills')
const piAgentRoot = path.join(app.getPath('home'), '.pi', 'agent')
const ptyRuntime = createPtyRuntime()

function benchmarkTrace(operation) {
  if (RELIABILITY_BENCHMARK_MODE) process.stderr.write(`[reliability-benchmark] ${operation}\n`)
}
const projectFileIndex = createProjectFileIndex()
const databaseOperations = createDatabaseOperationRegistry()
const redisOperations = createRedisOperationRegistry()
const githubOperations = createGithubOperationRegistry()
const externalMutations = createExternalMutationRegistry()
const volatileDrafts = createVolatileDraftRegistry()
const shellSessionManager = createShellSessionManager({
  processFactory: (executable, args, options) => ptyRuntime.spawn(executable, args, options),
  onData: handleShellSessionData,
  onExit: handleShellSessionExit,
})
const piSessionController = createPiSessionController({
  resolveExecutable: resolvePiExecutable,
  environmentForExecutable: environmentForPi,
  processFactory: (executable, args, options) => ptyRuntime.spawn(executable, args, options),
  createStream: ({ pty: ptyProcess, sessionId }) => createTerminalStreamController({
    pty: ptyProcess,
    sessionId,
    sendBlock: (block) => sendToRenderer('terminal:output', block),
    sendState: (state) => sendToRenderer('terminal:streamState', state),
  }),
  createInput: ({ stream, getPty }) => createTerminalInputController({
    getPty,
    waitForCapacity: (signal) => stream.waitForInputCapacity(signal),
  }),
  onStarted: ({ pid, sessionId }) => log('info', 'pi_started', { pid, sessionId }),
  onExit: handlePiSessionExit,
  onError: ({ source }) => log('error', 'pi_session_failure', { reason: source }),
})

function assertTrustedSender(event) {
  if (!mainWindow || !isTrustedIpcEvent(event, mainWindow.webContents)) {
    log('warn', 'ipc_sender_rejected')
    throw new Error('Origine IPC non autorizzata.')
  }
}

function sendToRenderer(channel, payload) {
  const window = mainWindow
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
  try {
    window.webContents.send(channel, payload)
    return true
  } catch (error) {
    const incident = toApplicationError(error, {
      channel: 'renderer:eventDelivery',
      code: 'RENDERER_EVENT_DELIVERY_FAILED',
      domain: 'internal',
      message: 'Un aggiornamento non è stato consegnato all’interfaccia.',
      operation: 'sendToRenderer',
      recoverable: true,
      severity: 'warning',
    })
    log('warning', 'renderer_event_delivery_failed', {
      ...getApplicationErrorLogMetadata(incident),
      eventChannel: channel,
    })
    return false
  }
}

function publicApplicationErrorPayload(error, options) {
  const incident = toApplicationError(error, options)
  return Object.freeze({
    category: incident.category,
    code: incident.publicCode,
    correlationId: incident.correlationId,
    message: incident.message,
    recoverable: incident.recoverable,
    severity: incident.severity,
  })
}

function redisKeyForRenderer(keyRef) {
  if (!keyRef || typeof keyRef !== 'object' || Array.isArray(keyRef) || typeof keyRef.encoded !== 'string') {
    throw new Error('Riferimento chiave Redis non valido.')
  }
  const binary = keyRef.binary === true
  const display = binary
    ? `base64:${keyRef.encoded.slice(0, 48)}${keyRef.encoded.length > 48 ? '…' : ''}`
    : typeof keyRef.display === 'string' && keyRef.display ? keyRef.display : '(chiave vuota)'
  return { key: display, keyRef: keyRef.encoded, binary }
}

function redisSummaryForRenderer(summary) {
  const { key, ...metadata } = summary
  return { ...redisKeyForRenderer(key), ...metadata }
}

function redisInspectionForRenderer(inspection) {
  const { key, resultBytes: _resultBytes, ...value } = inspection
  return { ...value, ...redisKeyForRenderer(key) }
}

function redisSearchForRenderer(result) {
  return {
    ...result,
    matches: Array.isArray(result?.matches) ? result.matches.map(redisSummaryForRenderer) : [],
  }
}

function workspaceFailure(error, options) {
  const errorIncident = publicApplicationErrorPayload(error, { channel: 'workspace:open', ...options })
  return Object.freeze({ error: errorIncident.message, errorIncident })
}

function confineIpcOneWay(channel, listener) {
  return wrapIpcListener(channel, listener, {
    log,
    onFailure: (failure, args) => {
      if (!failure.eventChannel || !failure.payload) return
      const event = args[0]
      const window = mainWindow
      if (!event || !window || window.isDestroyed() || window.webContents.isDestroyed()) return
      if (!isTrustedIpcEvent(event, window.webContents)) return
      sendToRenderer(failure.eventChannel, failure.payload)
    },
  })
}

function rejectOneWay(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function reportPreferenceRecovery(snapshot) {
  if (!snapshot?.recovery) return snapshot
  log('warning', 'preferences_recovered', {
    category: 'persistence',
    code: 'PERSISTENCE_PREFERENCES_CORRUPT',
    component: 'settings',
    correlationId: snapshot.recovery.correlationId,
    globalCount: snapshot.recovery.globalCount,
    operation: 'load-preferences',
    severity: 'warning',
    workspaceCount: snapshot.recovery.workspaceCount,
  })
  return snapshot
}

function activeShellSessionState() {
  if (!activeWorkspacePath) return null
  try {
    return shellSessionManager.list(activeWorkspacePath)
  } catch {
    // Best-effort durante cambio workspace/chiusura: lo stato autorevole resta
    // nel manager e i comandi espliciti di recovery riportano gli errori alla UI.
    return null
  }
}

function handleShellSessionData(event) {
  const state = activeShellSessionState()
  if (!state || state.workspacePath !== event.workspacePath) return
  sendToRenderer('shellSessions:data', {
    sessionId: event.sessionId,
    attachmentId: event.attachmentId,
    generation: event.generation,
    sequence: event.sequence,
    data: event.data,
  })
}

function handleShellSessionExit(event) {
  const state = activeShellSessionState()
  if (!state || state.workspacePath !== event.workspacePath) return
  const payload = {
    sessionId: event.sessionId,
    exitCode: event.exitCode,
    signal: event.signal,
    reason: event.reason,
  }
  sendToRenderer('shellSessions:exit', payload)
  log(event.reason === 'exit' && (event.exitCode !== 0 || event.signal) ? 'error' : 'info', 'shell_session_exited', {
    sessionId: event.sessionId,
    reason: event.reason,
    exitCode: event.exitCode,
    signal: event.signal,
  })
}

function handleShellSessionOneWay(event, sessionId, operation, perform) {
  try {
    const result = perform()
    if (result === false) {
      const error = new Error('Il trasporto renderer del terminale ha rifiutato il messaggio.')
      error.code = `SHELL_SESSION_${operation.toUpperCase()}_REJECTED`
      throw error
    }
    return result
  } catch (error) {
    reportShellSessionOneWayFailure({
      error,
      log,
      operation,
      sessionId,
      send: (channel, payload) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
      },
    })
    return undefined
  }
}

function openWithMacApplication(applicationPath, filePath) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['-a', applicationPath, filePath], { timeout: 15_000 }, (error) => error ? reject(error) : resolve())
  })
}

async function chooseMacApplication() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Apri con',
    buttonLabel: 'Apri',
    defaultPath: '/Applications',
    properties: ['openFile'],
  })
  return result.canceled ? null : result.filePaths[0] ?? null
}

function resolveWorkspaceContextEntry(contextKind, contextId) {
  const workspacePath = requireActiveWorkspace()
  if (contextKind === WORKSPACE_ROOT_CONTEXT_KIND) return { absolutePath: resolveProjectDirectory(workspacePath, ''), kind: 'directory', relativePath: '' }
  if (contextKind === WORKSPACE_DIRECTORY_CONTEXT_KIND) return { absolutePath: resolveProjectDirectory(workspacePath, contextId), kind: 'directory', relativePath: contextId }
  if (WORKSPACE_FILE_CONTEXT_KINDS.has(contextKind)) return { absolutePath: resolveProjectFile(workspacePath, contextId), kind: 'file', relativePath: contextId }
  throw new Error('Elemento del workspace non valido.')
}

function reportContextCommandFailure(error, operation, title) {
  log('error', operation)
  dialog.showErrorBox(title, toPublicErrorMessage(error, { code: 'CONTEXT_COMMAND_FAILED', message: 'L’operazione selezionata non è stata completata. Riprova.' }))
}

function dispatchContextMenuCommand(command, contextId, contextKind) {
  if (command === 'workspaceEntry.copyName' || command === 'workspaceEntry.copyRelativePath' || command === 'workspaceEntry.copyAbsolutePath') {
    try {
      const entry = resolveWorkspaceContextEntry(contextKind, contextId)
      const value = command === 'workspaceEntry.copyName'
        ? path.basename(entry.absolutePath)
        : command === 'workspaceEntry.copyRelativePath'
          ? entry.relativePath || '.'
          : entry.absolutePath
      clipboard.writeText(value)
    } catch (error) {
      reportContextCommandFailure(error, 'workspace_context_copy_failed', 'Percorso non copiato')
    }
    return
  }
  if (command === 'workspaceEntry.reveal') {
    try {
      const entry = resolveWorkspaceContextEntry(contextKind, contextId)
      if (contextKind === WORKSPACE_ROOT_CONTEXT_KIND) void shell.openPath(entry.absolutePath).then((message) => {
        if (message) throw new Error(message)
      }).catch((error) => reportContextCommandFailure(error, 'workspace_context_reveal_failed', 'Workspace non mostrato'))
      else shell.showItemInFolder(entry.absolutePath)
    } catch (error) {
      reportContextCommandFailure(error, 'workspace_context_reveal_failed', 'Elemento non mostrato')
    }
    return
  }
  if (command === 'workspaceFile.openWith') {
    void openProjectFileWith(requireActiveWorkspace(), contextId, {
      chooseApplication: chooseMacApplication,
      openWith: openWithMacApplication,
    }).catch((error) => reportContextCommandFailure(error, 'workspace_file_open_with_failed', 'Impossibile aprire il file'))
    return
  }
  if (command === 'recentWorkspace.copyPath') {
    clipboard.writeText(contextId)
    return
  }
  if (command === 'recentWorkspace.reveal') {
    void shell.openPath(contextId).then((message) => {
      if (message) throw new Error(message)
    }).catch((error) => reportContextCommandFailure(error, 'recent_workspace_reveal_failed', 'Workspace non mostrato'))
    return
  }
  if (command === 'gitFile.copyPath') {
    clipboard.writeText(contextId)
    return
  }
  if (command === 'gitFile.reveal') {
    try {
      const workspaceRoot = resolveProjectDirectory(requireActiveWorkspace(), '')
      const candidate = path.resolve(workspaceRoot, contextId)
      const relative = path.relative(workspaceRoot, candidate)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('File Git non valido.')
      shell.showItemInFolder(candidate)
    } catch (error) {
      reportContextCommandFailure(error, 'git_file_reveal_failed', 'File non mostrato')
    }
    return
  }
  sendToRenderer('contextMenu:action', { command, contextId, contextKind })
}

function getManagedSsh() {
  if (!managedSsh) {
    managedSsh = createManagedSshService({
      tempRoot: app.getPath('temp'),
      sendStatus: (status) => sendToRenderer('managedSsh:status', status),
      log,
    })
  }
  return managedSsh
}

function requireManagedConnectionForWorkspace(connectionId) {
  const workspacePath = requireActiveWorkspace()
  const connection = getManagedSsh().get(connectionId)
  if (!connection || connection.workspacePath !== workspacePath) throw new Error('Connessione SSH non disponibile per questo workspace.')
  return connection
}

function getRemoteFileService() {
  if (!remoteFileService) {
    sftpService ??= createSftpService({})
    remoteFileStore ??= createRemoteFileStore({ dataRoot: getDataDirectory(), database: getDatabase(), log })
    remoteFileService = createRemoteFileService({
      ssh: getManagedSsh(),
      sftp: sftpService,
      store: remoteFileStore,
      tempRoot: app.getPath('temp'),
      chooseFiles: async () => {
        const result = await dialog.showOpenDialog(mainWindow, { title: 'Carica file sul server', buttonLabel: 'Carica', properties: ['openFile', 'multiSelections'] })
        return result.canceled ? [] : result.filePaths
      },
      chooseDestination: async (name) => {
        const result = await dialog.showSaveDialog(mainWindow, { title: 'Scarica file remoto', buttonLabel: 'Salva', defaultPath: name })
        return result.canceled ? null : result.filePath
      },
      showItemInFolder: (localPath) => shell.showItemInFolder(localPath),
      log,
      notify: (transfer) => sendToRenderer('remoteFiles:transfer', transfer),
    })
  }
  return remoteFileService
}

function dispatchApplicationMenuCommand(command) {
  if (!isApplicationMenuCommand(command)) {
    log('warn', 'application_menu_command_rejected')
    return
  }
  sendToRenderer('appMenu:command', command)
}

function notifyWhenBackground(title, body) {
  if (!mainWindow || mainWindow.isFocused() || !Notification.isSupported()) return
  new Notification({ title, body }).show()
}

function handlePiSessionExit({ exitCode, signal, reason, sessionId }) {
  const expected = reason !== 'exit' && reason !== 'failure'
  log(expected || (exitCode === 0 && !signal) ? 'info' : 'error', expected ? 'pi_stopped' : 'pi_exited', {
    exitCode,
    signal,
    reason,
    sessionId,
  })
  // Gli stop richiesti da restart, cambio workspace e shutdown sono già osservabili
  // dalla rispettiva operazione. Solo gli exit inattesi devono cambiare lo stato UI.
  if (expected) return
  sendToRenderer('terminal:exit', { exitCode, signal })
  if (exitCode !== 0 || signal) {
    notifyWhenBackground('VincodeLab · Pi', signal ? `La sessione Pi è stata interrotta (segnale ${signal}).` : `Pi si è chiuso con codice ${exitCode}.`)
  }
}

function stopTerminal(reason = 'stop') {
  return piSessionController.stop(reason)
}

async function closeShellSessions(workspacePath = activeWorkspacePath) {
  if (!workspacePath) return { closed: 0 }
  const result = await shellSessionManager.closeAll(workspacePath)
  if (result.closed > 0) log('info', 'shell_sessions_stopped', { total: result.closed })
  return result
}

function withCleanupDeadline(promise, timeoutMs, operation) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
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

async function stopPiConfig() {
  const process = piConfigProcess
  if (!process) return { closed: false }
  const exit = piConfigExit?.process === process ? piConfigExit.promise : Promise.resolve()
  safeKillPty(process)
  try {
    await withCleanupDeadline(exit, 1_500, 'pi-config-term')
  } catch {
    try {
      process.kill('SIGKILL')
    } catch {
      // Best-effort: il processo può essere già terminato; il bounded wait
      // seguente verifica comunque l'esito e propaga un eventuale timeout.
    }
    await withCleanupDeadline(exit, 1_000, 'pi-config-kill')
  }
  return { closed: true }
}

async function cleanupWorkspaceRuntime(workspacePath, reason) {
  const ownerId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null
  await withCleanupDeadline(
    externalMutations.waitMatching((operation) => operation.workspacePath === workspacePath || (ownerId !== null && operation.ownerId === ownerId)),
    13_000,
    'external-mutations',
  )
  await stopTerminal(reason)
  const databaseDrain = databaseOperations.abortAndWaitMatching((operation) => !workspacePath || operation.workspacePath === workspacePath)
  const databaseSessionCleanup = workspacePath ? closeWorkspaceSessions(workspacePath) : Promise.resolve()
  await withCleanupDeadline(Promise.all([databaseDrain, databaseSessionCleanup]), 6_000, 'database-runtime')
  const redisDrain = redisOperations.abortAndWaitMatching((operation) => !workspacePath || operation.workspacePath === workspacePath)
  const redisSessionCleanup = workspacePath ? closeRedisWorkspaceSessions(workspacePath) : Promise.resolve()
  await withCleanupDeadline(Promise.all([redisDrain, redisSessionCleanup]), 6_000, 'redis-runtime')
  await withCleanupDeadline(
    githubOperations.abortAndWaitMatching((operation) => !workspacePath || operation.workspacePath === workspacePath),
    4_000,
    'github-operations',
  )
  if (workspacePath) {
    if (remoteFileService) await withCleanupDeadline(remoteFileService.closeWorkspace(workspacePath), 7_000, 'remote-files')
    else if (sftpService) await withCleanupDeadline(sftpService.closeWorkspace(workspacePath), 6_000, 'sftp')
    // Il ControlMaster resta disponibile finché la coda SFTP non è stata drenata.
    if (managedSsh) await withCleanupDeadline(managedSsh.closeWorkspace(workspacePath), 6_000, 'managed-ssh')
    await closeShellSessions(workspacePath)
  }
  await stopPiConfig()
}

function startPi(workspacePath) {
  return piSessionController.start(workspacePath)
}

function requireActiveWorkspace() {
  if (!activeWorkspacePath) throw new Error('Apri prima un workspace.')
  return activeWorkspacePath
}

function runExternalMutation(event, type, workspacePath, operation) {
  assertTrustedSender(event)
  return externalMutations.run({ ownerId: event.sender.id, workspacePath, type }, operation)
}

function runWorkspaceMutation(event, type, operation) {
  assertTrustedSender(event)
  const workspacePath = requireActiveWorkspace()
  return externalMutations.run({ ownerId: event.sender.id, workspacePath, type }, () => operation(workspacePath))
}

function assertCacheReadOptions(options) {
  if (options === undefined) return { force: false }
  if (!options || typeof options !== 'object' || Array.isArray(options) || (options.force !== undefined && typeof options.force !== 'boolean')) {
    throw new Error('Opzioni cache non valide.')
  }
  return { force: options.force === true }
}

async function runLatestGithubRead(event, type, load) {
  const workspacePath = requireActiveWorkspace()
  const operation = githubOperations.startLatest({ senderId: event.sender.id, workspacePath, type })
  try {
    // Serializzare il ricambio evita che il nuovo comando parta mentre il
    // processo superseded sta ancora completando TERM -> KILL.
    await operation.ready
    return await load(workspacePath, operation.signal)
  } finally {
    operation.finish()
  }
}

function requireRunningShellSession(workspacePath = requireActiveWorkspace()) {
  const state = shellSessionManager.list(workspacePath)
  const session = state.sessions.find((item) => item.sessionId === state.activeSessionId)
  if (!session || session.status !== 'running') throw new Error('La shell non è attiva per questo workspace.')
  return session
}

async function reloadPi() {
  await piSessionController.reload()
  log('info', 'pi_resources_reloaded')
  return { reloaded: true }
}

async function restartPi() {
  const workspacePath = requireActiveWorkspace()
  await startPi(workspacePath)
  return { restarted: true }
}

async function chooseTerminalAttachments() {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Allega file a Pi', buttonLabel: 'Allega', properties: ['openFile', 'multiSelections'] })
  return result.canceled ? [] : result.filePaths.map(prepareTerminalAttachment)
}

function startPiConfig() {
  if (piConfigProcess) return { started: false, reused: true }
  const executable = resolvePiExecutable()
  if (!executable) throw createPublicError(
    'PI_NOT_INSTALLED',
    'Pi Coding Agent non è installato o non è rilevabile. Installa Pi, quindi aggiorna la verifica nelle Impostazioni. Le altre funzioni restano disponibili.',
  )
  const ptyProcess = ptyRuntime.spawn(executable, ['config'], { name: 'xterm-256color', cols: 120, rows: 34, cwd: app.getPath('home'), env: { ...environmentForPi(executable), TERM: 'xterm-256color' } })
  let resolveExit
  const exitPromise = new Promise((resolve) => { resolveExit = resolve })
  piConfigProcess = ptyProcess
  piConfigExit = { process: ptyProcess, promise: exitPromise }
  ptyProcess.onData((data) => sendToRenderer('piConfig:data', data))
  ptyProcess.onExit(({ exitCode, signal }) => {
    resolveExit()
    if (piConfigProcess !== ptyProcess) return
    piConfigProcess = undefined
    piConfigExit = undefined
    sendToRenderer('piConfig:exit', { exitCode, signal })
  })
  return { started: true, reused: false }
}

async function openWorkspace(workspacePath) {
  if (typeof workspacePath !== 'string' || workspacePath.length === 0 || workspacePath.length > 4096 || !path.isAbsolute(workspacePath) || !isDirectory(workspacePath)) {
    log('warn', 'workspace_rejected')
    return workspaceFailure(new Error('Workspace path unavailable'), {
      category: 'not-found',
      code: 'WORKSPACE_NOT_FOUND',
      domain: 'workspace',
      message: 'La cartella selezionata non è più disponibile.',
      operation: 'open',
      severity: 'warning',
    })
  }

  const previousWorkspacePath = activeWorkspacePath ?? null
  const reservation = instanceRegistry?.setWorkspace(instanceId, workspacePath)
  if (reservation && !reservation.accepted) {
    log('warn', 'workspace_duplicate_rejected')
    return workspaceFailure(new Error('Workspace already reserved'), {
      category: 'conflict',
      code: 'WORKSPACE_ALREADY_OPEN',
      domain: 'workspace',
      message: 'Questo workspace è già aperto in un’altra finestra.',
      operation: 'open',
      severity: 'warning',
    })
  }
  const normalizedWorkspacePath = reservation?.workspacePath ?? workspacePath
  const openGeneration = ++workspaceOpenGeneration

  try {
    if (previousWorkspacePath && previousWorkspacePath !== normalizedWorkspacePath) {
      await cleanupWorkspaceRuntime(previousWorkspacePath, 'workspace-change')
    } else {
      // Anche una riapertura dello stesso workspace deve sostituire la sessione Pi,
      // senza però invalidare connessioni Database/SSH ancora appartenenti alla vista.
      await stopTerminal('workspace-change')
    }
    if (openGeneration !== workspaceOpenGeneration) {
      return workspaceFailure(new DOMException('Workspace open superseded', 'AbortError'), {
        category: 'cancelled',
        code: 'WORKSPACE_OPEN_SUPERSEDED',
        domain: 'workspace',
        message: 'Apertura sostituita da una richiesta workspace più recente.',
        operation: 'open',
        recoverable: true,
        severity: 'info',
      })
    }
    // Editor, Git e GitHub restano utilizzabili anche quando Pi non è installato o non riesce ad avviarsi.
    recordWorkspace(normalizedWorkspacePath)
    activeWorkspacePath = normalizedWorkspacePath
    activeWorkspaceError = undefined
    activeWorkspaceIncident = undefined
    remoteFileService?.openWorkspace(normalizedWorkspacePath)
    projectFileIndex.clear()
    void projectFileIndex.build(normalizedWorkspacePath).catch((error) => {
      if (error?.name !== 'AbortError') log('warn', 'project_file_index_failed')
    })
    try {
      await startPi(normalizedWorkspacePath)
      log('info', 'workspace_opened')
      return { path: normalizedWorkspacePath }
    } catch (error) {
      const failure = workspaceFailure(error, {
        code: 'PI_START_FAILED',
        domain: 'ai',
        message: 'Impossibile avviare Pi per questo workspace.',
        operation: 'start',
      })
      activeWorkspaceError = failure.error
      activeWorkspaceIncident = failure.errorIncident
      const piMissing = failure.errorIncident.code === 'PI_NOT_INSTALLED'
      log(piMissing ? 'warning' : 'error', piMissing ? 'pi_not_installed' : 'pi_start_failed')
      if (!piMissing) notifyWhenBackground('VincodeLab · Pi', failure.error)
      return { path: normalizedWorkspacePath, ...failure }
    }
  } catch (error) {
    if (openGeneration === workspaceOpenGeneration) {
      instanceRegistry?.setWorkspace(instanceId, previousWorkspacePath)
      if (previousWorkspacePath) remoteFileService?.openWorkspace(previousWorkspacePath)
    }
    const failure = workspaceFailure(error, {
      code: 'WORKSPACE_OPEN_FAILED',
      domain: 'workspace',
      message: 'Impossibile aprire il workspace.',
      operation: 'open',
    })
    log('error', 'workspace_open_failed')
    notifyWhenBackground('VincodeLab · Pi', failure.error)
    return failure
  }
}

async function chooseAndOpenWorkspace() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Apri cartella di lavoro',
    buttonLabel: 'Apri workspace',
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) return null
  return openWorkspace(result.filePaths[0])
}

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
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
    return result.response === 1
  } catch {
    // Senza dialog non esiste una decisione esplicita: la finestra resta aperta
    // e il log consente di diagnosticare il fallback locale non disponibile.
    log('error', 'window_cleanup_dialog_failed')
    return false
  }
}

const windowCloseCoordinator = createWindowCloseCoordinator({
  cleanup: ({ workspacePath }) => cleanupWorkspaceRuntime(workspacePath, 'window-close'),
  closeWindow: ({ window }) => {
    if (!window || window.isDestroyed() || mainWindow !== window) return
    allowWindowCloseOnce = true
    try {
      window.close()
    } catch (error) {
      allowWindowCloseOnce = false
      throw error
    }
    setImmediate(() => {
      if (mainWindow !== window || window.isDestroyed()) return
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
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  if (process.platform !== 'darwin') {
    beginApprovedQuit()
    return
  }
  void windowCloseCoordinator.request({ window, workspacePath: activeWorkspacePath })
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
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
    lifecycleCloseGuard.respondTimeout(request.requestId, result.response === 1 ? 'proceed' : 'cancel')
  } catch {
    // In assenza di una scelta esplicita la richiesta resta bloccata.
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: SCREENSHOT_CAPTURE_MODE ? SCREENSHOT_CAPTURE_VIEWPORT.width : 1280,
    height: SCREENSHOT_CAPTURE_MODE ? SCREENSHOT_CAPTURE_VIEWPORT.height : 800,
    minWidth: 900,
    minHeight: 600,
    show: !SCREENSHOT_CAPTURE_MODE,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    // Evita un flash chiaro prima che il renderer applichi il tema macOS.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececec',
    webPreferences: {
      backgroundThrottling: !SCREENSHOT_CAPTURE_MODE,
      additionalArguments: RELIABILITY_BENCHMARK_MODE
        ? [
            '--vincodelab-reliability-benchmark',
            ...(RELIABILITY_FAULT_INJECTION_MODE ? ['--vincodelab-reliability-fault-injection'] : []),
            ...(SCREENSHOT_CAPTURE_MODE ? ['--vincodelab-screenshot-capture'] : []),
          ]
        : [],
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const window = mainWindow
  rendererRecoveryController?.dispose()
  const recoveryController = createRendererRecoveryController({
    chooseRecovery: async (incident) => {
      log('error', 'renderer_recovery_requested', incident)
      if (RELIABILITY_FAULT_INJECTION_MODE) return 'reload'
      const reference = typeof incident.correlationId === 'string' ? `\n\nRiferimento ${incident.correlationId}.` : ''
      const options = {
        type: 'error',
        buttons: ['Ricarica interfaccia', 'Resta aperto'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'Interfaccia non disponibile',
        message: 'L’interfaccia di VincodeLab si è interrotta.',
        detail: `Puoi ricaricare soltanto l’interfaccia. Terminali, connessioni e servizi del workspace restano gestiti dal processo principale.${reference}`,
      }
      const result = await dialog.showMessageBox(window, options)
      return result.response === 0 ? 'reload' : 'stay'
    },
    reload: () => window.webContents.reload(),
    isDestroyed: () => window.isDestroyed() || window.webContents.isDestroyed(),
    isClosing: () => quitCleanupComplete || Boolean(quitCleanupPromise) || windowCloseCoordinator.isPending(),
    onError: () => log('error', 'renderer_recovery_failed'),
  })
  rendererRecoveryController = recoveryController

  // La shell e le viste persistenti hanno bisogno dell'area di lavoro reale, non della sola dimensione iniziale della finestra.
  // La finestra documentale resta invece nascosta: CDP la cattura senza invadere o tagliare il desktop dell'utente.
  if (!SCREENSHOT_CAPTURE_MODE) window.once('ready-to-show', () => window.maximize())
  // I guard vanno registrati prima di loadURL/loadFile: anche la prima pagina
  // compromessa non deve poter navigare, allegare webview o aprire finestre.
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
    const databaseOwnerDrain = databaseOperations.abortOwner(window.webContents.id)
    const databaseSessionCleanup = activeWorkspacePath ? closeWorkspaceSessions(activeWorkspacePath) : Promise.resolve()
    void withCleanupDeadline(Promise.all([databaseOwnerDrain, databaseSessionCleanup]), 6_000, 'database-owner-runtime')
      .catch(() => log('error', 'database_owner_cleanup_failed'))
    const redisOwnerDrain = redisOperations.abortOwner(window.webContents.id)
    const redisSessionCleanup = activeWorkspacePath ? closeRedisWorkspaceSessions(activeWorkspacePath) : Promise.resolve()
    void withCleanupDeadline(Promise.all([redisOwnerDrain, redisSessionCleanup]), 6_000, 'redis-owner-runtime')
      .catch(() => log('error', 'redis_owner_cleanup_failed'))
    void recoveryController.handleProcessGone({ ...details, correlationId: incident.correlationId })
  })
  // Gli errori del renderer non devono trasformarsi in una finestra vuota senza traccia diagnostica.
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
    if (quitCleanupComplete) return
    if (allowWindowCloseOnce) {
      allowWindowCloseOnce = false
      return
    }
    event.preventDefault()
    if (!quitCleanupPromise && !windowCloseCoordinator.isPending()) lifecycleCloseGuard.request('window')
  })
  window.on('closed', () => {
    recoveryController.dispose()
    if (rendererRecoveryController === recoveryController) rendererRecoveryController = undefined
    const workspacePath = activeWorkspacePath
    // Percorso di emergenza per distruzioni non passate dal coordinator.
    if (!windowCloseCoordinator.isPending() && !quitCleanupPromise && !quitCleanupComplete) {
      void cleanupWorkspaceRuntime(workspacePath, 'window-destroyed').catch(() => log('error', 'window_fallback_cleanup_failed'))
    }
    instanceRegistry?.setWorkspace(instanceId, null)
    activeWorkspacePath = undefined
    activeWorkspaceError = undefined
    activeWorkspaceIncident = undefined
    if (mainWindow === window) mainWindow = undefined
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  try {
    const loadPromise = devServerUrl
      ? window.loadURL(devServerUrl)
      : window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    void Promise.resolve(loadPromise).catch(() => {
      // `did-fail-load` possiede logging e recovery del caricamento asincrono.
      // Questa catch osserva la Promise Electron evitando un unhandledRejection duplicato.
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
}

function createMenu() {
  const menu = Menu.buildFromTemplate(createApplicationMenuTemplate({
    activeSection: activeAppSection,
    hasWorkspace: Boolean(activeWorkspacePath),
    isDevelopment: Boolean(process.env.VITE_DEV_SERVER_URL),
    onCommand: dispatchApplicationMenuCommand,
  }))
  Menu.setApplicationMenu(menu)
}

function migrateLegacyDatabaseSecretsInBatches() {
  try {
    const outcome = migrateLegacyConnectionSecrets({ limit: 25 })
    if (outcome.scrubbed > 0) log('info', 'database_secrets_migrated', { total: outcome.scrubbed })
    if (outcome.remaining) setImmediate(migrateLegacyDatabaseSecretsInBatches)
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

app.whenReady().then(() => {
  void initializeApplication().catch((error) => {
    void fatalErrorExperience.handleStartup(error)
  })
})

async function initializeApplication() {
  configureDatabaseSecretStorage(safeStorage)
  configureRedisSecretStorage(safeStorage)
  migrateLegacyDatabaseSecretsInBatches()
  instanceRegistry = createInstanceRegistry({ database: getDatabase() })
  const admission = instanceRegistry.register({ instanceId, pid: process.pid })
  if (!admission.accepted) {
    dialog.showErrorBox('VincodeLab è già aperto', 'Puoi usare al massimo due finestre contemporaneamente.')
    app.quit()
    return
  }
  instanceHeartbeat = setInterval(() => {
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
  const startupWorkspacePath = readWorkspaceArgument(process.argv)
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
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececec')
  })

  ipcMain.handle('workspace:open', (event) => {
    assertTrustedSender(event)
    // Il renderer che invoca questo handler gestisce il valore ritornato.
    // Non inviare anche workspace:opened: causerebbe due toast e due reset dello stato.
    return chooseAndOpenWorkspace()
  })
  ipcMain.handle('workspace:getActive', (event) => {
    assertTrustedSender(event)
    return activeWorkspacePath ? { path: activeWorkspacePath, error: activeWorkspaceError, errorIncident: activeWorkspaceIncident } : null
  })
  ipcMain.handle('workspaceSession:get', (event) => {
    assertTrustedSender(event)
    reliabilityFaultInjection?.beforeWorkspaceSessionRead()
    const snapshot = getWorkspaceSession(requireActiveWorkspace())
    if (snapshot.recovery) {
      log('warning', 'workspace_session_recovered', {
        category: 'persistence',
        code: 'PERSISTENCE_SESSION_CORRUPT',
        component: 'workspace-session',
        correlationId: snapshot.recovery.correlationId,
        operation: 'restore-layout',
        severity: 'warning',
      })
    }
    return snapshot
  })
  ipcMain.handle('workspaceSession:save', (event, snapshot) => {
    assertTrustedSender(event)
    return saveWorkspaceSession(requireActiveWorkspace(), snapshot)
  })
  ipcMain.handle('volatileDrafts:list', (event) => {
    assertTrustedSender(event)
    return volatileDrafts.list()
  })
  ipcMain.handle('volatileDrafts:write', (event, draft) => {
    assertTrustedSender(event)
    return volatileDrafts.write(draft)
  })
  ipcMain.handle('volatileDrafts:discard', (event, identity) => {
    assertTrustedSender(event)
    return volatileDrafts.discard(identity)
  })
  ipcMain.handle('workspace:instanceStatus', (event, workspacePath) => {
    assertTrustedSender(event)
    if (workspacePath !== undefined && (typeof workspacePath !== 'string' || workspacePath.length > 4_096 || !path.isAbsolute(workspacePath))) {
      return { ...instanceRegistry.status(), canOpenNew: false, workspaceOpenElsewhere: false, reason: 'invalid-path' }
    }
    return instanceRegistry.status(workspacePath)
  })
  ipcMain.handle('workspace:openInNewInstance', async (event, workspacePath) => {
    assertTrustedSender(event)
    if (launchInProgress) return { launched: false, reason: 'limit', message: 'Apertura di una nuova finestra già in corso.' }
    if (typeof workspacePath !== 'string' || workspacePath.length > 4_096 || !path.isAbsolute(workspacePath) || !isDirectory(workspacePath)) {
      return { launched: false, reason: 'invalid-path', message: 'La cartella selezionata non è disponibile.' }
    }
    const status = instanceRegistry.status(workspacePath)
    if (!status.canOpenNew) {
      const reason = status.workspaceOpenElsewhere ? 'duplicate' : 'limit'
      return {
        launched: false,
        reason,
        message: reason === 'duplicate'
          ? 'Questo workspace è già aperto in un’altra finestra.'
          : 'Puoi usare al massimo due finestre contemporaneamente.',
      }
    }

    launchInProgress = true
    try {
      return await launchWorkspaceInstance({
        executable: process.execPath,
        appPath: app.getAppPath(),
        packaged: app.isPackaged,
        workspacePath,
        onPostLaunchError: (error) => {
          log('error', 'workspace_instance_process_error')
          dialog.showErrorBox(
            'Nuova finestra terminata',
            toPublicErrorMessage(error, { code: 'WORKSPACE_INSTANCE_PROCESS_FAILED', message: 'La nuova finestra non è rimasta disponibile.' }),
          )
        },
      })
    } catch (error) {
      log('error', 'workspace_instance_launch_failed')
      return {
        launched: false,
        reason: 'launch-failed',
        message: toPublicErrorMessage(error, { code: 'WORKSPACE_INSTANCE_LAUNCH_FAILED', message: 'Impossibile aprire una nuova finestra.' }),
      }
    } finally {
      const releaseLaunch = setTimeout(() => { launchInProgress = false }, 2_000)
      releaseLaunch.unref()
    }
  })
  ipcMain.on('lifecycle:closeResponse', confineIpcOneWay('lifecycle:closeResponse', (event, response) => {
    try {
      assertTrustedSender(event)
    } catch {
      // `assertTrustedSender` ha già registrato il rifiuto; una risposta one-way
      // non attendibile non deve influire sul lifecycle della finestra legittima.
      return
    }
    if (!lifecycleCloseGuard.respondRenderer(response)) log('warn', 'lifecycle_close_response_rejected')
  }))
  if (RELIABILITY_BENCHMARK_MODE) {
    ipcMain.handle('benchmark:dispatchCommand', (event, command) => {
      assertTrustedSender(event)
      if (!RELIABILITY_BENCHMARK_COMMANDS.has(command)) throw new Error('Comando benchmark non valido.')
      dispatchApplicationMenuCommand(command)
      return { dispatched: true }
    })
    ipcMain.handle('benchmark:shutdown', async (event) => {
      assertTrustedSender(event)
      if (!quitCleanupPromise && !quitCleanupComplete) {
        quitCleanupPromise = shutdownApplication().then(() => {
          quitCleanupComplete = true
          lifecycleCloseGuard.dispose()
        })
      }
      if (quitCleanupPromise) await quitCleanupPromise
      setImmediate(() => app.quit())
      return { accepted: true }
    })
    if (SCREENSHOT_CAPTURE_MODE) {
      ipcMain.handle('benchmark:captureWindowBounds', (event) => {
        assertTrustedSender(event)
        const window = mainWindow
        if (!window || window.isDestroyed()) throw new Error('Finestra di cattura non disponibile.')
        return {
          bounds: window.getBounds(),
          contentBounds: window.getContentBounds(),
          maximized: window.isMaximized(),
          visible: window.isVisible(),
        }
      })
    }
    if (RELIABILITY_FAULT_INJECTION_MODE) {
      ipcMain.handle('benchmark:injectFault', (event, fault) => {
        assertTrustedSender(event)
        return reliabilityFaultInjection.inject(fault)
      })
      ipcMain.handle('benchmark:probe', (event) => {
        assertTrustedSender(event)
        return reliabilityFaultInjection.probe()
      })
    }
  }
  ipcMain.on('appMenu:setContext', confineIpcOneWay('appMenu:setContext', (event, section) => {
    assertTrustedSender(event)
    if (!APP_SECTIONS.has(section)) {
      log('warn', 'application_menu_context_rejected')
      return
    }
    if (activeAppSection === section) return
    activeAppSection = section
    createMenu()
  }))
  ipcMain.handle('contextMenu:open', (event, request) => {
    assertTrustedSender(event)
    const remoteContextKind = REMOTE_CONTEXT_KINDS.has(request?.kind) ? request.kind : null
    const workspaceFileContext = WORKSPACE_FILE_CONTEXT_KINDS.has(request?.kind)
    const workspaceDirectoryContext = request?.kind === WORKSPACE_DIRECTORY_CONTEXT_KIND
    const workspaceRootContext = request?.kind === WORKSPACE_ROOT_CONTEXT_KIND
    const recentWorkspaceContext = request?.kind === RECENT_WORKSPACE_CONTEXT_KIND
    const terminalTabContext = request?.kind === TERMINAL_TAB_CONTEXT_KIND
    const gitFileContext = GIT_FILE_CONTEXT_KINDS.has(request?.kind)
    const redisKeyContext = request?.kind === REDIS_KEY_CONTEXT_KIND
    const contextKind = remoteContextKind
      ?? (workspaceFileContext || workspaceDirectoryContext || workspaceRootContext || recentWorkspaceContext || terminalTabContext || gitFileContext || redisKeyContext ? request.kind : null)
    const contextId = typeof request?.contextId === 'string' ? request.contextId : null
    if (remoteContextKind && (!contextId || !UUID_PATTERN.test(request?.contextId))) throw new Error('Elemento remoto non valido.')
    if (terminalTabContext && (!contextId || !UUID_PATTERN.test(request?.contextId))) throw new Error('Sessione terminale non valida.')
    if (workspaceFileContext) {
      if (!contextId) throw new Error('File del workspace non valido.')
      resolveProjectFile(requireActiveWorkspace(), contextId)
    }
    if (workspaceDirectoryContext) {
      if (!contextId) throw new Error('Cartella del workspace non valida.')
      resolveProjectDirectory(requireActiveWorkspace(), contextId)
    }
    if (workspaceRootContext) resolveProjectDirectory(requireActiveWorkspace(), '')
    if (recentWorkspaceContext && (!contextId || !listRecentWorkspaces().some((recent) => recent.path === contextId))) {
      throw new Error('Workspace recente non valido.')
    }
    if (gitFileContext) {
      if (!contextId) throw new Error('File Git non valido.')
      const workspaceRoot = resolveProjectDirectory(requireActiveWorkspace(), '')
      const candidate = path.resolve(workspaceRoot, contextId)
      const relative = path.relative(workspaceRoot, candidate)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || contextId.includes('\0')) throw new Error('File Git non valido.')
    }
    if (redisKeyContext && (!contextId || !REDIS_KEY_REF_PATTERN.test(contextId))) throw new Error('Chiave Redis non valida.')
    if (request?.enabledCommands !== undefined && (!Array.isArray(request.enabledCommands)
      || request.enabledCommands.length > 100
      || request.enabledCommands.some((command) => !isApplicationMenuCommand(command)))) {
      throw new Error('Stato comandi contestuali non valido.')
    }
    const surfaceKind = request?.kind === 'terminal' ? 'terminal' : 'default'
    const editable = surfaceKind === 'default' && request?.editable === true
    const hasSelection = request?.hasSelection === true
    const params = {
      isEditable: editable,
      surfaceKind,
      selectionText: hasSelection ? 'selected' : '',
      editFlags: {
        canUndo: editable,
        canRedo: editable,
        canCut: editable && hasSelection,
        canCopy: hasSelection,
        canPaste: editable,
        canSelectAll: editable,
      },
      ...(Array.isArray(request?.enabledCommands) ? { enabledCommands: request.enabledCommands } : {}),
      contextFlags: {
        expanded: request?.contextFlags?.expanded === true,
        cancellable: request?.contextFlags?.cancellable === true,
        retryable: request?.contextFlags?.retryable === true,
        stageable: request?.contextFlags?.stageable === true,
        dirty: request?.contextFlags?.dirty === true,
        hasOtherTabs: request?.contextFlags?.hasOtherTabs === true,
        hasRightTabs: request?.contextFlags?.hasRightTabs === true,
        operable: request?.contextFlags?.operable === true,
        canCreate: request?.contextFlags?.canCreate === true,
        hasVisibleValue: request?.contextFlags?.hasVisibleValue === true,
      },
      ...(contextKind ? { contextKind, contextId } : {}),
    }
    const template = createContextMenuTemplate({
      activeSection: activeAppSection,
      params,
      onCommand: dispatchApplicationMenuCommand,
      onContextCommand: dispatchContextMenuCommand,
    })
    Menu.buildFromTemplate(template).popup({ window: mainWindow })
    return { opened: true }
  })
  ipcMain.handle('appearance:get', (event) => {
    assertTrustedSender(event)
    return getAppearance()
  })
  ipcMain.handle('appearance:set', (event, appearance) => {
    assertTrustedSender(event)
    const value = setAppearance(appearance)
    nativeTheme.themeSource = value
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececec')
    return value
  })
  registerPreferencesIpc({
    ipcMain,
    assertTrustedSender,
    clearAllWorkspacePreferences,
    clearWorkspacePreference,
    getActiveWorkspacePath: () => activeWorkspacePath,
    getPreferences,
    reportPreferenceRecovery,
    requireActiveWorkspace,
    setGlobalPreference,
    setWorkspacePreference,
  })
  ipcMain.handle('updates:list', (event) => { assertTrustedSender(event); return listManagedUpdates() })
  ipcMain.handle('updates:check', (event, id) => { assertTrustedSender(event); return checkUpdates(id ?? null, { force: true }) })
  ipcMain.handle('updates:download', (event, id) => runExternalMutation(event, 'updates:download', null, () => stageManagedUpdate(id)))
  ipcMain.handle('updates:downloadAll', (event) => runExternalMutation(event, 'updates:download-all', null, () => downloadAllUpdates()))
  ipcMain.handle('updates:setPolicy', (event, id, policy) => { assertTrustedSender(event); return setManagedUpdatePolicy(id, policy) })
  ipcMain.handle('updates:rollback', (event, id) => runExternalMutation(event, 'updates:rollback', null, () => rollbackManagedUpdate(id)))
  ipcMain.handle('updates:activatePending', (event) => runExternalMutation(event, 'updates:activate', null, () => activatePendingUpdates()))
  ipcMain.handle('workspace:listRecent', (event) => {
    assertTrustedSender(event)
    return listRecentWorkspaces()
  })
  ipcMain.handle('workspace:reveal', (event) => {
    assertTrustedSender(event)
    return revealWorkspace(requireActiveWorkspace(), { openPath: (workspacePath) => shell.openPath(workspacePath) })
  })
  ipcMain.handle('workspace:openRecent', (event, workspacePath) => {
    assertTrustedSender(event)
    return openWorkspace(workspacePath)
  })
  ipcMain.handle('files:list', (event) => {
    assertTrustedSender(event)
    return listProjectFiles(requireActiveWorkspace())
  })
  ipcMain.handle('files:listDirectory', (event, directoryId) => {
    assertTrustedSender(event)
    return listDirectoryEntries(requireActiveWorkspace(), directoryId)
  })
  ipcMain.handle('files:index', (event, options) => {
    assertTrustedSender(event)
    const force = options?.force === true
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => key !== 'force') || (options.force !== undefined && typeof options.force !== 'boolean'))) {
      throw new Error('Opzioni indice file non valide.')
    }
    return projectFileIndex.build(requireActiveWorkspace(), { force })
  })
  ipcMain.handle('files:indexStatus', (event) => {
    assertTrustedSender(event)
    return projectFileIndex.getStatus(requireActiveWorkspace())
  })
  ipcMain.handle('files:read', (event, fileId) => {
    assertTrustedSender(event)
    return readProjectFile(requireActiveWorkspace(), fileId)
  })
  ipcMain.handle('files:preview', (event, fileId) => {
    assertTrustedSender(event)
    return readProjectPreview(requireActiveWorkspace(), fileId)
  })
  ipcMain.handle('files:prepareAttachment', (event, fileId) => {
    assertTrustedSender(event)
    return prepareProjectFileAttachment(requireActiveWorkspace(), fileId)
  })
  ipcMain.handle('files:create', (event, directoryId, fileName) => {
    assertTrustedSender(event)
    const result = createProjectFile(requireActiveWorkspace(), directoryId, fileName)
    log('info', 'project_file_created')
    projectFileIndex.invalidate(requireActiveWorkspace())
    return result
  })
  ipcMain.handle('files:createDirectory', (event, parentId, directoryName) => {
    assertTrustedSender(event)
    const workspacePath = requireActiveWorkspace()
    const result = createProjectDirectory(workspacePath, parentId, directoryName)
    log('info', 'project_directory_created')
    projectFileIndex.invalidate(workspacePath)
    return result
  })
  ipcMain.handle('files:rename', (event, entryId, entryName, expectedKind) => {
    assertTrustedSender(event)
    const workspacePath = requireActiveWorkspace()
    const result = renameProjectEntry(workspacePath, entryId, entryName, expectedKind)
    if (result.renamed) {
      log('info', 'project_entry_renamed', { kind: expectedKind })
      projectFileIndex.invalidate(workspacePath)
    }
    return result
  })
  ipcMain.handle('files:duplicate', async (event, entryId, expectedKind) => {
    assertTrustedSender(event)
    const workspacePath = requireActiveWorkspace()
    const result = await duplicateProjectEntry(workspacePath, entryId, expectedKind)
    log('info', 'project_entry_duplicated', { kind: expectedKind })
    projectFileIndex.invalidate(workspacePath)
    return result
  })
  ipcMain.handle('files:trash', async (event, entryId, expectedKind) => {
    assertTrustedSender(event)
    const workspacePath = requireActiveWorkspace()
    if (!entryId || (expectedKind !== 'file' && expectedKind !== 'directory')) throw new Error('Elemento del workspace non valido.')
    const entryPath = expectedKind === 'file'
      ? resolveProjectFile(workspacePath, entryId)
      : resolveProjectDirectory(workspacePath, entryId)
    await shell.trashItem(entryPath)
    log('info', 'project_entry_moved_to_trash', { kind: expectedKind })
    projectFileIndex.invalidate(workspacePath)
    return { id: entryId, kind: expectedKind, trashed: true }
  })
  ipcMain.handle('files:save', (event, fileId, content, options) => {
    assertTrustedSender(event)
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => key !== 'force' && key !== 'revision')) {
      throw new Error('Opzioni salvataggio file non valide.')
    }
    return saveProjectFile(requireActiveWorkspace(), fileId, content, options).then((result) => {
      log('info', 'project_file_saved', { size: result.size })
      return result
    })
  })
  ipcMain.handle('instructions:get', (event) => {
    assertTrustedSender(event)
    return getProjectInstructions(requireActiveWorkspace())
  })
  ipcMain.handle('instructions:save', (event, content) => {
    assertTrustedSender(event)
    const result = saveProjectInstructions(requireActiveWorkspace(), content)
    log('info', 'project_instructions_saved')
    return result
  })
  ipcMain.handle('instructions:clear', (event) => {
    assertTrustedSender(event)
    const result = clearProjectInstructions(requireActiveWorkspace())
    log('info', 'project_instructions_cleared')
    return result
  })
  ipcMain.handle('skills:list', (event) => {
    assertTrustedSender(event)
    return listProjectSkills(requireActiveWorkspace())
  })
  ipcMain.handle('skills:get', (event, skillId) => {
    assertTrustedSender(event)
    return getProjectSkill(requireActiveWorkspace(), skillId)
  })
  ipcMain.handle('skills:create', (event, name) => {
    assertTrustedSender(event)
    return createProjectSkill(requireActiveWorkspace(), name)
  })
  ipcMain.handle('skills:update', (event, skillId, content) => {
    assertTrustedSender(event)
    return updateProjectSkill(requireActiveWorkspace(), skillId, content)
  })
  ipcMain.handle('skills:delete', (event, skillId) => {
    assertTrustedSender(event)
    deleteProjectSkill(requireActiveWorkspace(), skillId)
    return { deleted: true }
  })
  ipcMain.handle('skills:reload', (event) => {
    assertTrustedSender(event)
    return reloadPi()
  })
  ipcMain.handle('github:gitStatus', (event, options) => {
    assertTrustedSender(event)
    const readOptions = assertCacheReadOptions(options)
    return runLatestGithubRead(event, 'git-status', (workspacePath, signal) => getCachedGitStatus(workspacePath, { ...readOptions, signal }))
  })
  ipcMain.handle('github:initRepository', (event) => {
    return runWorkspaceMutation(event, 'github:init-repository', initializeGitRepository)
  })
  ipcMain.handle('github:addRemote', (event, remoteUrl) => {
    return runWorkspaceMutation(event, 'github:add-remote', (workspacePath) => addGitHubRemote(workspacePath, remoteUrl))
  })
  ipcMain.handle('github:createRepository', (event, repositoryName, visibility) => {
    return runWorkspaceMutation(event, 'github:create-repository', (workspacePath) => createGitHubRepository(workspacePath, repositoryName, visibility))
  })
  ipcMain.handle('github:stage', (event, filePaths) => {
    return runWorkspaceMutation(event, 'github:stage', (workspacePath) => stageFiles(workspacePath, filePaths))
  })
  ipcMain.handle('github:unstage', (event, filePaths) => {
    return runWorkspaceMutation(event, 'github:unstage', (workspacePath) => unstageFiles(workspacePath, filePaths))
  })
  ipcMain.handle('github:commit', (event, message) => {
    return runWorkspaceMutation(event, 'github:commit', (workspacePath) => commit(workspacePath, message))
  })
  ipcMain.handle('github:push', (event) => {
    return runWorkspaceMutation(event, 'github:push', push)
  })
  ipcMain.handle('github:fetch', (event) => {
    return runWorkspaceMutation(event, 'github:fetch', fetchRemote)
  })
  ipcMain.handle('github:pullRebase', (event) => {
    return runWorkspaceMutation(event, 'github:pull-rebase', pullRebase)
  })
  ipcMain.handle('github:branches', (event) => {
    assertTrustedSender(event)
    return runLatestGithubRead(event, 'branches', (workspacePath, signal) => listBranches(workspacePath, { signal }))
  })
  ipcMain.handle('github:switchBranch', (event, branchName) => {
    return runWorkspaceMutation(event, 'github:switch-branch', (workspacePath) => switchBranch(workspacePath, branchName))
  })
  ipcMain.handle('github:createBranch', (event, branchName) => {
    return runWorkspaceMutation(event, 'github:create-branch', (workspacePath) => createBranch(workspacePath, branchName))
  })
  ipcMain.handle('github:fileDiff', (event, filePath) => {
    assertTrustedSender(event)
    return runLatestGithubRead(event, 'file-diff', (workspacePath, signal) => getFileDiff(workspacePath, filePath, { signal }))
  })
  ipcMain.handle('github:revert', (event, sha) => {
    return runWorkspaceMutation(event, 'github:revert', (workspacePath) => revertCommit(workspacePath, sha))
  })
  ipcMain.handle('github:data', (event, options) => {
    assertTrustedSender(event)
    const readOptions = assertCacheReadOptions(options)
    return runLatestGithubRead(event, 'data', (workspacePath, signal) => getCachedGitHubData(workspacePath, { ...readOptions, signal }))
  })
  ipcMain.handle('github:createIssue', (event, title, body) => {
    return runWorkspaceMutation(event, 'github:create-issue', (workspacePath) => createIssue(workspacePath, title, body))
  })
  ipcMain.handle('github:updateIssue', (event, issueNumber, title, body, state) => {
    return runWorkspaceMutation(event, 'github:update-issue', (workspacePath) => updateIssue(workspacePath, issueNumber, title, body, state))
  })
  ipcMain.handle('github:projectBoard', (event, projectNumber, options) => {
    assertTrustedSender(event)
    const readOptions = assertCacheReadOptions(options)
    return runLatestGithubRead(event, 'project-board', (workspacePath, signal) => getCachedProjectBoard(workspacePath, projectNumber, { ...readOptions, signal }))
  })
  ipcMain.handle('github:createProject', (event, title) => {
    return runWorkspaceMutation(event, 'github:create-project', (workspacePath) => createWorkspaceProject(workspacePath, title))
  })
  ipcMain.handle('github:editProject', (event, projectNumber, title, description) => {
    return runWorkspaceMutation(event, 'github:edit-project', (workspacePath) => editWorkspaceProject(workspacePath, projectNumber, title, description))
  })
  ipcMain.handle('github:closeProject', (event, projectNumber, undo) => {
    return runWorkspaceMutation(event, 'github:close-project', (workspacePath) => closeWorkspaceProject(workspacePath, projectNumber, undo))
  })
  ipcMain.handle('github:addIssueToProject', (event, projectNumber, issueUrl) => {
    return runWorkspaceMutation(event, 'github:add-issue-to-project', (workspacePath) => addWorkspaceIssueToProject(workspacePath, projectNumber, issueUrl))
  })
  ipcMain.handle('github:updateProjectItem', (event, projectNumber, itemId, fieldId, update) => {
    return runWorkspaceMutation(event, 'github:update-project-item', (workspacePath) => updateWorkspaceProjectItem(workspacePath, projectNumber, itemId, fieldId, update))
  })
  ipcMain.handle('github:projectItemFields', (event, projectNumber, itemId) => {
    assertTrustedSender(event)
    return runLatestGithubRead(event, 'project-fields', (workspacePath, signal) => getWorkspaceProjectItemFields(workspacePath, projectNumber, itemId, { signal }))
  })
  ipcMain.handle('github:createProjectDraft', (event, projectNumber, title, body) => {
    return runWorkspaceMutation(event, 'github:create-project-draft', (workspacePath) => createWorkspaceProjectDraft(workspacePath, projectNumber, title, body))
  })
  ipcMain.handle('github:archiveProjectItem', (event, projectNumber, itemId, undo) => {
    return runWorkspaceMutation(event, 'github:archive-project-item', (workspacePath) => archiveWorkspaceProjectItem(workspacePath, projectNumber, itemId, undo))
  })
  ipcMain.handle('pi:reload', (event) => {
    assertTrustedSender(event)
    return reloadPi()
  })
  ipcMain.handle('pi:restart', (event) => {
    assertTrustedSender(event)
    return restartPi()
  })
  ipcMain.handle('terminal:resume', (event) => { assertTrustedSender(event); const stream = piSessionController.getStream(); if (!stream) throw new Error('La sessione Pi non è attiva.'); return stream.createResumeSnapshot() })
  ipcMain.on('terminal:ready', confineIpcOneWay('terminal:ready', (event, message) => {
    assertTrustedSender(event)
    const stream = piSessionController.getStream()
    if (!stream || !stream.rendererReady(message)) rejectOneWay('TERMINAL_READY_REJECTED', 'Il collegamento renderer non è stato accettato.')
  }))
  ipcMain.on('terminal:ack', confineIpcOneWay('terminal:ack', (event, message) => {
    assertTrustedSender(event)
    const stream = piSessionController.getStream()
    if (!stream || !stream.ack(message)) rejectOneWay('TERMINAL_ACK_REJECTED', 'La conferma renderer non è stata accettata.')
  }))
  ipcMain.on('terminal:key', confineIpcOneWay('terminal:key', (event, data) => {
    assertTrustedSender(event)
    if (!piSessionController.write(data)) rejectOneWay('TERMINAL_INPUT_REJECTED', 'Il processo Pi non ha accettato l’input.')
  }))
  ipcMain.handle('terminal:writeInput', (event, data) => {
    assertTrustedSender(event)
    const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : 0
    if (typeof data !== 'string' || bytes === 0 || bytes > 65_536) {
      throw toApplicationError(new Error('Input programmatico non valido.'), {
        category: 'validation',
        channel: 'terminal:writeInput',
        code: 'TERMINAL_WRITE_INPUT_INVALID',
        domain: 'terminal',
        message: 'Il testo da inviare al Terminale AI non è valido.',
        operation: 'writeInput',
        recoverable: true,
        severity: 'warning',
      })
    }
    if (!piSessionController.write(data)) {
      throw toApplicationError(new Error('Il processo Pi non ha accettato l’input programmatico.'), {
        channel: 'terminal:writeInput',
        code: 'TERMINAL_WRITE_INPUT_FAILED',
        domain: 'terminal',
        message: 'Il testo non è stato inviato al Terminale AI. La sessione è rimasta disponibile.',
        operation: 'writeInput',
        recoverable: true,
      })
    }
    return { accepted: true, bytes }
  })
  ipcMain.handle('terminal:pasteStart', (event, input) => { assertTrustedSender(event); const inputController = piSessionController.getInput(); if (!inputController) return { accepted: false, reason: 'not-running', totalBytes: input?.totalBytes, limit: MAX_PASTE_BYTES }; return inputController.start(input) })
  ipcMain.handle('terminal:pasteChunk', (event, input) => { assertTrustedSender(event); const inputController = piSessionController.getInput(); if (!inputController) return { accepted: false, reason: 'not-running', sentBytes: 0, totalBytes: 0 }; return inputController.chunk(input) })
  ipcMain.handle('terminal:pasteCancel', (event, transferId) => { assertTrustedSender(event); return piSessionController.getInput()?.cancel(transferId) ?? { cancelled: false, sentBytes: 0, totalBytes: 0 } })
  ipcMain.on('terminal:rendererMetrics', confineIpcOneWay('terminal:rendererMetrics', (event, metrics) => {
    assertTrustedSender(event)
    piSessionController.getStream()?.updateRendererMetrics(sanitizeRendererMetrics(metrics))
  }))
  ipcMain.handle('terminal:diagnostics', (event) => {
    assertTrustedSender(event)
    return createTerminalDiagnosticsReport({ ...(piSessionController.getStream()?.getDiagnostics() ?? {}), paste: piSessionController.getInput()?.getDiagnostics() })
  })
  ipcMain.handle('terminal:exportDiagnostics', async (event) => {
    assertTrustedSender(event)
    const report = createTerminalDiagnosticsReport({ ...(piSessionController.getStream()?.getDiagnostics() ?? {}), paste: piSessionController.getInput()?.getDiagnostics() })
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Esporta diagnostica Terminale AI',
      buttonLabel: 'Esporta',
      defaultPath: `VincodeLab-terminale-ai-${report.generatedAt.slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { exported: false }
    await writeFile(result.filePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return { exported: true, filePath: result.filePath }
  })
  ipcMain.handle('terminal:chooseAttachments', (event) => { assertTrustedSender(event); return chooseTerminalAttachments() })
  ipcMain.handle('terminal:prepareDroppedAttachments', (event, filePaths) => {
    assertTrustedSender(event)
    if (!Array.isArray(filePaths) || filePaths.length > 20) throw new Error('Allegati non validi.')
    return filePaths.map(prepareTerminalAttachment)
  })
  ipcMain.handle('systemSkills:list', (event) => { assertTrustedSender(event); return listSystemSkills(systemSkillsRoot) })
  ipcMain.handle('systemSkills:get', (event, id) => { assertTrustedSender(event); return getSystemSkill(systemSkillsRoot, id) })
  ipcMain.handle('systemSkills:create', (event, name) => { assertTrustedSender(event); return createSystemSkill(systemSkillsRoot, name) })
  ipcMain.handle('systemSkills:update', (event, id, content) => { assertTrustedSender(event); return updateSystemSkill(systemSkillsRoot, id, content) })
  ipcMain.handle('systemSkills:delete', (event, id) => { assertTrustedSender(event); deleteSystemSkill(systemSkillsRoot, id); return { deleted: true } })
  registerRuntimeIpc({
    ipcMain,
    assertTrustedSender,
    cleanMachineSmokeMode: CLEAN_MACHINE_SMOKE_MODE,
    getPtyStatus: () => ptyRuntime.getStatus(),
    getRuntimeCapabilities,
    resolvePiExecutable,
  })
  ipcMain.handle('piSystem:status', (event) => { assertTrustedSender(event); return getPiSystemStatus(resolvePiExecutable) })
  ipcMain.handle('piSystem:list', (event) => { assertTrustedSender(event); return listPiPackages(resolvePiExecutable) })
  ipcMain.handle('piSystem:listSkills', (event) => { assertTrustedSender(event); return listPiPackageSkills(resolvePiExecutable) })
  ipcMain.handle('piSystem:install', (event, source) => runExternalMutation(event, 'pi-system:install', null, async () => { const result = await installPiPackage(source, resolvePiExecutable); await reconcileManagedPiPackages(resolvePiExecutable, piAgentRoot); return result }))
  ipcMain.handle('piSystem:update', (event, source) => runExternalMutation(event, 'pi-system:update', null, async () => { const result = await updatePiPackage(source, resolvePiExecutable); await reconcileManagedPiPackages(resolvePiExecutable, piAgentRoot); return result }))
  ipcMain.handle('piSystem:remove', (event, source) => runExternalMutation(event, 'pi-system:remove', null, () => removePiPackage(source, resolvePiExecutable)))
  ipcMain.handle('piConfig:start', (event) => { assertTrustedSender(event); return startPiConfig() })
  ipcMain.handle('piConfig:close', async (event) => { assertTrustedSender(event); await stopPiConfig(); return { closed: true } })
  ipcMain.handle('shellSessions:list', (event) => {
    assertTrustedSender(event)
    const { activeSessionId, sessions } = shellSessionManager.list(requireActiveWorkspace())
    return { activeSessionId, sessions }
  })
  ipcMain.handle('shellSessions:resume', (event, sessionId) => {
    assertTrustedSender(event)
    return shellSessionManager.resume(requireActiveWorkspace(), sessionId)
  })
  ipcMain.on('shellSessions:ready', confineIpcOneWay('shellSessions:ready', (event, sessionId, message) => {
    assertTrustedSender(event)
    handleShellSessionOneWay(event, sessionId, 'ready', () => shellSessionManager.rendererReady(requireActiveWorkspace(), sessionId, message))
  }))
  ipcMain.on('shellSessions:ack', confineIpcOneWay('shellSessions:ack', (event, sessionId, message) => {
    assertTrustedSender(event)
    handleShellSessionOneWay(event, sessionId, 'ack', () => shellSessionManager.ack(requireActiveWorkspace(), sessionId, message))
  }))
  ipcMain.on('shellSessions:disconnect', confineIpcOneWay('shellSessions:disconnect', (event, sessionId, message) => {
    assertTrustedSender(event)
    handleShellSessionOneWay(event, sessionId, 'disconnect', () => shellSessionManager.disconnect(requireActiveWorkspace(), sessionId, message))
  }))
  ipcMain.handle('shellSessions:create', (event) => {
    assertTrustedSender(event)
    return shellSessionManager.create(requireActiveWorkspace())
  })
  ipcMain.handle('shellSessions:focus', (event, sessionId) => {
    assertTrustedSender(event)
    return shellSessionManager.focus(requireActiveWorkspace(), sessionId)
  })
  ipcMain.handle('shellSessions:restart', (event, sessionId) => {
    assertTrustedSender(event)
    return shellSessionManager.restart(requireActiveWorkspace(), sessionId)
  })
  ipcMain.handle('shellSessions:close', (event, sessionId) => {
    assertTrustedSender(event)
    return shellSessionManager.close(requireActiveWorkspace(), sessionId)
  })
  ipcMain.on('shellSessions:write', confineIpcOneWay('shellSessions:write', (event, sessionId, data) => {
    assertTrustedSender(event)
    handleShellSessionOneWay(event, sessionId, 'write', () => shellSessionManager.write(requireActiveWorkspace(), sessionId, data))
  }))
  ipcMain.on('shellSessions:resize', confineIpcOneWay('shellSessions:resize', (event, sessionId, dimensions) => {
    assertTrustedSender(event)
    handleShellSessionOneWay(event, sessionId, 'resize', () => shellSessionManager.resize(requireActiveWorkspace(), sessionId, dimensions))
  }))
  ipcMain.handle('workspaceCommands:list', (event) => {
    assertTrustedSender(event)
    return listWorkspaceCommands(requireActiveWorkspace())
  })
  ipcMain.handle('workspaceCommands:createCategory', (event, name) => {
    assertTrustedSender(event)
    return createCommandCategory(requireActiveWorkspace(), name)
  })
  ipcMain.handle('workspaceCommands:updateCategory', (event, categoryId, name) => {
    assertTrustedSender(event)
    return updateCommandCategory(requireActiveWorkspace(), categoryId, name)
  })
  ipcMain.handle('workspaceCommands:deleteCategory', (event, categoryId) => {
    assertTrustedSender(event)
    deleteCommandCategory(requireActiveWorkspace(), categoryId)
    return { deleted: true }
  })
  ipcMain.handle('workspaceCommands:create', (event, input) => {
    assertTrustedSender(event)
    return createWorkspaceCommand(requireActiveWorkspace(), input)
  })
  ipcMain.handle('workspaceCommands:update', (event, commandId, input) => {
    assertTrustedSender(event)
    return updateWorkspaceCommand(requireActiveWorkspace(), commandId, input)
  })
  ipcMain.handle('workspaceCommands:move', (event, commandId, categoryId) => {
    assertTrustedSender(event)
    moveWorkspaceCommand(requireActiveWorkspace(), commandId, categoryId)
    return { moved: true }
  })
  ipcMain.handle('workspaceCommands:delete', (event, commandId) => {
    assertTrustedSender(event)
    deleteWorkspaceCommand(requireActiveWorkspace(), commandId)
    return { deleted: true }
  })
  ipcMain.handle('workspaceCommands:run', (event, commandId) => {
    assertTrustedSender(event)
    const workspacePath = requireActiveWorkspace()
    const activeSession = requireRunningShellSession(workspacePath)
    const command = getWorkspaceCommand(workspacePath, commandId)
    if (!command) throw new Error('Comando del workspace non trovato.')
    if (command.kind === 'ssh') {
      const service = getManagedSsh()
      const launch = service.buildTerminalCommand(workspacePath, command)
      shellSessionManager.write(workspacePath, activeSession.sessionId, `${launch.command}\r`)
      void service.waitUntilConnected(launch.connection.id)
      return { executed: true, managedConnectionId: launch.connection.id }
    }
    shellSessionManager.write(workspacePath, activeSession.sessionId, `${command.command}\r`)
    return { executed: true }
  })
  ipcMain.handle('managedSsh:list', (event) => {
    assertTrustedSender(event)
    return getManagedSsh().list(requireActiveWorkspace())
  })
  ipcMain.handle('managedSsh:check', (event, connectionId) => {
    assertTrustedSender(event)
    requireManagedConnectionForWorkspace(connectionId)
    return getManagedSsh().check(connectionId)
  })
  ipcMain.handle('managedSsh:disconnect', async (event, connectionId) => {
    assertTrustedSender(event)
    requireManagedConnectionForWorkspace(connectionId)
    if (sftpService) await sftpService.closeConnection(connectionId)
    await getManagedSsh().disconnect(connectionId)
    return { disconnected: true }
  })
  ipcMain.handle('remoteFiles:browse', (event, connectionId, directoryId) => {
    assertTrustedSender(event)
    return getRemoteFileService().browse(requireActiveWorkspace(), connectionId, directoryId)
  })
  ipcMain.handle('remoteFiles:downloadAndTrack', (event, entryId) => {
    assertTrustedSender(event)
    return getRemoteFileService().downloadAndTrack(requireActiveWorkspace(), entryId)
  })
  ipcMain.handle('remoteFiles:downloadAs', (event, entryId) => {
    assertTrustedSender(event)
    return getRemoteFileService().downloadAs(requireActiveWorkspace(), entryId)
  })
  ipcMain.handle('remoteFiles:read', (event, fileId) => {
    assertTrustedSender(event)
    return getRemoteFileService().readLocal(requireActiveWorkspace(), fileId)
  })
  ipcMain.handle('remoteFiles:preview', (event, fileId) => {
    assertTrustedSender(event)
    return getRemoteFileService().readPreview(requireActiveWorkspace(), fileId)
  })
  ipcMain.handle('remoteFiles:saveLocal', (event, fileId, content) => {
    assertTrustedSender(event)
    return getRemoteFileService().saveLocal(requireActiveWorkspace(), fileId, content)
  })
  ipcMain.handle('remoteFiles:compare', (event, fileId) => {
    assertTrustedSender(event)
    return getRemoteFileService().compare(requireActiveWorkspace(), fileId)
  })
  ipcMain.handle('remoteFiles:upload', (event, fileId, options) => {
    assertTrustedSender(event)
    return getRemoteFileService().upload(requireActiveWorkspace(), fileId, options)
  })
  ipcMain.handle('remoteFiles:chooseAndUpload', (event, connectionId, directoryId) => {
    assertTrustedSender(event)
    return getRemoteFileService().chooseAndUpload(requireActiveWorkspace(), connectionId, directoryId)
  })
  ipcMain.handle('remoteFiles:cancelTransfer', (event, transferId) => {
    assertTrustedSender(event)
    return { cancelled: getRemoteFileService().cancelTransfer(requireActiveWorkspace(), transferId) }
  })
  ipcMain.handle('remoteFiles:createDirectory', (event, connectionId, parentId, name) => {
    assertTrustedSender(event)
    return getRemoteFileService().createDirectory(requireActiveWorkspace(), connectionId, parentId, name)
  })
  ipcMain.handle('remoteFiles:rename', (event, entryId, name) => {
    assertTrustedSender(event)
    return getRemoteFileService().rename(requireActiveWorkspace(), entryId, name)
  })
  ipcMain.handle('remoteFiles:remove', (event, entryId) => {
    assertTrustedSender(event)
    return getRemoteFileService().remove(requireActiveWorkspace(), entryId)
  })
  ipcMain.handle('remoteFiles:discard', (event, fileId, options) => {
    assertTrustedSender(event)
    return getRemoteFileService().discard(requireActiveWorkspace(), fileId, options)
  })
  ipcMain.handle('remoteFiles:listTracked', (event) => {
    assertTrustedSender(event)
    return getRemoteFileService().listTracked(requireActiveWorkspace())
  })
  ipcMain.handle('remoteFiles:revealLocal', (event, fileId) => {
    assertTrustedSender(event)
    return getRemoteFileService().revealLocal(requireActiveWorkspace(), fileId)
  })
  ipcMain.handle('remoteFiles:cleanup', (event, options) => {
    assertTrustedSender(event)
    return getRemoteFileService().cleanup(requireActiveWorkspace(), options)
  })
  ipcMain.handle('database:listConnections', (event) => { assertTrustedSender(event); return listConnections(requireActiveWorkspace()) })
  ipcMain.handle('database:createConnection', (event, input) => { assertTrustedSender(event); return createConnection(requireActiveWorkspace(), input) })
  ipcMain.handle('database:updateConnection', (event, id, input) => runWorkspaceMutation(event, 'database:update-connection', async (workspacePath) => {
    const drain = databaseOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
    await withCleanupDeadline(Promise.all([drain, closeConnectionSession(workspacePath, id)]), 6_000, 'database-connection-runtime')
    return updateConnection(workspacePath, id, input)
  }))
  ipcMain.handle('database:deleteConnection', (event, id) => runWorkspaceMutation(event, 'database:delete-connection', async (workspacePath) => {
    const drain = databaseOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
    await withCleanupDeadline(Promise.all([drain, closeConnectionSession(workspacePath, id)]), 6_000, 'database-connection-runtime')
    deleteConnection(workspacePath, id)
    return { deleted: true }
  }))
  ipcMain.handle('database:execute', async (event, id, sql, options) => {
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
  })
  ipcMain.handle('database:cancel', (event, operationId) => {
    assertTrustedSender(event)
    return databaseOperations.cancel(operationId, event.sender.id)
  })
  ipcMain.handle('database:begin', (event, id) => runWorkspaceMutation(event, 'database:begin', (workspacePath) => beginTransaction(workspacePath, id)))
  ipcMain.handle('database:commit', (event, id) => runWorkspaceMutation(event, 'database:commit', (workspacePath) => commitTransaction(workspacePath, id)))
  ipcMain.handle('database:rollback', (event, id) => runWorkspaceMutation(event, 'database:rollback', (workspacePath) => rollbackTransaction(workspacePath, id)))
  ipcMain.handle('database:inspectSchema', (event, id, options) => { assertTrustedSender(event); return inspectSchema(requireActiveWorkspace(), id, options) })
  ipcMain.handle('database:tableRows', async (event, id, tableName, options) => {
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
  })
  ipcMain.handle('database:updateTableRows', (event, id, tableName, changes) => runWorkspaceMutation(event, 'database:update-table-rows', (workspacePath) => updateTableRows(workspacePath, id, tableName, changes)))
  ipcMain.handle('database:listSavedQueries', (event, id) => { assertTrustedSender(event); return listSavedQueries(requireActiveWorkspace(), id) })
  ipcMain.handle('database:saveQuery', (event, input) => { assertTrustedSender(event); return saveQuery(requireActiveWorkspace(), input) })
  ipcMain.handle('database:updateSavedQuery', (event, id, input) => { assertTrustedSender(event); return updateSavedQuery(requireActiveWorkspace(), id, input) })
  ipcMain.handle('database:deleteSavedQuery', (event, id) => { assertTrustedSender(event); deleteSavedQuery(requireActiveWorkspace(), id); return { deleted: true } })
  ipcMain.handle('database:listHistory', (event, id, limit) => { assertTrustedSender(event); return listHistory(requireActiveWorkspace(), id, limit) })
  ipcMain.handle('database:clearHistory', (event, id) => { assertTrustedSender(event); return clearHistory(requireActiveWorkspace(), id) })
  ipcMain.handle('redis:listConnections', (event) => {
    assertTrustedSender(event)
    return listRedisConnections(requireActiveWorkspace())
  })
  ipcMain.handle('redis:createConnection', (event, input) => runWorkspaceMutation(event, 'redis:create-connection', (workspacePath) => createRedisConnection(workspacePath, input)))
  ipcMain.handle('redis:updateConnection', (event, id, input) => runWorkspaceMutation(event, 'redis:update-connection', async (workspacePath) => {
    const drain = redisOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
    await withCleanupDeadline(Promise.all([drain, closeRedisConnectionSession(workspacePath, id)]), 6_000, 'redis-connection-runtime')
    return updateRedisConnection(workspacePath, id, input)
  }))
  ipcMain.handle('redis:deleteConnection', (event, id) => runWorkspaceMutation(event, 'redis:delete-connection', async (workspacePath) => {
    const drain = redisOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === id)
    await withCleanupDeadline(Promise.all([drain, closeRedisConnectionSession(workspacePath, id)]), 6_000, 'redis-connection-runtime')
    deleteRedisConnection(workspacePath, id)
    return { deleted: true }
  }))
  ipcMain.handle('redis:testConnection', async (event, input, connectionId) => {
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
  })
  ipcMain.handle('redis:scanKeys', async (event, connectionId, input) => {
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
  })
  ipcMain.handle('redis:readKey', async (event, connectionId, encodedKey, input) => {
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
  })
  ipcMain.handle('redis:reconnect', async (event, connectionId) => {
    assertTrustedSender(event)
    const workspacePath = requireActiveWorkspace()
    await redisOperations.abortAndWaitMatching((operation) => operation.workspacePath === workspacePath && operation.connectionId === connectionId)
    await closeRedisConnectionSession(workspacePath, connectionId)
    return { reconnected: true }
  })
  ipcMain.handle('redis:searchPayloads', async (event, connectionId, input) => {
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
        sendToRenderer('redis:searchProgress', redisSearchForRenderer(progress))
      }))
    } finally {
      operation.finish()
    }
  })
  ipcMain.handle('redis:cancel', (event, operationId) => {
    assertTrustedSender(event)
    const result = redisOperations.cancel(operationId, event.sender.id)
    return { cancelled: result.cancelled }
  })
  ipcMain.on('piConfig:input', confineIpcOneWay('piConfig:input', (event, data) => {
    assertTrustedSender(event)
    if (typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data, 'utf8') > 65_536) {
      rejectOneWay('PI_CONFIG_INPUT_INVALID', 'Input configurazione non valido.')
    }
    if (!piConfigProcess) rejectOneWay('PI_CONFIG_NOT_RUNNING', 'La configurazione di Pi non è attiva.')
    piConfigProcess.write(data)
  }))
  ipcMain.on('piConfig:resize', confineIpcOneWay('piConfig:resize', (event, dimensions) => {
    assertTrustedSender(event)
    const cols = Number(dimensions?.cols)
    const rows = Number(dimensions?.rows)
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 1 || rows <= 1 || cols > 500 || rows > 500) {
      rejectOneWay('PI_CONFIG_RESIZE_INVALID', 'Dimensioni configurazione non valide.')
    }
    if (!piConfigProcess) rejectOneWay('PI_CONFIG_NOT_RUNNING', 'La configurazione di Pi non è attiva.')
    piConfigProcess.resize(cols, rows)
  }))
  ipcMain.on('terminal:resize', confineIpcOneWay('terminal:resize', (event, dimensions) => {
    assertTrustedSender(event)
    const cols = Number(dimensions?.cols)
    const rows = Number(dimensions?.rows)
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 1 || rows <= 1 || cols > 500 || rows > 500) {
      rejectOneWay('TERMINAL_RESIZE_INVALID', 'Dimensioni Terminale AI non valide.')
    }
    if (!piSessionController.resize(cols, rows)) rejectOneWay('TERMINAL_RESIZE_REJECTED', 'Il processo Pi non ha accettato il ridimensionamento.')
  }))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin' || quitCleanupComplete || quitCleanupPromise) return
  beginApprovedQuit()
})

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

app.on('before-quit', (event) => {
  if (quitCleanupComplete) return
  event.preventDefault()
  if (quitCleanupPromise) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    beginApprovedQuit()
    return
  }
  lifecycleCloseGuard.request('quit')
})

async function shutdownApplication() {
  benchmarkTrace('shutdown-start')
  log('info', 'app_stopping')
  rendererRecoveryController?.dispose()
  projectFileIndex.clear()
  await withCleanupDeadline(externalMutations.waitAll(), 13_000, 'external-mutations')
  await stopTerminal('shutdown')
  benchmarkTrace('pi-stopped')
  const databaseDrain = databaseOperations.abortAll()
  const databaseSessionCleanup = activeWorkspacePath ? closeWorkspaceSessions(activeWorkspacePath) : Promise.resolve()
  await withCleanupDeadline(Promise.all([databaseDrain, databaseSessionCleanup]), 6_000, 'database-runtime')
  const redisDrain = redisOperations.abortAll()
  const redisSessionCleanup = activeWorkspacePath ? closeRedisWorkspaceSessions(activeWorkspacePath) : Promise.resolve()
  await withCleanupDeadline(Promise.all([redisDrain, redisSessionCleanup]), 6_000, 'redis-runtime')
  await withCleanupDeadline(githubOperations.abortAndWaitMatching(), 4_000, 'github-operations')
  benchmarkTrace('github-stopped')
  benchmarkTrace('database-stopped')
  // I trasferimenti devono drenarsi prima di terminare il relativo ControlMaster.
  if (remoteFileService) await withCleanupDeadline(remoteFileService.closeAll(), 8_000, 'remote-files')
  else if (sftpService) await withCleanupDeadline(sftpService.closeAll(), 7_000, 'sftp')
  benchmarkTrace('remote-files-stopped')
  if (managedSsh) await withCleanupDeadline(managedSsh.closeAll(), 7_000, 'managed-ssh')
  benchmarkTrace('ssh-stopped')
  await stopPiConfig()
  await shellSessionManager.dispose()
  benchmarkTrace('pty-stopped')
  await withCleanupDeadline(flushLogs(), 1_500, 'logs')
  benchmarkTrace('logs-flushed')
  // L'istanza resta registrata finché tutte le risorse hanno confermato il cleanup.
  if (instanceHeartbeat) clearInterval(instanceHeartbeat)
  instanceHeartbeat = undefined
  instanceRegistry?.unregister(instanceId)
  benchmarkTrace('shutdown-complete')
}

app.on('will-quit', closeDatabase)
