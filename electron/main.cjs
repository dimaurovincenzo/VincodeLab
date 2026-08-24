const { installApplicationProcessEnvironment } = require('./infrastructure/processes/application-process-environment.adapter.cjs')

// Le app macOS avviate da Finder non ereditano necessariamente il PATH della
// shell. Aggiungiamo solo prefissi Homebrew verificati, senza eseguire profili
// utente o `brew shellenv`; gli smoke “clean machine” restano deliberatamente isolati.
installApplicationProcessEnvironment(process.env, {
  discoverHomebrew: !process.argv.includes('--clean-machine-smoke'),
})

const { IPC_CHANNELS } = require('./ipc/channels.cjs')
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, shell } = require('electron')
const { randomUUID } = require('node:crypto')
const { writeFile } = require('node:fs/promises')
const path = require('node:path')
const { flushLogs, log, parseRendererDiagnosticMessage } = require('./infrastructure/logging/logger.adapter.cjs')
const { getApplicationErrorLogMetadata, toApplicationError } = require('./domains/errors/application-error.cjs')
const { installIpcMainErrorHandling } = require('./infrastructure/ipc/ipc-error-boundary.cjs')
const { toIpcApplicationError } = require('./infrastructure/ipc/ipc-application-error.cjs')
const { createFatalErrorExperience } = require('./app/fatal-error-experience.cjs')
const { installNavigationGuards } = require('./infrastructure/security/ipc-security.adapter.cjs')
const { createPublicError, toPublicErrorMessage } = require('./domains/errors/public-error.cjs')
const { environmentForPi, resolvePiExecutable: findPiExecutable } = require('./infrastructure/processes/pi-executable.adapter.cjs')
const { createProjectDirectoryListingFilesystemAdapter } = require('./infrastructure/filesystem/project-directory-listing-filesystem.adapter.cjs')
const { createProjectEntryMutationsFilesystemAdapter } = require('./infrastructure/filesystem/project-entry-mutations-filesystem.adapter.cjs')
const { createProjectFileActionsFilesystemAdapter } = require('./infrastructure/filesystem/project-file-actions-filesystem.adapter.cjs')
const { createProjectFileIndexFilesystemAdapter } = require('./infrastructure/filesystem/project-file-index-filesystem.adapter.cjs')
const { createProjectFileReaderFilesystemAdapter } = require('./infrastructure/filesystem/project-file-reader-filesystem.adapter.cjs')
const { createProjectFileSaveFilesystemAdapter } = require('./infrastructure/filesystem/project-file-save-filesystem.adapter.cjs')
const { prepareTerminalAttachment } = require('./infrastructure/filesystem/terminal-attachment.adapter.cjs')
const { MAX_PASTE_BYTES } = require('./domains/terminal/terminal-input.cjs')
const { createTerminalDiagnosticsReport, sanitizeRendererMetrics } = require('./domains/terminal/terminal-diagnostics.cjs')
const { createSystemSkillsUseCases } = require('./domains/ai/system-skills.cjs')
const { createSystemSkillsFilesystemAdapter } = require('./infrastructure/filesystem/system-skills-filesystem.adapter.cjs')
const { PI_COMMAND_TIMEOUT_MS, createPiSystemUseCases } = require('./domains/ai/pi-system-service.cjs')
const { createPiPackageSkillsFilesystemAdapter } = require('./infrastructure/filesystem/pi-package-skills-filesystem.adapter.cjs')
const { createProjectInstructionsUseCases } = require('./domains/ai/project-instructions.cjs')
const { createProjectInstructionsFilesystemAdapter } = require('./infrastructure/filesystem/project-instructions-filesystem.adapter.cjs')
const { createProjectDirectoryListing, createProjectEntryMutations, createProjectFileActions, createProjectFileIndex, createProjectFileReader, createProjectFileSaver, resolveProjectDirectory, resolveProjectFile } = require('./domains/filesystem/project-files.cjs')
const { createProjectSkillsUseCases } = require('./domains/ai/project-skills.cjs')
const { createProjectSkillsFilesystemAdapter } = require('./infrastructure/filesystem/project-skills-filesystem.adapter.cjs')
const { createCommandCategory, createWorkspaceCommand, deleteCommandCategory, deleteWorkspaceCommand, getWorkspaceCommand, listWorkspaceCommands, moveWorkspaceCommand, updateCommandCategory, updateWorkspaceCommand } = require('./infrastructure/persistence/workspace-commands.repository.cjs')
const { clearHistory, configureDatabaseSecretStorage, createConnection, deleteConnection, deleteSavedQuery, getConnectionWithSecrets, listConnections, listHistory, listSavedQueries, migrateLegacyConnectionSecrets, recordHistory, saveQuery, updateConnection, updateSavedQuery } = require('./infrastructure/persistence/database.repository.cjs')
const { beginTransaction, classifySql, closeConnectionSession, closeWorkspaceSessions, commitTransaction, configureDatabasePersistence, configureDatabaseRuntime, executeQuery, inspectRoutine, inspectSchema, openConnection, readTableRows, rollbackTransaction, updateTableRows } = require('./domains/database/database-service.cjs')
const { createDatabaseOperationRegistry } = require('./domains/database/database-operation-registry.cjs')
const { nodeDatabaseDriverAdapter } = require('./infrastructure/database/node-database-driver.adapter.cjs')
const { SqliteWorkerSession, sqliteWorkerDiagnostics } = require('./infrastructure/database/sqlite-worker-session.adapter.cjs')
const { configureRedisSecretStorage, createRedisConnection, deleteRedisConnection, getRedisConnectionWithSecrets, listRedisConnections, updateRedisConnection } = require('./infrastructure/persistence/redis.repository.cjs')
const { mergeRedisTestConnectionSecrets } = require('./domains/redis/redis-connection-input.cjs')
const { closeConnectionSession: closeRedisConnectionSession, closeWorkspaceSessions: closeRedisWorkspaceSessions, configureRedisClientAdapter, configureRedisPersistence, readKey: readRedisKey, scanKeys: scanRedisKeys, searchKeys: searchRedisKeys, testConnectionInput: testRedisConnectionInput } = require('./domains/redis/redis-service.cjs')
const { createRedisOperationRegistry } = require('./domains/redis/redis-operation-registry.cjs')
const { redisInspectionForRenderer, redisSearchForRenderer, redisSummaryForRenderer } = require('./domains/redis/redis-renderer-serializer.cjs')
const { nodeRedisClientAdapter } = require('./infrastructure/redis/node-redis-client.adapter.cjs')
const { createGithubOperationRegistry } = require('./domains/github/github-operation-registry.cjs')
const { createExternalMutationRegistry } = require('./domains/workspace/external-mutation-registry.cjs')
const { addGitHubRemote, addWorkspaceIssueToProject, archiveWorkspaceProjectItem, closeWorkspaceProject, commit, createBranch, createGitHubRepository, createIssue, createWorkspaceProject, createWorkspaceProjectDraft, editWorkspaceProject, fetchRemote, getCachedGitHubData, getCachedGitStatus, getCachedProjectBoard, getFileDiff, getWorkspaceProjectItemFields, initializeGitRepository, listBranches, pullRebase, push, revertCommit, stageFiles, switchBranch, unstageFiles, updateIssue, updateWorkspaceProjectItem } = require('./infrastructure/github/github-service.adapter.cjs')
const { closeDatabase, getAppearance, getDataDirectory, getDatabase, isDirectory, listRecentWorkspaces, recordWorkspace, setAppearance } = require('./infrastructure/persistence/workspace.repository.cjs')
const { revealWorkspace } = require('./domains/workspace/workspace-reveal.cjs')
const { getWorkspaceSession, saveWorkspaceSession } = require('./infrastructure/persistence/workspace-session.repository.cjs')
const { createVolatileDraftRegistry } = require('./domains/workspace/volatile-draft-registry.cjs')
const { clearAllWorkspacePreferences, clearWorkspacePreference, getPreferences, setGlobalPreference, setWorkspacePreference } = require('./infrastructure/persistence/app-preferences.repository.cjs')
const updatePersistence = require('./infrastructure/persistence/update.repository.cjs')
const updateActivation = require('./infrastructure/updates/update-activation.adapter.cjs')
const updateChecker = require('./infrastructure/updates/update-checker.adapter.cjs')
const { reconcileManagedPiPackages: reconcileManagedPiPackagesWithDependencies } = require('./infrastructure/updates/update-discovery.adapter.cjs')
const updateDownloader = require('./infrastructure/updates/update-downloader.adapter.cjs')
const { createUpdateService } = require('./domains/updates/update-service.cjs')
const { APP_SECTIONS, createApplicationMenuTemplate, isApplicationMenuCommand } = require('./domains/menu/application-menu.cjs')
const { createContextMenuTemplate } = require('./domains/menu/context-menu.cjs')
const { createManagedSshService } = require('./infrastructure/remote/managed-ssh-service.adapter.cjs')
const { createSftpService } = require('./infrastructure/remote/sftp-service.adapter.cjs')
const { createRemoteFileStore } = require('./infrastructure/remote/remote-file-store.adapter.cjs')
const { createRemoteFileService } = require('./domains/remote-files/remote-file-service.cjs')
const { createRemoteFileIo } = require('./infrastructure/remote/remote-file-io.adapter.cjs')
const { createInstanceRegistry } = require('./infrastructure/persistence/instance-registry.adapter.cjs')
const { launchWorkspaceInstance, readWorkspaceArgument } = require('./infrastructure/processes/instance-launcher.adapter.cjs')
const { createLifecycleCloseController } = require('./app/lifecycle-close-controller.cjs')
const { reportPreloadFailure } = require('./app/preload-error-experience.cjs')
const { createReliabilityFaultInjection } = require('./app/reliability-fault-injection.cjs')
const { createRendererRecoveryController } = require('./app/renderer-recovery-controller.cjs')
const { createWindowCloseCoordinator } = require('./app/window-close-coordinator.cjs')
const { createPtyRuntime } = require('./infrastructure/processes/pty-runtime.adapter.cjs')
const { createPiCommandRunner, isPiProcessAlive } = require('./infrastructure/processes/pi-command-runner.adapter.cjs')
const { createHerdrRuntimeAdapter } = require('./infrastructure/processes/herdr-runtime.adapter.cjs')
const { createShellHostAdapter } = require('./infrastructure/processes/shell-host.adapter.cjs')
const { getRuntimeCapabilities } = require('./infrastructure/system/runtime-capabilities.adapter.cjs')
const { createRendererEventSender } = require('./infrastructure/ipc/renderer-event-sender.cjs')
const { createApplicationIpcBoundary } = require('./infrastructure/ipc/application-ipc-boundary.cjs')
const { createContextCommandHostAdapter } = require('./infrastructure/menu/context-command-host.adapter.cjs')
const { createShellSessionRuntime } = require('./domains/shell/shell-session-runtime.cjs')
const { createRemoteRuntime } = require('./domains/remote/remote-runtime.cjs')
const { createContextCommandRuntime } = require('./app/context-command-runtime.cjs')
const { createPiRuntime } = require('./domains/ai/pi-runtime.cjs')
const { createAiTerminalLaunchPolicy } = require('./domains/ai/ai-terminal-launch-policy.cjs')
const { createWorkspaceOperationBoundary } = require('./domains/workspace/workspace-operation-boundary.cjs')
const { createWorkspaceRuntimeCleanup } = require('./domains/workspace/workspace-runtime-cleanup.cjs')
const { createWorkspaceOpener } = require('./domains/workspace/workspace-opener.cjs')
const { createWorkspaceInstanceUseCases } = require('./domains/workspace/workspace-instance-use-cases.cjs')
const { createWindowLifecycleRuntime } = require('./app/window-lifecycle-runtime.cjs')
const { createApplicationMenuFeedbackRuntime } = require('./app/application-menu-feedback-runtime.cjs')
const { createApplicationShutdownRuntime, withCleanupDeadline } = require('./app/application-shutdown-runtime.cjs')
const { createApplicationStartupRuntime } = require('./app/application-startup-runtime.cjs')
const { registerAiTerminalIpc } = require('./ipc/domains/ai-terminal.ipc.cjs')
const { registerLifecycleBenchmarkIpc } = require('./ipc/domains/lifecycle-benchmark.ipc.cjs')
const { registerMenuContextIpc } = require('./ipc/domains/menu-context.ipc.cjs')
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
const { registerWorkspaceIpc } = require('./ipc/domains/workspace.ipc.cjs')
const { registerWorkspaceStateIpc } = require('./ipc/domains/workspace-state.ipc.cjs')

