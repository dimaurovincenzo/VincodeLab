const assert = require('node:assert/strict')
const test = require('node:test')

const {
  FILESYSTEM_INVOKE_CHANNELS,
  createFilesystemHandlers,
  registerFilesystemIpc,
} = require('../electron/ipc/domains/filesystem.ipc.cjs')

function filesystemFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const results = {
    attachment: { absolutePath: '/workspace/current/file.txt', name: 'file.txt' },
    createdDirectory: { id: 'src/new', kind: 'directory' },
    createdFile: { id: 'src/new.txt', content: '', size: 0 },
    directory: { entries: [{ id: 'src/file.txt' }], truncated: false },
    duplicated: { id: 'src/file copy.txt', kind: 'file' },
    index: { state: 'ready', files: [] },
    indexStatus: { state: 'idle' },
    list: [{ id: 'README.md' }],
    preview: { kind: 'text', content: 'preview' },
    read: { id: 'file.txt', content: 'content' },
    renamed: { id: 'src/renamed.txt', renamed: true },
    saved: { id: 'file.txt', revision: 'v1-next', size: 7 },
  }
  const projectFileIndex = {
    build: (workspacePath, options) => {
      calls.push(['index-build', workspacePath, options])
      return results.index
    },
    getStatus: (workspacePath) => {
      calls.push(['index-status', workspacePath])
      return results.indexStatus
    },
    invalidate: (workspacePath) => { calls.push(['index-invalidate', workspacePath]) },
  }
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    createProjectDirectory: (workspacePath, parentId, directoryName) => {
      calls.push(['create-directory', workspacePath, parentId, directoryName])
      return results.createdDirectory
    },
    createProjectFile: (workspacePath, directoryId, fileName) => {
      calls.push(['create-file', workspacePath, directoryId, fileName])
      return results.createdFile
    },
    duplicateProjectEntry: async (workspacePath, entryId, expectedKind) => {
      calls.push(['duplicate', workspacePath, entryId, expectedKind])
      return results.duplicated
    },
    listDirectoryEntries: (workspacePath, directoryId) => {
      calls.push(['list-directory', workspacePath, directoryId])
      return results.directory
    },
    listProjectFiles: (workspacePath) => {
      calls.push(['list', workspacePath])
      return results.list
    },
    log: (...args) => { calls.push(['log', ...args]) },
    prepareProjectFileAttachment: (workspacePath, fileId) => {
      calls.push(['prepare-attachment', workspacePath, fileId])
      return results.attachment
    },
    projectFileIndex,
    readProjectFile: (workspacePath, fileId) => {
      calls.push(['read', workspacePath, fileId])
      return results.read
    },
    readProjectPreview: (workspacePath, fileId) => {
      calls.push(['preview', workspacePath, fileId])
      return results.preview
    },
    renameProjectEntry: (workspacePath, entryId, entryName, expectedKind) => {
      calls.push(['rename', workspacePath, entryId, entryName, expectedKind])
      return results.renamed
    },
    requireActiveWorkspace: () => {
      calls.push(['require-workspace'])
      return '/workspace/current'
    },
    resolveProjectDirectory: (workspacePath, entryId) => {
      calls.push(['resolve-directory', workspacePath, entryId])
      return `/workspace/current/${entryId}`
    },
    resolveProjectFile: (workspacePath, entryId) => {
      calls.push(['resolve-file', workspacePath, entryId])
      return `/workspace/current/${entryId}`
    },
    saveProjectFile: async (workspacePath, fileId, content, options) => {
      calls.push(['save', workspacePath, fileId, content, options])
      return results.saved
    },
    trashItem: async (entryPath) => { calls.push(['trash-item', entryPath]) },
    ...overrides,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, registrations, results }
}

test('registra una sola volta il manifesto dei 13 canali IPC Filesystem', () => {
  const fixture = filesystemFixture()
  const registration = registerFilesystemIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(FILESYSTEM_INVOKE_CHANNELS, [
    'files:list',
    'files:listDirectory',
    'files:index',
    'files:indexStatus',
    'files:read',
    'files:preview',
    'files:prepareAttachment',
    'files:create',
    'files:createDirectory',
    'files:rename',
    'files:duplicate',
    'files:trash',
    'files:save',
  ])
  assert.deepEqual(registration.channels, FILESYSTEM_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], FILESYSTEM_INVOKE_CHANNELS)
})

