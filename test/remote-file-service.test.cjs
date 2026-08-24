const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')

const { createRemoteFileService } = require('../electron/domains/remote-files/remote-file-service.cjs')
const { createRemoteFileIo } = require('../electron/infrastructure/remote/remote-file-io.adapter.cjs')
const { createRemoteFileStore } = require('../electron/infrastructure/remote/remote-file-store.adapter.cjs')

function createFixture(t, initialRemote = 'prima', downloadDestination = null, options = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-remote-service-'))
  const database = new Database(':memory:')
  const store = createRemoteFileStore({ dataRoot, database })
  const calls = []
  let remoteContent = Buffer.from(initialRemote)
  let uploadedContent = null
  let uploadedRemotePath = null
  let renamedRemotePaths = null
  const ssh = {
    get: (id) => id === 'connection-a' ? {
      id, workspacePath: '/tmp/workspace-a', destination: 'api-test', remoteRoot: '/srv/app',
      socketPath: '/tmp/vl/socket', sftpPath: '/usr/bin/sftp', state: 'connected',
    } : null,
  }
  const sftp = {
    resolveRoot: async (_connection, root) => root,
    list: async () => [{ name: 'config.json', kind: 'file', size: remoteContent.length, mode: 0o640, modifiedAt: 10, linkTarget: null, destructiveAllowed: true }],
    download: async (_connection, _remotePath, localPath) => { calls.push('download'); fs.writeFileSync(localPath, remoteContent) },
    uploadTemp: async (_connection, localPath, remotePath) => { calls.push('uploadTemp'); uploadedContent = fs.readFileSync(localPath); uploadedRemotePath = remotePath },
    chmod: async () => { calls.push('chmod') },
    rename: async (_connection, fromPath, toPath) => { calls.push('rename'); renamedRemotePaths = { fromPath, toPath }; remoteContent = uploadedContent },
    remove: async () => { calls.push('remove') },
    mkdir: async () => { calls.push('mkdir') },
    rmdir: async () => { calls.push('rmdir') },
    ...options.sftp,
  }
  const transfers = []
  const revealed = []
  const logs = []
  const service = createRemoteFileService({
    ssh, sftp, store, tempRoot: dataRoot, createFileIo: createRemoteFileIo,
    chooseFiles: async () => options.selectedFiles ?? [], chooseDestination: async () => downloadDestination,
    showItemInFolder: (localPath) => revealed.push(localPath),
    log: (...entry) => logs.push(entry), notify: (transfer) => transfers.push(transfer),
    fileOperations: options.fileOperations,
    lifecycleTimeoutMs: options.lifecycleTimeoutMs,
  })
  t.after(() => {
    database.close()
    fs.rmSync(dataRoot, { recursive: true, force: true })
  })
  return {
    service,
    store,
    database,
    calls,
    logs,
    transfers,
    revealed,
    dataRoot,
    setRemote: (value) => { remoteContent = Buffer.from(value) },
    remote: () => remoteContent.toString('utf8'),
    uploadedRemotePath: () => uploadedRemotePath,
    renamedRemotePaths: () => renamedRemotePaths,
  }
}

async function downloadFixture(fixture) {
  const listing = await fixture.service.browse('/tmp/workspace-a', 'connection-a')
  return fixture.service.downloadAndTrack('/tmp/workspace-a', listing.entries[0].id)
}

test('scarica e traccia un file usando soltanto un ID opaco', async (t) => {
  const fixture = createFixture(t)
  const listing = await fixture.service.browse('/tmp/workspace-a', 'connection-a')
  assert.equal(listing.path, '/srv/app')
  assert.equal(listing.entries[0].remotePath, undefined)

  const tracked = await fixture.service.downloadAndTrack('/tmp/workspace-a', listing.entries[0].id)
  assert.equal(tracked.remotePath, '/srv/app/config.json')
  assert.equal('localPath' in tracked, false)
  assert.equal(fixture.store.getTrackedFile('/tmp/workspace-a', tracked.id).localState, 'synced')
})

