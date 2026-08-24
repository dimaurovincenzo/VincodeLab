const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  collectDirectoryEntries,
  createProjectDirectory,
  createProjectDirectoryListing,
  createProjectFile,
  createProjectFileActions,
  duplicateProjectEntry,
  isEditorVisibleFile,
  readProjectFile,
  readProjectPreview,
  renameProjectEntry,
  resolveProjectDirectory,
  saveProjectFile,
} = require('../electron/domains/filesystem/project-files.cjs')
const {
  createProjectDirectoryListingFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-directory-listing-filesystem.adapter.cjs')
const {
  createProjectFileActionsFilesystemAdapter,
} = require('../electron/infrastructure/filesystem/project-file-actions-filesystem.adapter.cjs')

const { listProjectFiles } = createProjectDirectoryListing(createProjectDirectoryListingFilesystemAdapter())
const {
  openProjectFileWith,
  revealProjectDirectory,
  revealProjectFile,
} = createProjectFileActions(createProjectFileActionsFilesystemAdapter())

test('il percorso IPC del file explorer usa soltanto scansione e letture asincrone', () => {
  const source = [
    '../electron/domains/filesystem/project-directory-listing.cjs',
    '../electron/infrastructure/filesystem/project-directory-listing-filesystem.adapter.cjs',
    '../electron/domains/filesystem/project-file-content.cjs',
  ].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')
  assert.doesNotMatch(source, /readdirSync/)
  assert.doesNotMatch(source, /readFileSync/)
  assert.match(source, /fs\.promises\.opendir/)
  assert.match(source, /async function readProjectFile/)
  assert.match(source, /async function readProjectPreview/)
})

test('mostra nel Finder soltanto un file risolto dentro il workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const revealed = []
  try {
    fs.mkdirSync(path.join(workspace, 'src'))
    fs.writeFileSync(path.join(workspace, 'src', 'App.tsx'), 'export default null\n')

    assert.deepEqual(revealProjectFile(workspace, 'src/App.tsx', { showItemInFolder: (filePath) => revealed.push(filePath) }), { revealed: true })
    assert.deepEqual(revealed, [path.join(fs.realpathSync(workspace), 'src', 'App.tsx')])
    assert.throws(() => revealProjectFile(workspace, '../esterno.txt', { showItemInFolder() {} }), /Percorso file non valido/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('risolve e mostra nel Finder soltanto directory reali confinate al workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-directories-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-external-'))
  const revealed = []
  try {
    fs.mkdirSync(path.join(workspace, 'src'))
    fs.symlinkSync(external, path.join(workspace, 'collegamento'))

    assert.equal(resolveProjectDirectory(workspace, ''), fs.realpathSync(workspace))
    assert.equal(resolveProjectDirectory(workspace, 'src'), path.join(fs.realpathSync(workspace), 'src'))
    assert.deepEqual(revealProjectDirectory(workspace, 'src', { showItemInFolder: (directoryPath) => revealed.push(directoryPath) }), { revealed: true })
    assert.deepEqual(revealed, [path.join(fs.realpathSync(workspace), 'src')])
    assert.throws(() => resolveProjectDirectory(workspace, '../esterno'), /Percorso file non valido/)
    assert.throws(() => resolveProjectDirectory(workspace, 'collegamento'), /link simbolici/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('apri con usa l’applicazione macOS scelta senza passare da una shell', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const opened = []
  try {
    fs.writeFileSync(path.join(workspace, 'README.md'), '# Progetto\n')

    assert.deepEqual(await openProjectFileWith(workspace, 'README.md', {
      chooseApplication: async () => '/Applications/Visual Studio Code.app',
      openWith: async (applicationPath, filePath) => opened.push({ applicationPath, filePath }),
    }), { opened: true })
    assert.deepEqual(opened, [{ applicationPath: '/Applications/Visual Studio Code.app', filePath: path.join(fs.realpathSync(workspace), 'README.md') }])

    assert.deepEqual(await openProjectFileWith(workspace, 'README.md', {
      chooseApplication: async () => null,
      openWith: async () => { throw new Error('non deve essere chiamato') },
    }), { opened: false })
    await assert.rejects(() => openProjectFileWith(workspace, 'README.md', {
      chooseApplication: async () => '/tmp/editor-eseguibile',
      openWith: async () => { throw new Error('non deve essere chiamato') },
    }), /applicazione macOS valida/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('crea il file nella cartella selezionata oppure nella root del workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  try {
    fs.mkdirSync(path.join(workspace, 'src'))

    assert.equal(createProjectFile(workspace, 'src', 'selezionato.ts').id, 'src/selezionato.ts')
    assert.equal(createProjectFile(workspace, '', 'radice.md').id, 'radice.md')
    assert.equal(fs.existsSync(path.join(workspace, 'src', 'selezionato.ts')), true)
    assert.equal(fs.existsSync(path.join(workspace, 'radice.md')), true)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('crea un nuovo file vuoto in una cartella esistente senza sovrascrivere', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  try {
    fs.mkdirSync(path.join(workspace, 'src'))

    const created = createProjectFile(workspace, 'src', 'nuovo-file.ts')
    const { revision, ...createdFile } = created
    assert.deepEqual(createdFile, {
      id: 'src/nuovo-file.ts',
      name: 'nuovo-file.ts',
      content: '',
      size: 0,
    })
    assert.match(revision, /^v1-[A-Za-z0-9_-]{43}$/)
    assert.equal(fs.readFileSync(path.join(workspace, 'src', 'nuovo-file.ts'), 'utf8'), '')
    assert.throws(() => createProjectFile(workspace, 'src', 'nuovo-file.ts'), /esiste già/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('crea directory nella root o in una cartella senza sovrascrivere elementi esistenti', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-directories-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-external-'))
  try {
    fs.mkdirSync(path.join(workspace, 'src'))
    fs.symlinkSync(external, path.join(workspace, 'collegamento'))
    assert.deepEqual(createProjectDirectory(workspace, '', 'docs'), { id: 'docs', kind: 'directory', name: 'docs' })
    assert.deepEqual(createProjectDirectory(workspace, 'src', 'components'), { id: 'src/components', kind: 'directory', name: 'components' })
    assert.equal(fs.statSync(path.join(workspace, 'src', 'components')).isDirectory(), true)
    assert.throws(() => createProjectDirectory(workspace, '', 'docs'), /esiste già/)
    fs.writeFileSync(path.join(workspace, 'src', 'occupato'), 'file')
    assert.throws(() => createProjectDirectory(workspace, 'src', 'occupato'), /esiste già/)
    assert.throws(() => createProjectDirectory(workspace, '', 'node_modules'), /non è accessibile/)
    assert.throws(() => createProjectDirectory(workspace, '..', 'esterno'), /Percorso file non valido/)
    assert.throws(() => createProjectDirectory(workspace, '', '../esterno'), /Nome file non valido/)
    assert.throws(() => createProjectDirectory(workspace, 'collegamento', 'esterno'), /link simbolici/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('rinomina file e directory senza sovrascrivere e conserva il contenuto', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-rename-'))
  try {
    fs.mkdirSync(path.join(workspace, 'src'))
    fs.mkdirSync(path.join(workspace, 'src', 'legacy'))
    fs.writeFileSync(path.join(workspace, 'src', 'legacy', 'app.ts'), 'export const value = 1\n', { mode: 0o755 })

    assert.deepEqual(renameProjectEntry(workspace, 'src/legacy/app.ts', 'main.ts', 'file'), {
      id: 'src/legacy/main.ts', kind: 'file', name: 'main.ts', previousId: 'src/legacy/app.ts', renamed: true,
    })
    assert.equal(fs.readFileSync(path.join(workspace, 'src', 'legacy', 'main.ts'), 'utf8'), 'export const value = 1\n')
    assert.equal(fs.statSync(path.join(workspace, 'src', 'legacy', 'main.ts')).mode & 0o777, 0o755)
    assert.deepEqual(renameProjectEntry(workspace, 'src/legacy', 'modern', 'directory'), {
      id: 'src/modern', kind: 'directory', name: 'modern', previousId: 'src/legacy', renamed: true,
    })
    assert.equal(fs.readFileSync(path.join(workspace, 'src', 'modern', 'main.ts'), 'utf8'), 'export const value = 1\n')

    fs.writeFileSync(path.join(workspace, 'src', 'modern', 'existing.ts'), 'non sostituire\n')
    assert.throws(() => renameProjectEntry(workspace, 'src/modern/main.ts', 'existing.ts', 'file'), /esiste già/)
    assert.equal(fs.readFileSync(path.join(workspace, 'src', 'modern', 'existing.ts'), 'utf8'), 'non sostituire\n')
    assert.equal(fs.existsSync(path.join(workspace, 'src', 'modern', 'main.ts')), true)
    fs.writeFileSync(path.join(workspace, 'src', 'modern', 'Case.ts'), 'case-only\n')
    assert.equal(renameProjectEntry(workspace, 'src/modern/Case.ts', 'case.ts', 'file').id, 'src/modern/case.ts')
    assert.equal(fs.readFileSync(path.join(workspace, 'src', 'modern', 'case.ts'), 'utf8'), 'case-only\n')
    fs.writeFileSync(path.join(workspace, 'src', 'modern', 'hard-a.ts'), 'hard link\n')
    fs.linkSync(path.join(workspace, 'src', 'modern', 'hard-a.ts'), path.join(workspace, 'src', 'modern', 'hard-b.ts'))
    assert.throws(() => renameProjectEntry(workspace, 'src/modern/hard-a.ts', 'hard-b.ts', 'file'), /esiste già/)
    assert.equal(fs.existsSync(path.join(workspace, 'src', 'modern', 'hard-a.ts')), true)
    assert.equal(fs.existsSync(path.join(workspace, 'src', 'modern', 'hard-b.ts')), true)
    assert.throws(() => renameProjectEntry(workspace, '', 'root-rinominata', 'directory'), /Percorso file non valido/)
    assert.throws(() => renameProjectEntry(workspace, 'src/modern', 'node_modules', 'directory'), /non è accessibile/)
    assert.throws(() => renameProjectEntry(workspace, 'src/modern', 'altro', 'file'), /File non trovato/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('rifiuta rinomina e duplicazione attraverso link simbolici', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-symlink-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-external-'))
  try {
    fs.writeFileSync(path.join(external, 'secret.txt'), 'segreto\n')
    fs.symlinkSync(external, path.join(workspace, 'esterno'))
    assert.throws(() => renameProjectEntry(workspace, 'esterno/secret.txt', 'copiato.txt', 'file'), /link simbolici/)
    await assert.rejects(() => duplicateProjectEntry(workspace, 'esterno/secret.txt', 'file'), /link simbolici/)
    assert.equal(fs.existsSync(path.join(workspace, 'copiato.txt')), false)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('non segue un symlink che sostituisce il file mentre inizia la duplicazione', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-duplicate-race-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-external-'))
  const source = path.join(workspace, 'app.ts')
  const externalFile = path.join(external, 'secret.txt')
  const originalOpen = fs.promises.open
  try {
    fs.writeFileSync(source, 'contenuto workspace\n')
    fs.writeFileSync(externalFile, 'segreto esterno\n')
    const resolvedSource = fs.realpathSync(source)
    let replaced = false
    fs.promises.open = async function openWithReplacement(filePath, ...args) {
      if (!replaced && filePath === resolvedSource) {
        replaced = true
        fs.unlinkSync(source)
        fs.symlinkSync(externalFile, source)
      }
      return originalOpen.call(this, filePath, ...args)
    }

    await assert.rejects(() => duplicateProjectEntry(workspace, 'app.ts', 'file'), /link simbolici/)
    assert.equal(fs.existsSync(path.join(workspace, 'app copia.ts')), false)
  } finally {
    fs.promises.open = originalOpen
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('duplica file con nome progressivo senza sovrascrivere copie esistenti', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-duplicate-'))
  try {
    fs.writeFileSync(path.join(workspace, 'app.ts'), 'originale\n')
    fs.chmodSync(path.join(workspace, 'app.ts'), 0o777)
    fs.writeFileSync(path.join(workspace, 'app copia.ts'), 'esistente\n')
    const duplicate = await duplicateProjectEntry(workspace, 'app.ts', 'file')
    assert.deepEqual(duplicate, { id: 'app copia 2.ts', kind: 'file', name: 'app copia 2.ts', sourceId: 'app.ts' })
    assert.equal(fs.readFileSync(path.join(workspace, 'app copia.ts'), 'utf8'), 'esistente\n')
    assert.equal(fs.readFileSync(path.join(workspace, 'app copia 2.ts'), 'utf8'), 'originale\n')
    assert.equal(fs.statSync(path.join(workspace, 'app copia 2.ts')).mode & 0o777, 0o777)
    assert.throws(() => renameProjectEntry(workspace, 'app.ts', 'app copia 2.ts', 'file'), /esiste già/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('duplica ricorsivamente una directory ammessa senza seguire symlink', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-duplicate-directory-'))
  try {
    fs.mkdirSync(path.join(workspace, 'src', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'src', 'nested', 'app.ts'), 'contenuto\n')
    const duplicate = await duplicateProjectEntry(workspace, 'src', 'directory')
    assert.deepEqual(duplicate, { id: 'src copia', kind: 'directory', name: 'src copia', sourceId: 'src' })
    assert.equal(fs.readFileSync(path.join(workspace, 'src copia', 'nested', 'app.ts'), 'utf8'), 'contenuto\n')
    assert.equal(fs.readFileSync(path.join(workspace, 'src', 'nested', 'app.ts'), 'utf8'), 'contenuto\n')
    fs.writeFileSync(path.join(workspace, 'src copia', 'non-sovrascrivere.txt'), 'esistente\n')
    const secondDuplicate = await duplicateProjectEntry(workspace, 'src', 'directory')
    assert.deepEqual(secondDuplicate, { id: 'src copia 2', kind: 'directory', name: 'src copia 2', sourceId: 'src' })
    assert.equal(fs.readFileSync(path.join(workspace, 'src copia', 'non-sovrascrivere.txt'), 'utf8'), 'esistente\n')
    assert.equal(fs.readFileSync(path.join(workspace, 'src copia 2', 'nested', 'app.ts'), 'utf8'), 'contenuto\n')
    await assert.rejects(() => duplicateProjectEntry(workspace, '', 'directory'), /Percorso file non valido/)
    await assert.rejects(() => duplicateProjectEntry(workspace, 'src', 'unknown'), /Tipo elemento non valido/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('rifiuta directory duplicate con symlink o node_modules e ripulisce le copie temporanee', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-duplicate-policy-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-external-'))
  try {
    fs.mkdirSync(path.join(workspace, 'with-link'))
    fs.symlinkSync(external, path.join(workspace, 'with-link', 'outside'))
    await assert.rejects(() => duplicateProjectEntry(workspace, 'with-link', 'directory'), /link simbolici/)
    assert.equal(fs.existsSync(path.join(workspace, 'with-link copia')), false)

    fs.mkdirSync(path.join(workspace, 'with-modules', 'node_modules'), { recursive: true })
    await assert.rejects(() => duplicateProjectEntry(workspace, 'with-modules', 'directory'), /node_modules/)
    assert.equal(fs.existsSync(path.join(workspace, 'with-modules copia')), false)
    assert.deepEqual(fs.readdirSync(workspace).filter((name) => name.startsWith('.vincodelab-duplicate-')), [])
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('impedisce di creare file fuori dal workspace o in percorsi esclusi', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-external-'))
  try {
    fs.mkdirSync(path.join(workspace, 'node_modules'))
    fs.mkdirSync(path.join(workspace, 'src'))
    fs.mkdirSync(path.join(workspace, 'src', 'node_modules'))
    fs.symlinkSync(external, path.join(workspace, 'collegamento'))

    assert.throws(() => createProjectFile(workspace, '..', 'esterno.txt'), /Percorso file non valido/)
    assert.throws(() => createProjectFile(workspace, '/tmp', 'esterno.txt'), /Percorso file non valido/)
    assert.throws(() => createProjectFile(workspace, 'node_modules', 'pacchetto.js'), /non è accessibile/)
    assert.throws(() => createProjectFile(workspace, 'src/node_modules', 'pacchetto.js'), /non è accessibile/)
    assert.throws(() => createProjectFile(workspace, 'collegamento', 'segreto.txt'), /link simbolici/)
    assert.throws(() => createProjectFile(workspace, 'cartella-mancante', 'file.txt'), /Cartella non trovata/)
    assert.throws(() => createProjectFile(workspace, '', '../esterno.txt'), /Nome file non valido/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('allows hidden, secret and certificate files in the project editor', () => {
  for (const fileName of ['.env', '.env.production', '.env.example', 'id_rsa', 'server.pem', 'client.key', 'identity.p12']) {
    assert.equal(isEditorVisibleFile(fileName), true, fileName)
  }
})

test('allows ordinary source files in the project editor', () => {
  assert.equal(isEditorVisibleFile('App.tsx'), true)
  assert.equal(isEditorVisibleFile('README.md'), true)
})

test('restituisce anteprime sicure per immagini e PDF', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  try {
    fs.writeFileSync(path.join(workspace, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    fs.writeFileSync(path.join(workspace, 'manuale.pdf'), Buffer.from('%PDF-1.7\n'))
    fs.writeFileSync(path.join(workspace, 'manuale.txt'), 'testo\n')
    assert.match((await readProjectPreview(workspace, 'diagram.png')).content, /^data:image\/png;base64,/)
    assert.match((await readProjectPreview(workspace, 'manuale.pdf')).content, /^data:application\/pdf;base64,/)
    await assert.rejects(() => readProjectPreview(workspace, 'manuale.txt'), /anteprima/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('preserves executable permissions when saving a project file', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const scriptPath = path.join(workspace, 'script.sh')
  try {
    fs.writeFileSync(scriptPath, '#!/bin/zsh\necho prima\n', { mode: 0o755 })
    const opened = await readProjectFile(workspace, 'script.sh')
    const saved = await saveProjectFile(workspace, 'script.sh', '#!/bin/zsh\necho dopo\n', { revision: opened.revision })
    assert.match(saved.revision, /^v1-[A-Za-z0-9_-]{43}$/)
    assert.notEqual(saved.revision, opened.revision)
    assert.equal(fs.statSync(scriptPath).mode & 0o777, 0o755)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('lists and edits hidden workspace files except node_modules', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  try {
    fs.mkdirSync(path.join(workspace, '.git'))
    fs.mkdirSync(path.join(workspace, '.ssh'))
    fs.mkdirSync(path.join(workspace, '.secrets'))
    fs.mkdirSync(path.join(workspace, 'node_modules'))
    fs.writeFileSync(path.join(workspace, '.git', 'config'), '[core]\n')
    fs.writeFileSync(path.join(workspace, '.env'), 'TOKEN=prima\n')
    fs.writeFileSync(path.join(workspace, '.ssh', 'id_rsa'), 'chiave\n')
    fs.writeFileSync(path.join(workspace, '.secrets', 'cert.pem'), 'certificato\n')
    fs.writeFileSync(path.join(workspace, 'README.md'), '# progetto\n')
    assert.deepEqual((await listProjectFiles(workspace)).entries.map((entry) => entry.name), ['.git', '.secrets', '.ssh', '.env', 'README.md'])
    const environment = await readProjectFile(workspace, '.env')
    assert.equal(environment.content, 'TOKEN=prima\n')
    assert.match(environment.revision, /^v1-[A-Za-z0-9_-]{43}$/)
    assert.equal((await readProjectFile(workspace, '.git/config')).content, '[core]\n')
    await saveProjectFile(workspace, '.env', 'TOKEN=dopo\n', { revision: environment.revision })
    assert.equal(fs.readFileSync(path.join(workspace, '.env'), 'utf8'), 'TOKEN=dopo\n')
    assert.equal((await readProjectFile(workspace, '.ssh/id_rsa')).content, 'chiave\n')
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('rifiuta un salvataggio quando il file è cambiato e non sovrascrive la versione esterna', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const filePath = path.join(workspace, 'app.ts')
  try {
    fs.writeFileSync(filePath, 'const source = "iniziale"\n')
    const opened = await readProjectFile(workspace, 'app.ts')
    fs.writeFileSync(filePath, 'const source = "esterno"\n')

    await assert.rejects(
      () => saveProjectFile(workspace, 'app.ts', 'const source = "locale"\n', { revision: opened.revision }),
      (error) => {
        assert.equal(error.code, 'FILESYSTEM_EXTERNAL_CONFLICT')
        assert.match(error.message, /modificato o rimosso/)
        return true
      },
    )
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'const source = "esterno"\n')

    const forced = await saveProjectFile(workspace, 'app.ts', 'const source = "locale"\n', { force: true })
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'const source = "locale"\n')
    assert.match(forced.revision, /^v1-[A-Za-z0-9_-]{43}$/)
    const next = await saveProjectFile(workspace, 'app.ts', 'const source = "successivo"\n', { revision: forced.revision })
    assert.notEqual(next.revision, forced.revision)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('richiede una revisione valida per ogni salvataggio non forzato', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const filePath = path.join(workspace, 'app.ts')
  try {
    fs.writeFileSync(filePath, 'originale\n')
    await assert.rejects(() => saveProjectFile(workspace, 'app.ts', 'locale\n'), /Opzioni salvataggio file non valide/)
    await assert.rejects(() => saveProjectFile(workspace, 'app.ts', 'locale\n', {}), /Revisione file non valida/)
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'originale\n')
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('un file eliminato non viene ricreato senza una sovrascrittura esplicita', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const filePath = path.join(workspace, 'app.ts')
  try {
    fs.writeFileSync(filePath, 'prima\n')
    const opened = await readProjectFile(workspace, 'app.ts')
    fs.rmSync(filePath)

    await assert.rejects(
      () => saveProjectFile(workspace, 'app.ts', 'locale\n', { revision: opened.revision }),
      (error) => error?.code === 'FILESYSTEM_EXTERNAL_CONFLICT',
    )
    assert.equal(fs.existsSync(filePath), false)

    const forced = await saveProjectFile(workspace, 'app.ts', 'locale\n', { force: true })
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'locale\n')
    assert.match(forced.revision, /^v1-[A-Za-z0-9_-]{43}$/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('hides only node_modules regardless of filename casing', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  try {
    fs.mkdirSync(path.join(workspace, 'Node_Modules'))
    fs.mkdirSync(path.join(workspace, '.GIT'))
    fs.writeFileSync(path.join(workspace, 'README.md'), '# progetto\n')
    assert.deepEqual((await listProjectFiles(workspace)).entries.map((entry) => entry.name), ['.GIT', 'README.md'])
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('lists symlinks without allowing their target to be opened', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  const externalFile = path.join(workspace, '..', 'vincodelab-external.txt')
  try {
    fs.writeFileSync(externalFile, 'fuori workspace\n')
    fs.symlinkSync(externalFile, path.join(workspace, 'collegamento-esterno'))
    assert.deepEqual((await listProjectFiles(workspace)).entries, [{ id: 'collegamento-esterno', name: 'collegamento-esterno', kind: 'file' }])
    await assert.rejects(() => readProjectFile(workspace, 'collegamento-esterno'), /link simbolici/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(externalFile, { force: true })
  }
})

test('limita una directory enorme senza accumularla e lascia avanzare il ciclo eventi', async () => {
  const totalEntries = 100_000
  async function* fakeDirectoryEntries() {
    for (let index = totalEntries - 1; index >= 0; index -= 1) {
      yield {
        kind: 'file',
        name: `entry-${String(index).padStart(6, '0')}.txt`,
      }
    }
  }

  let heartbeatActive = true
  let heartbeats = 0
  const heartbeat = () => {
    heartbeats += 1
    if (heartbeatActive) setImmediate(heartbeat)
  }
  setImmediate(heartbeat)

  const result = await collectDirectoryEntries(fakeDirectoryEntries())
  heartbeatActive = false
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.truncated, true)
  assert.equal(result.entries.length, 1_000)
  assert.ok(result.peakRetainedEntries <= 1_000)
  assert.equal(result.entries[0].name, 'entry-000000.txt')
  assert.equal(result.entries.at(-1).name, 'entry-000999.txt')
  assert.ok(heartbeats > 0)
})

test('applica i limiti anche dopo la lettura asincrona', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-files-'))
  try {
    fs.writeFileSync(path.join(workspace, 'troppo-grande.txt'), Buffer.alloc(1_000_001, 0x61))
    fs.writeFileSync(path.join(workspace, 'troppo-grande.png'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x61))

    await assert.rejects(() => readProjectFile(workspace, 'troppo-grande.txt'), /supera 1 MiB/)
    await assert.rejects(() => readProjectPreview(workspace, 'troppo-grande.png'), /supera 8 MiB/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})