test('ogni handler verifica il sender prima di usare workspace o servizi', async () => {
  const rejection = new Error('sender non attendibile')
  const asyncChannels = new Set(['files:duplicate', 'files:trash'])
  const argumentsByChannel = new Map([
    ['files:list', []],
    ['files:listDirectory', ['src']],
    ['files:index', [{}]],
    ['files:indexStatus', []],
    ['files:read', ['file.txt']],
    ['files:preview', ['file.txt']],
    ['files:prepareAttachment', ['file.txt']],
    ['files:create', ['src', 'new.txt']],
    ['files:createDirectory', ['src', 'new']],
    ['files:rename', ['file.txt', 'renamed.txt', 'file']],
    ['files:duplicate', ['file.txt', 'file']],
    ['files:trash', ['file.txt', 'file']],
    ['files:save', ['file.txt', 'content', {}]],
  ])

  for (const channel of FILESYSTEM_INVOKE_CHANNELS) {
    const fixture = filesystemFixture({ assertTrustedSender: (event) => {
      fixture.calls.push(['guard', event])
      throw rejection
    } })
    const event = { sender: { id: channel } }
    const handler = createFilesystemHandlers(fixture.dependencies).get(channel)
    const invoke = () => handler(event, ...argumentsByChannel.get(channel))
    if (asyncChannels.has(channel)) await assert.rejects(invoke, (error) => error === rejection)
    else assert.throws(invoke, (error) => error === rejection)
    assert.deepEqual(fixture.calls, [['guard', event]], channel)
  }
})

test('le letture derivano sempre il workspace attivo e restituiscono il risultato originale', () => {
  const fixture = filesystemFixture()
  const handlers = createFilesystemHandlers(fixture.dependencies)
  const event = { sender: { id: 7 } }

  assert.equal(handlers.get('files:list')(event), fixture.results.list)
  assert.equal(handlers.get('files:listDirectory')(event, 'src'), fixture.results.directory)
  assert.equal(handlers.get('files:indexStatus')(event), fixture.results.indexStatus)
  assert.equal(handlers.get('files:read')(event, 'file.txt'), fixture.results.read)
  assert.equal(handlers.get('files:preview')(event, 'image.png'), fixture.results.preview)
  assert.equal(handlers.get('files:prepareAttachment')(event, 'notes.md'), fixture.results.attachment)

  assert.deepEqual(fixture.calls, [
    ['guard', event], ['require-workspace'], ['list', '/workspace/current'],
    ['guard', event], ['require-workspace'], ['list-directory', '/workspace/current', 'src'],
    ['guard', event], ['require-workspace'], ['index-status', '/workspace/current'],
    ['guard', event], ['require-workspace'], ['read', '/workspace/current', 'file.txt'],
    ['guard', event], ['require-workspace'], ['preview', '/workspace/current', 'image.png'],
    ['guard', event], ['require-workspace'], ['prepare-attachment', '/workspace/current', 'notes.md'],
  ])
})

test('files:index accetta soltanto force booleano e lo normalizza senza cambiare il risultato', () => {
  const event = { sender: { id: 11 } }
  for (const [options, expectedForce] of [[undefined, false], [{}, false], [{ force: false }, false], [{ force: true }, true]]) {
    const fixture = filesystemFixture()
    const handler = createFilesystemHandlers(fixture.dependencies).get('files:index')
    assert.equal(handler(event, options), fixture.results.index)
    assert.deepEqual(fixture.calls, [
      ['guard', event],
      ['require-workspace'],
      ['index-build', '/workspace/current', { force: expectedForce }],
    ])
  }

  for (const options of [null, false, [], { unknown: true }, { force: 1 }, { force: true, unknown: false }]) {
    const fixture = filesystemFixture()
    const handler = createFilesystemHandlers(fixture.dependencies).get('files:index')
    assert.throws(() => handler(event, options), /Opzioni indice file non valide\./u)
    assert.deepEqual(fixture.calls, [['guard', event]])
  }
})

test('create e createDirectory conservano risultati, audit log e invalidazione indice', () => {
  const event = { sender: { id: 13 } }
  const fileFixture = filesystemFixture()
  const fileHandler = createFilesystemHandlers(fileFixture.dependencies).get('files:create')
  assert.equal(fileHandler(event, 'src', 'new.txt'), fileFixture.results.createdFile)
  assert.deepEqual(fileFixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['create-file', '/workspace/current', 'src', 'new.txt'],
    ['log', 'info', 'project_file_created'],
    ['require-workspace'],
    ['index-invalidate', '/workspace/current'],
  ])

  const directoryFixture = filesystemFixture()
  const directoryHandler = createFilesystemHandlers(directoryFixture.dependencies).get('files:createDirectory')
  assert.equal(directoryHandler(event, 'src', 'new'), directoryFixture.results.createdDirectory)
  assert.deepEqual(directoryFixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['create-directory', '/workspace/current', 'src', 'new'],
    ['log', 'info', 'project_directory_created'],
    ['index-invalidate', '/workspace/current'],
  ])
})