test('un cleanup temporaneo fallito non invalida il download ma resta correlato e sanitizzato nei log', async (t) => {
  const fixture = createFixture(t, 'contenuto remoto', null, {
    fileOperations: {
      rm: async () => { throw new Error('EACCES /Users/alice/private token=segreto') },
    },
  })

  const tracked = await downloadFixture(fixture)

  assert.equal(tracked.name, 'config.json')
  assert.equal(fixture.logs.length, 1)
  const [level, event, fields] = fixture.logs[0]
  assert.equal(level, 'warning')
  assert.equal(event, 'remote_temporary_cleanup_failed')
  assert.match(fields.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.equal(fields.category, 'filesystem')
  assert.equal(fields.operation, 'remove-download-temporary')
  assert.doesNotMatch(JSON.stringify(fields), /alice|private|token|segreto|EACCES/iu)
})

test('scarica una copia scelta dall utente senza esporre il percorso al renderer', async (t) => {
  const destinationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-download-as-'))
  const destination = path.join(destinationRoot, 'config.json')
  t.after(() => fs.rmSync(destinationRoot, { recursive: true, force: true }))
  const fixture = createFixture(t, 'contenuto remoto', destination)
  const listing = await fixture.service.browse('/tmp/workspace-a', 'connection-a')

  const result = await fixture.service.downloadAs('/tmp/workspace-a', listing.entries[0].id)

  assert.deepEqual(result, { saved: true })
  assert.equal(fs.readFileSync(destination, 'utf8'), 'contenuto remoto')
  assert.equal('path' in result, false)
})

test('preserva la destinazione esistente se la copia locale si interrompe', async (t) => {
  const destinationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-download-atomic-'))
  const destination = path.join(destinationRoot, 'config.json')
  fs.writeFileSync(destination, 'contenuto precedente')
  t.after(() => fs.rmSync(destinationRoot, { recursive: true, force: true }))
  let partialPath
  const fixture = createFixture(t, 'nuovo contenuto', destination, {
    fileOperations: {
      copyFile: async (_source, target) => {
        partialPath = target
        fs.writeFileSync(target, 'parziale')
        throw new Error('disco non disponibile')
      },
    },
  })
  const listing = await fixture.service.browse('/tmp/workspace-a', 'connection-a')

  await assert.rejects(() => fixture.service.downloadAs('/tmp/workspace-a', listing.entries[0].id), /REMOTE_DOWNLOAD_FAILED/)

  assert.equal(fs.readFileSync(destination, 'utf8'), 'contenuto precedente')
  assert.equal(fs.existsSync(partialPath), false)
})

test('carica una scelta su un path remoto temporaneo e rinomina soltanto al termine', async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-upload-atomic-'))
  const localPath = path.join(localRoot, 'config.json')
  fs.writeFileSync(localPath, 'nuovo contenuto')
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }))
  const fixture = createFixture(t, 'contenuto precedente', null, { selectedFiles: [localPath] })

  assert.deepEqual(await fixture.service.chooseAndUpload('/tmp/workspace-a', 'connection-a'), [{ name: 'config.json', uploaded: true }])

  assert.match(fixture.uploadedRemotePath(), /^\/srv\/app\/config\.json\.vincodelab-[\w-]+\.tmp$/)
  assert.deepEqual(fixture.renamedRemotePaths(), {
    fromPath: fixture.uploadedRemotePath(),
    toPath: '/srv/app/config.json',
  })
  assert.equal(fixture.remote(), 'nuovo contenuto')
})

test('rimuove il temporaneo remoto se un upload scelto si interrompe', async (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-upload-failed-'))
  const localPath = path.join(localRoot, 'config.json')
  fs.writeFileSync(localPath, 'nuovo contenuto')
  t.after(() => fs.rmSync(localRoot, { recursive: true, force: true }))
  let failedRemotePath
  const fixture = createFixture(t, 'contenuto precedente', null, {
    selectedFiles: [localPath],
    sftp: {
      uploadTemp: async (_connection, _source, remotePath) => {
        failedRemotePath = remotePath
        throw new Error('rete interrotta')
      },
    },
  })

  await assert.rejects(() => fixture.service.chooseAndUpload('/tmp/workspace-a', 'connection-a'), /REMOTE_UPLOAD_FAILED/)

  assert.match(failedRemotePath, /^\/srv\/app\/config\.json\.vincodelab-[\w-]+\.tmp$/)
  assert.equal(fixture.remote(), 'contenuto precedente')
  assert.equal(fixture.calls.includes('rename'), false)
  assert.equal(fixture.calls.includes('remove'), true)
})

