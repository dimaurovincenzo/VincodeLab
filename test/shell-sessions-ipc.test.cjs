const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
const types = fs.readFileSync(path.join(__dirname, '../src/vincode-lab.d.ts'), 'utf8')

function registrationBlock(source, kind, channel) {
  const marker = `ipcMain.${kind}('${channel}'`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `registrazione ${channel} assente`)
  const next = source.indexOf('\n  ipcMain.', start + marker.length)
  return source.slice(start, next === -1 ? undefined : next)
}

test('il preload espone sessioni tipizzate senza accettare un workspace path', () => {
  const start = preload.indexOf('shellSessions: {')
  const end = preload.indexOf('\n  terminal:', start)
  const surface = preload.slice(start, end)

  assert.notEqual(start, -1)
  for (const channel of ['list', 'resume', 'ready', 'ack', 'disconnect', 'create', 'focus', 'write', 'resize', 'restart', 'close', 'onError']) {
    assert.match(surface, new RegExp(`${channel}:`), `${channel} assente dalla surface`)
  }
  assert.match(surface, /ipcRenderer\.on\('shellSessions:data'/)
  assert.match(surface, /ipcRenderer\.on\('shellSessions:exit'/)
  assert.match(surface, /ipcRenderer\.on\('shellSessions:error'/)
  assert.doesNotMatch(surface, /workspacePath|node:|require\(/)
  assert.match(types, /shellSessions: \{[\s\S]*list: \(\) => Promise<ShellSessionList>[\s\S]*create: \(\) => Promise<ShellSessionMetadata>/)
  assert.match(types, /resume: \(sessionId: string\) => Promise<ShellSessionResumeSnapshot>/)
  assert.match(types, /interface ShellSessionDataEvent \{[\s\S]*attachmentId: string[\s\S]*generation: number[\s\S]*sequence: number/)
  assert.match(types, /interface ShellSessionResumeSnapshot \{[\s\S]*attachmentId: string[\s\S]*watermark: number[\s\S]*truncated: boolean/)
  assert.match(types, /ready: \(sessionId: string, message: ShellSessionRendererReady\) => void/)
  assert.match(types, /ack: \(sessionId: string, message: ShellSessionOutputAck\) => void/)
  assert.match(types, /disconnect: \(sessionId: string, message: \{ attachmentId: string; generation: number \}\) => void/)
  assert.match(types, /onData: \(listener: \(event: ShellSessionDataEvent\)/)
  assert.match(types, /onExit: \(listener: \(event: ShellSessionExitEvent\)/)
  assert.match(types, /interface ShellSessionErrorEvent \{[\s\S]*sessionId: string[\s\S]*operation: ShellSessionOneWayOperation[\s\S]*correlationId: string[\s\S]*message: string/)
  assert.match(types, /onError: \(listener: \(event: ShellSessionErrorEvent\)/)
})

test('ogni operazione multi-terminale è trusted e deriva il workspace nel main process', () => {
  for (const channel of ['shellSessions:list', 'shellSessions:resume', 'shellSessions:create', 'shellSessions:focus', 'shellSessions:restart', 'shellSessions:close']) {
    const block = registrationBlock(main, 'handle', channel)
    assert.match(block, /assertTrustedSender\(event\)/)
    assert.match(block, /requireActiveWorkspace\(\)/)
  }
  for (const channel of ['shellSessions:ready', 'shellSessions:ack', 'shellSessions:disconnect', 'shellSessions:write', 'shellSessions:resize']) {
    const block = registrationBlock(main, 'on', channel)
    assert.match(block, /assertTrustedSender\(event\)/)
    assert.match(block, /requireActiveWorkspace\(\)/)
    assert.match(block, /handleShellSessionOneWay\(event, sessionId/)
  }
  assert.doesNotMatch(main, /shell_session_(?:ready|ack|disconnect|input|resize)_rejected/)
})

test('ogni chunk terminale attraversa un solo canale IPC tipizzato', () => {
  assert.match(main, /sendToRenderer\('shellSessions:data', \{[\s\S]*sessionId: event\.sessionId,[\s\S]*attachmentId: event\.attachmentId,[\s\S]*generation: event\.generation,[\s\S]*sequence: event\.sequence,[\s\S]*data: event\.data/)
  assert.match(main, /sendToRenderer\('shellSessions:exit', payload\)/)
  assert.match(main, /reportShellSessionOneWayFailure\(\{[\s\S]*sessionId,[\s\S]*send:/)
  assert.doesNotMatch(main, /let shellProcess|let shellWorkspacePath/)
  assert.doesNotMatch(main, /['"]shell:(?:start|restart|input|resize|data|exit)['"]/)
  assert.doesNotMatch(preload, /\bshell: \{/)
  assert.doesNotMatch(types, /\n\s*shell: \{/)
})

test('il cambio workspace chiude tutte le sessioni del workspace precedente', () => {
  assert.match(main, /previousWorkspacePath !== normalizedWorkspacePath[\s\S]*await cleanupWorkspaceRuntime\(previousWorkspacePath, 'workspace-change'\)/)
  assert.match(main, /async function cleanupWorkspaceRuntime\(workspacePath, reason\)[\s\S]*remoteFileService\.closeWorkspace\(workspacePath\)[\s\S]*managedSsh\.closeWorkspace\(workspacePath\)[\s\S]*await closeShellSessions\(workspacePath\)/)
  assert.match(main, /async function closeShellSessions\(workspacePath = activeWorkspacePath\)[\s\S]*await shellSessionManager\.closeAll\(workspacePath\)/)
  assert.match(main, /async function shutdownApplication\(\)[\s\S]*await shellSessionManager\.dispose\(\)/)
})
