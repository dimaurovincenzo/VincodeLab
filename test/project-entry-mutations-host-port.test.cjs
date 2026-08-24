const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  PROJECT_ENTRY_DUPLICATE_RESULTS,
  PROJECT_ENTRY_MUTATIONS_HOST_METHODS,
  createProjectEntryMutationsHostPort,
} = require('../electron/domains/filesystem/project-entry-mutations-host.port.cjs')
const { createProjectEntryMutations } = require('../electron/domains/filesystem/project-entry-mutations.cjs')
const projectFiles = require('../electron/domains/filesystem/project-files.cjs')
const {
  createProjectEntryMutationsFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-entry-mutations-filesystem.adapter.cjs')

function mutationPort(overrides = {}) {
  return createProjectEntryMutationsHostPort({
    prepareDirectory() { return {} },
    createFileExclusive() { return { mtimeMs: 1, size: 0 } },
    createDirectoryExclusive() { return true },
    prepareRename() { return {} },
    rename() { return true },
    async prepareDuplicate(_workspacePath, entryId) {
      return { handle: {}, name: entryId.split('/').at(-1), status: PROJECT_ENTRY_DUPLICATE_RESULTS.ready }
    },
    async tryDuplicate() { return PROJECT_ENTRY_DUPLICATE_RESULTS.created },
    async disposeDuplicate() {},
    ...overrides,
  })
}

test('la porta mutazioni espone solo il lifecycle host richiesto, preserva il receiver ed è immutabile', async () => {
  const implementation = {
    prefix: 'host',
    prepareDirectory() { return { owner: this.prefix } },
    createFileExclusive() { return { mtimeMs: this.prefix.length, size: 0 } },
    createDirectoryExclusive() { return this.prefix === 'host' },
    prepareRename() { return { owner: this.prefix } },
    rename() { return this.prefix === 'host' },
    async prepareDuplicate() { return { owner: this.prefix } },
    async tryDuplicate() { return this.prefix },
    async disposeDuplicate() { this.disposed = true },
  }
  const port = createProjectEntryMutationsHostPort(implementation)

  assert.deepEqual(PROJECT_ENTRY_MUTATIONS_HOST_METHODS, [
    'prepareDirectory',
    'createFileExclusive',
    'createDirectoryExclusive',
    'prepareRename',
    'rename',
    'prepareDuplicate',
    'tryDuplicate',
    'disposeDuplicate',
  ])
  assert.deepEqual(Object.keys(port), PROJECT_ENTRY_MUTATIONS_HOST_METHODS)
  assert.equal(Object.isFrozen(port), true)
  assert.equal(port.prepareDirectory().owner, 'host')
  assert.equal(port.createFileExclusive().mtimeMs, 4)
  assert.equal(port.createDirectoryExclusive(), true)
  assert.equal(port.prepareRename().owner, 'host')
  assert.equal(port.rename(), true)
  assert.equal((await port.prepareDuplicate()).owner, 'host')
  assert.equal(await port.tryDuplicate(), 'host')
  await port.disposeDuplicate()
  assert.equal(implementation.disposed, true)
  assert.throws(() => createProjectEntryMutationsHostPort({}), /incompleta: prepareDirectory/)
  assert.throws(() => createProjectEntryMutationsHostPort(null), /non valida/)
  assert.throws(() => createProjectEntryMutations({}), /non valida/)
})

test('il dominio conserva firme, ordine create, mode, revisioni e DTO', () => {
  const events = []
  const directoryHandle = {}
  const mutations = createProjectEntryMutations(mutationPort({
    prepareDirectory(workspacePath, directoryId) {
      events.push(['prepare-directory', workspacePath, directoryId])
      return directoryHandle
    },
    createFileExclusive(handle, name, mode) {
      events.push(['create-file', handle, name, mode])
      return { mtimeMs: 2, size: 0 }
    },
    createDirectoryExclusive(handle, name, mode) {
      events.push(['create-directory', handle, name, mode])
      return true
    },
  }))

  assert.equal(Object.isFrozen(mutations), true)
  assert.deepEqual(Object.keys(mutations), [
    'createProjectDirectory',
    'createProjectFile',
    'duplicateProjectEntry',
    'renameProjectEntry',
  ])
  assert.equal(mutations.createProjectDirectory.length, 3)
  assert.equal(mutations.createProjectFile.length, 3)
  assert.equal(mutations.duplicateProjectEntry.length, 3)
  assert.equal(mutations.renameProjectEntry.length, 4)

  const file = mutations.createProjectFile('/workspace', 'src', 'file.ts')
  assert.deepEqual({ ...file, revision: undefined }, {
    id: 'src/file.ts', name: 'file.ts', content: '', revision: undefined, size: 0,
  })
  assert.match(file.revision, /^v1-[A-Za-z0-9_-]{43}$/u)
  assert.deepEqual(mutations.createProjectDirectory('/workspace', 'src', 'components'), {
    id: 'src/components', kind: 'directory', name: 'components',
  })
  assert.deepEqual(events, [
    ['prepare-directory', '/workspace', 'src'],
    ['create-file', directoryHandle, 'file.ts', 0o644],
    ['prepare-directory', '/workspace', 'src'],
    ['create-directory', directoryHandle, 'components', 0o755],
  ])
})

test('create conserva collisioni e la diversa traduzione ENOENT tra file e directory', () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  const missingMutations = createProjectEntryMutations(mutationPort({
    prepareDirectory() { throw missing },
  }))
  assert.throws(() => missingMutations.createProjectFile('/workspace', 'missing', 'file.txt'), /Cartella non trovata/)
  assert.throws(
    () => missingMutations.createProjectDirectory('/workspace', 'missing', 'child'),
    (error) => error === missing,
  )

  const collisionMutations = createProjectEntryMutations(mutationPort({
    createFileExclusive() { return null },
    createDirectoryExclusive() { return false },
    rename() { return false },
  }))
  assert.throws(() => collisionMutations.createProjectFile('/workspace', '', 'file.txt'), /file con questo nome esiste già/)
  assert.throws(() => collisionMutations.createProjectDirectory('/workspace', '', 'docs'), /elemento con questo nome esiste già/)
  assert.throws(() => collisionMutations.renameProjectEntry('/workspace', 'file.txt', 'other.txt', 'file'), /elemento con questo nome esiste già/)
})