test('riusa gli ID di listing e rilascia i transfer conclusi', async (t) => {
  const destinationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-remote-resources-'))
  const destination = path.join(destinationRoot, 'config.json')
  t.after(() => fs.rmSync(destinationRoot, { recursive: true, force: true }))
  const fixture = createFixture(t, 'contenuto remoto', destination)
  const first = await fixture.service.browse('/tmp/workspace-a', 'connection-a')
  const second = await fixture.service.browse('/tmp/workspace-a', 'connection-a')

  assert.equal(second.entries[0].id, first.entries[0].id)
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 1, transfers: 0, operations: 0 })

  await fixture.service.downloadAs('/tmp/workspace-a', first.entries[0].id)
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 1, transfers: 0, operations: 0 })
})

test('blocca upload quando il server è cambiato', async (t) => {
  const fixture = createFixture(t)
  const tracked = await downloadFixture(fixture)
  await fixture.service.saveLocal('/tmp/workspace-a', tracked.id, 'locale')
  fixture.calls.length = 0
  fixture.setRemote('cambiato')

  const result = await fixture.service.upload('/tmp/workspace-a', tracked.id, { force: false })
  assert.deepEqual(result, { status: 'conflict', uploaded: false })
  assert.equal(fixture.calls.includes('uploadTemp'), false)
  assert.equal(fixture.store.getTrackedFile('/tmp/workspace-a', tracked.id).localState, 'conflict')
})

test('propaga la cancellazione del controllo remoto senza trasformarla in conflitto', async (t) => {
  let downloadCalls = 0
  const fixture = createFixture(t, 'contenuto remoto', null, {
    sftp: {
      download: async (_connection, _remotePath, localPath, signal) => {
        downloadCalls += 1
        if (downloadCalls === 1) {
          await fs.promises.writeFile(localPath, 'contenuto remoto')
          return
        }
        await new Promise((resolve, reject) => {
          const abort = () => {
            const error = new Error('trasferimento annullato')
            error.name = 'AbortError'
            reject(error)
          }
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        })
      },
    },
  })
  const tracked = await downloadFixture(fixture)
  await fixture.service.saveLocal('/tmp/workspace-a', tracked.id, 'modifica locale')

  const upload = fixture.service.upload('/tmp/workspace-a', tracked.id)
  await new Promise((resolve) => setImmediate(resolve))
  const activeTransfer = fixture.transfers.findLast((transfer) => transfer.state === 'running')
  assert.ok(activeTransfer)
  assert.equal(fixture.service.cancelTransfer('/tmp/workspace-a', activeTransfer.id), true)
  await assert.rejects(upload, /annullato/)

  assert.equal(fixture.store.getTrackedFile('/tmp/workspace-a', tracked.id).localState, 'modified')
  assert.equal(fixture.transfers.at(-1).state, 'cancelled')
})

test('non espone path token o query negli errori di trasferimento inviati alla UI', async (t) => {
  const privateDetail = 'SFTP /Users/demo/Segreti/config.json?token=ghp_supersegreto Authorization=Bearer abc.def.ghi'
  const fixture = createFixture(t, 'contenuto remoto', null, {
    sftp: {
      download: async () => { throw new Error(privateDetail) },
    },
  })
  const listing = await fixture.service.browse('/tmp/workspace-a', 'connection-a')

  const error = await fixture.service.downloadAndTrack('/tmp/workspace-a', listing.entries[0].id).catch((failure) => failure)

  assert.equal(error.message, 'Download remoto non riuscito. [REMOTE_DOWNLOAD_FAILED]')
  assert.equal('cause' in error, false)
  const notification = fixture.transfers.at(-1)
  assert.equal(notification.state, 'error')
  assert.equal(notification.error, error.message)
  assert.doesNotMatch(notification.error, /Users|Segreti|token|ghp_|Authorization|Bearer|abc\.def|\?/i)
})

