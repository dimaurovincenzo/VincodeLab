const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  SHELL_SESSIONS_INVOKE_CHANNELS,
  SHELL_SESSIONS_SEND_CHANNELS,
  createShellSessionsHandlers,
  createShellSessionsListeners,
  registerShellSessionsIpc,
} = require('../electron/ipc/domains/shell-sessions.ipc.cjs')

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
const applicationShutdownRuntime = fs.readFileSync(path.join(__dirname, '../electron/app/application-shutdown-runtime.cjs'), 'utf8')
const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
const types = fs.readFileSync(path.join(__dirname, '../src/vincode-lab.d.ts'), 'utf8')

function createHarness(overrides = {}) {
  const calls = []
  const shellSessionManager = {
    ack: (...args) => calls.push(['ack', ...args]),
    close: (...args) => ({ action: 'close', args }),
    create: (...args) => ({ action: 'create', args }),
    disconnect: (...args) => calls.push(['disconnect', ...args]),
    focus: (...args) => ({ action: 'focus', args }),
    list: (...args) => {
      calls.push(['list', ...args])
      return { activeSessionId: 'session-1', sessions: [{ id: 'session-1' }], internal: true }
    },
    rendererReady: (...args) => calls.push(['ready', ...args]),
    resize: (...args) => calls.push(['resize', ...args]),
    restart: (...args) => ({ action: 'restart', args }),
    resume: (...args) => ({ action: 'resume', args }),
    write: (...args) => calls.push(['write', ...args]),
  }
  const dependencies = {
    assertTrustedSender: (event) => calls.push(['guard', event]),
    handleShellSessionOneWay: (event, sessionId, operation, perform) => {
      calls.push(['one-way', event, sessionId, operation])
      return perform()
    },
    requireActiveWorkspace: () => '/workspace',
    shellSessionManager,
    ...overrides,
  }
  return {
    calls,
    dependencies,
    handlers: createShellSessionsHandlers(dependencies),
    listeners: createShellSessionsListeners(dependencies),
  }
}

test('registra manifesti invoke e send senza ownership duplicata', () => {
  const handles = []
  const listeners = []
  const confined = []
  const { dependencies } = createHarness()
  const result = registerShellSessionsIpc({
    ...dependencies,
    confineIpcOneWay: (channel, listener) => {
      confined.push(channel)
      return listener
    },
    ipcMain: {
      handle: (channel, handler) => handles.push([channel, handler]),
      on: (channel, listener) => listeners.push([channel, listener]),
    },
  })

  assert.deepEqual(handles.map(([channel]) => channel), [...SHELL_SESSIONS_INVOKE_CHANNELS])
  assert.deepEqual(listeners.map(([channel]) => channel), [...SHELL_SESSIONS_SEND_CHANNELS])
  assert.deepEqual(confined, [...SHELL_SESSIONS_SEND_CHANNELS])
  assert.deepEqual(result.invokeChannels, SHELL_SESSIONS_INVOKE_CHANNELS)
  assert.deepEqual(result.sendChannels, SHELL_SESSIONS_SEND_CHANNELS)
  assert.equal(Object.isFrozen(result), true)
})

test('gli invoke verificano il sender e conservano workspace, argomenti e risultati', () => {
  const { calls, handlers } = createHarness()
  const event = { sender: { id: 7 } }

  assert.deepEqual(handlers.get('shellSessions:list')(event), {
    activeSessionId: 'session-1',
    sessions: [{ id: 'session-1' }],
  })
  assert.deepEqual(handlers.get('shellSessions:resume')(event, 'session-2'), { action: 'resume', args: ['/workspace', 'session-2'] })
  assert.deepEqual(handlers.get('shellSessions:create')(event), { action: 'create', args: ['/workspace'] })
  assert.deepEqual(handlers.get('shellSessions:focus')(event, 'session-2'), { action: 'focus', args: ['/workspace', 'session-2'] })
  assert.deepEqual(handlers.get('shellSessions:restart')(event, 'session-2'), { action: 'restart', args: ['/workspace', 'session-2'] })
  assert.deepEqual(handlers.get('shellSessions:close')(event, 'session-2'), { action: 'close', args: ['/workspace', 'session-2'] })
  assert.equal(calls.filter(([type]) => type === 'guard').length, 6)
})