test('rename no-op risolve la source ma non usa rename o reservation', () => {
  const events = []
  const mutations = createProjectEntryMutations(mutationPort({
    prepareRename(workspacePath, entryId, expectedKind) {
      events.push(['prepare', workspacePath, entryId, expectedKind])
      return {}
    },
    rename() {
      events.push(['rename'])
      return true
    },
  }))

  assert.deepEqual(mutations.renameProjectEntry('/workspace', 'src/file.txt', 'file.txt', 'file'), {
    id: 'src/file.txt', kind: 'file', name: 'file.txt', previousId: 'src/file.txt', renamed: false,
  })
  assert.deepEqual(events, [['prepare', '/workspace', 'src/file.txt', 'file']])

  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  const missingSource = createProjectEntryMutations(mutationPort({ prepareRename() { throw missing } }))
  assert.throws(
    () => missingSource.renameProjectEntry('/workspace', 'src/file.txt', 'file.txt', 'file'),
    (error) => error === missing,
  )
})

test('duplicate mantiene naming dotfile, ultima estensione e directory senza trattare i punti come estensione', async () => {
  async function duplicateName(sourceName, expectedKind) {
    let candidate
    let disposed = 0
    const mutations = createProjectEntryMutations(mutationPort({
      async prepareDuplicate() {
        return { handle: {}, name: sourceName, status: PROJECT_ENTRY_DUPLICATE_RESULTS.ready }
      },
      async tryDuplicate(_handle, name) {
        candidate = name
        return PROJECT_ENTRY_DUPLICATE_RESULTS.created
      },
      async disposeDuplicate() { disposed += 1 },
    }))
    const result = await mutations.duplicateProjectEntry('/workspace', sourceName, expectedKind)
    assert.equal(disposed, 1)
    assert.equal(result.name, candidate)
    return candidate
  }

  assert.equal(await duplicateName('.env', 'file'), '.env copia')
  assert.equal(await duplicateName('.env.production', 'file'), '.env copia.production')
  assert.equal(await duplicateName('archive.tar.gz', 'file'), 'archive.tar copia.gz')
  assert.equal(await duplicateName('src.v1', 'directory'), 'src.v1 copia')
})

