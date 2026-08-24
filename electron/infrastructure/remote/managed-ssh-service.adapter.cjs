const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { getApplicationErrorLogMetadata, toApplicationError } = require('../../domains/errors/application-error.cjs')
const {
  assertManagedSshWorkspacePath,
  parseManagedSshCommand,
  publicConnection,
  quoteShellArg,
} = require('../../domains/remote/managed-ssh-model.cjs')
const { createManagedSshControlLifecycle } = require('./managed-ssh-control-lifecycle.cjs')

const SSH_CANDIDATES = ['/usr/bin/ssh', '/opt/homebrew/bin/ssh', '/usr/local/bin/ssh']
const SFTP_CANDIDATES = ['/usr/bin/sftp', '/opt/homebrew/bin/sftp', '/usr/local/bin/sftp']

function resolveExecutable(candidates, accessSync) {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Ogni candidato è opzionale: il failure diventa rilevante soltanto se nessun
      // eseguibile OpenSSH supportato è disponibile, caso gestito dopo il ciclo.
    }
  }
  throw new Error('OpenSSH non è disponibile nel sistema.')
}

function createManagedSshService({
  spawn = childProcess.spawn,
  accessSync = fs.accessSync,
  tempRoot,
  sendStatus = () => undefined,
  log = () => undefined,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  controlTimeoutMs = 5_000,
  killGraceMs = 250,
  removeSync = fs.rmSync,
}) {
  if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot)) throw new Error('Directory temporanea SSH non valida.')
  if (!Number.isInteger(controlTimeoutMs) || controlTimeoutMs < 1 || controlTimeoutMs > 60_000) throw new Error('Timeout controllo SSH non valido.')
  if (!Number.isInteger(killGraceMs) || killGraceMs < 0 || killGraceMs > 5_000) throw new Error('Timeout arresto SSH non valido.')
  if (typeof removeSync !== 'function') throw new Error('Cleanup SSH non valido.')
  const sshPath = resolveExecutable(SSH_CANDIDATES, accessSync)
  const sftpPath = resolveExecutable(SFTP_CANDIDATES, accessSync)
  const root = path.join(tempRoot, `vl-${process.getuid?.() ?? 'user'}`, 'ssh')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  fs.chmodSync(root, 0o700)
  const connections = new Map()
  const closingWorkspaces = new Set()
  let closingAll = false

  const { runControl } = createManagedSshControlLifecycle({
    spawn,
    log,
    setTimer,
    clearTimer,
    controlTimeoutMs,
    killGraceMs,
  })
  function requireConnection(connectionId) {
    const connection = connections.get(connectionId)
    if (!connection) throw new Error('Connessione SSH non trovata.')
    return connection
  }

  function publish(connection) {
    const value = publicConnection(connection)
    sendStatus(value)
    return value
  }

  function cleanupSocketDirectory(connection) {
    const socketDirectory = path.dirname(connection.socketPath)
    if (path.dirname(socketDirectory) !== root) {
      log('warn', 'managed_ssh_socket_cleanup_rejected', { connectionId: connection.id })
      return
    }
    try {
      removeSync(socketDirectory, { recursive: true, force: true })
    } catch (error) {
      const incident = toApplicationError(error, {
        category: 'filesystem',
        code: 'SSH_SOCKET_CLEANUP_FAILED',
        domain: 'remote',
        message: 'I dati temporanei della connessione SSH non sono stati rimossi completamente.',
        operation: 'cleanup-ssh-socket',
        severity: 'warning',
      })
      log('warn', 'managed_ssh_socket_cleanup_failed', {
        connectionId: connection.id,
        ...getApplicationErrorLogMetadata(incident),
      })
    }
  }

  function pruneDisconnectedConnections(workspacePath, commandId) {
    const matching = [...connections.values()].filter((connection) => connection.workspacePath === workspacePath && connection.commandId === commandId)
    const hasLiveConnection = matching.some((connection) => connection.state !== 'disconnected')
    const completed = matching.filter((connection) => connection.state === 'disconnected' && !connection.disconnectPromise)
    const retainedId = hasLiveConnection ? undefined : completed.at(-1)?.id
    for (const connection of completed) {
      if (connection.id === retainedId) continue
      cleanupSocketDirectory(connection)
      connections.delete(connection.id)
    }
  }

  function replaceConnectionGeneration(connection) {
    connection.controller?.abort()
    connection.generation += 1
    connection.controller = new AbortController()
    return { generation: connection.generation, signal: connection.controller.signal }
  }

  function cancelConnectionGeneration(connection) {
    connection.controller?.abort()
    connection.generation += 1
    connection.controller = undefined
    return connection.generation
  }

  function isCurrentGeneration(connection, generation, signal) {
    return connection.generation === generation && !signal.aborted
  }

  function transition(connection, state, generation, error) {
    if (connection.generation !== generation || connection.state === 'disconnected') return false
    const allowed = connection.state === 'connecting'
      ? new Set(['connected', 'error', 'disconnected'])
      : connection.state === 'connected' || connection.state === 'error'
        ? new Set(['error', 'disconnected'])
        : new Set()
    if (connection.state !== state && !allowed.has(state)) return false
    if (connection.state === state && connection.error === error) return true
    connection.state = state
    connection.error = error
    publish(connection)
    return true
  }

  function waitForDelay(milliseconds, signal) {
    if (signal.aborted) return Promise.resolve(false)
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (value, error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(value)
      }
      const onAbort = () => finish(false)
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve()
        .then(() => delay(milliseconds, signal))
        .then(() => finish(true), (error) => finish(false, error))
    })
  }

  function buildTerminalCommand(workspacePath, command) {
    workspacePath = assertManagedSshWorkspacePath(workspacePath)
    if (closingAll || closingWorkspaces.has(workspacePath)) throw new Error('Le connessioni SSH del workspace sono in chiusura.')
    const { destination, remoteRoot } = parseManagedSshCommand(command)
    const id = crypto.randomUUID()
    const socketDirectory = path.join(root, crypto.createHash('sha256').update(`${workspacePath}\0${id}`).digest('hex').slice(0, 12))
    fs.mkdirSync(socketDirectory, { recursive: true, mode: 0o700 })
    fs.chmodSync(socketDirectory, 0o700)
    const socketPath = path.join(socketDirectory, 's')
    if (Buffer.byteLength(socketPath) >= 100) {
      removeSync(socketDirectory, { recursive: true, force: true })
      throw new Error('Il percorso del socket SSH è troppo lungo.')
    }
    const connection = {
      id,
      commandId: command.id,
      workspacePath,
      title: command.title,
      destination,
      remoteRoot,
      socketPath,
      sshPath,
      sftpPath,
      state: 'connecting',
      error: undefined,
      generation: 1,
      controller: new AbortController(),
      controls: new Set(),
      disconnectPromise: undefined,
    }
    connections.set(id, connection)
    pruneDisconnectedConnections(workspacePath, command.id)
    publish(connection)
    const terminalCommand = [
      quoteShellArg(sshPath),
      '-o', quoteShellArg('ControlMaster=auto'),
      '-o', quoteShellArg('ControlPersist=10m'),
      '-o', quoteShellArg(`ControlPath=${socketPath}`),
      '--', quoteShellArg(destination),
    ].join(' ')
    return { command: terminalCommand, socketPath, connection: publicConnection(connection) }
  }

  async function checkGeneration(connection, generation, signal, timeoutMs = controlTimeoutMs) {
    if (!isCurrentGeneration(connection, generation, signal) || !['connecting', 'connected'].includes(connection.state)) return false
    const result = await runControl(connection, 'check', { signal, timeoutMs })
    if (!result.ok || !isCurrentGeneration(connection, generation, signal) || !['connecting', 'connected'].includes(connection.state)) return false
    if (connection.state === 'connecting') transition(connection, 'connected', generation, undefined)
    return connection.state === 'connected'
  }

  async function check(connectionId) {
    const connection = requireConnection(connectionId)
    if (!connection.controller || !['connecting', 'connected'].includes(connection.state)) return false
    return checkGeneration(connection, connection.generation, connection.controller.signal)
  }

  async function waitUntilConnected(connectionId, { timeoutMs = 120_000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) throw new Error('Timeout SSH non valido.')
    const connection = requireConnection(connectionId)
    if (connection.state === 'connected') return true
    if (connection.state !== 'connecting') return false
    const { generation, signal } = replaceConnectionGeneration(connection)
    const deadline = now() + timeoutMs
    let firstAttempt = true
    while (isCurrentGeneration(connection, generation, signal) && connection.state === 'connecting') {
      const remaining = Math.max(0, deadline - now())
      if (!firstAttempt && remaining === 0) break
      firstAttempt = false
      if (await checkGeneration(connection, generation, signal, Math.max(1, Math.min(controlTimeoutMs, remaining || 1)))) return true
      if (!isCurrentGeneration(connection, generation, signal) || connection.state !== 'connecting') return false
      const nextRemaining = Math.max(0, deadline - now())
      if (nextRemaining === 0) break
      if (!await waitForDelay(Math.min(500, nextRemaining), signal)) return false
    }
    if (!isCurrentGeneration(connection, generation, signal) || connection.state !== 'connecting') return false
    const error = 'Connessione SSH non disponibile entro il tempo previsto.'
    if (transition(connection, 'error', generation, error)) {
      connection.controller?.abort()
      log('warn', 'managed_ssh_connection_timeout', { connectionId })
    }
    return false
  }

  function get(connectionId) {
    return requireConnection(connectionId)
  }

  function list(workspacePath) {
    return [...connections.values()].filter((connection) => connection.workspacePath === workspacePath).map(publicConnection)
  }

  async function disconnect(connectionId) {
    const connection = requireConnection(connectionId)
    if (connection.disconnectPromise) return connection.disconnectPromise
    if (connection.state === 'disconnected') {
      cleanupSocketDirectory(connection)
      return true
    }
    const activeControls = [...connection.controls]
    const generation = cancelConnectionGeneration(connection)
    const disconnectPromise = (async () => {
      const result = await runControl(connection, 'exit')
      await Promise.allSettled(activeControls)
      if (!result.ok) {
        const error = 'Chiusura della connessione SSH non confermata. Riprova prima di chiudere il workspace.'
        transition(connection, 'error', generation, error)
        log('warn', 'managed_ssh_disconnect_failed', { connectionId: connection.id, operation: 'exit', reason: result.reason })
        return false
      }
      transition(connection, 'disconnected', generation, undefined)
      cleanupSocketDirectory(connection)
      return true
    })()
    connection.disconnectPromise = disconnectPromise
    try {
      return await disconnectPromise
    } finally {
      if (connection.disconnectPromise === disconnectPromise) connection.disconnectPromise = undefined
      pruneDisconnectedConnections(connection.workspacePath, connection.commandId)
    }
  }

  async function closeWorkspace(workspacePath) {
    closingWorkspaces.add(workspacePath)
    try {
      const matching = [...connections.values()].filter((connection) => connection.workspacePath === workspacePath)
      const results = await Promise.all(matching.map((connection) => disconnect(connection.id)))
      const failed = matching.filter((_connection, index) => !results[index])
      for (const connection of matching.filter((_connection, index) => results[index])) connections.delete(connection.id)
      if (failed.length > 0) {
        const error = new Error('Una connessione SSH non ha confermato la chiusura; il cleanup può essere ritentato.')
        error.code = 'MANAGED_SSH_CLEANUP_FAILED'
        error.failed = failed.length
        throw error
      }
      return Object.freeze({ closed: matching.length, failed: 0 })
    } finally {
      closingWorkspaces.delete(workspacePath)
    }
  }

  async function closeAll() {
    closingAll = true
    try {
      const matching = [...connections.values()]
      const results = await Promise.all(matching.map((connection) => disconnect(connection.id)))
      const failed = matching.filter((_connection, index) => !results[index])
      for (const connection of matching.filter((_connection, index) => results[index])) connections.delete(connection.id)
      if (failed.length > 0) {
        const error = new Error('Una connessione SSH non ha confermato la chiusura; il cleanup può essere ritentato.')
        error.code = 'MANAGED_SSH_CLEANUP_FAILED'
        error.failed = failed.length
        throw error
      }
      return Object.freeze({ closed: matching.length, failed: 0 })
    } finally {
      closingAll = false
    }
  }

  return { buildTerminalCommand, check, waitUntilConnected, get, list, disconnect, closeWorkspace, closeAll }
}

module.exports = { createManagedSshService, quoteShellArg }