test('redige anche gli errori delle operazioni remote senza transfer DTO', async (t) => {
  const fixture = createFixture(t, 'contenuto remoto', null, {
    sftp: {
      list: async () => { throw new Error('lettura /private/tmp/catalogo.json?access_token=segreto') },
    },
  })

  const error = await fixture.service.browse('/tmp/workspace-a', 'connection-a').catch((failure) => failure)

  assert.equal(error.message, 'Esplorazione dei file remoti non riuscita. [REMOTE_BROWSE_FAILED]')
  assert.doesNotMatch(error.message, /private|catalogo|access_token|segreto|\?/i)
})

test('preserva la copia locale precedente se il salvataggio atomico non arriva al rename', async (t) => {
  const fixture = createFixture(t, 'contenuto precedente', null, {
    fileOperations: {
      rename: async () => { throw new Error('rename non disponibile') },
    },
  })
  const tracked = await downloadFixture(fixture)
  const internal = fixture.store.getTrackedFile('/tmp/workspace-a', tracked.id)

  await assert.rejects(() => fixture.service.saveLocal('/tmp/workspace-a', tracked.id, 'contenuto nuovo'), /REMOTE_SAVE_LOCAL_FAILED/)

  assert.equal(fs.readFileSync(internal.localPath, 'utf8'), 'contenuto precedente')
  assert.equal(fs.readdirSync(path.dirname(internal.localPath)).some((name) => name.endsWith('.tmp')), false)
})

test('legge la preview binaria dal solo sample senza caricare tutto il file', async (t) => {
  const fixture = createFixture(t, Buffer.from([0, 1, 2, 3]), null, {
    fileOperations: {
      readFile: async () => { throw new Error('lettura completa non consentita') },
    },
  })
  const tracked = await downloadFixture(fixture)

  const preview = await fixture.service.readPreview('/tmp/workspace-a', tracked.id)

  assert.equal(preview.binary, true)
  assert.equal(preview.size, 4)
})

test('carica temporaneo, ripristina mode e rinomina', async (t) => {
  const fixture = createFixture(t)
  const tracked = await downloadFixture(fixture)
  await fixture.service.saveLocal('/tmp/workspace-a', tracked.id, 'locale')
  fixture.calls.length = 0

  const result = await fixture.service.upload('/tmp/workspace-a', tracked.id, { force: false })
  assert.equal(result.status, 'synced')
  assert.equal(result.uploaded, true)
  assert.deepEqual(fixture.calls, ['download', 'uploadTemp', 'chmod', 'rename'])
  assert.equal(fixture.remote(), 'locale')
})

test('rinomina soltanto il record tracciato con lo stesso path remoto completo', async (t) => {
  const workspacePath = '/tmp/workspace-a'
  const fixture = createFixture(t, 'contenuto remoto', null, {
    sftp: {
      list: async (_connection, remotePath) => remotePath === '/srv/app'
        ? [
            { name: 'a', kind: 'directory', size: 0, mode: 0o750, modifiedAt: 10, linkTarget: null, destructiveAllowed: true },
            { name: 'b', kind: 'directory', size: 0, mode: 0o750, modifiedAt: 10, linkTarget: null, destructiveAllowed: true },
          ]
        : [{ name: 'config.json', kind: 'file', size: 32, mode: 0o640, modifiedAt: 10, linkTarget: null, destructiveAllowed: true }],
      download: async (_connection, remotePath, localPath) => fs.promises.writeFile(localPath, `contenuto di ${remotePath}`),
    },
  })
  const root = await fixture.service.browse(workspacePath, 'connection-a')
  const entriesByPath = new Map()
  for (const directory of root.entries) {
    const listing = await fixture.service.browse(workspacePath, 'connection-a', directory.id)
    entriesByPath.set(listing.entries[0].displayPath, listing.entries[0])
    await fixture.service.downloadAndTrack(workspacePath, listing.entries[0].id)
  }

  const decoy = fixture.store.listTrackedFiles(workspacePath).find((item) => item.remotePath === '/srv/app/a/config.json')
  const target = fixture.store.listTrackedFiles(workspacePath).find((item) => item.remotePath === '/srv/app/b/config.json')
  fixture.database.prepare('UPDATE remote_tracked_files SET updated_at = ? WHERE id = ?').run(2, decoy.id)
  fixture.database.prepare('UPDATE remote_tracked_files SET updated_at = ? WHERE id = ?').run(1, target.id)

  await fixture.service.rename(workspacePath, entriesByPath.get(target.remotePath).id, 'renamed.json')

  const renamedPath = '/srv/app/b/renamed.json'
  assert.equal(fixture.store.getTrackedFile(workspacePath, target.id).remotePath, renamedPath)
  assert.equal(fixture.store.getTrackedFile(workspacePath, decoy.id).remotePath, decoy.remotePath)

  await fixture.service.saveLocal(workspacePath, target.id, 'contenuto target aggiornato')
  await fixture.service.upload(workspacePath, target.id, { force: true })
  assert.equal(fixture.renamedRemotePaths().toPath, renamedPath)
  assert.equal(fixture.remote(), 'contenuto target aggiornato')
})