const {
  activatePendingUpdates,
  checkUpdates,
  downloadAllUpdates,
  listManagedUpdates,
  rollbackManagedUpdate,
  setManagedUpdatePolicy,
  stageManagedUpdate,
} = createUpdateService({
  activatePendingUpdates: updateActivation.activatePendingUpdates,
  checkEligibleUpdates: updateChecker.checkEligibleUpdates,
  checkManagedUpdate: updateChecker.checkManagedUpdate,
  getManagedUpdate: updatePersistence.getManagedUpdate,
  listManagedUpdates: updatePersistence.listManagedUpdates,
  recordAvailableUpdate: updatePersistence.recordAvailableUpdate,
  recordUpdateError: updatePersistence.recordUpdateError,
  rollbackManagedUpdate: updateActivation.rollbackManagedUpdate,
  setManagedUpdatePolicy: updatePersistence.setManagedUpdatePolicy,
  stageManagedUpdate: updateDownloader.stageManagedUpdate,
})

configureDatabasePersistence({ getConnectionWithSecrets, recordHistory })
configureDatabaseRuntime({
  createSqliteWorkerSession: (sqlitePath, onClosed) => new SqliteWorkerSession(sqlitePath, onClosed),
  driverPort: nodeDatabaseDriverAdapter,
  sqliteWorkerDiagnostics,
})
configureRedisClientAdapter(nodeRedisClientAdapter)
configureRedisPersistence({ getConnectionWithSecrets: getRedisConnectionWithSecrets })

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
let applicationShutdownRuntime
let applicationStartupRuntime
const instanceId = randomUUID()
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
const applicationHomePath = app.getPath('home')
const systemSkillsRoot = path.join(applicationHomePath, '.pi', 'agent', 'skills')
const {
  createSystemSkill,
  deleteSystemSkill,
  getSystemSkill,
  listSystemSkills,
  updateSystemSkill,
} = createSystemSkillsUseCases({
  storage: createSystemSkillsFilesystemAdapter(),
})
const piAgentRoot = path.join(applicationHomePath, '.pi', 'agent')
const ptyRuntime = createPtyRuntime()
const shellHost = createShellHostAdapter({ environment: process.env })
const resolvePiExecutable = () => findPiExecutable({ environment: process.env, homeDirectory: applicationHomePath })
const environmentForPiExecutable = (executable) => environmentForPi(executable, process.env)
const piCommandRunner = createPiCommandRunner({
  buildEnvironment: environmentForPi,
  getEnvironment: () => process.env,
  timeoutMs: PI_COMMAND_TIMEOUT_MS,
})
const herdrRuntime = createHerdrRuntimeAdapter({
  getEnvironment: () => process.env,
  getHomePath: () => applicationHomePath,
  includeUserCandidates: !CLEAN_MACHINE_SMOKE_MODE,
})
const aiTerminalLaunchPolicy = createAiTerminalLaunchPolicy({
  environmentForExecutable: environmentForPiExecutable,
  getEnvironment: () => process.env,
  herdrEnabled: !RELIABILITY_BENCHMARK_MODE,
  inspectHerdr: herdrRuntime.inspect,
  resolvePiExecutable,
})
const piPackageSkillsSource = createPiPackageSkillsFilesystemAdapter()
const {
  getPiSystemStatus,
  installPiPackage,
  listPiPackageSkills,
  listPiPackages,
  removePiPackage,
  updatePiPackage,
} = createPiSystemUseCases({ packageSkillsSource: piPackageSkillsSource, run: piCommandRunner.run })
const reconcileManagedPiPackages = (resolveExecutableForReconciliation, allowedRoot) => reconcileManagedPiPackagesWithDependencies(
  resolveExecutableForReconciliation,
  allowedRoot,
  { run: piCommandRunner.run },
)
const {
  clearProjectInstructions,
  getProjectInstructions,
  saveProjectInstructions,
} = createProjectInstructionsUseCases({
  storage: createProjectInstructionsFilesystemAdapter(),
})
const {
  createProjectSkill,
  deleteProjectSkill,
  getProjectSkill,
  listProjectSkills,
  updateProjectSkill,
} = createProjectSkillsUseCases({
  storage: createProjectSkillsFilesystemAdapter(),
})
const { listDirectoryEntries, listProjectFiles } = createProjectDirectoryListing(createProjectDirectoryListingFilesystemAdapter())
const {
  createProjectDirectory,
  createProjectFile,
  duplicateProjectEntry,
  renameProjectEntry,
} = createProjectEntryMutations(createProjectEntryMutationsFilesystemAdapter())
const {
  openProjectFileWith,
  prepareProjectFileAttachment,
} = createProjectFileActions(createProjectFileActionsFilesystemAdapter())
const {
  readProjectFile,
  readProjectPreview,
} = createProjectFileReader(createProjectFileReaderFilesystemAdapter())
const { saveProjectFile } = createProjectFileSaver(createProjectFileSaveFilesystemAdapter())
const projectFileIndex = createProjectFileIndex(createProjectFileIndexFilesystemAdapter())
const databaseOperations = createDatabaseOperationRegistry()
const redisOperations = createRedisOperationRegistry()
const githubOperations = createGithubOperationRegistry()
const externalMutations = createExternalMutationRegistry()
const volatileDrafts = createVolatileDraftRegistry()
const sendToRenderer = createRendererEventSender({
  getApplicationErrorLogMetadata,
  getWindow: () => mainWindow,
  log,
  toApplicationError,
})
const applicationMenuFeedbackRuntime = createApplicationMenuFeedbackRuntime({
  Menu,
  Notification,
  createApplicationMenuTemplate,
  getActiveWorkspacePath: () => activeWorkspacePath,
  getIsDevelopment: () => Boolean(process.env.VITE_DEV_SERVER_URL),
  getMainWindow: () => mainWindow,
  isApplicationMenuCommand,
  log,
  sendToRenderer,
})
const {
  createMenu,
  dispatchApplicationMenuCommand,
  notifyWhenBackground,
  reportPreferenceRecovery,
} = applicationMenuFeedbackRuntime