test('rename invalida e registra soltanto una rinomina effettiva', () => {
  const event = { sender: { id: 17 } }
  const renamedFixture = filesystemFixture()
  const renamedHandler = createFilesystemHandlers(renamedFixture.dependencies).get('files:rename')
  assert.equal(renamedHandler(event, 'src/old.txt', 'new.txt', 'file'), renamedFixture.results.renamed)
  assert.deepEqual(renamedFixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['rename', '/workspace/current', 'src/old.txt', 'new.txt', 'file'],
    ['log', 'info', 'project_entry_renamed', { kind: 'file' }],
    ['index-invalidate', '/workspace/current'],
  ])

  const unchanged = { id: 'src/current.txt', renamed: false }
  const unchangedFixture = filesystemFixture({ renameProjectEntry: (...args) => {
    unchangedFixture.calls.push(['rename', ...args])
    return unchanged
  } })
  const unchangedHandler = createFilesystemHandlers(unchangedFixture.dependencies).get('files:rename')
  assert.equal(unchangedHandler(event, 'src/current.txt', 'current.txt', 'file'), unchanged)
  assert.deepEqual(unchangedFixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['rename', '/workspace/current', 'src/current.txt', 'current.txt', 'file'],
  ])
})

test('duplicate attende il servizio e poi conserva audit log, invalidazione e risultato', async () => {
  const fixture = filesystemFixture()
  const event = { sender: { id: 19 } }
  const handler = createFilesystemHandlers(fixture.dependencies).get('files:duplicate')

  assert.equal(await handler(event, 'src/file.txt', 'file'), fixture.results.duplicated)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['duplicate', '/workspace/current', 'src/file.txt', 'file'],
    ['log', 'info', 'project_entry_duplicated', { kind: 'file' }],
    ['index-invalidate', '/workspace/current'],
  ])
})

test('trash valida id e kind, risolve il tipo corretto e restituisce il contratto pubblico', async () => {
  const event = { sender: { id: 23 } }
  const fileFixture = filesystemFixture()
  const fileHandler = createFilesystemHandlers(fileFixture.dependencies).get('files:trash')
  assert.deepEqual(await fileHandler(event, 'src/file.txt', 'file'), { id: 'src/file.txt', kind: 'file', trashed: true })
  assert.deepEqual(fileFixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['resolve-file', '/workspace/current', 'src/file.txt'],
    ['trash-item', '/workspace/current/src/file.txt'],
    ['log', 'info', 'project_entry_moved_to_trash', { kind: 'file' }],
    ['index-invalidate', '/workspace/current'],
  ])

  const directoryFixture = filesystemFixture()
  const directoryHandler = createFilesystemHandlers(directoryFixture.dependencies).get('files:trash')
  assert.deepEqual(await directoryHandler(event, 'src/archive', 'directory'), { id: 'src/archive', kind: 'directory', trashed: true })
  assert.equal(directoryFixture.calls.some(([operation]) => operation === 'resolve-directory'), true)
  assert.equal(directoryFixture.calls.some(([operation]) => operation === 'resolve-file'), false)

  for (const [entryId, kind] of [['', 'file'], ['file.txt', 'link'], [null, 'directory']]) {
    const fixture = filesystemFixture()
    const handler = createFilesystemHandlers(fixture.dependencies).get('files:trash')
    await assert.rejects(() => handler(event, entryId, kind), /Elemento del workspace non valido\./u)
    assert.deepEqual(fixture.calls, [['guard', event], ['require-workspace']])
  }
})

test('save richiede un oggetto options, inoltra i valori e registra la dimensione risultante', async () => {
  const event = { sender: { id: 29 } }
  const options = { force: false, revision: 'v1-current' }
  const fixture = filesystemFixture()
  const handler = createFilesystemHandlers(fixture.dependencies).get('files:save')

  assert.equal(await handler(event, 'file.txt', 'content', options), fixture.results.saved)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['save', '/workspace/current', 'file.txt', 'content', options],
    ['log', 'info', 'project_file_saved', { size: 7 }],
  ])

  for (const invalidOptions of [undefined, null, false, [], { unknown: true }, { force: true, extra: false }]) {
    const invalidFixture = filesystemFixture()
    const invalidHandler = createFilesystemHandlers(invalidFixture.dependencies).get('files:save')
    assert.throws(() => invalidHandler(event, 'file.txt', 'content', invalidOptions), /Opzioni salvataggio file non valide\./u)
    assert.deepEqual(invalidFixture.calls, [['guard', event]])
  }
})
