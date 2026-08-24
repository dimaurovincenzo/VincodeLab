const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  PROJECT_FILE_INDEX_HOST_METHODS,
  createProjectFileIndexHostPort,
} = require('../electron/domains/filesystem/project-file-index-host.port.cjs')
const {
  createProjectFileIndex,
} = require('../electron/domains/filesystem/project-file-index.cjs')
const projectFiles = require('../electron/domains/filesystem/project-files.cjs')

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

test('la porta host espone soltanto le quattro operazioni semantiche richieste', () => {
  const calls = []
  const implementation = {
    marker: 'host',
    inspectEntry() { calls.push(['inspectEntry', this.marker]) },
    normalizeWorkspacePath() { calls.push(['normalizeWorkspacePath', this.marker]) },
    readDirectory() { calls.push(['readDirectory', this.marker]) },
    resolveWorkspace() { calls.push(['resolveWorkspace', this.marker]) },
  }
  const host = createProjectFileIndexHostPort(implementation)

  assert.deepEqual(PROJECT_FILE_INDEX_HOST_METHODS, [
    'inspectEntry',
    'normalizeWorkspacePath',
    'readDirectory',
    'resolveWorkspace',
  ])
  assert.deepEqual(Object.keys(host), PROJECT_FILE_INDEX_HOST_METHODS)
  assert.equal(Object.isFrozen(host), true)
  for (const method of PROJECT_FILE_INDEX_HOST_METHODS) host[method]()
  assert.deepEqual(calls, PROJECT_FILE_INDEX_HOST_METHODS.map((method) => [method, 'host']))
  assert.throws(() => createProjectFileIndexHostPort({}), /incompleta: inspectEntry/u)
})

test('la composition root inietta l adapter e importa la factory dal facade', () => {
  assert.match(main, /createProjectFileIndexFilesystemAdapter \} = require\('\.\/infrastructure\/filesystem\/project-file-index-filesystem\.adapter\.cjs'\)/u)
  assert.match(main, /createProjectFileIndex,[^\n]+require\('\.\/domains\/filesystem\/project-files\.cjs'\)/u)
  assert.doesNotMatch(main, /require\('\.\/domains\/filesystem\/project-file-index\.cjs'\)/u)
  assert.match(main, /createProjectFileIndex\(createProjectFileIndexFilesystemAdapter\(\)\)/u)
})

test('il dominio conserva esclusioni, sorting e metriche usando DTO host semantici', async () => {
  const inspected = []
  const host = createProjectFileIndexHostPort({
    normalizeWorkspacePath(workspacePath) {
      return workspacePath
    },
    async resolveWorkspace(workspacePath) {
      return { requestedPath: workspacePath, root: workspacePath }
    },
    async readDirectory(_root, directoryId) {
      if (directoryId === '') {
        return {
          kind: 'directory',
          entries: [
            { name: 'zeta.ts', symbolicLink: false },
            { name: 'src', symbolicLink: false },
            { name: 'node_modules', symbolicLink: false },
            { name: 'linked', symbolicLink: true },
            { name: 'missing.ts', symbolicLink: false },
          ],
        }
      }
      assert.equal(directoryId, 'src')
      return {
        kind: 'directory',
        entries: [
          { name: 'pipe', symbolicLink: false },
          { name: 'Alpha.ts', symbolicLink: false },
        ],
      }
    },
    async inspectEntry(_root, directoryId, entryName) {
      inspected.push([directoryId, entryName])
      if (entryName === 'missing.ts') throw Object.assign(new Error('entry sparita'), { code: 'ENOENT' })
      if (entryName === 'node_modules') return { kind: 'directory', directoryId: 'node_modules' }
      if (entryName === 'src') return { kind: 'directory', directoryId: 'src' }
      if (entryName === 'pipe') return { kind: 'unsupported' }
      const id = directoryId ? `${directoryId}/${entryName}` : entryName
      return {
        kind: 'file',
        file: {
          id,
          name: entryName,
          directory: directoryId,
          extension: 'ts',
          size: 1,
          modifiedAt: 1,
        },
      }
    },
  })

  const result = await createProjectFileIndex(host, { progressEvery: 1, yieldEvery: 1 }).build('/workspace')

  assert.deepEqual(result.files.map((file) => file.id), ['src/Alpha.ts', 'zeta.ts'])
  assert.deepEqual(inspected, [
    ['', 'missing.ts'],
    ['', 'node_modules'],
    ['', 'src'],
    ['', 'zeta.ts'],
    ['src', 'Alpha.ts'],
    ['src', 'pipe'],
  ])
  assert.equal(result.directoriesVisited, 2)
  assert.equal(result.entriesScanned, 7)
  assert.deepEqual(result.skipped, {
    excludedDirectories: 1,
    symbolicLinks: 1,
    unsupportedEntries: 1,
    inaccessibleEntries: 1,
  })
  assert.strictEqual(projectFiles.createProjectFileIndex, createProjectFileIndex)
})