const {
  assertTrustedSender,
  confineIpcOneWay,
  rejectOneWay,
  workspaceFailure,
} = createApplicationIpcBoundary({
  getWindow: () => mainWindow,
  log,
  sendToRenderer,
})

const workspaceOperations = createWorkspaceOperationBoundary({
  assertTrustedSender,
  externalMutations,
  getActiveWorkspacePath: () => activeWorkspacePath,
  githubOperations,
})
const {
  assertCacheReadOptions,
  requireActiveWorkspace,
  runExternalMutation,
  runLatestGithubRead,
  runWorkspaceMutation,
} = workspaceOperations

const shellSessionRuntime = createShellSessionRuntime({
  canonicalizeWorkspace: shellHost.canonicalizeWorkspace,
  deliverData: (payload) => sendToRenderer(IPC_CHANNELS.SHELL_SESSIONS_DATA, payload),
  deliverExit: (payload) => sendToRenderer(IPC_CHANNELS.SHELL_SESSIONS_EXIT, payload),
  getActiveWorkspacePath: () => activeWorkspacePath,
  getEnvironment: shellHost.getEnvironment,
  getExecutable: shellHost.getExecutable,
  isProcessAlive: shellHost.isProcessAlive,
  log,
  processFactory: (executable, args, options) => ptyRuntime.spawn(executable, args, options),
})
const shellSessionManager = shellSessionRuntime.manager
const closeShellSessions = shellSessionRuntime.closeSessions

