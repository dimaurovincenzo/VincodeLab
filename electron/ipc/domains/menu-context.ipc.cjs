const { IPC_CHANNELS, MENU_CONTEXT_INVOKE_CHANNELS, MENU_CONTEXT_SEND_CHANNELS } = require('../channels.cjs')

const path = require('node:path')

const REMOTE_CONTEXT_KINDS = new Set([
  'remote-file',
  'remote-directory',
  'remote-local-file',
  'remote-transfer',
  'editor-remote-tab',
])
const WORKSPACE_FILE_CONTEXT_KINDS = new Set(['workspace-file', 'editor-workspace-tab'])
const WORKSPACE_DIRECTORY_CONTEXT_KIND = 'workspace-directory'
const WORKSPACE_ROOT_CONTEXT_KIND = 'workspace-root'
const RECENT_WORKSPACE_CONTEXT_KIND = 'recent-workspace'
const TERMINAL_TAB_CONTEXT_KIND = 'terminal-tab'
const GIT_FILE_CONTEXT_KINDS = new Set(['git-unstaged-file', 'git-staged-file'])
const REDIS_KEY_CONTEXT_KIND = 'redis-key'
const REDIS_KEY_REF_PATTERN = /^[A-Za-z0-9+/_=-]{1,21848}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createMenuContextHandlers({
  assertTrustedSender,
  buildMenuFromTemplate,
  createContextMenuTemplate,
  dispatchApplicationMenuCommand,
  dispatchContextMenuCommand,
  getActiveAppSection,
  getMainWindow,
  isApplicationMenuCommand,
  listRecentWorkspaces,
  requireActiveWorkspace,
  resolveProjectDirectory,
  resolveProjectFile,
}) {
  return new Map([
    [IPC_CHANNELS.CONTEXT_MENU_OPEN, (event, request) => {
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
        ?? (workspaceFileContext
          || workspaceDirectoryContext
          || workspaceRootContext
          || recentWorkspaceContext
          || terminalTabContext
          || gitFileContext
          || redisKeyContext
          ? request.kind
          : null)
      const contextId = typeof request?.contextId === 'string' ? request.contextId : null

      if (remoteContextKind && (!contextId || !UUID_PATTERN.test(request?.contextId))) {
        throw new Error('Elemento remoto non valido.')
      }
      if (terminalTabContext && (!contextId || !UUID_PATTERN.test(request?.contextId))) {
        throw new Error('Sessione terminale non valida.')
      }
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
        if (!relative
          || relative === '..'
          || relative.startsWith(`..${path.sep}`)
          || path.isAbsolute(relative)
          || contextId.includes('\0')) {
          throw new Error('File Git non valido.')
        }
      }
      if (redisKeyContext && (!contextId || !REDIS_KEY_REF_PATTERN.test(contextId))) {
        throw new Error('Chiave Redis non valida.')
      }
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
        activeSection: getActiveAppSection(),
        params,
        onCommand: dispatchApplicationMenuCommand,
        onContextCommand: dispatchContextMenuCommand,
      })
      buildMenuFromTemplate(template).popup({ window: getMainWindow() })
      return { opened: true }
    }],
  ])
}

function createMenuContextListeners({
  appSections,
  assertTrustedSender,
  createMenu,
  getActiveAppSection,
  log,
  setActiveAppSection,
}) {
  return new Map([
    [IPC_CHANNELS.APP_MENU_SET_CONTEXT, (event, section) => {
      assertTrustedSender(event)
      if (!appSections.has(section)) {
        log('warn', 'application_menu_context_rejected')
        return
      }
      if (getActiveAppSection() === section) return
      setActiveAppSection(section)
      createMenu()
    }],
  ])
}

function registerMenuContextIpc({ confineIpcOneWay, ipcMain, ...dependencies }) {
  const handlers = createMenuContextHandlers(dependencies)
  const listeners = createMenuContextListeners(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  for (const [channel, listener] of listeners) ipcMain.on(channel, confineIpcOneWay(channel, listener))
  return Object.freeze({
    invokeChannels: MENU_CONTEXT_INVOKE_CHANNELS,
    sendChannels: MENU_CONTEXT_SEND_CHANNELS,
  })
}

module.exports = {
  MENU_CONTEXT_INVOKE_CHANNELS,
  MENU_CONTEXT_SEND_CHANNELS,
  createMenuContextHandlers,
  createMenuContextListeners,
  registerMenuContextIpc,
}