test('duplicate dispone sempre la source su successo, failure e dopo esattamente 1000 collisioni', async () => {
  let disposed = 0
  const success = createProjectEntryMutations(mutationPort({
    async disposeDuplicate() { disposed += 1 },
  }))
  await success.duplicateProjectEntry('/workspace', 'file.txt', 'file')
  assert.equal(disposed, 1)

  const failure = createProjectEntryMutations(mutationPort({
    async tryDuplicate() { throw new Error('copy failure') },
    async disposeDuplicate() { disposed += 1 },
  }))
  await assert.rejects(() => failure.duplicateProjectEntry('/workspace', 'file.txt', 'file'), /copy failure/)
  assert.equal(disposed, 2)

  const candidates = []
  const exhausted = createProjectEntryMutations(mutationPort({
    async tryDuplicate(_handle, name) {
      candidates.push(name)
      return PROJECT_ENTRY_DUPLICATE_RESULTS.collision
    },
    async disposeDuplicate() { disposed += 1 },
  }))
  await assert.rejects(
    () => exhausted.duplicateProjectEntry('/workspace', 'file.txt', 'file'),
    /Impossibile trovare un nome disponibile/,
  )
  assert.equal(candidates.length, 1_000)
  assert.equal(candidates[0], 'file copia.txt')
  assert.equal(candidates.at(-1), 'file copia 1000.txt')
  assert.equal(disposed, 3)
})

test('duplicate traduce failure di copia e dispone la source prima di propagare', async () => {
  for (const [result, message] of [
    [PROJECT_ENTRY_DUPLICATE_RESULTS.sourceChanged, /cambiato durante la duplicazione/],
    [PROJECT_ENTRY_DUPLICATE_RESULTS.copyIncomplete, /non è stata completata/],
  ]) {
    let disposed = 0
    const mutations = createProjectEntryMutations(mutationPort({
      async tryDuplicate() { return result },
      async disposeDuplicate() { disposed += 1 },
    }))
    await assert.rejects(() => mutations.duplicateProjectEntry('/workspace', 'file.txt', 'file'), message)
    assert.equal(disposed, 1)
  }
})

test('i limiti directory ammettono 5000 entry e 64 MiB esatti ma rifiutano il primo eccesso', async () => {
  async function* entries(count, size = 0) {
    for (let index = 0; index < count; index += 1) {
      yield { kind: 'file', name: `file-${index}`, size: index === 0 ? size : 0 }
    }
  }

  function mutationsFor(directoryEntries) {
    return createProjectEntryMutations(mutationPort({
      async prepareDuplicate(_workspacePath, _entryId, _expectedKind, policies) {
        await policies.inspectDirectory(directoryEntries)
        return { handle: {}, name: 'src', status: PROJECT_ENTRY_DUPLICATE_RESULTS.ready }
      },
    }))
  }

  await mutationsFor(entries(5_000)).duplicateProjectEntry('/workspace', 'src', 'directory')
  await mutationsFor(entries(1, 64 * 1024 * 1024)).duplicateProjectEntry('/workspace', 'src', 'directory')
  await assert.rejects(
    () => mutationsFor(entries(5_001)).duplicateProjectEntry('/workspace', 'src', 'directory'),
    /5\.000 elementi o 64 MiB/,
  )
  await assert.rejects(
    () => mutationsFor(entries(1, 64 * 1024 * 1024 + 1)).duplicateProjectEntry('/workspace', 'src', 'directory'),
    /5\.000 elementi o 64 MiB/,
  )
})