const remoteRuntime = createRemoteRuntime({
  chooseDestination: async (name) => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Scarica file remoto', buttonLabel: 'Salva', defaultPath: name })
    return result.canceled ? null : result.filePath
  },
  chooseFiles: async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Carica file sul server', buttonLabel: 'Carica', properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  },
  createManagedSshService,
  createRemoteFileIo,
  createRemoteFileService,
  createRemoteFileStore,
  createSftpService,
  getActiveWorkspacePath: () => activeWorkspacePath,
  getDataDirectory,
  getDatabase,
  getTempRoot: () => app.getPath('temp'),
  log,
  notifyTransfer: (transfer) => sendToRenderer(IPC_CHANNELS.REMOTE_FILES_TRANSFER, transfer),
  sendManagedSshStatus: (status) => sendToRenderer(IPC_CHANNELS.MANAGED_SSH_STATUS, status),
  showItemInFolder: (localPath) => shell.showItemInFolder(localPath),
})
const getManagedSsh = remoteRuntime.getManagedSsh
const getRemoteFileService = remoteRuntime.getRemoteFileService
const requireManagedConnectionForWorkspace = remoteRuntime.requireManagedConnection

const contextCommandHost = createContextCommandHostAdapter({
  clipboard,
  dialog,
  getWindow: () => mainWindow,
  shell,
})
const contextCommandRuntime = createContextCommandRuntime({
  chooseApplication: contextCommandHost.chooseApplication,
  copyText: contextCommandHost.copyText,
  log,
  openPath: contextCommandHost.openPath,
  openProjectFileWith,
  openWithApplication: contextCommandHost.openWithApplication,
  requireActiveWorkspace,
  resolveProjectDirectory,
  resolveProjectFile,
  revealItem: contextCommandHost.revealItem,
  sendToRenderer,
  showError: contextCommandHost.showError,
  toPublicErrorMessage,
})
const dispatchContextMenuCommand = contextCommandRuntime.dispatch