test('confronta file binari senza trasformarli in testo', async (t) => {
  const fixture = createFixture(t, Buffer.from([0, 1, 2, 3]))
  const tracked = await downloadFixture(fixture)
  const comparison = await fixture.service.compare('/tmp/workspace-a', tracked.id)

  assert.equal(comparison.binary, true)
  assert.equal(comparison.remoteContent, undefined)
  assert.equal(comparison.localContent, undefined)
})

test('isola connessioni e trasferimenti per workspace', async (t) => {
  const fixture = createFixture(t)
  await assert.rejects(() => fixture.service.browse('/tmp/workspace-b', 'connection-a'), /REMOTE_BROWSE_FAILED/)
  assert.equal(fixture.service.cancelTransfer('/tmp/workspace-b', 'missing-transfer'), false)
})

test('closeWorkspace annulla operazioni e transfer pendenti e drena le risorse una sola volta', async (t) => {
  let listCalls = 0
  let pendingStarted = 0
  let notifyPendingStarted
  const pendingStartedPromise = new Promise((resolve) => { notifyPendingStarted = resolve })
  let closeWorkspaceCalls = 0
  const pendingUntilAbort = (signal) => new Promise((resolve, reject) => {
    pendingStarted += 1
    if (pendingStarted === 2) notifyPendingStarted()
    const abort = () => {
      const error = new Error('operazione annullata dal lifecycle')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
  const fixture = createFixture(t, 'contenuto remoto', null, {
    lifecycleTimeoutMs: 100,
    sftp: {
      list: async (_connection, _remotePath, signal) => {
        listCalls += 1
        if (listCalls === 1) return [{ name: 'config.json', kind: 'file', size: 16, mode: 0o640, modifiedAt: 10, linkTarget: null, destructiveAllowed: true }]
        return pendingUntilAbort(signal)
      },
      download: async (_connection, _remotePath, _localPath, signal) => pendingUntilAbort(signal),
      closeWorkspace: async (workspacePath) => {
        assert.equal(workspacePath, '/tmp/workspace-a')
        closeWorkspaceCalls += 1
      },
    },
  })
  const listing = await fixture.service.browse('/tmp/workspace-a', 'connection-a')
  const downloadResult = fixture.service.downloadAndTrack('/tmp/workspace-a', listing.entries[0].id).catch((error) => error)
  const browseResult = fixture.service.browse('/tmp/workspace-a', 'connection-a').catch((error) => error)
  await pendingStartedPromise
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 1, transfers: 1, operations: 2 })

  const firstClose = fixture.service.closeWorkspace('/tmp/workspace-a')
  const secondClose = fixture.service.closeWorkspace('/tmp/workspace-a')
  assert.equal(firstClose, secondClose)
  await Promise.all([firstClose, secondClose])

  assert.match((await downloadResult).message, /REMOTE_TRANSFER_CANCELLED/)
  assert.match((await browseResult).message, /REMOTE_BROWSE_FAILED/)
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 0, transfers: 0, operations: 0 })
  assert.equal(fixture.transfers.at(-1).state, 'cancelled')
  assert.equal(closeWorkspaceCalls, 1)
  await fixture.service.closeWorkspace('/tmp/workspace-a')
  assert.equal(closeWorkspaceCalls, 1)
})

