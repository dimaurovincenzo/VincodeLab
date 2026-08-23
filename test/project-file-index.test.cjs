const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  DEFAULT_EXCLUDED_DIRECTORIES,
  DEFAULT_MAX_FILES,
  createProjectFileIndex,
} = require('../electron/project-file-index.cjs')

function temporaryWorkspace(t, prefix = 'vincodelab-file-index-') {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  return workspace
}

function writeFiles(workspace, fileIds) {
  for (const fileId of fileIds) {
    const filePath = path.join(workspace, fileId)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, fileId)
  }
}

test('valida la root e restituisce soltanto metadata relativi contenuti nel workspace', async (t) => {
  const workspace = temporaryWorkspace(t)
  writeFiles(workspace, ['README.md', 'src/App.tsx'])
  const index = createProjectFileIndex()

  await assert.rejects(() => index.build('workspace-relativo'), /Percorso workspace non valido/)
  await assert.rejects(() => index.build(path.join(workspace, 'README.md')), /directory valida/)

  const result = await index.build(workspace)
  assert.equal(DEFAULT_MAX_FILES, 20_000)
  assert.deepEqual(result.files.map((file) => file.id), ['README.md', 'src/App.tsx'])
  assert.deepEqual(result.files[1], {
    id: 'src/App.tsx',
    name: 'App.tsx',
    directory: 'src',
    extension: 'tsx',
    size: Buffer.byteLength('src/App.tsx'),
    modifiedAt: result.files[1].modifiedAt,
  })
  assert.equal(Number.isFinite(result.files[1].modifiedAt), true)
  assert.equal(result.files.every((file) => !path.isAbsolute(file.id)), true)
  assert.equal(Object.isFrozen(result.files), true)
  assert.equal(Object.isFrozen(result.files[0]), true)
})

test('non segue link simbolici a file o directory esterni', async (t) => {
  const workspace = temporaryWorkspace(t)
  const external = temporaryWorkspace(t, 'vincodelab-file-index-external-')
  writeFiles(workspace, ['src/local.ts'])
  writeFiles(external, ['secret.txt', 'nested/private.key'])
  fs.symlinkSync(external, path.join(workspace, 'external-directory'))
  fs.symlinkSync(path.join(external, 'secret.txt'), path.join(workspace, 'external-file'))

  const result = await createProjectFileIndex().build(workspace)

  assert.deepEqual(result.files.map((file) => file.id), ['src/local.ts'])
  assert.equal(result.skipped.symbolicLinks, 2)
  assert.equal(result.files.some((file) => file.id.includes('secret') || file.id.includes('private')), false)
})

test('esclude dipendenze, metadata e output pesanti ma conserva file nascosti editabili', async (t) => {
  const workspace = temporaryWorkspace(t)
  writeFiles(workspace, [
    '.env',
    '.ssh/id_rsa',
    '.secrets/cert.pem',
    'src/index.ts',
    'Node_Modules/package/index.js',
    '.git/objects/pack.bin',
    'dist/bundle.js',
    'coverage/report.json',
    'styled-system/css/index.mjs',
  ])

  const result = await createProjectFileIndex().build(workspace)

  assert.deepEqual(result.files.map((file) => file.id), [
    '.env',
    '.secrets/cert.pem',
    '.ssh/id_rsa',
    'src/index.ts',
  ])
  assert.equal(result.skipped.excludedDirectories, 5)
  assert.equal(DEFAULT_EXCLUDED_DIRECTORIES.includes('node_modules'), true)
  assert.equal(DEFAULT_EXCLUDED_DIRECTORIES.includes('.git'), true)
})

test('applica il cap configurabile scegliendo e ordinando file in modo deterministico', async (t) => {
  const workspace = temporaryWorkspace(t)
  writeFiles(workspace, ['zeta.ts', 'beta.ts', 'alpha.ts', 'delta.ts', 'charlie.ts'])
  const index = createProjectFileIndex({ maxFiles: 3, progressEvery: 1, yieldEvery: 1 })

  const first = await index.build(workspace)
  index.invalidate(workspace)
  const second = await index.build(workspace)

  assert.deepEqual(first.files.map((file) => file.id), ['alpha.ts', 'beta.ts', 'charlie.ts'])
  assert.deepEqual(second.files.map((file) => file.id), first.files.map((file) => file.id))
  assert.equal(first.fileCount, 3)
  assert.equal(first.truncated, true)
  assert.throws(() => createProjectFileIndex({ maxFiles: 0 }), /Limite file non valido/)
  assert.throws(() => createProjectFileIndex({ maxFiles: 100_001 }), /Limite file non valido/)
})

test('riusa una cache per workspace finché non viene invalidata', async (t) => {
  const workspace = temporaryWorkspace(t)
  writeFiles(workspace, ['prima.ts'])
  const index = createProjectFileIndex()

  const first = await index.build(workspace)
  writeFiles(workspace, ['dopo.ts'])
  const cached = await index.build(workspace)

  assert.equal(first.cacheHit, false)
  assert.equal(cached.cacheHit, true)
  assert.deepEqual(cached.files.map((file) => file.id), ['prima.ts'])
  assert.equal(index.getCached(workspace).cacheHit, true)
  assert.equal(index.invalidate(workspace), true)
  assert.equal(index.getCached(workspace), null)
  assert.equal(index.getStatus(workspace), null)

  const rebuilt = await index.build(workspace)
  assert.equal(rebuilt.cacheHit, false)
  assert.deepEqual(rebuilt.files.map((file) => file.id), ['dopo.ts', 'prima.ts'])
})