const piRuntime = createPiRuntime({
  attachmentPreparer: prepareTerminalAttachment,
  createPublicError,
  deliverPiConfigData: (payload) => sendToRenderer(IPC_CHANNELS.PI_CONFIG_DATA, payload),
  deliverPiConfigExit: (payload) => sendToRenderer(IPC_CHANNELS.PI_CONFIG_EXIT, payload),
  deliverTerminalExit: (payload) => sendToRenderer(IPC_CHANNELS.TERMINAL_EXIT, payload),
  deliverTerminalOutput: (payload) => sendToRenderer(IPC_CHANNELS.TERMINAL_OUTPUT, payload),
  deliverTerminalStreamState: (payload) => sendToRenderer(IPC_CHANNELS.TERMINAL_STREAM_STATE, payload),
  environmentForExecutable: environmentForPiExecutable,
  getHomePath: () => applicationHomePath,
  getWindow: () => mainWindow,
  isProcessAlive: isPiProcessAlive,
  log,
  notifyWhenBackground,
  ptyRuntime,
  resolveExecutable: resolvePiExecutable,
  resolveLaunchCandidates: aiTerminalLaunchPolicy.resolveCandidates,
  requireActiveWorkspace,
  showOpenDialog: (...args) => dialog.showOpenDialog(...args),
  withCleanupDeadline,
})
const piSessionController = piRuntime.controller
const chooseTerminalAttachments = piRuntime.chooseAttachments
const reloadPi = piRuntime.reload
const restartPi = piRuntime.restart
const startPi = piRuntime.start
const startPiConfig = piRuntime.startConfig
const stopPiConfig = piRuntime.stopConfig
const stopTerminal = piRuntime.stop

