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
const { redisInspectionForRenderer, redisSearchForRenderer, redisSummaryForRenderer } = require('./domains/redis/redis-renderer-serializer.cjs')
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
const { createRendererEventSender } = require('./infrastructure/ipc/renderer-event-sender.cjs')
const { registerAiTerminalIpc } = require('./ipc/domains/ai-terminal.ipc.cjs')
const { registerPreferencesIpc } = require('./ipc/domains/preferences.ipc.cjs')
const { registerRuntimeIpc } = require('./ipc/domains/runtime.ipc.cjs')
const { registerAppearanceIpc } = require('./ipc/domains/appearance.ipc.cjs')
const { registerDatabaseIpc } = require('./ipc/domains/database.ipc.cjs')
const { registerFilesystemIpc } = require('./ipc/domains/filesystem.ipc.cjs')
const { registerGitIpc } = require('./ipc/domains/git.ipc.cjs')
const { registerGithubIpc } = require('./ipc/domains/github.ipc.cjs')
const { registerManagedSshIpc } = require('./ipc/domains/managed-ssh.ipc.cjs')
const { registerPiSystemIpc } = require('./ipc/domains/pi-system.ipc.cjs')
const { registerProjectResourcesIpc } = require('./ipc/domains/project-resources.ipc.cjs')
const { registerRedisIpc } = require('./ipc/domains/redis.ipc.cjs')
const { registerRemoteFilesIpc } = require('./ipc/domains/remote-files.ipc.cjs')
const { registerShellSessionsIpc } = require('./ipc/domains/shell-sessions.ipc.cjs')
const { registerSystemSkillsIpc } = require('./ipc/domains/system-skills.ipc.cjs')
const { registerUpdatesIpc } = require('./ipc/domains/updates.ipc.cjs')
const { registerWorkspaceCommandsIpc } = require('./ipc/domains/workspace-commands.ipc.cjs')
const { registerWorkspaceStateIpc } = require('./ipc/domains/workspace-state.ipc.cjs')

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

