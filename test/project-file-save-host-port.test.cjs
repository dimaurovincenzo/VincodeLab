const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  PROJECT_FILE_SAVE_HOST_METHODS,
  createProjectFileSaveHostPort,
} = require('../electron/domains/filesystem/project-file-save-host.port.cjs')
const { createFileRevision } = require('../electron/domains/filesystem/project-file-revision.cjs')
const { createProjectFileSaver } = require('../electron/domains/filesystem/project-file-save.cjs')
const projectFiles = require('../electron/domains/filesystem/project-files.cjs')
const {
  createProjectFileSaveFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-file-save-filesystem.adapter.cjs')
const {
  createProjectFileReaderFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-file-reader-filesystem.adapter.cjs')

const TOO_LARGE_MESSAGE = 'Il file supera 1 MiB e non può essere salvato nell’editor.'

function snapshot(content, mtimeMs) {
  const buffer = Buffer.from(content)
  return { buffer, mtimeMs, size: buffer.length }
}

test('la porta save espone soltanto le primitive host richieste, preserva il receiver ed è immutabile', async () => {
  const implementation = {
    prefix: 'host',
    exists() { return this.prefix === 'host' },
    prepareSave(_workspacePath, fileId) { return { id: `${this.prefix}-${fileId}` } },
    async readBounded() { return snapshot(this.prefix, 1) },
    readMode() { return this.prefix === 'host' ? 0o755 : 0 },
    writeAtomic(_handle, content) { this.written = content },
  }
  const port = createProjectFileSaveHostPort(implementation)

  assert.deepEqual(PROJECT_FILE_SAVE_HOST_METHODS, ['prepareSave', 'exists', 'readBounded', 'readMode', 'writeAtomic'])
  assert.deepEqual(Object.keys(port), PROJECT_FILE_SAVE_HOST_METHODS)
  assert.equal(Object.isFrozen(port), true)
  const handle = port.prepareSave('/workspace', 'file.txt', false)
  assert.equal(handle.id, 'host-file.txt')
  assert.equal(port.exists(handle), true)
  assert.equal((await port.readBounded(handle, 10, 'grande')).buffer.toString(), 'host')
  assert.equal(port.readMode(handle), 0o755)
  port.writeAtomic(handle, 'nuovo', 0o644)
  assert.equal(implementation.written, 'nuovo')
  assert.throws(() => createProjectFileSaveHostPort({}), /incompleta: prepareSave/)
  assert.throws(() => createProjectFileSaveHostPort(null), /non valida/)
  assert.throws(() => createProjectFileSaver({}), /non valida/)
})

test('il dominio conserva ordine, revisione, mode eseguibile, limiti e DTO del salvataggio', async () => {
  const events = []
  const handle = {}
  let current = snapshot('prima\n', 1)
  const originalRevision = createFileRevision(current.buffer, current)
  const saver = createProjectFileSaver(createProjectFileSaveHostPort({
    prepareSave(workspacePath, fileId, force) {
      events.push(['prepare', workspacePath, fileId, force])
      return handle
    },
    exists() {
      events.push(['exists'])
      return true
    },
    async readBounded(received, maxSize, tooLargeMessage) {
      events.push(['read', received, maxSize, tooLargeMessage])
      return current
    },
    readMode(received) {
      events.push(['mode', received])
      return 0o100755
    },
    writeAtomic(received, content, mode) {
      events.push(['write', received, content, mode])
      current = snapshot(content, 2)
    },
  }))

  assert.equal(Object.isFrozen(saver), true)
  assert.deepEqual(Object.keys(saver), ['saveProjectFile'])
  assert.equal(saver.saveProjectFile.length, 4)
  const saved = await saver.saveProjectFile('/workspace', 'script.sh', 'dopo\n', { revision: originalRevision })
  assert.deepEqual(saved, {
    id: 'script.sh',
    revision: createFileRevision(current.buffer, current),
    size: 5,
  })
  assert.deepEqual(events, [
    ['prepare', '/workspace', 'script.sh', false],
    ['read', handle, 1_000_000, TOO_LARGE_MESSAGE],
    ['mode', handle],
    ['write', handle, 'dopo\n', 0o755],
    ['read', handle, 1_000_000, TOO_LARGE_MESSAGE],
  ])
})

test('content e options falliscono prima del target, mentre una revisione diversa precede mode e write', async () => {
  const events = []
  const current = snapshot('corrente\n', 1)
  const saver = createProjectFileSaver(createProjectFileSaveHostPort({
    prepareSave() {
      events.push('prepare')
      return {}
    },
    exists() {
      events.push('exists')
      return true
    },
    async readBounded() {
      events.push('read')
      return current
    },
    readMode() {
      events.push('mode')
      return 0o644
    },
    writeAtomic() {
      events.push('write')
    },
  }))

  await assert.rejects(() => saver.saveProjectFile('/workspace', 'file.txt', null, null), /contenuto supera/)
  assert.deepEqual(events, [])
  await assert.rejects(() => saver.saveProjectFile('/workspace', 'file.txt', 'locale\n'), /Opzioni salvataggio file non valide/)
  assert.deepEqual(events, [])
  await assert.rejects(
    () => saver.saveProjectFile('/workspace', 'file.txt', 'locale\n', { revision: `v1-${'A'.repeat(43)}` }),
    (error) => error?.code === 'FILESYSTEM_EXTERNAL_CONFLICT',
  )
  assert.deepEqual(events, ['prepare', 'read'])
})

test('il dominio mappa soltanto gli errori esterni pre-write dei salvataggi non forzati', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  const targetFailure = createProjectFileSaver(createProjectFileSaveHostPort({
    prepareSave() { throw missing },
    exists() { return false },
    async readBounded() { throw new Error('non usato') },
    readMode() { return 0o644 },
    writeAtomic() {},
  }))
  await assert.rejects(
    () => targetFailure.saveProjectFile('/workspace', 'file.txt', 'locale\n', { revision: `v1-${'A'.repeat(43)}` }),
    (error) => error?.code === 'FILESYSTEM_EXTERNAL_CONFLICT',
  )
  await assert.rejects(
    () => targetFailure.saveProjectFile('/workspace', 'file.txt', 'locale\n', { force: true }),
    (error) => error === missing,
  )

  const readFailure = createProjectFileSaver(createProjectFileSaveHostPort({
    prepareSave() { return {} },
    exists() { return true },
    async readBounded() { throw new Error('Il file è cambiato durante la lettura. Riprova.') },
    readMode() { return 0o644 },
    writeAtomic() {},
  }))
  await assert.rejects(
    () => readFailure.saveProjectFile('/workspace', 'file.txt', 'locale\n', { revision: `v1-${'A'.repeat(43)}` }),
    (error) => error?.code === 'FILESYSTEM_EXTERNAL_CONFLICT',
  )
  await assert.rejects(
    () => readFailure.saveProjectFile('/workspace', 'file.txt', 'locale\n', { force: true }),
    /cambiato durante la lettura/,
  )
})

test('force su target mancante salta lettura corrente e usa il mode storico 0644', async () => {
  const events = []
  const handle = {}
  let saved = snapshot('', 1)
  const saver = createProjectFileSaver(createProjectFileSaveHostPort({
    prepareSave(_workspacePath, _fileId, force) {
      events.push(['prepare', force])
      return handle
    },
    exists(received) {
      events.push(['exists', received])
      return false
    },
    async readBounded(received) {
      events.push(['read', received])
      return saved
    },
    readMode() {
      events.push(['mode'])
      return 0o755
    },
    writeAtomic(received, content, mode) {
      events.push(['write', received, content, mode])
      saved = snapshot(content, 2)
    },
  }))

  const result = await saver.saveProjectFile('/workspace', 'nuovo.txt', 'creato\n', { force: true })
  assert.equal(result.id, 'nuovo.txt')
  assert.deepEqual(events, [
    ['prepare', true],
    ['exists', handle],
    ['write', handle, 'creato\n', 0o644],
    ['read', handle],
  ])
})

test('un mismatch dopo la scrittura produce il conflitto pubblico senza nascondere che write è avvenuta', async () => {
  const current = snapshot('prima\n', 1)
  const revision = createFileRevision(current.buffer, current)
  let reads = 0
  let writes = 0
  const saver = createProjectFileSaver(createProjectFileSaveHostPort({
    prepareSave() { return {} },
    exists() { return true },
    async readBounded() {
      reads += 1
      return reads === 1 ? current : snapshot('diverso\n', 2)
    },
    readMode() { return 0o644 },
    writeAtomic() { writes += 1 },
  }))

  await assert.rejects(
    () => saver.saveProjectFile('/workspace', 'file.txt', 'locale\n', { revision }),
    (error) => error?.code === 'FILESYSTEM_EXTERNAL_CONFLICT',
  )
  assert.equal(writes, 1)
  assert.equal(reads, 2)
})

test('l adapter confina il path in handle opachi e rifiuta handle contraffatti o di altre istanze', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-save-handle-'))
  try {
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'prima\n')
    const host = createProjectFileSaveFilesystemAdapter()
    const handle = host.prepareSave(workspace, 'file.txt', false)
    assert.equal(Object.isFrozen(handle), true)
    assert.deepEqual(Object.keys(handle), [])
    assert.equal('filePath' in handle, false)
    assert.equal(host.exists(handle), true)

    const forged = {}
    assert.throws(() => host.exists(forged), /Handle salvataggio file progetto non valido/)
    assert.throws(() => host.readMode(forged), /Handle salvataggio file progetto non valido/)
    assert.throws(() => host.writeAtomic(forged, 'dati', 0o644), /Handle salvataggio file progetto non valido/)
    await assert.rejects(() => host.readBounded(forged, 1_000_000, TOO_LARGE_MESSAGE), /Handle salvataggio file progetto non valido/)

    const otherHost = createProjectFileSaveFilesystemAdapter()
    assert.throws(() => otherHost.exists(handle), /Handle salvataggio file progetto non valido/)
    await assert.rejects(() => otherHost.readBounded(handle, 1_000_000, TOO_LARGE_MESSAGE), /Handle salvataggio file progetto non valido/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('reader e saver condividono la stessa bounded read con risultati equivalenti', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-shared-read-'))
  try {
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'contenuto\n')
    const readerHost = createProjectFileReaderFilesystemAdapter()
    const saveHost = createProjectFileSaveFilesystemAdapter()
    const readerTarget = readerHost.prepareRead(workspace, 'file.txt')
    const saveTarget = saveHost.prepareSave(workspace, 'file.txt', false)

    const [readerSnapshot, saveSnapshot] = await Promise.all([
      readerHost.readBounded(readerTarget.handle, 1_000_000, TOO_LARGE_MESSAGE),
      saveHost.readBounded(saveTarget, 1_000_000, TOO_LARGE_MESSAGE),
    ])
    assert.equal(readerSnapshot.buffer.toString(), saveSnapshot.buffer.toString())
    assert.equal(readerSnapshot.size, saveSnapshot.size)
    assert.equal(readerSnapshot.mtimeMs, saveSnapshot.mtimeMs)

    const readerSource = fs.readFileSync(path.join(__dirname, '../electron/infrastructure/filesystem/project-file-reader-filesystem.adapter.cjs'), 'utf8')
    const saveSource = fs.readFileSync(path.join(__dirname, '../electron/infrastructure/filesystem/project-file-save-filesystem.adapter.cjs'), 'utf8')
    assert.match(readerSource, /project-file-io-filesystem\.service\.cjs/)
    assert.match(saveSource, /project-file-io-filesystem\.service\.cjs/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('l adapter reale conserva force missing e l ordine storico della validazione target', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-save-force-'))
  try {
    const saver = createProjectFileSaver(createProjectFileSaveFilesystemAdapter())
    const result = await saver.saveProjectFile(workspace, 'nuovo.sh', '#!/bin/zsh\n', { force: true })
    assert.equal(fs.readFileSync(path.join(workspace, 'nuovo.sh'), 'utf8'), '#!/bin/zsh\n')
    assert.equal(fs.statSync(path.join(workspace, 'nuovo.sh')).mode & 0o777, 0o644)
    assert.match(result.revision, /^v1-[A-Za-z0-9_-]{43}$/u)

    await assert.rejects(
      () => saver.saveProjectFile(workspace, 'node_modules/../file.txt', 'x', { force: true }),
      /cartella di sistema non è accessibile/,
    )
    await assert.rejects(
      () => saver.saveProjectFile(workspace, 'node_modules/../file.txt', 'x', { revision: result.revision }),
      /Percorso file non valido/,
    )
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('facade e main compongono il saver mantenendo saveProjectFile nell IPC', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.equal(projectFiles.createProjectFileSaver, createProjectFileSaver)
  assert.match(main, /createProjectFileSaveFilesystemAdapter/)
  assert.match(main, /const \{ saveProjectFile \} = createProjectFileSaver\(createProjectFileSaveFilesystemAdapter\(\)\)/)
  assert.match(main, /registerFilesystemIpc\(\{[\s\S]*?saveProjectFile,/)
})
