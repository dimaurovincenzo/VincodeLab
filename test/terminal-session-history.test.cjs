const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('il terminale ripristina l’output Pi già prodotto dopo il rimontaggio della vista', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')

  assert.match(main, /createTerminalStreamController/)
  assert.match(main, /ipcMain\.handle\('terminal:resume'/)
  assert.match(preload, /resume: \(request\) => ipcRenderer\.invoke\('terminal:resume', request\)/)
  assert.match(app, /appBridge\.terminal\.resume/)
  assert.doesNotMatch(app, /window\.vincodeLab/)
  assert.match(app, /snapshot/)
})

test('la finestra iniziale usa l’area di lavoro disponibile', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.match(main, /const window = mainWindow/)
  assert.match(main, /window\.once\('ready-to-show', \(\) => window\.maximize\(\)\)/)
  assert.doesNotMatch(main, /mainWindow\.once\('ready-to-show'/)
})

test('il listener della console Electron usa la firma corrente senza registrare il messaggio renderer grezzo', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const listenerStart = main.indexOf("window.webContents.on('console-message'")
  const listenerEnd = main.indexOf("\n  window.on('close'", listenerStart)
  const listener = main.slice(listenerStart, listenerEnd)

  assert.ok(listenerStart >= 0 && listenerEnd > listenerStart)
  assert.match(listener, /console-message', \(details\) => \{/)
  assert.match(listener, /if \(details\.level < 2\) return/)
  assert.match(listener, /const diagnostic = parseRendererDiagnosticMessage\(details\.message\)/)
  assert.match(listener, /if \(diagnostic\) log\(diagnostic\.level \?\? 'error', diagnostic\.event, \{ \.\.\.diagnostic\.fields, line: details\.lineNumber \}\)/)
  assert.match(listener, /else log\('error', 'renderer_console_error', \{ line: details\.lineNumber \}\)/)
  assert.doesNotMatch(listener, /message:\s*details\.message|sourceId/)
})

test('il riavvio usa soltanto la sessione selezionata senza un secondo bridge IPC', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const component = fs.readFileSync(path.join(__dirname, '../src/features/terminal/components/free-terminal.tsx'), 'utf8')

  assert.match(main, /createShellSessionManager/)
  assert.doesNotMatch(main, /let shellProcess|let shellWorkspacePath/)
  assert.doesNotMatch(main, /['"]shell:restart['"]/)
  assert.doesNotMatch(preload, /['"]shell:restart['"]/)
  assert.match(component, /await terminalBridge\.shellSessions\.restart\(sessionId\)/)
  assert.doesNotMatch(component, /window\.vincodeLab\.shell\./)
  assert.doesNotMatch(component, /restartKey/)
})
