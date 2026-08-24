const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { readTerminalModule } = require('./helpers/terminal-source.cjs')

const projectRoot = path.join(__dirname, '..')
const terminalWorkspace = fs.readFileSync(path.join(projectRoot, 'src/features/terminal/components/terminal-workspace.tsx'), 'utf8')
const terminalWorkspaceController = readTerminalModule('hooks/use-terminal-workspace-controller.ts')
const terminalWorkspaceCommands = readTerminalModule('model/terminal-workspace.ts')
const freeTerminal = [
  readTerminalModule('components/free-terminal.tsx'),
  readTerminalModule('components/workspace-command-panel.tsx'),
  readTerminalModule('hooks/use-shell-xterm-lifecycle.ts'),
  readTerminalModule('hooks/use-workspace-command-library.ts'),
].join('\n')
const lifecycle = readTerminalModule('hooks/use-shell-xterm-lifecycle.ts')

test('FreeTerminal è un client isolato per sessionId e non crea PTY legacy', () => {
  assert.match(freeTerminal, /sessionId: string/)
  assert.match(lifecycle, /shellSessions\.write\(sessionId, data\)/)
  assert.match(lifecycle, /shellSessions\.resize\(sessionId, nextDimensions\)/)
  assert.match(freeTerminal, /shellSessions\.restart\(sessionId\)/)
  assert.match(lifecycle, /shellSessions\.resume\(sessionId\)/)
  assert.match(lifecycle, /createShellXtermOutputController/)
  assert.match(lifecycle, /shellSessions\.ready\(sessionId, message\)/)
  assert.match(lifecycle, /shellSessions\.ack\(sessionId, message\)/)
  assert.match(lifecycle, /shellSessions\.disconnect\(sessionId, outputConnection\)/)
  assert.match(freeTerminal, /shellSessions\.focus\(sessionId\)/)
  assert.match(lifecycle, /shellSessions\.onData\(\(event\) => \{\s*if \(event\.sessionId !== sessionId\) return/)
  assert.match(lifecycle, /shellSessions\.onExit\(\(event\) => \{\s*if \(event\.sessionId !== sessionId\) return/)
  assert.match(lifecycle, /shellSessions\.onError\(\(event\) => \{\s*if \(event\.sessionId !== sessionId\) return[\s\S]*setTerminalFailure\(terminalFailureFromEvent\(event\)\)/)
  assert.match(freeTerminal, /\{terminalFailure && <ErrorNotice[\s\S]*error=\{terminalFailure\.error\}/)
  assert.match(freeTerminal, /terminalFailure\.recovery === 'resize' \? 'Adatta terminale'/)
  const errorSubscriptionStart = lifecycle.indexOf('shellSessions.onError')
  const errorSubscriptionEnd = lifecycle.indexOf('publishSynchronizeOutput(resume)', errorSubscriptionStart)
  const errorSubscription = lifecycle.slice(errorSubscriptionStart, errorSubscriptionEnd)
  assert.doesNotMatch(errorSubscription, /toast\.|reportUserError/)
  assert.match(freeTerminal, /storageKey=\{`vincodelab\.terminal\.commands-width:\$\{workspace\}`\}/)
  assert.doesNotMatch(freeTerminal, /window\.vincodeLab\.shell\./)
  assert.doesNotMatch(freeTerminal, /shellSessions\.(?:create|list)\(/)
  assert.ok(lifecycle.indexOf('shellSessions.onData') < lifecycle.indexOf('void resume().catch'), 'la subscription live deve precedere la richiesta snapshot')
  assert.doesNotMatch(freeTerminal, /data\.slice\(0, remainingBytes\)/)
  assert.doesNotMatch(freeTerminal, /MAX_PENDING_SHELL_OUTPUT_BYTES|pendingOutput|cancelAnimationFrame\(outputFrame/)
  assert.match(freeTerminal, /snapshot\.truncated/)
})

test('il controller TerminalWorkspace possiede lifecycle, limite e fallback delle sessioni', () => {
  assert.match(terminalWorkspace, /useTerminalWorkspaceController\(/)
  assert.doesNotMatch(terminalWorkspace, /terminalBridge/)
  assert.match(terminalWorkspaceController, /const MAX_TERMINAL_SESSIONS = 8/)
  assert.match(terminalWorkspaceController, /shellSessions\.list\(\)/)
  assert.match(terminalWorkspaceController, /snapshot\.sessions\.length === 0[\s\S]*shellSessions\.create\(\)/)
  assert.match(terminalWorkspaceController, /shellSessions\.focus\(sessionId\)/)
  assert.match(terminalWorkspaceController, /shellSessions\.close\(sessionId\)/)
  assert.match(terminalWorkspaceController, /result\.activeSessionId[\s\S]*mruSessionIds\.current\.find/)
  for (const action of ['focus', 'next', 'previous', 'new', 'close']) {
    assert.match(terminalWorkspaceCommands, new RegExp(`['"]${action}['"]`))
  }
  for (const status of ['starting', 'ready', 'exited', 'error']) {
    assert.match(terminalWorkspace, new RegExp(`['"]${status}['"]`))
  }
})

test('le tab Ark mantengono montati terminali e File remoti non attivi', () => {
  assert.match(terminalWorkspace, /lazyMount=\{false\}[\s\S]{0,80}unmountOnExit=\{false\}/)
  assert.match(terminalWorkspace, /sessions\.map\(\(session\) => \([\s\S]*?<Tabs\.Content[\s\S]*?<FreeTerminal/)
  assert.match(terminalWorkspace, /sessionId=\{session\.sessionId\}/)
  assert.match(terminalWorkspace, /active=\{active && tab === 'shell' && activeSessionId === session\.sessionId\}/)
  assert.match(terminalWorkspace, /<Tabs\.Content value="remote"[^>]*>[\s\S]*?<RemoteFiles/)
  assert.doesNotMatch(terminalWorkspace, /activeSessionId === session\.sessionId\s*&&\s*<FreeTerminal/)
  assert.doesNotMatch(terminalWorkspace, /tab === 'remote'\s*&&\s*<RemoteFiles/)
})
