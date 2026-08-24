const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function ipcRegistrationModules() {
  const root = path.join(__dirname, '../electron/ipc')
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(target)
    return entry.name.endsWith('.cjs') ? [target] : []
  })
  return fs.existsSync(root) ? walk(root) : []
}

function declaredIpcInvokeChannels() {
  return ipcRegistrationModules().flatMap((modulePath) => Object.entries(require(modulePath))
    .filter(([name, value]) => name.endsWith('_INVOKE_CHANNELS') && Array.isArray(value))
    .flatMap(([, value]) => value))
}

test('preload espone soltanto le API impostazioni previste', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  assert.match(source, /systemSkills:/)
  assert.match(source, /piSystem:/)
  assert.match(source, /piConfig:/)
  assert.doesNotMatch(source, /node:fs/)
})

test('il bridge benchmark esiste soltanto con flag e accetta due comandi allowlisted', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.match(preload, /benchmarkMode\s*=\s*process\.argv\.includes\('--vincodelab-reliability-benchmark'\)[\s\S]*benchmark: \{[\s\S]{0,160}dispatchCommand: \(command\) => ipcRenderer\.invoke\('benchmark:dispatchCommand', command\)/)
  assert.match(preload, /benchmarkFaultInjectionMode\s*=\s*benchmarkMode\s*&&\s*process\.argv\.includes\('--vincodelab-reliability-fault-injection'\)/)
  assert.match(preload, /screenshotCaptureMode\s*=\s*benchmarkMode\s*&&\s*process\.argv\.includes\('--vincodelab-screenshot-capture'\)/)
  assert.match(preload, /screenshotCaptureMode \? \{[\s\S]{0,180}captureWindowBounds: \(\) => ipcRenderer\.invoke\('benchmark:captureWindowBounds'\)/)
  assert.match(preload, /benchmarkFaultInjectionMode \? \{[\s\S]{0,220}injectFault: \(fault\) => ipcRenderer\.invoke\('benchmark:injectFault', fault\)/)
  assert.match(preload, /shutdown: \(\) => ipcRenderer\.invoke\('benchmark:shutdown'\)/)
  assert.match(main, /additionalArguments: RELIABILITY_BENCHMARK_MODE[\s\S]{0,180}--vincodelab-reliability-benchmark[\s\S]{0,180}--vincodelab-reliability-fault-injection/)
  assert.match(main, /RELIABILITY_BENCHMARK_COMMANDS = new Set\(\['workbench\.commandPalette', 'workbench\.quickOpen'\]\)/)
  assert.match(main, /if \(RELIABILITY_BENCHMARK_MODE\) \{[\s\S]{0,360}ipcMain\.handle\('benchmark:dispatchCommand'[\s\S]{0,220}assertTrustedSender\(event\)/)
  assert.match(main, /RELIABILITY_BENCHMARK_COMMANDS\.has\(command\)[\s\S]{0,140}dispatchApplicationMenuCommand\(command\)/)
  assert.match(main, /ipcMain\.handle\('benchmark:shutdown'[\s\S]{0,180}assertTrustedSender\(event\)[\s\S]{0,260}shutdownApplication\(\)/)
  assert.match(main, /if \(SCREENSHOT_CAPTURE_MODE\) \{[\s\S]{0,180}ipcMain\.handle\('benchmark:captureWindowBounds'[\s\S]{0,160}assertTrustedSender\(event\)/)
  assert.match(main, /if \(RELIABILITY_FAULT_INJECTION_MODE\) \{[\s\S]{0,220}ipcMain\.handle\('benchmark:injectFault'[\s\S]{0,160}assertTrustedSender\(event\)/)
})

test('il Terminale AI separa tasti interattivi, input programmatici con ack e paste controllati', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const aiTerminalIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/ai-terminal.ipc.cjs'), 'utf8')

  assert.match(preload, /writeKey: \(data\) => ipcRenderer\.send\('terminal:key', data\)/)
  assert.match(preload, /writeInput: \(data\) => ipcRenderer\.invoke\('terminal:writeInput', data\)/)
  assert.match(preload, /startPaste: \(input\) => ipcRenderer\.invoke\('terminal:pasteStart', input\)/)
  assert.match(preload, /writePasteChunk: \(input\) => ipcRenderer\.invoke\('terminal:pasteChunk', input\)/)
  assert.match(preload, /cancelPaste: \(transferId\) => ipcRenderer\.invoke\('terminal:pasteCancel', transferId\)/)
  assert.match(aiTerminalIpc, /\['terminal:key'/)
  assert.match(aiTerminalIpc, /\['terminal:writeInput'/)
  assert.match(aiTerminalIpc, /return \{ accepted: true, bytes \}/)
  assert.match(main, /registerAiTerminalIpc\(\{/)
  assert.doesNotMatch(main, /terminal:input|writeTerminalInput/)
})

test('il Terminale AI e piConfig espongono failure one-way classificati', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const aiTerminalIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/ai-terminal.ipc.cjs'), 'utf8')
  const types = fs.readFileSync(path.join(__dirname, '../src/vincode-lab.d.ts'), 'utf8')

  assert.match(preload, /ipcRenderer\.on\('terminal:error'/)
  assert.match(preload, /ipcRenderer\.on\('piConfig:error'/)
  assert.match(types, /writeInput: \(data: string\) => Promise<\{ accepted: true; bytes: number \}>/)
  assert.match(types, /onError: \(listener: \(event: TerminalErrorEvent\)/)
  assert.match(types, /onError: \(listener: \(event: PiConfigErrorEvent\)/)
  assert.match(aiTerminalIpc, /confineIpcOneWay\(channel, listener\)/)
  for (const channel of ['terminal:key', 'terminal:resize', 'piConfig:input', 'piConfig:resize']) {
    assert.match(aiTerminalIpc, new RegExp(`\\['${channel}'`))
  }
})

test('il Terminale AI espone diagnostica numerica senza percorso di esportazione dal renderer', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const aiTerminalIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/ai-terminal.ipc.cjs'), 'utf8')

  assert.match(preload, /reportRendererMetrics: \(metrics\) => ipcRenderer\.send\('terminal:rendererMetrics', metrics\)/)
  assert.match(preload, /diagnostics: \(\) => ipcRenderer\.invoke\('terminal:diagnostics'\)/)
  assert.match(preload, /exportDiagnostics: \(\) => ipcRenderer\.invoke\('terminal:exportDiagnostics'\)/)
  assert.match(aiTerminalIpc, /\['terminal:rendererMetrics'/)
  assert.match(aiTerminalIpc, /\['terminal:diagnostics'/)
  assert.match(aiTerminalIpc, /\['terminal:exportDiagnostics'/)
  assert.doesNotMatch(preload, /exportDiagnostics: \([^)]*filePath/)
})

test('preload espone il menu contestuale senza accettare template o callback dal renderer', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.match(preload, /contextMenu: \{[\s\S]*open: \(request\) => ipcRenderer\.invoke\('contextMenu:open', request\)/)
  assert.doesNotMatch(preload, /buildFromTemplate|Menu\.popup/)
  assert.match(main, /contextMenu:open[\s\S]*request\?\.kind === 'terminal' \? 'terminal' : 'default'/)
})

test('preload espone preferenze tipizzate senza accettare percorsi workspace', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const preferencesIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/preferences.ipc.cjs'), 'utf8')
  const start = source.indexOf('preferences: {')
  const end = source.indexOf('\n  piSystem: {', start)
  const preload = start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : ''
  assert.match(preload, /get: \(\) => ipcRenderer\.invoke\('preferences:get'\)/)
  assert.match(preload, /setGlobal: \(key, value\) => ipcRenderer\.invoke\('preferences:setGlobal', key, value\)/)
  assert.match(preload, /setWorkspace: \(key, value\) => ipcRenderer\.invoke\('preferences:setWorkspace', key, value\)/)
  assert.match(preload, /clearWorkspace: \(key\) => ipcRenderer\.invoke\('preferences:clearWorkspace', key\)/)
  assert.match(preload, /clearAllWorkspace: \(\) => ipcRenderer\.invoke\('preferences:clearAllWorkspace'\)/)
  assert.doesNotMatch(preload, /workspacePath|require\(|node:/)
  for (const channel of ['preferences:get', 'preferences:setGlobal', 'preferences:setWorkspace', 'preferences:clearWorkspace', 'preferences:clearAllWorkspace']) {
    assert.match(preferencesIpc, new RegExp(`\\['${channel}', \\(event[\\s\\S]{0,180}assertTrustedSender\\(event\\)`))
  }
  assert.match(main, /registerPreferencesIpc\(\{[\s\S]{0,500}assertTrustedSender/)
  assert.doesNotMatch(main, /ipcMain\.handle\('preferences:/)
})

test('le bozze volatili usano invoke con ack per rendere osservabili write e discard', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const workspaceStateIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/workspace-state.ipc.cjs'), 'utf8')
  const types = fs.readFileSync(path.join(__dirname, '../src/vincode-lab.d.ts'), 'utf8')

  assert.match(preload, /write: \(draft\) => ipcRenderer\.invoke\('volatileDrafts:write', draft\)/)
  assert.match(preload, /discard: \(identity\) => ipcRenderer\.invoke\('volatileDrafts:discard', identity\)/)
  assert.doesNotMatch(preload, /ipcRenderer\.send\('volatileDrafts:(?:write|discard)'/)
  assert.match(workspaceStateIpc, /\['volatileDrafts:write', \(event, draft\)[\s\S]{0,180}return volatileDrafts\.write\(draft\)/)
  assert.match(workspaceStateIpc, /\['volatileDrafts:discard', \(event, identity\)[\s\S]{0,180}return volatileDrafts\.discard\(identity\)/)
  assert.match(main, /registerWorkspaceStateIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.handle\('volatileDrafts:/)
  assert.match(types, /write: \(draft: RendererDraftSnapshot\) => Promise<\{ stored: boolean \}>/)
  assert.match(types, /discard: \(identity: RendererDraftIdentity\) => Promise<\{ discarded: boolean \}>/)
})

test('preload espone il catalogo read-only delle skill dai pacchetti Pi', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  assert.match(source, /listSkills: \(\) => ipcRenderer\.invoke\('piSystem:listSkills'\)/)
})

test('il renderer ripristina il workspace attivo dopo un rimontaggio', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')

  assert.match(preload, /getActive: \(\) => ipcRenderer\.invoke\('workspace:getActive'\)/)
  assert.match(main, /ipcMain\.handle\('workspace:getActive'/)
  assert.match(main, /return activeWorkspacePath \? \{ path: activeWorkspacePath, error: activeWorkspaceError, errorIncident: activeWorkspaceIncident \} : null/)
  assert.match(app, /appBridge\.workspace\.getActive\(\)\.then\(\(result\) =>/)
  assert.match(app, /handleWorkspaceResult\(result, false\)/)
})

test('Mostra nel Finder attraversa invoke e il menu delega ownership e recovery al renderer', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const types = fs.readFileSync(path.join(__dirname, '../src/vincode-lab.d.ts'), 'utf8')
  const dispatch = main.slice(main.indexOf('function dispatchApplicationMenuCommand'), main.indexOf('function notifyWhenBackground'))
  const listRecent = main.slice(main.indexOf("ipcMain.handle('workspace:listRecent'"), main.indexOf("ipcMain.handle('workspace:reveal'"))

  assert.match(preload, /reveal: \(\) => ipcRenderer\.invoke\('workspace:reveal'\)/)
  assert.match(main, /ipcMain\.handle\('workspace:reveal'[\s\S]{0,260}assertTrustedSender\(event\)[\s\S]{0,260}revealWorkspace\(requireActiveWorkspace\(\)/)
  assert.match(types, /reveal: \(\) => Promise<\{ revealed: true \}>/)
  assert.match(dispatch, /sendToRenderer\('appMenu:command', command\)/)
  assert.doesNotMatch(dispatch, /shell\.openPath|workspace_reveal_failed/)
  assert.match(app, /command === 'workspace\.reveal'[\s\S]{0,100}revealWorkspace\(\)/)
  assert.match(app, /title: 'Workspace non mostrato nel Finder'[\s\S]{0,320}label: 'Riprova'/)
  assert.match(listRecent, /return listRecentWorkspaces\(\)/)
  assert.doesNotMatch(listRecent, /catch|new Error/)
})

test('la sessione workspace usa soltanto il workspace attivo e un sender trusted', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const types = fs.readFileSync(path.join(__dirname, '../src/vincode-lab.d.ts'), 'utf8')
  const workspaceStateIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/workspace-state.ipc.cjs'), 'utf8')
  const start = preloadSource.indexOf('workspaceSession: {')
  const end = preloadSource.indexOf('\n  appearance:', start)
  const workspaceSession = start >= 0 ? preloadSource.slice(start, end >= 0 ? end : undefined) : ''

  assert.match(workspaceSession, /get: \(\) => ipcRenderer\.invoke\('workspaceSession:get'\)/)
  assert.match(workspaceSession, /save: \(snapshot\) => ipcRenderer\.invoke\('workspaceSession:save', snapshot\)/)
  assert.doesNotMatch(workspaceSession, /workspacePath|require\(|node:/)
  assert.match(workspaceStateIpc, /\['workspaceSession:get', \(event\)[\s\S]{0,180}getWorkspaceSession\(requireActiveWorkspace\(\)\)/)
  assert.match(workspaceStateIpc, /\['workspaceSession:save', \(event, snapshot\)[\s\S]{0,180}saveWorkspaceSession\(requireActiveWorkspace\(\), snapshot\)/)
  assert.match(main, /registerWorkspaceStateIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.handle\('workspaceSession:/)
  assert.match(types, /workspaceSession: \{[\s\S]*get: \(\) => Promise<WorkspaceSessionSnapshot>[\s\S]*save: \(snapshot: WorkspaceSessionWriteSnapshot\) => Promise<WorkspaceSessionSnapshot>/)
})

test('preload espone refresh cache-aware senza API Node nel renderer', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  assert.match(source, /gitStatus: \(options\) => ipcRenderer\.invoke\('github:gitStatus', options\)/)
  assert.match(source, /data: \(options\) => ipcRenderer\.invoke\('github:data', options\)/)
  assert.match(source, /projectBoard: \(projectNumber, options\) => ipcRenderer\.invoke\('github:projectBoard', projectNumber, options\)/)
  assert.doesNotMatch(source, /workspace_cache|vincodelab\.sqlite/)
})

test('preload espone il workspace Database senza accesso Node dal renderer', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const databaseIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/database.ipc.cjs'), 'utf8')
  const database = preload.slice(preload.indexOf('database:'), preload.indexOf('\n  shell:'))

  assert.match(database, /database: \{[\s\S]*execute: \(connectionId, sql, options\) => ipcRenderer\.invoke\('database:execute', connectionId, sql, options\)/)
  assert.match(database, /cancel: \(operationId\) => ipcRenderer\.invoke\('database:cancel', operationId\)/)
  assert.match(database, /tableRows: \(connectionId, tableName, options\) => ipcRenderer\.invoke\('database:tableRows', connectionId, tableName, options\)/)
  assert.match(database, /updateTableRows: \(connectionId, tableName, changes\) => ipcRenderer\.invoke\('database:updateTableRows', connectionId, tableName, changes\)/)
  assert.match(database, /updateConnection: \(id, input\) => ipcRenderer\.invoke\('database:updateConnection', id, input\)/)
  assert.match(database, /deleteSavedQuery: \(id\) => ipcRenderer\.invoke\('database:deleteSavedQuery', id\)/)
  assert.match(database, /clearHistory: \(connectionId\) => ipcRenderer\.invoke\('database:clearHistory', connectionId\)/)
  assert.doesNotMatch(database, /require\(|node:|better-sqlite3/)
  assert.match(databaseIpc, /database:updateConnection[\s\S]*closeConnectionSession\(workspacePath, id\)/)
  assert.match(databaseIpc, /database:deleteConnection[\s\S]*closeConnectionSession\(workspacePath, id\)/)
  assert.match(databaseIpc, /\['database:execute'[\s\S]*databaseOperations\.start[\s\S]*event\.sender\.id[\s\S]*signal: operation\.signal/)
  assert.match(databaseIpc, /\['database:cancel'[\s\S]*databaseOperations\.cancel\(operationId, event\.sender\.id\)/)
  assert.match(main, /registerDatabaseIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.handle\('database:/)
})

test('ogni API invoke esposta dal preload ha un handler nel main process', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1])
  const handlers = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)]
    .map((match) => match[1])
    .concat(declaredIpcInvokeChannels())

  assert.equal(new Set(handlers).size, handlers.length, 'ogni canale invoke deve avere un solo proprietario')
  for (const channel of channels) assert.ok(handlers.includes(channel), `handler mancante per ${channel}`)
})

test('preload espone i comandi workspace senza scrivere direttamente nella shell', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const workspaceCommandsIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/workspace-commands.ipc.cjs'), 'utf8')
  const workspaceCommands = preload.slice(preload.indexOf('workspaceCommands:'), preload.indexOf('\n  shell:'))

  assert.match(preload, /workspaceCommands: \{[\s\S]*run: \(commandId\) => ipcRenderer\.invoke\('workspaceCommands:run', commandId\)/)
  assert.doesNotMatch(workspaceCommands, /shell:input/)
  assert.match(workspaceCommandsIpc, /const activeSession = requireRunningShellSession\(workspacePath\)/)
  assert.match(workspaceCommandsIpc, /shellSessionManager\.write\(workspacePath, activeSession\.sessionId/)
  assert.match(workspaceCommandsIpc, /getWorkspaceCommand\(workspacePath, commandId\)/)
  assert.match(main, /registerWorkspaceCommandsIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.handle\('workspaceCommands:/)
})

test('preload espone allegati Pi senza accesso filesystem nel renderer', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const aiTerminalIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/ai-terminal.ipc.cjs'), 'utf8')

  assert.match(preload, /webUtils\.getPathForFile/)
  assert.match(preload, /chooseAttachments: \(\) => ipcRenderer\.invoke\('terminal:chooseAttachments'\)/)
  assert.match(preload, /prepareDroppedAttachments: \(files\) => ipcRenderer\.invoke\('terminal:prepareDroppedAttachments'/)
  assert.doesNotMatch(preload, /node:fs/)
  assert.match(aiTerminalIpc, /\['terminal:chooseAttachments'/)
  assert.match(aiTerminalIpc, /\['terminal:prepareDroppedAttachments'/)
  assert.match(aiTerminalIpc, /prepareTerminalAttachment/)
  assert.match(main, /registerAiTerminalIpc\(\{/)
})

test('preload espone file remoti con ID opachi e handler confinati', () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const managedSshIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/managed-ssh.ipc.cjs'), 'utf8')
  const remoteFilesIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/remote-files.ipc.cjs'), 'utf8')
  const remoteIpc = `${managedSshIpc}\n${remoteFilesIpc}`
  const start = preloadSource.indexOf('managedSsh:')
  const end = preloadSource.indexOf('\n  database:', start)
  const remotePreload = start >= 0 ? preloadSource.slice(start, end >= 0 ? end : undefined) : ''

  assert.match(remotePreload, /managedSsh:[\s\S]*onStatus/)
  assert.match(remotePreload, /remoteFiles:[\s\S]*downloadAndTrack[\s\S]*revealLocal[\s\S]*onTransfer/)
  assert.doesNotMatch(remotePreload, /workspacePath|localPath|node:|require\(/)
  assert.match(main, /function requireManagedConnectionForWorkspace[\s\S]*connection\.workspacePath !== workspacePath/)
  for (const channel of [
    'managedSsh:list', 'managedSsh:check', 'managedSsh:disconnect',
    'remoteFiles:browse', 'remoteFiles:downloadAndTrack', 'remoteFiles:read',
    'remoteFiles:saveLocal', 'remoteFiles:compare', 'remoteFiles:upload', 'remoteFiles:revealLocal',
  ]) assert.match(remoteIpc, new RegExp(`\\['${channel}'[\\s\\S]{0,260}assertTrustedSender`))
  assert.match(main, /registerManagedSshIpc\(\{/)
  assert.match(main, /registerRemoteFilesIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.handle\('(managedSsh|remoteFiles):/)
})