const sendToRenderer = createRendererEventSender({
  getApplicationErrorLogMetadata,
  getWindow: () => mainWindow,
  log,
  toApplicationError,
})

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
  registerWorkspaceStateIpc({
    ipcMain,
    assertTrustedSender,
    beforeWorkspaceSessionRead: () => reliabilityFaultInjection?.beforeWorkspaceSessionRead(),
    getWorkspaceSession,
    logWorkspaceSessionRecovery: (recovery) => log('warning', 'workspace_session_recovered', {
      category: 'persistence',
      code: 'PERSISTENCE_SESSION_CORRUPT',
      component: 'workspace-session',
      correlationId: recovery.correlationId,
      operation: 'restore-layout',
      severity: 'warning',
    }),
    requireActiveWorkspace,
    saveWorkspaceSession,
    volatileDrafts,
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
  registerAppearanceIpc({
    ipcMain,
    assertTrustedSender,
    applyAppearance: (value) => {
      nativeTheme.themeSource = value
      mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececec')
    },
    getAppearance,
    setAppearance,
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
  registerUpdatesIpc({
    activatePendingUpdates,
    assertTrustedSender,
    checkUpdates,
    downloadAllUpdates,
    ipcMain,
    listManagedUpdates,
    rollbackManagedUpdate,
    runExternalMutation,
    setManagedUpdatePolicy,
    stageManagedUpdate,
  })
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
  registerFilesystemIpc({
    assertTrustedSender,
    createProjectDirectory,
    createProjectFile,
    duplicateProjectEntry,
    ipcMain,
    listDirectoryEntries,
    listProjectFiles,
    log,
    prepareProjectFileAttachment,
    projectFileIndex,
    readProjectFile,
    readProjectPreview,
    renameProjectEntry,
    requireActiveWorkspace,
    resolveProjectDirectory,
    resolveProjectFile,
    saveProjectFile,
    trashItem: (entryPath) => shell.trashItem(entryPath),
  })
  registerProjectResourcesIpc({
    ipcMain,
    assertTrustedSender,
    clearProjectInstructions,
    createProjectSkill,
    deleteProjectSkill,
    getProjectInstructions,
    getProjectSkill,
    listProjectSkills,
    log,
    reloadPi,
    requireActiveWorkspace,
    saveProjectInstructions,
    updateProjectSkill,
  })
  registerGitIpc({
    addGitHubRemote,
    assertCacheReadOptions,
    assertTrustedSender,
    commit,
    createBranch,
    fetchRemote,
    getCachedGitStatus,
    getFileDiff,
    initializeGitRepository,
    ipcMain,
    listBranches,
    pullRebase,
    push,
    revertCommit,
    runLatestGithubRead,
    runWorkspaceMutation,
    stageFiles,
    switchBranch,
    unstageFiles,
  })
  registerGithubIpc({
    addWorkspaceIssueToProject,
    archiveWorkspaceProjectItem,
    assertCacheReadOptions,
    assertTrustedSender,
    closeWorkspaceProject,
    createGitHubRepository,
    createIssue,
    createWorkspaceProject,
    createWorkspaceProjectDraft,
    editWorkspaceProject,
    getCachedGitHubData,
    getCachedProjectBoard,
    getWorkspaceProjectItemFields,
    ipcMain,
    runLatestGithubRead,
    runWorkspaceMutation,
    updateIssue,
    updateWorkspaceProjectItem,
  })
  registerAiTerminalIpc({
    assertTrustedSender,
    chooseTerminalAttachments,
    confineIpcOneWay,
    createTerminalDiagnosticsReport,
    dialog,
    getMainWindow: () => mainWindow,
    getPiConfigProcess: () => piConfigProcess,
    ipcMain,
    maxPasteBytes: MAX_PASTE_BYTES,
    piSessionController,
    prepareTerminalAttachment,
    rejectOneWay,
    reloadPi,
    restartPi,
    sanitizeRendererMetrics,
    startPiConfig,
    stopPiConfig,
    toApplicationError,
    writeFile,
  })
  registerSystemSkillsIpc({
    ipcMain,
    assertTrustedSender,
    createSystemSkill,
    deleteSystemSkill,
    getSystemSkill,
    listSystemSkills,
    systemSkillsRoot,
    updateSystemSkill,
  })
  registerRuntimeIpc({
    ipcMain,
    assertTrustedSender,
    cleanMachineSmokeMode: CLEAN_MACHINE_SMOKE_MODE,
    getPtyStatus: () => ptyRuntime.getStatus(),
    getRuntimeCapabilities,
    resolvePiExecutable,
  })
  registerPiSystemIpc({
    assertTrustedSender,
    getPiSystemStatus,
    installPiPackage,
    ipcMain,
    listPiPackageSkills,
    listPiPackages,
    piAgentRoot,
    reconcileManagedPiPackages,
    removePiPackage,
    resolvePiExecutable,
    runExternalMutation,
    updatePiPackage,
  })
  registerShellSessionsIpc({
    assertTrustedSender,
    confineIpcOneWay,
    handleShellSessionOneWay,
    ipcMain,
    requireActiveWorkspace,
    shellSessionManager,
  })
  registerWorkspaceCommandsIpc({
    assertTrustedSender,
    createCommandCategory,
    createWorkspaceCommand,
    deleteCommandCategory,
    deleteWorkspaceCommand,
    getManagedSsh,
    getWorkspaceCommand,
    ipcMain,
    listWorkspaceCommands,
    moveWorkspaceCommand,
    requireActiveWorkspace,
    requireRunningShellSession,
    shellSessionManager,
    updateCommandCategory,
    updateWorkspaceCommand,
  })
  registerManagedSshIpc({
    assertTrustedSender,
    getManagedSsh,
    getSftpService: () => sftpService,
    ipcMain,
    requireActiveWorkspace,
    requireManagedConnectionForWorkspace,
  })
  registerRemoteFilesIpc({
    assertTrustedSender,
    getRemoteFileService,
    ipcMain,
    requireActiveWorkspace,
  })
  registerDatabaseIpc({
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
    inspectSchema,
    ipcMain,
    listConnections,
    listHistory,
    listSavedQueries,
    log,
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
  })
  registerRedisIpc({
    assertTrustedSender,
    closeRedisConnectionSession,
    createPublicError,
    createRedisConnection,
    deleteRedisConnection,
    getRedisConnectionWithSecrets,
    ipcMain,
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
  })
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