test('propaga i failure della root ma confina le directory figlie inaccessibili', async () => {
  const rootFailure = Object.assign(new Error('root non accessibile'), { code: 'EACCES' })
  const rootHost = createProjectFileIndexHostPort({
    inspectEntry() { throw new Error('non atteso') },
    normalizeWorkspacePath: (workspacePath) => workspacePath,
    readDirectory: async () => { throw rootFailure },
    resolveWorkspace: async (workspacePath) => ({ requestedPath: workspacePath, root: workspacePath }),
  })
  const rootIndex = createProjectFileIndex(rootHost)

  await assert.rejects(() => rootIndex.build('/workspace'), (error) => error === rootFailure)
  assert.equal(rootIndex.getStatus('/workspace').state, 'error')
  assert.equal(rootIndex.getStatus('/workspace').error.code, 'EACCES')

  const childHost = createProjectFileIndexHostPort({
    normalizeWorkspacePath: (workspacePath) => workspacePath,
    resolveWorkspace: async (workspacePath) => ({ requestedPath: workspacePath, root: workspacePath }),
    async readDirectory(_root, directoryId) {
      if (directoryId === '') return { kind: 'directory', entries: [{ name: 'src', symbolicLink: false }] }
      throw Object.assign(new Error('figlia non accessibile'), { code: 'EACCES' })
    },
    async inspectEntry() {
      return { kind: 'directory', directoryId: 'src' }
    },
  })

  const result = await createProjectFileIndex(childHost).build('/workspace')
  assert.equal(result.state, 'ready')
  assert.equal(result.directoriesVisited, 1)
  assert.equal(result.skipped.inaccessibleEntries, 1)
})

test('force supera il job attivo e conserva soltanto generazione e stato più recenti', async () => {
  let releaseFirst
  let markFirstStarted
  let readCount = 0
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve })
  const firstRead = new Promise((resolve) => { releaseFirst = resolve })
  const host = createProjectFileIndexHostPort({
    inspectEntry() { throw new Error('non atteso') },
    normalizeWorkspacePath: (workspacePath) => workspacePath,
    resolveWorkspace: async (workspacePath) => ({ requestedPath: workspacePath, root: workspacePath }),
    async readDirectory() {
      readCount += 1
      if (readCount === 1) {
        markFirstStarted()
        await firstRead
      }
      return { kind: 'directory', entries: [] }
    },
  })
  const index = createProjectFileIndex(host)

  const first = index.build('/workspace')
  await firstStarted
  const forced = index.build('/workspace', { force: true })
  const forcedResult = await forced
  releaseFirst()

  await assert.rejects(first, (error) => error.name === 'AbortError' && error.code === 'ABORT_ERR')
  assert.equal(forcedResult.generation, 2)
  assert.equal(index.getStatus('/workspace').state, 'ready')
  assert.equal(index.getStatus('/workspace').generation, 2)
  assert.equal(index.getCached('/workspace').generation, 2)
})
