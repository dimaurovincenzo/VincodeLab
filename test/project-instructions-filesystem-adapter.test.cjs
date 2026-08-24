const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createProjectInstructionsFilesystemAdapter } = require('../electron/infrastructure/filesystem/project-instructions-filesystem.adapter.cjs')

function temporaryWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-project-instructions-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('legge, salva atomicamente e rimuove .pi/APPEND_SYSTEM.md', (t) => {
  const workspacePath = temporaryWorkspace(t)
  const adapter = createProjectInstructionsFilesystemAdapter()
  const directoryPath = path.join(workspacePath, '.pi')
  const filePath = path.join(directoryPath, 'APPEND_SYSTEM.md')

  assert.equal(adapter.read(workspacePath), null)
  adapter.write(workspacePath, '# Prima versione')

  assert.equal(fs.readFileSync(filePath, 'utf8'), '# Prima versione')
  assert.equal(adapter.read(workspacePath), '# Prima versione')
  assert.equal(fs.lstatSync(directoryPath).isDirectory(), true)
  assert.equal(fs.lstatSync(filePath).isFile(), true)
  assert.deepEqual(fs.readdirSync(directoryPath), ['APPEND_SYSTEM.md'])

  adapter.write(workspacePath, '# Seconda versione')
  assert.equal(fs.readFileSync(filePath, 'utf8'), '# Seconda versione')
  assert.deepEqual(fs.readdirSync(directoryPath), ['APPEND_SYSTEM.md'])

  adapter.remove(workspacePath)
  assert.equal(fs.existsSync(filePath), false)
  assert.doesNotThrow(() => adapter.remove(workspacePath))
})

test('non segue un APPEND_SYSTEM.md simbolico in lettura, scrittura o rimozione', (t) => {
  const workspacePath = temporaryWorkspace(t)
  const adapter = createProjectInstructionsFilesystemAdapter()
  const directoryPath = path.join(workspacePath, '.pi')
  const targetPath = path.join(workspacePath, 'target.md')
  const filePath = path.join(directoryPath, 'APPEND_SYSTEM.md')
  fs.mkdirSync(directoryPath)
  fs.writeFileSync(targetPath, 'dato privato')
  fs.symlinkSync(targetPath, filePath)

  for (const operation of [
    () => adapter.read(workspacePath),
    () => adapter.write(workspacePath, '# Nuovo'),
    () => adapter.remove(workspacePath),
  ]) {
    assert.throws(operation, /Il file richiesto non è un file regolare/u)
  }
  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'dato privato')
  assert.equal(fs.lstatSync(filePath).isSymbolicLink(), true)
})

test('non scrive attraverso una directory .pi simbolica o non-directory', (t) => {
  const adapter = createProjectInstructionsFilesystemAdapter()

  const symlinkWorkspace = path.join(temporaryWorkspace(t), 'symlink-workspace')
  const externalDirectory = path.join(symlinkWorkspace, 'external')
  fs.mkdirSync(symlinkWorkspace)
  fs.mkdirSync(externalDirectory)
  fs.symlinkSync(externalDirectory, path.join(symlinkWorkspace, '.pi'))
  assert.throws(
    () => adapter.write(symlinkWorkspace, '# Regole'),
    /La directory progetto non è sicura/u,
  )

  const fileWorkspace = path.join(temporaryWorkspace(t), 'file-workspace')
  fs.mkdirSync(fileWorkspace)
  fs.writeFileSync(path.join(fileWorkspace, '.pi'), 'non è una directory')
  assert.throws(
    () => adapter.write(fileWorkspace, '# Regole'),
    /La directory progetto non è sicura/u,
  )
})

test('rifiuta una risorsa esistente che non è un file regolare', (t) => {
  const workspacePath = temporaryWorkspace(t)
  const adapter = createProjectInstructionsFilesystemAdapter()
  const filePath = path.join(workspacePath, '.pi', 'APPEND_SYSTEM.md')
  fs.mkdirSync(filePath, { recursive: true })

  assert.throws(() => adapter.read(workspacePath), /Il file richiesto non è un file regolare/u)
  assert.throws(() => adapter.write(workspacePath, '# Regole'), /Il file richiesto non è un file regolare/u)
  assert.throws(() => adapter.remove(workspacePath), /Il file richiesto non è un file regolare/u)
})