test('isola cache e invalidazione tra workspace', async (t) => {
  const workspaceA = temporaryWorkspace(t, 'vincodelab-file-index-a-')
  const workspaceB = temporaryWorkspace(t, 'vincodelab-file-index-b-')
  writeFiles(workspaceA, ['a.ts'])
  writeFiles(workspaceB, ['b.ts'])
  const fileIndex = createProjectFileIndex()

  await Promise.all([fileIndex.build(workspaceA), fileIndex.build(workspaceB)])
  writeFiles(workspaceA, ['a-after.ts'])
  writeFiles(workspaceB, ['b-after.ts'])
  fileIndex.invalidate(workspaceA)

  const [rebuiltA, cachedB] = await Promise.all([
    fileIndex.build(workspaceA),
    fileIndex.build(workspaceB),
  ])
  assert.deepEqual(rebuiltA.files.map((file) => file.id), ['a-after.ts', 'a.ts'])
  assert.equal(rebuiltA.cacheHit, false)
  assert.deepEqual(cachedB.files.map((file) => file.id), ['b.ts'])
  assert.equal(cachedB.cacheHit, true)
})

test('pubblica avanzamento e consente cancellazione cooperativa', async (t) => {
  const workspace = temporaryWorkspace(t)
  writeFiles(workspace, Array.from({ length: 600 }, (_, index) => `src/file-${String(index).padStart(4, '0')}.ts`))
  const fileIndex = createProjectFileIndex({ progressEvery: 10, yieldEvery: 10 })
  const progress = []

  const build = fileIndex.build(workspace, {
    onProgress(status) {
      progress.push(status)
      if (status.filesIndexed >= 30) fileIndex.cancel(workspace)
    },
  })

  await assert.rejects(build, (error) => error.name === 'AbortError' && error.code === 'ABORT_ERR')
  assert.equal(progress[0].state, 'indexing')
  assert.equal(progress.some((status) => status.filesIndexed >= 30), true)
  assert.equal(fileIndex.getStatus(workspace).state, 'cancelled')
  assert.equal(fileIndex.getCached(workspace), null)
})

test("l'invalidazione durante il traversal consente una ricostruzione immediata", async (t) => {
  const workspace = temporaryWorkspace(t)
  writeFiles(workspace, Array.from({ length: 600 }, (_, index) => `src/invalidate-${String(index).padStart(4, '0')}.ts`))
  const fileIndex = createProjectFileIndex({ progressEvery: 10, yieldEvery: 10 })
  let resolveProgress
  const madeProgress = new Promise((resolve) => { resolveProgress = resolve })

  const build = fileIndex.build(workspace, {
    onProgress(status) {
      if (status.filesIndexed >= 30) resolveProgress()
    },
  })

  await madeProgress
  assert.equal(fileIndex.invalidate(workspace), true)
  const rebuilt = fileIndex.build(workspace)
  await assert.rejects(build, (error) => error.name === 'AbortError' && error.code === 'ABORT_ERR')
  assert.equal((await rebuilt).fileCount, 600)
  assert.equal(fileIndex.getStatus(workspace).state, 'ready')
  assert.equal(fileIndex.getCached(workspace).fileCount, 600)
})

test('condivide il lavoro concorrente per lo stesso workspace', async (t) => {
  const workspace = temporaryWorkspace(t)
  writeFiles(workspace, Array.from({ length: 300 }, (_, index) => `src/shared-${index}.ts`))
  const fileIndex = createProjectFileIndex({ progressEvery: 25, yieldEvery: 25 })
  const firstProgress = []
  const secondProgress = []

  const firstBuild = fileIndex.build(workspace, { onProgress: (status) => firstProgress.push(status) })
  const secondBuild = fileIndex.build(workspace, { onProgress: (status) => secondProgress.push(status) })
  const [first, second] = await Promise.all([firstBuild, secondBuild])

  assert.strictEqual(first, second)
  assert.equal(first.fileCount, 300)
  assert.equal(firstProgress.length > 0, true)
  assert.equal(secondProgress.length > 0, true)
  assert.equal(first.generation, second.generation)
})

test('indicizza 10.000 file sintetici entro un budget locale ragionevole', { timeout: 30_000 }, async (t) => {
  const workspace = temporaryWorkspace(t, 'vincodelab-file-index-performance-')
  const directories = 100
  const filesPerDirectory = 100
  for (let directory = 0; directory < directories; directory += 1) {
    const directoryPath = path.join(workspace, `src-${String(directory).padStart(3, '0')}`)
    fs.mkdirSync(directoryPath)
    for (let file = 0; file < filesPerDirectory; file += 1) {
      fs.writeFileSync(path.join(directoryPath, `file-${String(file).padStart(3, '0')}.ts`), 'x')
    }
  }

  const startedAt = performance.now()
  const result = await createProjectFileIndex({ maxFiles: 12_000 }).build(workspace)
  const elapsedMs = performance.now() - startedAt

  assert.equal(result.fileCount, 10_000)
  assert.equal(result.truncated, false)
  assert.equal(result.files[0].id, 'src-000/file-000.ts')
  assert.equal(result.files.at(-1).id, 'src-099/file-099.ts')
  assert.ok(elapsedMs < 12_000, `indicizzazione troppo lenta: ${Math.round(elapsedMs)} ms`)
})