test('i listener one-way restano confinati e inoltrano solo la sessione richiesta', () => {
  const { calls, listeners } = createHarness()
  const event = { sender: { id: 7 } }
  const message = { generation: 3 }
  const dimensions = { cols: 120, rows: 40 }

  listeners.get('shellSessions:ready')(event, 'session-1', message)
  listeners.get('shellSessions:ack')(event, 'session-1', message)
  listeners.get('shellSessions:disconnect')(event, 'session-1', message)
  listeners.get('shellSessions:write')(event, 'session-1', 'pwd\r')
  listeners.get('shellSessions:resize')(event, 'session-1', dimensions)

  assert.deepEqual(calls.filter(([type]) => type === 'one-way').map((entry) => entry.slice(2)), [
    ['session-1', 'ready'],
    ['session-1', 'ack'],
    ['session-1', 'disconnect'],
    ['session-1', 'write'],
    ['session-1', 'resize'],
  ])
  assert.deepEqual(calls.find(([type]) => type === 'ready'), ['ready', '/workspace', 'session-1', message])
  assert.deepEqual(calls.find(([type]) => type === 'ack'), ['ack', '/workspace', 'session-1', message])
  assert.deepEqual(calls.find(([type]) => type === 'disconnect'), ['disconnect', '/workspace', 'session-1', message])
  assert.deepEqual(calls.find(([type]) => type === 'write'), ['write', '/workspace', 'session-1', 'pwd\r'])
  assert.deepEqual(calls.find(([type]) => type === 'resize'), ['resize', '/workspace', 'session-1', dimensions])
})

test('un sender rifiutato non raggiunge manager o confine operativo', () => {
  const rejection = new Error('sender rifiutato')
  const { calls, handlers, listeners } = createHarness({ assertTrustedSender: () => { throw rejection } })

  assert.throws(() => handlers.get('shellSessions:list')({ sender: { id: 7 } }), (error) => error === rejection)
  assert.throws(
    () => listeners.get('shellSessions:write')({ sender: { id: 7 } }, 'session-1', 'pwd\r'),
    (error) => error === rejection,
  )
  assert.equal(calls.some(([type]) => type === 'list' || type === 'one-way' || type === 'write'), false)
})

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

test('main registra il dominio sessioni una volta e conserva il confine one-way', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '../electron/domains/shell/shell-session-runtime.cjs'), 'utf8')
  assert.match(main, /registerShellSessionsIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.(?:handle|on)\('shellSessions:/)
  assert.match(main, /const handleShellSessionOneWay = shellSessionRuntime\.handleOneWay/)
  assert.match(runtime, /function handleOneWay\(event, sessionId, operation, perform\)/)
  assert.match(runtime, /reportShellSessionOneWayFailure\(\{[\s\S]*sessionId,[\s\S]*send:/)
  assert.doesNotMatch(main, /shell_session_(?:ready|ack|disconnect|input|resize)_rejected/)
})

test('ogni chunk terminale attraversa un solo canale IPC tipizzato', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '../electron/domains/shell/shell-session-runtime.cjs'), 'utf8')
  assert.match(runtime, /sendToRenderer\('shellSessions:data', \{[\s\S]*sessionId: event\.sessionId,[\s\S]*attachmentId: event\.attachmentId,[\s\S]*generation: event\.generation,[\s\S]*sequence: event\.sequence,[\s\S]*data: event\.data/)
  assert.match(runtime, /sendToRenderer\('shellSessions:exit', \{/)
  assert.doesNotMatch(main, /let shellProcess|let shellWorkspacePath/)
  assert.doesNotMatch(main, /['"]shell:(?:start|restart|input|resize|data|exit)['"]/)
  assert.doesNotMatch(preload, /\bshell: \{/)
  assert.doesNotMatch(types, /\n\s*shell: \{/)
})

test('il cambio workspace chiude tutte le sessioni del workspace precedente', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '../electron/domains/shell/shell-session-runtime.cjs'), 'utf8')
  const remoteRuntime = fs.readFileSync(path.join(__dirname, '../electron/domains/remote/remote-runtime.cjs'), 'utf8')
  const workspaceCleanup = fs.readFileSync(path.join(__dirname, '../electron/domains/workspace/workspace-runtime-cleanup.cjs'), 'utf8')
  const workspaceOpener = fs.readFileSync(path.join(__dirname, '../electron/domains/workspace/workspace-opener.cjs'), 'utf8')
  assert.match(workspaceOpener, /previousWorkspacePath !== normalizedWorkspacePath[\s\S]*await cleanupWorkspaceRuntime\(previousWorkspacePath, 'workspace-change'\)/)
  assert.match(workspaceCleanup, /cleanupWorkspaceRuntime\(workspacePath, reason\)[\s\S]*remoteRuntime\.closeWorkspace\(workspacePath, withCleanupDeadline\)[\s\S]*await closeShellSessions\(workspacePath\)/)
  assert.match(remoteRuntime, /remoteFileService\.closeWorkspace\(workspacePath\)[\s\S]*managedSsh\.closeWorkspace\(workspacePath\)/)
  assert.match(main, /const closeShellSessions = shellSessionRuntime\.closeSessions/)
  assert.match(runtime, /async function closeSessions\(workspacePath = getActiveWorkspacePath\(\)\)[\s\S]*await manager\.closeAll\(workspacePath\)/)
  assert.match(applicationShutdownRuntime, /async function shutdownApplication\(\)[\s\S]*await shellSessionManager\.dispose\(\)/)
})