test('il timeout di closeWorkspace conserva le risorse vive, scarta il risultato stale e consente retry', async (t) => {
  let listCalls = 0
  let resolvePending
  let pendingStarted
  const started = new Promise((resolve) => { pendingStarted = resolve })
  const pending = new Promise((resolve) => { resolvePending = resolve })
  let closeWorkspaceCalls = 0
  const fixture = createFixture(t, 'contenuto remoto', null, {
    lifecycleTimeoutMs: 20,
    sftp: {
      list: async () => {
        listCalls += 1
        if (listCalls === 1) return [{ name: 'config.json', kind: 'file', size: 16, mode: 0o640, modifiedAt: 10, linkTarget: null, destructiveAllowed: true }]
        pendingStarted()
        return pending
      },
      closeWorkspace: async () => { closeWorkspaceCalls += 1 },
    },
  })
  await fixture.service.browse('/tmp/workspace-a', 'connection-a')
  const staleBrowse = fixture.service.browse('/tmp/workspace-a', 'connection-a').catch((error) => error)
  await started

  await assert.rejects(
    () => fixture.service.closeWorkspace('/tmp/workspace-a'),
    (error) => error?.code === 'REMOTE_LIFECYCLE_TIMEOUT',
  )
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 1, transfers: 0, operations: 1 })
  await assert.rejects(() => fixture.service.browse('/tmp/workspace-a', 'connection-a'), /REMOTE_BROWSE_FAILED/)

  resolvePending([{ name: 'stale.json', kind: 'file', size: 4, mode: 0o640, modifiedAt: 11, linkTarget: null, destructiveAllowed: true }])
  assert.match((await staleBrowse).message, /REMOTE_BROWSE_FAILED/)
  assert.equal(fixture.service.getResourceCounts().operations, 0)

  await fixture.service.closeWorkspace('/tmp/workspace-a')
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 0, transfers: 0, operations: 0 })
  assert.equal(closeWorkspaceCalls, 2)
  await fixture.service.closeWorkspace('/tmp/workspace-a')
  assert.equal(closeWorkspaceCalls, 2)
})

test('closeAll propaga il failure senza cancellare i registri e il retry completa exactly-once', async (t) => {
  let closeAllCalls = 0
  const fixture = createFixture(t, 'contenuto remoto', null, {
    sftp: {
      closeAll: async () => {
        closeAllCalls += 1
        if (closeAllCalls === 1) throw new Error('cleanup SFTP non confermato')
      },
    },
  })
  await fixture.service.browse('/tmp/workspace-a', 'connection-a')

  await assert.rejects(() => fixture.service.closeAll(), /cleanup SFTP non confermato/)
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 1, transfers: 0, operations: 0 })
  await assert.rejects(() => fixture.service.browse('/tmp/workspace-a', 'connection-a'), /REMOTE_BROWSE_FAILED/)

  await fixture.service.closeAll()
  assert.deepEqual(fixture.service.getResourceCounts(), { entries: 0, transfers: 0, operations: 0 })
  assert.equal(closeAllCalls, 2)
  await fixture.service.closeAll()
  assert.equal(closeAllCalls, 2)
})

test('mostra una copia locale nel Finder senza esporre il percorso al renderer', async (t) => {
  const fixture = createFixture(t)
  const tracked = await downloadFixture(fixture)

  assert.deepEqual(await fixture.service.revealLocal('/tmp/workspace-a', tracked.id), { revealed: true })
  assert.equal(fixture.revealed.length, 1)
  assert.equal(path.basename(fixture.revealed[0]), `${tracked.id}.json`)
})

test('il percorso runtime dei file remoti non usa API filesystem sincrone', () => {
  for (const fileName of [
    'domains/remote-files/remote-file-service.cjs',
    'infrastructure/remote/remote-file-io.adapter.cjs',
    'infrastructure/remote/remote-file-store.adapter.cjs',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron', fileName), 'utf8')
    assert.doesNotMatch(source, /\bfs\.[A-Za-z]+Sync\s*\(/, `${fileName} contiene ancora I/O filesystem sincrono`)
  }
})
