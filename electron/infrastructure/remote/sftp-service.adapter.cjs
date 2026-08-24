const childProcess = require('node:child_process')
const path = require('node:path')
const {
  getSftpErrorMetadata,
  parseSftpList,
  quoteSftpPath,
  toSftpApplicationError,
  validateSftpConnection,
} = require('../../domains/remote/sftp-protocol.cjs')
const { createSftpProcessLifecycle } = require('./sftp-process-lifecycle.cjs')
function createSftpService({
  spawn = childProcess.spawn,
  timeoutMs = 30_000,
  killGraceMs = 250,
  maxOutputBytes = 5 * 1024 * 1024,
  maxConcurrentPerConnection = 1,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error('Timeout SFTP non valido.')
  if (!Number.isInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > 5_000) throw new Error('Timeout arresto SFTP non valido.')
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 50 * 1024 * 1024) throw new Error('Limite output SFTP non valido.')
  if (maxConcurrentPerConnection !== 1) throw new Error('La concorrenza SFTP deve essere seriale.')
  const queues = new Map()
  const closedConnections = new Set()
  const closedWorkspaces = new Set()
  const workspaceClosePromises = new Map()
  let closeAllPromise
  let closingAll = false

  const { runProcess } = createSftpProcessLifecycle({
    spawn,
    timeoutMs,
    killGraceMs,
    maxOutputBytes,
  })
  function enqueue(connection, operation, sourceSignal) {
    const connectionId = connection.id
    const workspacePath = typeof connection.workspacePath === 'string' ? connection.workspacePath : null
    if (closingAll || closedConnections.has(connectionId) || (workspacePath && closedWorkspaces.has(workspacePath))) {
      return Promise.reject(new Error('Trasferimento annullato.'))
    }
    let queue = queues.get(connectionId)
    if (!queue) {
      queue = { connectionId, workspacePath, tail: Promise.resolve(), operations: new Set(), closing: false, closePromise: undefined }
      queues.set(connectionId, queue)
    }
    if (queue.workspacePath !== workspacePath) return Promise.reject(new Error('Connessione SFTP non valida.'))
    if (queue.closing) return Promise.reject(new Error('Trasferimento annullato.'))

    const controller = new AbortController()
    const abort = () => controller.abort()
    if (sourceSignal?.aborted) controller.abort()
    else sourceSignal?.addEventListener('abort', abort, { once: true })
    const queuedOperation = { controller }
    queue.operations.add(queuedOperation)

    const current = queue.tail.then(() => operation(controller.signal))
    const tail = current.catch(() => {
      // `current` resta la Promise restituita al chiamante e conserva il failure;
      // soltanto la coda interna viene guarita per permettere il retry successivo.
    })
    queue.tail = tail
    void tail.then(() => {
      sourceSignal?.removeEventListener('abort', abort)
      queue.operations.delete(queuedOperation)
      if (queue.tail === tail && !queue.closing && queues.get(connectionId) === queue) queues.delete(connectionId)
    })
    return current
  }

  function runBatch(connection, commands, options = {}) {
    validateSftpConnection(connection)
    if (!Array.isArray(commands) || commands.length === 0 || commands.some((command) => typeof command !== 'string' || /[\0\r\n]/.test(command))) {
      throw new Error('Comando SFTP non valido.')
    }
    return enqueue(connection, (signal) => runProcess(connection, commands, {
      operation: options.operation,
      resource: options.resource,
      signal,
    }), options.signal)
  }

  async function resolveRoot(connection, remoteRoot, signal) {
    try {
      if (remoteRoot !== '~' && !remoteRoot.startsWith('~/')) return remoteRoot
      if (!connection.canonicalHome) {
        const result = await runBatch(connection, ['pwd'], { operation: 'resolve-root', resource: remoteRoot, signal })
        const match = /Remote working directory:\s*(\/[^\r\n]*)/.exec(result.stdout)
        if (!match) throw new Error('Impossibile determinare la directory remota iniziale.')
        connection.canonicalHome = match[1]
      }
      const relative = remoteRoot === '~' ? '' : remoteRoot.slice(2)
      return relative ? path.posix.join(connection.canonicalHome, relative) : connection.canonicalHome
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'resolve-root', resource: remoteRoot })
    }
  }

  async function list(connection, remotePath, signal) {
    try {
      const result = await runBatch(connection, [`ls -la ${quoteSftpPath(remotePath)}`], { operation: 'list', resource: remotePath, signal })
      return parseSftpList(result.stdout)
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'list', resource: remotePath })
    }
  }

  async function download(connection, remotePath, localTempPath, signal) {
    try {
      await runBatch(connection, [`get ${quoteSftpPath(remotePath)} ${quoteSftpPath(localTempPath)}`], { operation: 'download', resource: remotePath, signal })
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'download', resource: remotePath })
    }
  }

  async function uploadTemp(connection, localPath, remoteTempPath, signal) {
    try {
      await runBatch(connection, [`put ${quoteSftpPath(localPath)} ${quoteSftpPath(remoteTempPath)}`], { operation: 'upload', resource: remoteTempPath, signal })
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'upload', resource: remoteTempPath })
    }
  }

  async function rename(connection, fromPath, toPath, signal) {
    try {
      await runBatch(connection, [`rename ${quoteSftpPath(fromPath)} ${quoteSftpPath(toPath)}`], { operation: 'rename', resource: toPath, signal })
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'rename', resource: toPath })
    }
  }

  async function chmod(connection, remotePath, mode, signal) {
    try {
      if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new Error('Permessi remoti non validi.')
      await runBatch(connection, [`chmod ${mode.toString(8)} ${quoteSftpPath(remotePath)}`], { operation: 'chmod', resource: remotePath, signal })
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'chmod', resource: remotePath })
    }
  }

  async function mkdir(connection, remotePath, signal) {
    try {
      await runBatch(connection, [`mkdir ${quoteSftpPath(remotePath)}`], { operation: 'mkdir', resource: remotePath, signal })
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'mkdir', resource: remotePath })
    }
  }

  async function remove(connection, remotePath, signal) {
    try {
      await runBatch(connection, [`rm ${quoteSftpPath(remotePath)}`], { operation: 'remove', resource: remotePath, signal })
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'remove', resource: remotePath })
    }
  }

  async function rmdir(connection, remotePath, signal) {
    try {
      await runBatch(connection, [`rmdir ${quoteSftpPath(remotePath)}`], { operation: 'rmdir', resource: remotePath, signal })
    } catch (error) {
      throw toSftpApplicationError(error, { connection, operation: 'rmdir', resource: remotePath })
    }
  }

  function closeQueue(connectionId, queue) {
    if (queue.closePromise) return queue.closePromise
    queue.closing = true
    for (const operation of queue.operations) operation.controller.abort()
    queue.closePromise = queue.tail.then(() => {
      if (queues.get(connectionId) === queue) queues.delete(connectionId)
    })
    return queue.closePromise
  }

  function closeConnection(connectionId) {
    closedConnections.add(connectionId)
    const queue = queues.get(connectionId)
    if (!queue) return Promise.resolve()
    return closeQueue(connectionId, queue)
  }

  function closeWorkspace(workspacePath) {
    const existing = workspaceClosePromises.get(workspacePath)
    if (existing) return existing
    if (closedWorkspaces.has(workspacePath)) return Promise.resolve()
    closedWorkspaces.add(workspacePath)
    const closing = Promise.all([...queues.entries()]
      .filter(([, queue]) => queue.workspacePath === workspacePath)
      .map(([connectionId, queue]) => closeQueue(connectionId, queue)))
    workspaceClosePromises.set(workspacePath, closing)
    void closing.finally(() => {
      if (workspaceClosePromises.get(workspacePath) === closing) workspaceClosePromises.delete(workspacePath)
    })
    return closing
  }

  function closeAll() {
    if (closeAllPromise) return closeAllPromise
    closingAll = true
    closeAllPromise = Promise.all([...queues.entries()].map(([connectionId, queue]) => closeQueue(connectionId, queue)))
    return closeAllPromise
  }

  function openWorkspace(workspacePath) {
    if (closingAll || workspaceClosePromises.has(workspacePath)) return false
    closedWorkspaces.delete(workspacePath)
    workspaceClosePromises.delete(workspacePath)
    return true
  }

  function getResourceCounts() {
    let operations = 0
    for (const queue of queues.values()) operations += queue.operations.size
    return { queues: queues.size, operations }
  }

  return { chmod, closeAll, closeConnection, closeWorkspace, download, getResourceCounts, list, mkdir, openWorkspace, remove, rename, resolveRoot, rmdir, uploadTemp }
}

module.exports = { createSftpService, getSftpErrorMetadata, parseSftpList, quoteSftpPath }