const cleanupWorkspaceRuntime = createWorkspaceRuntimeCleanup({
  closeDatabaseWorkspaceSessions: closeWorkspaceSessions,
  closeRedisWorkspaceSessions,
  closeShellSessions,
  databaseOperations,
  externalMutations,
  getWindow: () => mainWindow,
  githubOperations,
  redisOperations,
  remoteRuntime,
  stopPiConfig,
  stopTerminal,
  withCleanupDeadline,
})

const workspaceOpener = createWorkspaceOpener({
  cleanupWorkspaceRuntime,
  getActiveWorkspacePath: () => activeWorkspacePath,
  getInstanceRegistry: () => applicationStartupRuntime?.getInstanceRegistry(),
  getWindow: () => mainWindow,
  instanceId,
  isDirectory,
  log,
  notifyWhenBackground,
  projectFileIndex,
  recordWorkspace,
  remoteRuntime,
  setActiveWorkspaceError: (value) => { activeWorkspaceError = value },
  setActiveWorkspaceIncident: (value) => { activeWorkspaceIncident = value },
  setActiveWorkspacePath: (value) => { activeWorkspacePath = value },
  showOpenDialog: (...args) => dialog.showOpenDialog(...args),
  startPi,
  stopTerminal,
  workspaceFailure,
})
const chooseAndOpenWorkspace = workspaceOpener.chooseAndOpen
const openWorkspace = workspaceOpener.open

