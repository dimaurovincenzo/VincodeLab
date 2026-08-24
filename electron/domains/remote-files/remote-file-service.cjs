const crypto = require('node:crypto')
const path = require('node:path')
const { toPublicError } = require('../errors/public-error.cjs')
const { createRemoteEntryRegistry } = require('./remote-entry-registry.cjs')
const { toPublicTrackedFile } = require('./remote-file-model.cjs')

const MAX_EDITABLE_BYTES = 20 * 1024 * 1024
const MAX_TRANSFER_BYTES = 100 * 1024 * 1024
function exposeAsync(operation, options) {
  return async (...args) => {
    try {
      return await operation(...args)
    } catch (error) {
      throw toPublicError(error, options)
    }
  }
}

function exposeSync(operation, options) {
  return (...args) => {
    try {
      return operation(...args)
    } catch (error) {
      throw toPublicError(error, options)
    }
  }
}

function createRemoteFileService({ ssh, sftp, store, tempRoot, chooseFiles, chooseDestination, createFileIo, showItemInFolder = () => undefined, log = () => undefined, notify = () => undefined, fileOperations = {}, lifecycleTimeoutMs = 5_000 }) {
  if (!ssh?.get || !sftp?.list || !store?.trackDownload) throw new Error('Servizio file remoti non configurato.')
  if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot)) throw new Error('Directory temporanea non valida.')
  if (typeof createFileIo !== 'function') throw new Error('Adapter filesystem remoto non configurato.')
  if (!Number.isInteger(lifecycleTimeoutMs) || lifecycleTimeoutMs < 1 || lifecycleTimeoutMs > 30_000) throw new Error('Timeout lifecycle remoto non valido.')
  const {
    cleanupTemporary,
    createDestinationTemporaryPath,
    createTemporaryPath,
    ensureStagingRoot,
    flushDirectory,
    flushFile,
    inspectFile,
    io,
    isBinary: fileIoIsBinary,
    readSample,
    statBoundedFile,
  } = createFileIo({ tempRoot, fileOperations, log })
  const toPublicFile = (item) => toPublicTrackedFile(item, { stat: io.stat })
  const entryRegistry = createRemoteEntryRegistry()
  const transfers = new Map()
  const activeOperations = new Set()
  const closedWorkspaces = new Set()
  const cleanedWorkspaces = new Set()
  const workspaceClosePromises = new Map()
  const reopenWorkspaces = new Set()
  let closeAllPromise
  let closingAll = false
  function requireWorkspace(workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) throw new Error('Workspace non valido.')
    return workspacePath
  }

  function cancellationError() {
    const error = new Error('Operazione remota annullata.')
    error.name = 'AbortError'
    return error
  }

  function withRemoteOperation(workspacePath, operation) {
    workspacePath = requireWorkspace(workspacePath)
    if (closingAll || closedWorkspaces.has(workspacePath)) return Promise.reject(cancellationError())
    const controller = new AbortController()
    const active = { workspacePath, controller, settled: undefined }
    const pending = Promise.resolve().then(async () => {
      const result = await operation(controller.signal)
      if (controller.signal.aborted) throw cancellationError()
      return result
    })
    active.settled = pending.then(() => undefined, () => undefined)
    activeOperations.add(active)
    return pending.finally(() => activeOperations.delete(active))
  }

  function exposeRemote(operation, options) {
    return exposeAsync((workspacePath, ...args) => withRemoteOperation(workspacePath, (signal) => operation(workspacePath, signal, ...args)), options)
  }

  function waitForLifecycle(promises) {
    if (promises.length === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback(value)
      }
      const timer = setTimeout(() => {
        const error = new Error('Il cleanup dei file remoti non è terminato entro il tempo previsto.')
        error.code = 'REMOTE_LIFECYCLE_TIMEOUT'
        finish(reject, error)
      }, lifecycleTimeoutMs)
      Promise.allSettled(promises).then((results) => {
        const failure = results.find((result) => result.status === 'rejected')
        if (failure) finish(reject, failure.reason)
        else finish(resolve)
      }, (error) => finish(reject, error))
    })
  }

  function requireConnection(workspacePath, connectionId) {
    const connection = ssh.get(connectionId)
    if (!connection || connection.workspacePath !== workspacePath) throw new Error('Connessione SSH non disponibile per questo workspace.')
    if (connection.state !== 'connected') throw new Error('La connessione SSH non è attiva.')
    return connection
  }

  function transferDto(transfer) {
    const { controller: _controller, workspacePath: _workspacePath, ...dto } = transfer
    return dto
  }

  function updateTransfer(transfer, patch) {
    Object.assign(transfer, patch)
    const dto = transferDto(transfer)
    notify(dto)
    return dto
  }

  async function withTransfer(workspacePath, direction, name, operation, lifecycleSignal) {
    const transfer = {
      id: crypto.randomUUID(), workspacePath, direction, name,
      state: 'queued', bytes: null, total: null, error: undefined,
      controller: new AbortController(),
    }
    const abortFromLifecycle = () => transfer.controller.abort()
    if (lifecycleSignal?.aborted) transfer.controller.abort()
    else lifecycleSignal?.addEventListener('abort', abortFromLifecycle, { once: true })
    transfers.set(transfer.id, transfer)
    updateTransfer(transfer, { state: 'running' })
    try {
      const result = await operation(transfer.controller.signal, transfer)
      updateTransfer(transfer, { state: 'completed' })
      return result
    } catch (error) {
      const cancelled = transfer.controller.signal.aborted
      const publicError = toPublicError(error, cancelled
        ? { code: 'REMOTE_TRANSFER_CANCELLED', message: 'Trasferimento remoto annullato.' }
        : { code: direction === 'download' ? 'REMOTE_DOWNLOAD_FAILED' : 'REMOTE_UPLOAD_FAILED', message: direction === 'download' ? 'Download remoto non riuscito.' : 'Upload remoto non riuscito.' })
      updateTransfer(transfer, { state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : publicError.message })
      throw publicError
    } finally {
      lifecycleSignal?.removeEventListener('abort', abortFromLifecycle)
      transfers.delete(transfer.id)
    }
  }

  async function browse(workspacePath, lifecycleSignal, connectionId, directoryId = null) {
    workspacePath = requireWorkspace(workspacePath)
    const connection = requireConnection(workspacePath, connectionId)
    let remotePath
    if (directoryId) {
      const directory = entryRegistry.requireEntry(workspacePath, directoryId, 'directory')
      if (directory.connectionId !== connectionId) throw new Error('Directory associata a una connessione diversa.')
      remotePath = directory.remotePath
    } else {
      remotePath = await sftp.resolveRoot(connection, connection.remoteRoot, lifecycleSignal)
    }
    const listed = await sftp.list(connection, remotePath, lifecycleSignal)
    const publicEntries = listed.map((item) => {
      const internal = entryRegistry.cacheEntry({ ...item, workspacePath, connectionId, remotePath: path.posix.join(remotePath, item.name) })
      return {
        id: internal.id,
        name: item.name,
        kind: item.kind,
        displayPath: internal.remotePath,
        size: item.size,
        modifiedAt: item.modifiedAt,
        mode: item.mode,
        destructiveAllowed: item.destructiveAllowed,
      }
    })
    return { path: remotePath, entries: publicEntries }
  }

  async function downloadAndTrack(workspacePath, lifecycleSignal, entryId) {
    workspacePath = requireWorkspace(workspacePath)
    const entry = entryRegistry.requireEntry(workspacePath, entryId, 'file')
    if (Number.isFinite(entry.size) && entry.size > MAX_TRANSFER_BYTES) throw new Error('Il file remoto supera il limite di trasferimento.')
    const connection = requireConnection(workspacePath, entry.connectionId)
    return withTransfer(workspacePath, 'download', entry.name, async (signal) => {
      await ensureStagingRoot()
      const temporaryPath = createTemporaryPath(path.extname(entry.name))
      try {
        await sftp.download(connection, entry.remotePath, temporaryPath, signal)
        const inspected = await inspectFile(temporaryPath, {
          maxBytes: MAX_TRANSFER_BYTES,
          signal,
          errorMessage: 'Il file remoto supera il limite di trasferimento.',
        })
        const tracked = await store.trackDownload(workspacePath, {
          connectionId: entry.connectionId,
          remotePath: entry.remotePath,
          localTempPath: temporaryPath,
          size: inspected.size,
          modifiedAt: entry.modifiedAt,
          mode: entry.mode,
          baselineHash: inspected.hash,
        })
        return await toPublicFile(tracked)
      } finally {
        await cleanupTemporary('remove-download-temporary', () => io.rm(temporaryPath, { force: true }))
      }
    }, lifecycleSignal)
  }

  async function downloadAs(workspacePath, lifecycleSignal, entryId) {
    workspacePath = requireWorkspace(workspacePath)
    const entry = entryRegistry.requireEntry(workspacePath, entryId, 'file')
    if (Number.isFinite(entry.size) && entry.size > MAX_TRANSFER_BYTES) throw new Error('Il file remoto supera il limite di trasferimento.')
    const destination = await chooseDestination(entry.name)
    if (lifecycleSignal.aborted) throw cancellationError()
    if (!destination) return { saved: false }
    if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new Error('Destinazione locale non valida.')
    const connection = requireConnection(workspacePath, entry.connectionId)
    return withTransfer(workspacePath, 'download', entry.name, async (signal) => {
      await ensureStagingRoot()
      const temporaryPath = createTemporaryPath(path.extname(entry.name))
      const destinationTemporaryPath = createDestinationTemporaryPath(destination)
      try {
        await sftp.download(connection, entry.remotePath, temporaryPath, signal)
        await statBoundedFile(temporaryPath, MAX_TRANSFER_BYTES, 'Il file remoto supera il limite di trasferimento.')
        await io.copyFile(temporaryPath, destinationTemporaryPath)
        await flushFile(destinationTemporaryPath)
        await io.rename(destinationTemporaryPath, destination)
        await flushDirectory(path.dirname(destination))
        return { saved: true }
      } finally {
        await cleanupTemporary('remove-download-source-temporary', () => io.rm(temporaryPath, { force: true }))
        await cleanupTemporary('remove-download-destination-temporary', () => io.rm(destinationTemporaryPath, { force: true }))
      }
    }, lifecycleSignal)
  }

  async function readLocal(workspacePath, fileId) {
    const tracked = store.getTrackedFile(requireWorkspace(workspacePath), fileId)
    if (!tracked) throw new Error('Copia locale non trovata.')
    const preview = await readSample(tracked.localPath)
    if (preview.size > MAX_EDITABLE_BYTES) throw new Error('Il file supera il limite dell’Editor.')
    if (fileIoIsBinary(preview.sample)) throw new Error('Il file binario non è modificabile come testo.')
    const content = await io.readFile(tracked.localPath)
    if (content.length > MAX_EDITABLE_BYTES) throw new Error('Il file supera il limite dell’Editor.')
    return { file: await toPublicFile(tracked), content: content.toString('utf8') }
  }

  async function readPreview(workspacePath, fileId) {
    const tracked = store.getTrackedFile(requireWorkspace(workspacePath), fileId)
    if (!tracked) throw new Error('Copia locale non trovata.')
    const preview = await readSample(tracked.localPath)
    return { file: await toPublicFile(tracked), binary: fileIoIsBinary(preview.sample), size: preview.size }
  }

  async function saveLocal(workspacePath, fileId, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_EDITABLE_BYTES) throw new Error('Contenuto locale non valido.')
    const tracked = store.getTrackedFile(requireWorkspace(workspacePath), fileId)
    if (!tracked) throw new Error('File remoto non trovato.')
    const temporaryPath = createDestinationTemporaryPath(tracked.localPath)
    let handle
    try {
      handle = await io.open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(content, 'utf8')
      if (process.platform !== 'win32') await io.chmod(temporaryPath, 0o600)
      await handle.sync()
      await handle.close()
      handle = undefined
      await io.rename(temporaryPath, tracked.localPath)
      await flushDirectory(path.dirname(tracked.localPath))
      return await toPublicFile(await store.markLocalSaved(workspacePath, fileId))
    } finally {
      await cleanupTemporary('close-local-save-temporary', () => handle?.close())
      await cleanupTemporary('remove-local-save-temporary', () => io.rm(temporaryPath, { force: true }))
    }
  }

  async function downloadCurrent(connection, tracked, signal, collectLimit = 0) {
    await ensureStagingRoot()
    const temporaryPath = createTemporaryPath(path.extname(tracked.name))
    try {
      await sftp.download(connection, tracked.remotePath, temporaryPath, signal)
      return await inspectFile(temporaryPath, {
        maxBytes: MAX_TRANSFER_BYTES,
        collectLimit,
        signal,
        errorMessage: 'Il file remoto supera il limite di trasferimento.',
      })
    } finally {
      await cleanupTemporary('remove-remote-read-temporary', () => io.rm(temporaryPath, { force: true }))
    }
  }

  async function compare(workspacePath, lifecycleSignal, fileId) {
    workspacePath = requireWorkspace(workspacePath)
    const tracked = store.getTrackedFile(workspacePath, fileId)
    if (!tracked) throw new Error('File remoto non trovato.')
    const connection = requireConnection(workspacePath, tracked.connectionId)
    const [remote, local] = await Promise.all([
      downloadCurrent(connection, tracked, lifecycleSignal, MAX_EDITABLE_BYTES),
      inspectFile(tracked.localPath, {
        maxBytes: MAX_TRANSFER_BYTES,
        collectLimit: MAX_EDITABLE_BYTES,
        signal: lifecycleSignal,
        errorMessage: 'Copia locale non trovata o non valida.',
      }),
    ])
    const binary = fileIoIsBinary(remote.sample) || fileIoIsBinary(local.sample)
    return {
      baselineChanged: remote.hash !== tracked.baselineHash,
      binary,
      remoteHash: remote.hash,
      baselineHash: tracked.baselineHash,
      localHash: local.hash,
      ...(!binary && remote.content && local.content
        ? { remoteContent: remote.content.toString('utf8'), localContent: local.content.toString('utf8') }
        : {}),
    }
  }

  async function upload(workspacePath, lifecycleSignal, fileId, { force = false } = {}) {
    workspacePath = requireWorkspace(workspacePath)
    const tracked = store.getTrackedFile(workspacePath, fileId)
    if (!tracked) throw new Error('File remoto non trovato.')
    const connection = requireConnection(workspacePath, tracked.connectionId)
    return withTransfer(workspacePath, 'upload', tracked.name, async (signal) => {
      let current
      try {
        current = await downloadCurrent(connection, tracked, signal)
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') throw error
        if (!force) {
          store.markConflict(workspacePath, fileId, 'Il file remoto non è più disponibile.')
          return { status: 'conflict', uploaded: false }
        }
        log('warn', 'remote_file_force_upload_without_baseline', { fileId })
      }
      if (!force && current.hash !== tracked.baselineHash) {
        store.markConflict(workspacePath, fileId)
        return { status: 'conflict', uploaded: false }
      }
      const remoteTemporaryPath = `${tracked.remotePath}.vincodelab-${crypto.randomUUID()}.tmp`
      let temporaryUploaded = false
      try {
        temporaryUploaded = true
        await sftp.uploadTemp(connection, tracked.localPath, remoteTemporaryPath, signal)
        if (tracked.mode !== null) await sftp.chmod(connection, remoteTemporaryPath, tracked.mode, signal)
        await sftp.rename(connection, remoteTemporaryPath, tracked.remotePath, signal)
        temporaryUploaded = false
        const synced = await store.markSynced(workspacePath, fileId)
        return { status: 'synced', uploaded: true, file: await toPublicFile(synced) }
      } finally {
        if (temporaryUploaded) await cleanupTemporary('remove-remote-upload-temporary', () => sftp.remove(connection, remoteTemporaryPath))
      }
    }, lifecycleSignal)
  }

  async function chooseAndUpload(workspacePath, lifecycleSignal, connectionId, directoryId = null) {
    const selected = await chooseFiles()
    if (lifecycleSignal.aborted) throw cancellationError()
    if (!Array.isArray(selected) || selected.length === 0) return []
    const connection = requireConnection(requireWorkspace(workspacePath), connectionId)
    const directory = directoryId ? entryRegistry.requireEntry(workspacePath, directoryId, 'directory').remotePath : await sftp.resolveRoot(connection, connection.remoteRoot, lifecycleSignal)
    const results = []
    for (const localPath of selected) {
      if (lifecycleSignal.aborted) throw cancellationError()
      const stats = await io.stat(localPath)
      if (!stats.isFile() || stats.size > MAX_TRANSFER_BYTES) throw new Error('File locale non trasferibile.')
      const remotePath = path.posix.join(directory, path.basename(localPath))
      const remoteTemporaryPath = `${remotePath}.vincodelab-${crypto.randomUUID()}.tmp`
      await withTransfer(workspacePath, 'upload', path.basename(localPath), async (signal) => {
        let temporaryUploaded = false
        try {
          temporaryUploaded = true
          await sftp.uploadTemp(connection, localPath, remoteTemporaryPath, signal)
          await sftp.rename(connection, remoteTemporaryPath, remotePath, signal)
          temporaryUploaded = false
        } finally {
          if (temporaryUploaded) await cleanupTemporary('remove-selected-upload-temporary', () => sftp.remove(connection, remoteTemporaryPath))
        }
      }, lifecycleSignal)
      results.push({ name: path.basename(localPath), uploaded: true })
    }
    return results
  }

  function cancelTransfer(workspacePath, transferId) {
    workspacePath = requireWorkspace(workspacePath)
    const transfer = transfers.get(transferId)
    if (!transfer || transfer.workspacePath !== workspacePath || transfer.state !== 'running') return false
    transfer.controller.abort()
    return true
  }

  async function createDirectory(workspacePath, lifecycleSignal, connectionId, parentId, name) {
    if (typeof name !== 'string' || !name.trim() || name.includes('/') || /[\0\r\n]/.test(name)) throw new Error('Nome cartella non valido.')
    const connection = requireConnection(requireWorkspace(workspacePath), connectionId)
    const parentPath = parentId ? entryRegistry.requireEntry(workspacePath, parentId, 'directory').remotePath : await sftp.resolveRoot(connection, connection.remoteRoot, lifecycleSignal)
    await sftp.mkdir(connection, path.posix.join(parentPath, name.trim()), lifecycleSignal)
    return { created: true }
  }

  async function rename(workspacePath, lifecycleSignal, entryId, name) {
    if (typeof name !== 'string' || !name.trim() || name.includes('/') || /[\0\r\n]/.test(name)) throw new Error('Nome remoto non valido.')
    const entry = entryRegistry.requireEntry(requireWorkspace(workspacePath), entryId)
    if (!entry.destructiveAllowed) throw new Error('Questo elemento remoto è in sola lettura.')
    const connection = requireConnection(workspacePath, entry.connectionId)
    const previousPath = entry.remotePath
    const nextPath = path.posix.join(path.posix.dirname(previousPath), name.trim())
    await sftp.rename(connection, previousPath, nextPath, lifecycleSignal)
    entryRegistry.updateEntryPath(entry, nextPath)
    const tracked = store.listTrackedFiles(workspacePath).find((item) => item.connectionId === entry.connectionId && item.remotePath === previousPath)
    if (tracked) store.updateRemotePath(workspacePath, tracked.id, nextPath)
    entryRegistry.updateEntryName(entry, name.trim())
    return { renamed: true }
  }

  async function remove(workspacePath, lifecycleSignal, entryId) {
    const entry = entryRegistry.requireEntry(requireWorkspace(workspacePath), entryId)
    if (!entry.destructiveAllowed) throw new Error('Questo elemento remoto è in sola lettura.')
    const connection = requireConnection(workspacePath, entry.connectionId)
    if (entry.kind === 'directory') await sftp.rmdir(connection, entry.remotePath, lifecycleSignal)
    else await sftp.remove(connection, entry.remotePath, lifecycleSignal)
    entryRegistry.removeEntry(entry)
    return { removed: true }
  }

  async function discard(workspacePath, fileId, { force = false } = {}) {
    return await store.removeTrackedFile(requireWorkspace(workspacePath), fileId, { force })
  }

  async function listTracked(workspacePath) {
    return await Promise.all(store.listTrackedFiles(requireWorkspace(workspacePath)).map(toPublicFile))
  }

  async function revealLocal(workspacePath, fileId) {
    const tracked = store.getTrackedFile(requireWorkspace(workspacePath), fileId)
    if (!tracked) throw new Error('Copia locale non trovata.')
    try {
      const stats = await io.stat(tracked.localPath)
      if (!stats.isFile()) throw new Error('Copia locale non trovata.')
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('Copia locale non trovata.')
      throw error
    }
    showItemInFolder(tracked.localPath)
    return { revealed: true }
  }

  async function cleanup(workspacePath, options) {
    return await store.cleanup(requireWorkspace(workspacePath), options)
  }

  function clearWorkspaceResources(workspacePath) {
    for (const operation of activeOperations) {
      if (operation.workspacePath === workspacePath) activeOperations.delete(operation)
    }
    for (const [id, transfer] of transfers) {
      if (transfer.workspacePath === workspacePath) transfers.delete(id)
    }
    entryRegistry.clearWorkspace(workspacePath)
  }

  function closeWorkspace(workspacePath) {
    workspacePath = requireWorkspace(workspacePath)
    reopenWorkspaces.delete(workspacePath)
    const existing = workspaceClosePromises.get(workspacePath)
    if (existing) return existing
    if (cleanedWorkspaces.has(workspacePath)) return Promise.resolve()
    closedWorkspaces.add(workspacePath)
    const matchingOperations = [...activeOperations].filter((operation) => operation.workspacePath === workspacePath)
    for (const operation of matchingOperations) operation.controller.abort()
    for (const transfer of transfers.values()) {
      if (transfer.workspacePath === workspacePath && transfer.state === 'running') transfer.controller.abort()
    }
    const targets = matchingOperations.map((operation) => operation.settled)
    if (typeof sftp.closeWorkspace === 'function') targets.push(Promise.resolve().then(() => sftp.closeWorkspace(workspacePath)))
    const closing = waitForLifecycle(targets).then(() => {
      clearWorkspaceResources(workspacePath)
      cleanedWorkspaces.add(workspacePath)
    })
    workspaceClosePromises.set(workspacePath, closing)
    const release = () => {
      if (workspaceClosePromises.get(workspacePath) === closing) workspaceClosePromises.delete(workspacePath)
    }
    void closing.then(release, release)
    return closing
  }

  function closeAll() {
    if (closeAllPromise) return closeAllPromise
    closingAll = true
    reopenWorkspaces.clear()
    for (const operation of activeOperations) operation.controller.abort()
    for (const transfer of transfers.values()) {
      if (transfer.state === 'running') transfer.controller.abort()
    }
    const targets = [...activeOperations].map((operation) => operation.settled)
    if (typeof sftp.closeAll === 'function') targets.push(Promise.resolve().then(() => sftp.closeAll()))
    const closing = waitForLifecycle(targets).then(() => {
      activeOperations.clear()
      transfers.clear()
      entryRegistry.clear()
    })
    closeAllPromise = closing
    void closing.catch(() => {
      if (closeAllPromise === closing) closeAllPromise = undefined
    })
    return closing
  }

  function openWorkspace(workspacePath) {
    workspacePath = requireWorkspace(workspacePath)
    if (closingAll) return false
    reopenWorkspaces.add(workspacePath)
    const activate = () => {
      if (closingAll || !reopenWorkspaces.delete(workspacePath)) return
      closedWorkspaces.delete(workspacePath)
      cleanedWorkspaces.delete(workspacePath)
      sftp.openWorkspace?.(workspacePath)
    }
    const closing = workspaceClosePromises.get(workspacePath)
    if (closing) void closing.then(activate, () => undefined)
    else activate()
    return true
  }

  function getResourceCounts() {
    return { entries: entryRegistry.getSize(), transfers: transfers.size, operations: activeOperations.size }
  }

  return {
    browse: exposeRemote(browse, { code: 'REMOTE_BROWSE_FAILED', message: 'Esplorazione dei file remoti non riuscita.' }),
    cancelTransfer: exposeSync(cancelTransfer, { code: 'REMOTE_CANCEL_FAILED', message: 'Annullamento del trasferimento non riuscito.' }),
    chooseAndUpload: exposeRemote(chooseAndUpload, { code: 'REMOTE_UPLOAD_FAILED', message: 'Upload remoto non riuscito.' }),
    cleanup: exposeAsync(cleanup, { code: 'REMOTE_CLEANUP_FAILED', message: 'Pulizia delle copie locali non riuscita.' }),
    closeWorkspace,
    closeAll,
    compare: exposeRemote(compare, { code: 'REMOTE_COMPARE_FAILED', message: 'Confronto con il file remoto non riuscito.' }),
    createDirectory: exposeRemote(createDirectory, { code: 'REMOTE_CREATE_DIRECTORY_FAILED', message: 'Creazione della cartella remota non riuscita.' }),
    discard: exposeAsync(discard, { code: 'REMOTE_DISCARD_FAILED', message: 'Rimozione della copia locale non riuscita.' }),
    downloadAs: exposeRemote(downloadAs, { code: 'REMOTE_DOWNLOAD_FAILED', message: 'Download remoto non riuscito.' }),
    downloadAndTrack: exposeRemote(downloadAndTrack, { code: 'REMOTE_DOWNLOAD_FAILED', message: 'Download remoto non riuscito.' }),
    getResourceCounts,
    listTracked: exposeAsync(listTracked, { code: 'REMOTE_LIST_TRACKED_FAILED', message: 'Lettura delle copie locali non riuscita.' }),
    openWorkspace,
    readLocal: exposeAsync(readLocal, { code: 'REMOTE_READ_LOCAL_FAILED', message: 'Lettura della copia locale non riuscita.' }),
    readPreview: exposeAsync(readPreview, { code: 'REMOTE_PREVIEW_FAILED', message: 'Anteprima del file remoto non riuscita.' }),
    revealLocal: exposeAsync(revealLocal, { code: 'REMOTE_REVEAL_FAILED', message: 'Apertura della copia locale non riuscita.' }),
    remove: exposeRemote(remove, { code: 'REMOTE_REMOVE_FAILED', message: 'Rimozione del file remoto non riuscita.' }),
    rename: exposeRemote(rename, { code: 'REMOTE_RENAME_FAILED', message: 'Rinomina del file remoto non riuscita.' }),
    saveLocal: exposeAsync(saveLocal, { code: 'REMOTE_SAVE_LOCAL_FAILED', message: 'Salvataggio della copia locale non riuscito.' }),
    upload: exposeRemote(upload, { code: 'REMOTE_UPLOAD_FAILED', message: 'Upload remoto non riuscito.' }),
  }
}

module.exports = { createRemoteFileService }
