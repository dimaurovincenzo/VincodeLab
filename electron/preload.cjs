const { contextBridge, ipcRenderer: electronIpcRenderer, webUtils } = require('electron')

// BEGIN PRELOAD_PUBLIC_ERROR_RESTORER
const IPC_REJECTION_PATTERN = /^Error invoking remote method '([^']+)': Error:\s*(.+?)\s+\[([A-Z][A-Z0-9_]{2,63})\]\s+\[(ERR-[A-F0-9]{6})\]\s*$/u
const SAFE_CHANNEL_PATTERN = /^[a-zA-Z][a-zA-Z0-9:._-]{1,95}$/u
const MAX_PUBLIC_MESSAGE_LENGTH = 320
const GIT_OPERATIONS = new Set(['addRemote', 'branches', 'commit', 'createBranch', 'fetch', 'fileDiff', 'gitStatus', 'initRepository', 'pullRebase', 'push', 'revert', 'stage', 'switchBranch', 'unstage'])

function safePreloadProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

function trustedPublicMessage(value) {
  if (typeof value !== 'string' || value.length > MAX_PUBLIC_MESSAGE_LENGTH) return null
  if (/\p{Cc}|\b(?:password|passwd|pwd|token|secret|authorization|cookie|api[-_ ]?key)\b\s*[:=]|\b(?:bearer|basic)\s+|[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\/(?:Users|home|tmp|private\/tmp|var\/folders|opt|etc|srv|mnt)\//iu.test(value)) return null
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized && normalized === value ? normalized : null
}

function fallbackPreloadCategory(channel) {
  const [namespace, operation = ''] = channel.split(':', 2)
  if (namespace === 'database') return 'database'
  if (namespace === 'github') return GIT_OPERATIONS.has(operation) ? 'git' : 'github'
  if (namespace === 'remoteFiles' || namespace === 'managedSsh') return 'remote'
  if (namespace === 'files' || namespace === 'instructions' || namespace === 'skills' || namespace === 'systemSkills') return 'filesystem'
  if (namespace === 'workspaceSession' || namespace === 'volatileDrafts') return 'persistence'
  if (namespace === 'workspace') return 'filesystem'
  if (namespace === 'piConfig' || namespace === 'piSystem' || namespace === 'runtime' || namespace === 'appearance' || namespace === 'preferences') return 'configuration'
  if (namespace === 'pi' || namespace === 'terminal' || namespace === 'shellSessions' || namespace === 'updates') return 'process'
  return 'internal'
}

function preloadCategoryFromCode(code, channel) {
  if (/(?:^|_)(?:CANCELLED|CANCELED|ABORTED)(?:_|$)/u.test(code)) return 'cancelled'
  if (/(?:AUTH|LOGIN|TOKEN_(?:EXPIRED|INVALID|MISSING)|CREDENTIALS?)/u.test(code)) return 'authentication'
  if (/(?:PERMISSION|FORBIDDEN|READ_ONLY|EACCES|EPERM)/u.test(code)) return 'permission'
  if (/(?:CONFIG|NOT_CONFIGURED|API_KEY|ENVIRONMENT)/u.test(code)) return 'configuration'
  if (/(?:TIMEOUT|TIMED_OUT|DEADLINE)/u.test(code)) return 'timeout'
  if (/(?:CONFLICT|STALE|ALREADY_EXISTS|NON_FAST_FORWARD)/u.test(code)) return 'conflict'
  if (/(?:RATE_LIMIT|TOO_MANY_REQUESTS|NETWORK|OFFLINE|CONNECTION|UNREACHABLE)/u.test(code)) return 'network'
  if (/(?:NOT_FOUND|MISSING|NO_SUCH)/u.test(code)) return 'not-found'
  if (/(?:INVALID|VALIDATION|MALFORMED|PARSE|SYNTAX|UNSUPPORTED)/u.test(code)) return 'validation'
  return fallbackPreloadCategory(channel)
}

function preloadSeverityFor(category) {
  if (category === 'cancelled') return 'info'
  if (category === 'configuration' || category === 'conflict' || category === 'validation') return 'warning'
  return 'error'
}

function restorePublicInvokeError(error, expectedChannel) {
  if (typeof expectedChannel !== 'string' || !SAFE_CHANNEL_PATTERN.test(expectedChannel)) return error
  const rawMessage = typeof error === 'string' ? error : safePreloadProperty(error, 'message')
  if (typeof rawMessage !== 'string') return error
  const match = rawMessage.match(IPC_REJECTION_PATTERN)
  if (!match || match[1] !== expectedChannel) return error
  const message = trustedPublicMessage(match[2])
  if (!message) return error
  const code = match[3]
  const correlationId = match[4]
  const category = preloadCategoryFromCode(code, expectedChannel)
  return Object.freeze({
    category,
    code,
    correlationId,
    message: `${message} [${code}] [${correlationId}]`,
    recoverable: category !== 'cancelled',
    severity: preloadSeverityFor(category),
  })
}
// END PRELOAD_PUBLIC_ERROR_RESTORER

// L'Error serializzato da Electron conserva soltanto il messaggio. Il preload è
// il confine fidato che ricostruisce il contratto pubblico classificato dal main;
// qualsiasi rejection non conforme resta un errore non attendibile nel renderer.
const ipcRenderer = Object.freeze({
  invoke: (channel, ...args) => electronIpcRenderer.invoke(channel, ...args).catch((error) => {
    throw restorePublicInvokeError(error, channel)
  }),
  on: (...args) => electronIpcRenderer.on(...args),
  removeListener: (...args) => electronIpcRenderer.removeListener(...args),
  send: (...args) => electronIpcRenderer.send(...args),
})

const benchmarkMode = process.argv.includes('--vincodelab-reliability-benchmark')
const benchmarkFaultInjectionMode = benchmarkMode && process.argv.includes('--vincodelab-reliability-fault-injection')
const screenshotCaptureMode = benchmarkMode && process.argv.includes('--vincodelab-screenshot-capture')
const benchmarkApi = benchmarkMode
  ? { benchmark: {
      dispatchCommand: (command) => ipcRenderer.invoke('benchmark:dispatchCommand', command),
      ...(benchmarkFaultInjectionMode ? {
        injectFault: (fault) => ipcRenderer.invoke('benchmark:injectFault', fault),
        probe: () => ipcRenderer.invoke('benchmark:probe'),
      } : {}),
      ...(screenshotCaptureMode ? {
        captureWindowBounds: () => ipcRenderer.invoke('benchmark:captureWindowBounds'),
      } : {}),
      shutdown: () => ipcRenderer.invoke('benchmark:shutdown'),
    } }
  : {}

contextBridge.exposeInMainWorld('vincodeLab', {
  ...benchmarkApi,
  lifecycle: {
    respondToClose: (requestId, decision) => ipcRenderer.send('lifecycle:closeResponse', { requestId, decision }),
    onCloseRequested: (listener) => {
      const handler = (_event, request) => listener(request)
      ipcRenderer.on('lifecycle:closeRequested', handler)
      return () => ipcRenderer.removeListener('lifecycle:closeRequested', handler)
    },
  },
  appMenu: {
    setContext: (section) => ipcRenderer.send('appMenu:setContext', section),
    onCommand: (listener) => {
      const handler = (_event, command) => listener(command)
      ipcRenderer.on('appMenu:command', handler)
      return () => ipcRenderer.removeListener('appMenu:command', handler)
    },
  },
  contextMenu: {
    open: (request) => ipcRenderer.invoke('contextMenu:open', request),
    onAction: (listener) => {
      const handler = (_event, action) => listener(action)
      ipcRenderer.on('contextMenu:action', handler)
      return () => ipcRenderer.removeListener('contextMenu:action', handler)
    },
  },
  workspace: {
    open: () => ipcRenderer.invoke('workspace:open'),
    getActive: () => ipcRenderer.invoke('workspace:getActive'),
    listRecent: () => ipcRenderer.invoke('workspace:listRecent'),
    reveal: () => ipcRenderer.invoke('workspace:reveal'),
    openRecent: (workspacePath) => ipcRenderer.invoke('workspace:openRecent', workspacePath),
    instanceStatus: (workspacePath) => ipcRenderer.invoke('workspace:instanceStatus', workspacePath),
    openInNewInstance: (workspacePath) => ipcRenderer.invoke('workspace:openInNewInstance', workspacePath),
    onOpened: (listener) => {
      const handler = (_event, result) => listener(result)
      ipcRenderer.on('workspace:opened', handler)
      return () => ipcRenderer.removeListener('workspace:opened', handler)
    },
  },
  workspaceSession: {
    get: () => ipcRenderer.invoke('workspaceSession:get'),
    save: (snapshot) => ipcRenderer.invoke('workspaceSession:save', snapshot),
  },
  volatileDrafts: {
    list: () => ipcRenderer.invoke('volatileDrafts:list'),
    write: (draft) => ipcRenderer.invoke('volatileDrafts:write', draft),
    discard: (identity) => ipcRenderer.invoke('volatileDrafts:discard', identity),
  },
  appearance: {
    get: () => ipcRenderer.invoke('appearance:get'),
    set: (appearance) => ipcRenderer.invoke('appearance:set', appearance),
  },
  preferences: {
    get: () => ipcRenderer.invoke('preferences:get'),
    setGlobal: (key, value) => ipcRenderer.invoke('preferences:setGlobal', key, value),
    setWorkspace: (key, value) => ipcRenderer.invoke('preferences:setWorkspace', key, value),
    clearWorkspace: (key) => ipcRenderer.invoke('preferences:clearWorkspace', key),
    clearAllWorkspace: () => ipcRenderer.invoke('preferences:clearAllWorkspace'),
  },
  updates: {
    list: () => ipcRenderer.invoke('updates:list'),
    check: (id) => ipcRenderer.invoke('updates:check', id),
    download: (id) => ipcRenderer.invoke('updates:download', id),
    downloadAll: () => ipcRenderer.invoke('updates:downloadAll'),
    setPolicy: (id, policy) => ipcRenderer.invoke('updates:setPolicy', id, policy),
    rollback: (id) => ipcRenderer.invoke('updates:rollback', id),
    activatePending: () => ipcRenderer.invoke('updates:activatePending'),
  },
  files: {
    list: () => ipcRenderer.invoke('files:list'),
    listDirectory: (directoryId) => ipcRenderer.invoke('files:listDirectory', directoryId),
    index: (options) => ipcRenderer.invoke('files:index', options),
    indexStatus: () => ipcRenderer.invoke('files:indexStatus'),
    read: (fileId) => ipcRenderer.invoke('files:read', fileId),
    preview: (fileId) => ipcRenderer.invoke('files:preview', fileId),
    prepareAttachment: (fileId) => ipcRenderer.invoke('files:prepareAttachment', fileId),
    create: (directoryId, fileName) => ipcRenderer.invoke('files:create', directoryId, fileName),
    createDirectory: (parentId, directoryName) => ipcRenderer.invoke('files:createDirectory', parentId, directoryName),
    rename: (entryId, entryName, expectedKind) => ipcRenderer.invoke('files:rename', entryId, entryName, expectedKind),
    duplicate: (entryId, expectedKind) => ipcRenderer.invoke('files:duplicate', entryId, expectedKind),
    trash: (entryId, expectedKind) => ipcRenderer.invoke('files:trash', entryId, expectedKind),
    save: (fileId, content, options) => ipcRenderer.invoke('files:save', fileId, content, options),
  },
  instructions: {
    get: () => ipcRenderer.invoke('instructions:get'),
    save: (content) => ipcRenderer.invoke('instructions:save', content),
    clear: () => ipcRenderer.invoke('instructions:clear'),
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    get: (skillId) => ipcRenderer.invoke('skills:get', skillId),
    create: (name) => ipcRenderer.invoke('skills:create', name),
    update: (skillId, content) => ipcRenderer.invoke('skills:update', skillId, content),
    delete: (skillId) => ipcRenderer.invoke('skills:delete', skillId),
    reload: () => ipcRenderer.invoke('skills:reload'),
  },
  pi: {
    reload: () => ipcRenderer.invoke('pi:reload'),
    restart: () => ipcRenderer.invoke('pi:restart'),
  },
  systemSkills: {
    list: () => ipcRenderer.invoke('systemSkills:list'), get: (id) => ipcRenderer.invoke('systemSkills:get', id), create: (name) => ipcRenderer.invoke('systemSkills:create', name), update: (id, content) => ipcRenderer.invoke('systemSkills:update', id, content), delete: (id) => ipcRenderer.invoke('systemSkills:delete', id),
  },
  runtime: {
    capabilities: () => ipcRenderer.invoke('runtime:capabilities'),
  },
  piSystem: {
    status: () => ipcRenderer.invoke('piSystem:status'), list: () => ipcRenderer.invoke('piSystem:list'), listSkills: () => ipcRenderer.invoke('piSystem:listSkills'), install: (source) => ipcRenderer.invoke('piSystem:install', source), update: (source) => ipcRenderer.invoke('piSystem:update', source), remove: (source) => ipcRenderer.invoke('piSystem:remove', source),
  },
  piConfig: {
    start: () => ipcRenderer.invoke('piConfig:start'), close: () => ipcRenderer.invoke('piConfig:close'), write: (data) => ipcRenderer.send('piConfig:input', data), resize: (dimensions) => ipcRenderer.send('piConfig:resize', dimensions),
    onData: (listener) => { const handler = (_event, data) => listener(data); ipcRenderer.on('piConfig:data', handler); return () => ipcRenderer.removeListener('piConfig:data', handler) },
    onExit: (listener) => { const handler = (_event, status) => listener(status); ipcRenderer.on('piConfig:exit', handler); return () => ipcRenderer.removeListener('piConfig:exit', handler) },
    onError: (listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on('piConfig:error', handler); return () => ipcRenderer.removeListener('piConfig:error', handler) },
  },
  github: {
    gitStatus: (options) => ipcRenderer.invoke('github:gitStatus', options),
    initRepository: () => ipcRenderer.invoke('github:initRepository'),
    addRemote: (remoteUrl) => ipcRenderer.invoke('github:addRemote', remoteUrl),
    createRepository: (repositoryName, visibility) => ipcRenderer.invoke('github:createRepository', repositoryName, visibility),
    stage: (filePaths) => ipcRenderer.invoke('github:stage', filePaths),
    unstage: (filePaths) => ipcRenderer.invoke('github:unstage', filePaths),
    commit: (message) => ipcRenderer.invoke('github:commit', message),
    push: () => ipcRenderer.invoke('github:push'),
    fetch: () => ipcRenderer.invoke('github:fetch'),
    pullRebase: () => ipcRenderer.invoke('github:pullRebase'),
    branches: () => ipcRenderer.invoke('github:branches'),
    switchBranch: (branchName) => ipcRenderer.invoke('github:switchBranch', branchName),
    createBranch: (branchName) => ipcRenderer.invoke('github:createBranch', branchName),
    fileDiff: (filePath) => ipcRenderer.invoke('github:fileDiff', filePath),
    revert: (sha) => ipcRenderer.invoke('github:revert', sha),
    data: (options) => ipcRenderer.invoke('github:data', options),
    createIssue: (title, body) => ipcRenderer.invoke('github:createIssue', title, body),
    updateIssue: (issueNumber, title, body, state) => ipcRenderer.invoke('github:updateIssue', issueNumber, title, body, state),
    projectBoard: (projectNumber, options) => ipcRenderer.invoke('github:projectBoard', projectNumber, options),
    createProject: (title) => ipcRenderer.invoke('github:createProject', title),
    editProject: (projectNumber, title, description) => ipcRenderer.invoke('github:editProject', projectNumber, title, description),
    closeProject: (projectNumber, undo) => ipcRenderer.invoke('github:closeProject', projectNumber, undo),
    addIssueToProject: (projectNumber, issueUrl) => ipcRenderer.invoke('github:addIssueToProject', projectNumber, issueUrl),
    updateProjectItem: (projectNumber, itemId, fieldId, update) => ipcRenderer.invoke('github:updateProjectItem', projectNumber, itemId, fieldId, update),
    projectItemFields: (projectNumber, itemId) => ipcRenderer.invoke('github:projectItemFields', projectNumber, itemId),
    createProjectDraft: (projectNumber, title, body) => ipcRenderer.invoke('github:createProjectDraft', projectNumber, title, body),
    archiveProjectItem: (projectNumber, itemId, undo) => ipcRenderer.invoke('github:archiveProjectItem', projectNumber, itemId, undo),
  },
  workspaceCommands: {
    list: () => ipcRenderer.invoke('workspaceCommands:list'),
    createCategory: (name) => ipcRenderer.invoke('workspaceCommands:createCategory', name),
    updateCategory: (categoryId, name) => ipcRenderer.invoke('workspaceCommands:updateCategory', categoryId, name),
    deleteCategory: (categoryId) => ipcRenderer.invoke('workspaceCommands:deleteCategory', categoryId),
    create: (input) => ipcRenderer.invoke('workspaceCommands:create', input),
    update: (commandId, input) => ipcRenderer.invoke('workspaceCommands:update', commandId, input),
    move: (commandId, categoryId) => ipcRenderer.invoke('workspaceCommands:move', commandId, categoryId),
    delete: (commandId) => ipcRenderer.invoke('workspaceCommands:delete', commandId),
    run: (commandId) => ipcRenderer.invoke('workspaceCommands:run', commandId),
  },
  managedSsh: {
    list: () => ipcRenderer.invoke('managedSsh:list'),
    check: (connectionId) => ipcRenderer.invoke('managedSsh:check', connectionId),
    disconnect: (connectionId) => ipcRenderer.invoke('managedSsh:disconnect', connectionId),
    onStatus: (listener) => {
      const handler = (_event, status) => listener(status)
      ipcRenderer.on('managedSsh:status', handler)
      return () => ipcRenderer.removeListener('managedSsh:status', handler)
    },
  },
  remoteFiles: {
    browse: (connectionId, directoryId) => ipcRenderer.invoke('remoteFiles:browse', connectionId, directoryId),
    downloadAndTrack: (entryId) => ipcRenderer.invoke('remoteFiles:downloadAndTrack', entryId),
    downloadAs: (entryId) => ipcRenderer.invoke('remoteFiles:downloadAs', entryId),
    read: (fileId) => ipcRenderer.invoke('remoteFiles:read', fileId),
    preview: (fileId) => ipcRenderer.invoke('remoteFiles:preview', fileId),
    saveLocal: (fileId, content) => ipcRenderer.invoke('remoteFiles:saveLocal', fileId, content),
    compare: (fileId) => ipcRenderer.invoke('remoteFiles:compare', fileId),
    upload: (fileId, options) => ipcRenderer.invoke('remoteFiles:upload', fileId, options),
    chooseAndUpload: (connectionId, directoryId) => ipcRenderer.invoke('remoteFiles:chooseAndUpload', connectionId, directoryId),
    cancelTransfer: (transferId) => ipcRenderer.invoke('remoteFiles:cancelTransfer', transferId),
    createDirectory: (connectionId, parentId, name) => ipcRenderer.invoke('remoteFiles:createDirectory', connectionId, parentId, name),
    rename: (entryId, name) => ipcRenderer.invoke('remoteFiles:rename', entryId, name),
    remove: (entryId) => ipcRenderer.invoke('remoteFiles:remove', entryId),
    discard: (fileId, options) => ipcRenderer.invoke('remoteFiles:discard', fileId, options),
    listTracked: () => ipcRenderer.invoke('remoteFiles:listTracked'),
    revealLocal: (fileId) => ipcRenderer.invoke('remoteFiles:revealLocal', fileId),
    cleanup: (options) => ipcRenderer.invoke('remoteFiles:cleanup', options),
    onTransfer: (listener) => {
      const handler = (_event, transfer) => listener(transfer)
      ipcRenderer.on('remoteFiles:transfer', handler)
      return () => ipcRenderer.removeListener('remoteFiles:transfer', handler)
    },
  },
  database: {
    listConnections: () => ipcRenderer.invoke('database:listConnections'),
    createConnection: (input) => ipcRenderer.invoke('database:createConnection', input),
    updateConnection: (id, input) => ipcRenderer.invoke('database:updateConnection', id, input),
    deleteConnection: (id) => ipcRenderer.invoke('database:deleteConnection', id),
    execute: (connectionId, sql, options) => ipcRenderer.invoke('database:execute', connectionId, sql, options),
    cancel: (operationId) => ipcRenderer.invoke('database:cancel', operationId),
    begin: (connectionId) => ipcRenderer.invoke('database:begin', connectionId),
    commit: (connectionId) => ipcRenderer.invoke('database:commit', connectionId),
    rollback: (connectionId) => ipcRenderer.invoke('database:rollback', connectionId),
    inspectSchema: (connectionId, options) => ipcRenderer.invoke('database:inspectSchema', connectionId, options),
    tableRows: (connectionId, tableName, options) => ipcRenderer.invoke('database:tableRows', connectionId, tableName, options),
    updateTableRows: (connectionId, tableName, changes) => ipcRenderer.invoke('database:updateTableRows', connectionId, tableName, changes),
    listSavedQueries: (connectionId) => ipcRenderer.invoke('database:listSavedQueries', connectionId),
    saveQuery: (input) => ipcRenderer.invoke('database:saveQuery', input),
    updateSavedQuery: (id, input) => ipcRenderer.invoke('database:updateSavedQuery', id, input),
    deleteSavedQuery: (id) => ipcRenderer.invoke('database:deleteSavedQuery', id),
    listHistory: (connectionId, limit) => ipcRenderer.invoke('database:listHistory', connectionId, limit),
    clearHistory: (connectionId) => ipcRenderer.invoke('database:clearHistory', connectionId),
  },
  shellSessions: {
    list: () => ipcRenderer.invoke('shellSessions:list'),
    resume: (sessionId) => ipcRenderer.invoke('shellSessions:resume', sessionId),
    ready: (sessionId, message) => ipcRenderer.send('shellSessions:ready', sessionId, message),
    ack: (sessionId, message) => ipcRenderer.send('shellSessions:ack', sessionId, message),
    disconnect: (sessionId, message) => ipcRenderer.send('shellSessions:disconnect', sessionId, message),
    create: () => ipcRenderer.invoke('shellSessions:create'),
    focus: (sessionId) => ipcRenderer.invoke('shellSessions:focus', sessionId),
    write: (sessionId, data) => ipcRenderer.send('shellSessions:write', sessionId, data),
    resize: (sessionId, dimensions) => ipcRenderer.send('shellSessions:resize', sessionId, dimensions),
    restart: (sessionId) => ipcRenderer.invoke('shellSessions:restart', sessionId),
    close: (sessionId) => ipcRenderer.invoke('shellSessions:close', sessionId),
    onData: (listener) => {
      const handler = (_event, payload) => listener(payload)
      ipcRenderer.on('shellSessions:data', handler)
      return () => ipcRenderer.removeListener('shellSessions:data', handler)
    },
    onExit: (listener) => {
      const handler = (_event, payload) => listener(payload)
      ipcRenderer.on('shellSessions:exit', handler)
      return () => ipcRenderer.removeListener('shellSessions:exit', handler)
    },
    onError: (listener) => {
      const handler = (_event, payload) => listener(payload)
      ipcRenderer.on('shellSessions:error', handler)
      return () => ipcRenderer.removeListener('shellSessions:error', handler)
    },
  },
  terminal: {
    resume: (request) => ipcRenderer.invoke('terminal:resume', request),
    ready: (message) => ipcRenderer.send('terminal:ready', message),
    ack: (message) => ipcRenderer.send('terminal:ack', message),
    chooseAttachments: () => ipcRenderer.invoke('terminal:chooseAttachments'),
    prepareDroppedAttachments: (files) => ipcRenderer.invoke('terminal:prepareDroppedAttachments', files.map((file) => webUtils.getPathForFile(file))),
    writeKey: (data) => ipcRenderer.send('terminal:key', data),
    writeInput: (data) => ipcRenderer.invoke('terminal:writeInput', data),
    startPaste: (input) => ipcRenderer.invoke('terminal:pasteStart', input),
    writePasteChunk: (input) => ipcRenderer.invoke('terminal:pasteChunk', input),
    cancelPaste: (transferId) => ipcRenderer.invoke('terminal:pasteCancel', transferId),
    reportRendererMetrics: (metrics) => ipcRenderer.send('terminal:rendererMetrics', metrics),
    diagnostics: () => ipcRenderer.invoke('terminal:diagnostics'),
    exportDiagnostics: () => ipcRenderer.invoke('terminal:exportDiagnostics'),
    resize: (dimensions) => ipcRenderer.send('terminal:resize', dimensions),
    onOutput: (listener) => {
      const handler = (_event, block) => listener(block)
      ipcRenderer.on('terminal:output', handler)
      return () => ipcRenderer.removeListener('terminal:output', handler)
    },
    onStreamState: (listener) => {
      const handler = (_event, state) => listener(state)
      ipcRenderer.on('terminal:streamState', handler)
      return () => ipcRenderer.removeListener('terminal:streamState', handler)
    },
    onExit: (listener) => {
      const handler = (_event, status) => listener(status)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    onError: (listener) => {
      const handler = (_event, payload) => listener(payload)
      ipcRenderer.on('terminal:error', handler)
      return () => ipcRenderer.removeListener('terminal:error', handler)
    },
  },
})
