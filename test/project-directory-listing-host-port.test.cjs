const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  PROJECT_DIRECTORY_LISTING_HOST_METHODS,
  createProjectDirectoryListingHostPort,
} = require('../electron/domains/filesystem/project-directory-listing-host.port.cjs')
const {
  collectDirectoryEntries,
  createProjectDirectoryListing,
} = require('../electron/domains/filesystem/project-directory-listing.cjs')
const {
  createProjectDirectoryListingFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-directory-listing-filesystem.adapter.cjs')
const projectFiles = require('../electron/domains/filesystem/project-files.cjs')

async function* records(values) {
  for (const value of values) yield value
}

test('la porta listing espone un solo metodo semantico, preserva il receiver ed è immutabile', async () => {
  const implementation = {
    prefix: 'src',
    async openDirectory() {
      return { directoryId: this.prefix, entries: records([]) }
    },
  }
  const port = createProjectDirectoryListingHostPort(implementation)

  assert.deepEqual(PROJECT_DIRECTORY_LISTING_HOST_METHODS, ['openDirectory'])
  assert.deepEqual(Object.keys(port), PROJECT_DIRECTORY_LISTING_HOST_METHODS)
  assert.equal(Object.isFrozen(port), true)
  assert.equal((await port.openDirectory()).directoryId, 'src')
  assert.throws(() => createProjectDirectoryListingHostPort({}), /incompleta: openDirectory/)
  assert.throws(() => createProjectDirectoryListingHostPort(null), /non valida/)
})

test('facade e composition root iniettano l adapter senza cambiare le funzioni consegnate all IPC', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.equal(projectFiles.createProjectDirectoryListing, createProjectDirectoryListing)
  assert.doesNotMatch(main, /require\('\.\/domains\/filesystem\/project-directory-listing\.cjs'\)/)
  assert.match(main, /createProjectDirectoryListingFilesystemAdapter/)
  assert.match(main, /const \{ listDirectoryEntries, listProjectFiles \} = createProjectDirectoryListing\(createProjectDirectoryListingFilesystemAdapter\(\)\)/)
  assert.match(main, /registerFilesystemIpc\(\{[\s\S]*?listDirectoryEntries,[\s\S]*?listProjectFiles,/)
})

test('il dominio mantiene ordering, esclusioni, symlink e DTO senza conoscere Dirent', async () => {
  const requested = []
  const listing = createProjectDirectoryListing(createProjectDirectoryListingHostPort({
    async openDirectory(workspacePath, directoryId) {
      requested.push([workspacePath, directoryId])
      return {
        directoryId: 'src/nested',
        entries: records([
          { kind: 'file', name: 'zeta.txt' },
          { kind: 'directory', name: 'zeta' },
          { kind: 'symbolic-link', name: 'Node_Modules' },
          { kind: 'directory', name: 'node_modules' },
          { kind: 'unsupported', name: 'socket' },
          { kind: 'directory', name: '.hidden' },
          { kind: 'file', name: '.env' },
          { kind: 'directory', name: 'alpha' },
        ]),
      }
    },
  }))

  const result = await listing.listDirectoryEntries('/workspace', '/src//nested/')

  assert.deepEqual(requested, [['/workspace', '/src//nested/']])
  assert.deepEqual(result, {
    entries: [
      { id: 'src/nested/.hidden', kind: 'directory', name: '.hidden' },
      { id: 'src/nested/alpha', kind: 'directory', name: 'alpha' },
      { id: 'src/nested/zeta', kind: 'directory', name: 'zeta' },
      { id: 'src/nested/.env', kind: 'file', name: '.env' },
      { id: 'src/nested/Node_Modules', kind: 'file', name: 'Node_Modules' },
      { id: 'src/nested/zeta.txt', kind: 'file', name: 'zeta.txt' },
    ],
    truncated: false,
  })
})

test('il dominio mantiene heap bounded, limite 1000, truncation e yield durante directory enormi', async () => {
  const totalEntries = 100_000
  async function* hugeDirectory() {
    for (let index = totalEntries - 1; index >= 0; index -= 1) {
      yield { kind: 'file', name: `entry-${String(index).padStart(6, '0')}.txt` }
    }
  }

  let heartbeatActive = true
  let heartbeats = 0
  const heartbeat = () => {
    heartbeats += 1
    if (heartbeatActive) setImmediate(heartbeat)
  }
  setImmediate(heartbeat)

  const result = await collectDirectoryEntries(hugeDirectory())
  heartbeatActive = false
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.truncated, true)
  assert.equal(result.entries.length, 1_000)
  assert.ok(result.peakRetainedEntries <= 1_000)
  assert.equal(result.entries[0].name, 'entry-000000.txt')
  assert.equal(result.entries.at(-1).name, 'entry-000999.txt')
  assert.ok(heartbeats > 0)
})

test('gli errori host, stream e shape attraversano il use case senza fallback silenziosi', async () => {
  const openFailure = Object.assign(new Error('directory non leggibile'), { code: 'EACCES' })
  const openListing = createProjectDirectoryListing(createProjectDirectoryListingHostPort({
    async openDirectory() { throw openFailure },
  }))
  await assert.rejects(() => openListing.listProjectFiles('/workspace'), (error) => error === openFailure)

  const streamFailure = Object.assign(new Error('lettura interrotta'), { code: 'EIO' })
  const streamListing = createProjectDirectoryListing(createProjectDirectoryListingHostPort({
    async openDirectory() {
      return {
        directoryId: '',
        entries: {
          [Symbol.asyncIterator]() {
            return { async next() { throw streamFailure } }
          },
        },
      }
    },
  }))
  await assert.rejects(() => streamListing.listProjectFiles('/workspace'), (error) => error === streamFailure)

  const invalidSource = createProjectDirectoryListing(createProjectDirectoryListingHostPort({
    async openDirectory() { return { directoryId: '', entries: [] } },
  }))
  await assert.rejects(() => invalidSource.listProjectFiles('/workspace'), /Sorgente host elenco directory non valida/)

  const invalidRecord = createProjectDirectoryListing(createProjectDirectoryListingHostPort({
    async openDirectory() { return { directoryId: '', entries: records([{ name: 'file.txt' }]) } },
  }))
  await assert.rejects(() => invalidRecord.listProjectFiles('/workspace'), /Elemento host elenco directory non valido/)
})

test('l adapter confina i path, rifiuta directory simboliche e restituisce record neutrali', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-listing-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-listing-external-'))
  try {
    fs.mkdirSync(path.join(workspace, 'src'))
    fs.mkdirSync(path.join(workspace, 'src', 'nested'))
    fs.writeFileSync(path.join(workspace, 'src', 'nested', 'file.txt'), 'contenuto\n')
    fs.symlinkSync(external, path.join(workspace, 'outside'))

    const host = createProjectDirectoryListingFilesystemAdapter()
    const source = await host.openDirectory(workspace, '/src//nested/')
    const entries = []
    for await (const entry of source.entries) entries.push(entry)

    assert.equal(source.directoryId, 'src/nested')
    assert.deepEqual(entries, [{ kind: 'file', name: 'file.txt' }])
    assert.equal(Object.isFrozen(entries[0]), true)
    await assert.rejects(() => host.openDirectory(workspace, '../external'), /Percorso file non valido/)
    await assert.rejects(() => host.openDirectory(workspace, 'outside'), /link simbolici/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('l adapter chiude opendir sia a fine stream sia quando il consumer interrompe con errore', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-listing-close-'))
  const originalOpenDirectory = fs.promises.opendir
  const openedHandles = []
  try {
    fs.writeFileSync(path.join(workspace, 'first.txt'), 'uno\n')
    fs.writeFileSync(path.join(workspace, 'second.txt'), 'due\n')
    fs.promises.opendir = async (...args) => {
      const handle = await originalOpenDirectory(...args)
      openedHandles.push(handle)
      return handle
    }

    const host = createProjectDirectoryListingFilesystemAdapter()
    const completed = await host.openDirectory(workspace, '')
    for await (const _entry of completed.entries) {
      // Consuma intenzionalmente l'intero stream.
    }

    const consumerFailure = new Error('consumer interrotto')
    const interrupted = await host.openDirectory(workspace, '')
    await assert.rejects(async () => {
      for await (const _entry of interrupted.entries) throw consumerFailure
    }, (error) => error === consumerFailure)

    assert.equal(openedHandles.length, 2)
    for (const handle of openedHandles) {
      await assert.rejects(() => handle.read(), (error) => error?.code === 'ERR_DIR_CLOSED')
    }
  } finally {
    fs.promises.opendir = originalOpenDirectory
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('alias workspace e ID root producono gli stessi ID pubblici canonici', async () => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-listing-alias-'))
  const workspace = path.join(container, 'workspace')
  const alias = path.join(container, 'workspace-alias')
  try {
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'src', 'file.txt'), 'contenuto\n')
    fs.symlinkSync(workspace, alias)

    const listing = createProjectDirectoryListing(createProjectDirectoryListingFilesystemAdapter())
    assert.deepEqual(await listing.listProjectFiles(alias), {
      entries: [{ id: 'src', kind: 'directory', name: 'src' }],
      truncated: false,
    })
    assert.deepEqual(await listing.listDirectoryEntries(alias, '/src/'), {
      entries: [{ id: 'src/file.txt', kind: 'file', name: 'file.txt' }],
      truncated: false,
    })
  } finally {
    fs.rmSync(container, { recursive: true, force: true })
  }
})

test('il dominio impedisce di aprire node_modules prima di invocare l host', async () => {
  let calls = 0
  const listing = createProjectDirectoryListing(createProjectDirectoryListingHostPort({
    async openDirectory() {
      calls += 1
      return { directoryId: '', entries: records([]) }
    },
  }))

  await assert.rejects(() => listing.listDirectoryEntries('/workspace', 'src/Node_Modules/pkg'), /non è accessibile/)
  assert.equal(calls, 0)
})