const handleShellSessionOneWay = shellSessionRuntime.handleOneWay

function requireRunningShellSession(workspacePath = requireActiveWorkspace()) {
  return shellSessionRuntime.requireRunning(workspacePath)
}

const windowLifecycleRuntime = createWindowLifecycleRuntime({
  BrowserWindow,
  benchmarkMode: RELIABILITY_BENCHMARK_MODE,
  beginApprovedQuit: () => applicationShutdownRuntime.beginApprovedQuit(),
  cleanupWorkspaceRuntime,
  closeDatabaseWorkspaceSessions: closeWorkspaceSessions,
  closeRedisWorkspaceSessions,
  createLifecycleCloseController,
  createRendererRecoveryController,
  createWindowCloseCoordinator,
  databaseOperations,
  dialog,
  faultInjectionMode: RELIABILITY_FAULT_INJECTION_MODE,
  getActiveWorkspacePath: () => activeWorkspacePath,
  getApplicationErrorLogMetadata,
  getInstanceRegistry: () => applicationStartupRuntime?.getInstanceRegistry(),
  getMainWindow: () => mainWindow,
  getQuitCleanupComplete: () => applicationShutdownRuntime?.getQuitCleanupComplete() ?? false,
  getQuitCleanupPromise: () => applicationShutdownRuntime?.getQuitCleanupPromise(),
  installNavigationGuards,
  instanceId,
  log,
  nativeTheme,
  parseRendererDiagnosticMessage,
  preloadPath: path.join(__dirname, 'preload.cjs'),
  redisOperations,
  rendererEntryPath: path.join(__dirname, '..', 'dist', 'index.html'),
  reportPreloadFailure,
  screenshotCaptureMode: SCREENSHOT_CAPTURE_MODE,
  screenshotViewport: SCREENSHOT_CAPTURE_VIEWPORT,
  sendToRenderer,
  setActiveWorkspaceError: (value) => { activeWorkspaceError = value },
  setActiveWorkspaceIncident: (value) => { activeWorkspaceIncident = value },
  setActiveWorkspacePath: (value) => { activeWorkspacePath = value },
  setMainWindow: (value) => { mainWindow = value },
  toApplicationError,
  withCleanupDeadline,
})
const { createWindow, disposeRendererRecovery, lifecycleCloseGuard } = windowLifecycleRuntime
applicationShutdownRuntime = createApplicationShutdownRuntime({
  app,
  benchmarkMode: RELIABILITY_BENCHMARK_MODE,
  closeDatabase,
  closeDatabaseWorkspaceSessions: closeWorkspaceSessions,
  closeRedisWorkspaceSessions,
  databaseOperations,
  dialog,
  disposeRendererRecovery,
  externalMutations,
  flushLogs,
  getActiveWorkspacePath: () => activeWorkspacePath,
  getMainWindow: () => mainWindow,
  githubOperations,
  lifecycleCloseGuard,
  log,
  platform: process.platform,
  projectFileIndex,
  redisOperations,
  releaseInstanceRegistration: () => applicationStartupRuntime?.releaseInstanceRegistration(),
  remoteRuntime,
  shellSessionManager,
  stopPiConfig,
  stopTerminal,
  writeBenchmarkTrace: (message) => process.stderr.write(message),
})
const {
  shutdownApplication,
} = applicationShutdownRuntime

