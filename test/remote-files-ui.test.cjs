const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.join(__dirname, '..')

test('il terminale separa shell e file remoti senza smontare le viste', () => {
  const workspace = fs.readFileSync(path.join(projectRoot, 'src/components/terminal-workspace.tsx'), 'utf8')

  assert.match(workspace, /import \{[^}]*\bTabs\b[^}]*\} from '@\/components\/ui'/)
  assert.match(workspace, /<Tabs\.Root[^>]*value=\{tab\}[^>]*onValueChange=/)
  assert.match(workspace, /<Tabs\.List[^>]*aria-label="Strumenti terminale"/)
  assert.match(workspace, /<Tabs\.Trigger value="shell">[^]*Terminali<\/Tabs\.Trigger>/)
  assert.match(workspace, /<Tabs\.Trigger value="remote">[^]*File remoti<\/Tabs\.Trigger>/)
  assert.match(workspace, /<Tabs\.Indicator\s*\/>/)
  assert.match(workspace, /<Tabs\.Content value="shell"[^>]*>[\s\S]*?<FreeTerminal/)
  assert.match(workspace, /<Tabs\.Content value="remote"[^>]*>[\s\S]*?<RemoteFiles/)
  assert.match(workspace, /<FreeTerminal[^]*active=\{active && tab === 'shell' && activeSessionId === session\.sessionId\}/)
  assert.match(workspace, /<RemoteFiles[^]*active=\{active && tab === 'remote'\}/)
  assert.doesNotMatch(workspace, /tab === 'shell'\s*&&\s*<FreeTerminal/)
  assert.doesNotMatch(workspace, /tab === 'remote'\s*&&\s*<RemoteFiles/)
  assert.doesNotMatch(workspace, /role="(?:tablist|tab)"|aria-controls="terminal-panel-/)
})

test('il form dei comandi distingue shell e connessioni SSH gestite', () => {
  const freeTerminal = fs.readFileSync(path.join(projectRoot, 'src/components/free-terminal.tsx'), 'utf8')

  assert.match(freeTerminal, /commandKind/)
  assert.match(freeTerminal, /sshDestination/)
  assert.match(freeTerminal, /remoteRoot/)
  assert.match(freeTerminal, /Connessione SSH/)
  assert.match(freeTerminal, /onManagedConnection/)
  assert.match(freeTerminal, /managedConnectionId/)
})

test('File remoti espone profili SSH salvati e guida creazione e connessione', () => {
  const workspace = fs.readFileSync(path.join(projectRoot, 'src/components/terminal-workspace.tsx'), 'utf8')
  const remoteFiles = fs.readFileSync(path.join(projectRoot, 'src/components/remote-files.tsx'), 'utf8')
  const freeTerminal = fs.readFileSync(path.join(projectRoot, 'src/components/free-terminal.tsx'), 'utf8')

  assert.match(remoteFiles, /remoteFilesBridge\.workspaceCommands\.list\(\)/)
  assert.match(remoteFiles, /command\.kind === 'ssh'/)
  assert.match(remoteFiles, /Nuovo profilo SSH/)
  assert.match(remoteFiles, /Connetti/)
  assert.match(remoteFiles, /onCreateSshProfile/)
  assert.match(remoteFiles, /onConnectProfile/)
  assert.match(workspace, /profileComposerRequest/)
  assert.match(workspace, /onCreateSshProfile=/)
  assert.match(workspace, /onConnectProfile=/)
  assert.match(freeTerminal, /profileComposerRequest/)
  assert.match(freeTerminal, /openNewCommand\('ssh'\)/)
})