test('l adapter usa handle opachi confinati, conserva collisioni e invalida la source dopo dispose', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-mutations-host-'))
  try {
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'contenuto\n')
    fs.writeFileSync(path.join(workspace, 'existing.txt'), 'non sovrascrivere\n')
    fs.mkdirSync(path.join(workspace, 'docs'))
    const host = createProjectEntryMutationsFilesystemAdapter()
    const directoryHandle = host.prepareDirectory(workspace, '')
    assert.equal(Object.isFrozen(directoryHandle), true)
    assert.deepEqual(Object.keys(directoryHandle), [])
    assert.equal('directoryPath' in directoryHandle, false)
    assert.equal(host.createFileExclusive(directoryHandle, 'existing.txt', 0o644), null)
    assert.equal(host.createDirectoryExclusive(directoryHandle, 'docs', 0o755), false)
    assert.equal(fs.readFileSync(path.join(workspace, 'existing.txt'), 'utf8'), 'non sovrascrivere\n')

    assert.throws(() => host.createFileExclusive({}, 'new.txt', 0o644), /Handle mutazione progetto non valido/)
    assert.throws(() => host.rename(directoryHandle, 'renamed.txt'), /Handle mutazione progetto non valido/)
    await assert.rejects(() => host.tryDuplicate({}, 'copy.txt'), /Handle mutazione progetto non valido/)
    await assert.rejects(() => host.disposeDuplicate({}), /Handle mutazione progetto non valido/)

    const prepared = await host.prepareDuplicate(workspace, 'file.txt', 'file', {})
    assert.equal(prepared.status, PROJECT_ENTRY_DUPLICATE_RESULTS.ready)
    assert.equal(Object.isFrozen(prepared.handle), true)
    assert.deepEqual(Object.keys(prepared.handle), [])
    await host.disposeDuplicate(prepared.handle)
    await assert.rejects(() => host.tryDuplicate(prepared.handle, 'file copia.txt'), /Handle mutazione progetto non valido/)

    const otherHost = createProjectEntryMutationsFilesystemAdapter()
    await assert.rejects(() => otherHost.disposeDuplicate(prepared.handle), /Handle mutazione progetto non valido/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('dominio e adapter mantengono separati policy e primitive operative', () => {
  const domain = fs.readFileSync(path.join(__dirname, '../electron/domains/filesystem/project-entry-mutations.cjs'), 'utf8')
  const adapter = fs.readFileSync(path.join(__dirname, '../electron/infrastructure/filesystem/project-entry-mutations-filesystem.adapter.cjs'), 'utf8')

  assert.doesNotMatch(domain, /node:fs|node:path|O_EXCL|O_NOFOLLOW|openSync|randomUUID|\.vincodelab-duplicate-/)
  assert.match(domain, /MAX_DUPLICATE_NAME_ATTEMPTS = 1_000/)
  assert.match(domain, /MAX_DIRECTORY_DUPLICATE_ENTRIES = 5_000/)
  assert.match(domain, /MAX_DIRECTORY_DUPLICATE_BYTES = 64 \* 1024 \* 1024/)
  assert.match(adapter, /O_EXCL/)
  assert.match(adapter, /O_NOFOLLOW/)
  assert.match(adapter, /\.vincodelab-duplicate-/)
  assert.match(adapter, /reserveDestination/)
  assert.match(adapter, /releaseReservedDestination/)
})

test('facade e main compongono le mutazioni mantenendo le firme IPC', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.equal(projectFiles.createProjectEntryMutations, createProjectEntryMutations)
  assert.match(main, /createProjectEntryMutationsFilesystemAdapter/)
  assert.match(main, /\} = createProjectEntryMutations\(createProjectEntryMutationsFilesystemAdapter\(\)\)/)
  for (const operation of ['createProjectDirectory', 'createProjectFile', 'duplicateProjectEntry', 'renameProjectEntry']) {
    assert.match(main, new RegExp(`registerFilesystemIpc\\(\\{[\\s\\S]*?${operation},`))
  }
})