function registerApplicationIpc(instanceRegistry) {
  const workspaceInstanceUseCases = createWorkspaceInstanceUseCases({
    applicationExecutable: process.execPath,
    applicationIsPackaged: app.isPackaged,
    getApplicationPath: () => app.getAppPath(),
    getInstanceStatus: (workspacePath) => instanceRegistry.status(workspacePath),
    isDirectory,
    launchWorkspaceInstance,
    log,
    scheduleTimeout: setTimeout,
    showErrorBox: (title, message) => dialog.showErrorBox(title, message),
    toPublicErrorMessage,
  })
  registerWorkspaceIpc({
    assertTrustedSender,
    chooseAndOpenWorkspace,
    getActiveWorkspaceError: () => activeWorkspaceError,
    getActiveWorkspaceIncident: () => activeWorkspaceIncident,
    getActiveWorkspacePath: () => activeWorkspacePath,
    getWorkspaceInstanceStatus: workspaceInstanceUseCases.getStatus,
    ipcMain,
    listRecentWorkspaces,
    openPath: (workspacePath) => shell.openPath(workspacePath),
    openWorkspace,
    openWorkspaceInNewInstance: workspaceInstanceUseCases.openInNewInstance,
    requireActiveWorkspace,
    revealWorkspace,
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
  registerLifecycleBenchmarkIpc({
    assertTrustedSender,
    confineIpcOneWay,
    dispatchApplicationMenuCommand,
    getMainWindow: () => mainWindow,
    getQuitCleanupComplete: applicationShutdownRuntime.getQuitCleanupComplete,
    getQuitCleanupPromise: applicationShutdownRuntime.getQuitCleanupPromise,
    ipcMain,
    lifecycleCloseGuard,
    log,
    quitApplication: () => app.quit(),
    reliabilityBenchmarkCommands: RELIABILITY_BENCHMARK_COMMANDS,
    reliabilityBenchmarkMode: RELIABILITY_BENCHMARK_MODE,
    reliabilityFaultInjection,
    reliabilityFaultInjectionMode: RELIABILITY_FAULT_INJECTION_MODE,
    scheduleImmediate: setImmediate,
    screenshotCaptureMode: SCREENSHOT_CAPTURE_MODE,
    setQuitCleanupComplete: applicationShutdownRuntime.setQuitCleanupComplete,
    setQuitCleanupPromise: applicationShutdownRuntime.setQuitCleanupPromise,
    shutdownApplication,
  })
  registerMenuContextIpc({
    appSections: APP_SECTIONS,
    assertTrustedSender,
    buildMenuFromTemplate: (template) => Menu.buildFromTemplate(template),
    confineIpcOneWay,
    createContextMenuTemplate,
    createMenu,
    dispatchApplicationMenuCommand,
    dispatchContextMenuCommand,
    getActiveAppSection: applicationMenuFeedbackRuntime.getActiveAppSection,
    getMainWindow: () => mainWindow,
    ipcMain,
    isApplicationMenuCommand,
    listRecentWorkspaces,
    log,
    requireActiveWorkspace,
    resolveProjectDirectory,
    resolveProjectFile,
    setActiveAppSection: applicationMenuFeedbackRuntime.setActiveAppSection,
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
    getPiConfigProcess: piRuntime.getConfigProcess,
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
    inspectHerdr: () => RELIABILITY_BENCHMARK_MODE
      ? { available: false, reason: 'disabled' }
      : herdrRuntime.inspect(process.env),
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
    getSftpService: remoteRuntime.getSftpService,
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
    inspectRoutine,
    inspectSchema,
    ipcMain,
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
    toIpcApplicationError,
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
}

applicationStartupRuntime = createApplicationStartupRuntime({
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
  getMainWindow: () => mainWindow,
  getOpenWindows: () => BrowserWindow.getAllWindows(),
  instanceId,
  log,
  migrateLegacyConnectionSecrets,
  nativeTheme,
  openWorkspace,
  piAgentRoot,
  processArguments: process.argv,
  processId: process.pid,
  readWorkspaceArgument,
  reconcileManagedPiPackages,
  registerIpc: registerApplicationIpc,
  resolvePiExecutable,
  safeStorage,
  toApplicationError,
})

applicationStartupRuntime.start()
applicationShutdownRuntime.install()