test('le tab e la toolbar dei file remoti restano coerenti e contenute', () => {
  const viewStyles = fs.readFileSync(path.join(projectRoot, 'src/styles/views/terminal.css'), 'utf8')
  const remoteStyles = fs.readFileSync(path.join(projectRoot, 'src/theme/styles/remote.ts'), 'utf8')
  const terminalStyles = fs.readFileSync(path.join(projectRoot, 'src/theme/styles/terminal.ts'), 'utf8')
  const recipes = fs.readFileSync(path.join(projectRoot, 'src/theme/recipes.ts'), 'utf8')
  const terminalWorkspace = fs.readFileSync(path.join(projectRoot, 'src/components/terminal-workspace.tsx'), 'utf8')
  const remoteFiles = fs.readFileSync(path.join(projectRoot, 'src/components/remote-files.tsx'), 'utf8')

  assert.match(terminalWorkspace, /<Tabs\.List className=\{terminalStyles\.secondaryTabs\}/)
  assert.match(terminalWorkspace, /<Tabs\.Indicator\s*\/>/)
  assert.match(remoteFiles, /<Tabs\.List className=\{remoteStyles\.viewTabs\}/)
  assert.match(remoteFiles, /<Tabs\.Indicator\s*\/>/)
  assert.match(recipes, /_selected:\s*\{[^}]*bg:\s*'accentSubtle'/)
  assert.doesNotMatch(viewStyles, /ui-tablist|remote-view-tab-active/)
  assert.match(remoteStyles, /toolbarActions:\s*css\(\{[^}]*minW:\s*'0'/)
  assert.match(remoteFiles, /className=\{remoteStyles\.toolbarActions\}/)
  assert.match(terminalStyles, /secondaryTabs:\s*css\(\{/)
  assert.doesNotMatch(viewStyles, /\.remote-|\[data-slot=/)
})

test('App usa il workspace Terminale persistente', () => {
  const app = fs.readFileSync(path.join(projectRoot, 'src/App.tsx'), 'utf8')

  assert.match(app, /TerminalWorkspace/)
  assert.match(app, /<TerminalWorkspace\b[^>]*active=\{appSection === 'terminal'\}/)
  assert.doesNotMatch(app, /<FreeTerminal active=\{appSection === 'terminal'\}/)
})

test('l Explorer remoto gestisce resize, caricamento, vuoto e trasferimenti', () => {
  const remoteFiles = fs.readFileSync(path.join(projectRoot, 'src/components/remote-files.tsx'), 'utf8')

  assert.match(remoteFiles, /<Splitter\.Root[^>]*storageKey=\{`vincodelab\.remote\.connection-width:\$\{workspace\}`\}/)
  assert.match(remoteFiles, /<Splitter\.ResizeTrigger aria-label="Ridimensiona Explorer remoto"/)
  assert.doesNotMatch(remoteFiles, /useResizablePanel|role="separator"|onPointerDown=/)
  assert.match(remoteFiles, /Caricamento file remoti/)
  assert.match(remoteFiles, /Nessun file nella cartella/)
  assert.match(remoteFiles, /Trasferimenti/)
  assert.match(remoteFiles, /remoteFilesBridge\.managedSsh\.list/)
  assert.match(remoteFiles, /remoteFilesBridge\.remoteFiles\.browse/)
  assert.match(remoteFiles, /onOpenRemoteFile/)
  assert.match(remoteFiles, /aria-label="Ridimensiona Explorer remoto"/)
  assert.match(remoteFiles, /contextMenu\.onAction/)
})

test('Riprova un transfer fallito riesegue una sola volta la stessa operazione remota', () => {
  const remoteFiles = fs.readFileSync(path.join(projectRoot, 'src/components/remote-files.tsx'), 'utf8')
  const retryController = fs.readFileSync(path.join(projectRoot, 'src/lib/remote-transfer-retry.ts'), 'utf8')

  assert.match(remoteFiles, /createRemoteTransferRetryController/)
  assert.match(remoteFiles, /retryController\.run\(\{/)
  assert.match(remoteFiles, /retryController\.observe\(transfer\)/)
  assert.match(remoteFiles, /retryController\.retry\(transferId\)/)
  assert.match(remoteFiles, /onClick=\{\(\) => void retryTransfer\(transfer\.id\)\}/)
  assert.match(remoteFiles, /aria-label=\{`Riprova trasferimento \$\{transfer\.name\}`\}/)
  assert.doesNotMatch(remoteFiles, /transfer\.state === 'error'[^\n]*setRefreshToken/)
  assert.match(retryController, /retryableByTransferId\.delete\(candidateId\)/)
  assert.match(retryController, /await run\(operation\)/)
})

test('l Explorer remoto gestisce copie locali, spazio cache e pulizia selettiva', () => {
  const remoteFiles = fs.readFileSync(path.join(projectRoot, 'src/components/remote-files.tsx'), 'utf8')

  assert.match(remoteFiles, /Copie locali/)
  assert.match(remoteFiles, /remoteFilesBridge\.remoteFiles\.listTracked/)
  assert.match(remoteFiles, /remoteFilesBridge\.remoteFiles\.revealLocal/)
  assert.match(remoteFiles, /remoteFilesBridge\.remoteFiles\.discard/)
  assert.match(remoteFiles, /remoteFilesBridge\.remoteFiles\.cleanup/)
  assert.match(remoteFiles, /Pulisci sincronizzati/)
  assert.match(remoteFiles, /cacheSize/)
})
