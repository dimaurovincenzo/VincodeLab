const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createSystemSkillsFilesystemAdapter } = require('../electron/infrastructure/filesystem/system-skills-filesystem.adapter.cjs')

function temporaryDirectory(t, prefix = 'vincodelab-system-skills-adapter-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function content(name) {
  return `---\nname: ${name}\ndescription: Skill ${name}\n---\n`
}

test('supporta directory SKILL.md e file .md legacy con precedenza storica al file diretto', (t) => {
  const root = temporaryDirectory(t)
  const adapter = createSystemSkillsFilesystemAdapter()
  const directory = path.join(root, 'duplice')
  const legacyFile = path.join(root, 'duplice.md')
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'SKILL.md'), content('directory'))
  fs.writeFileSync(legacyFile, content('legacy'))

  assert.deepEqual(adapter.read(root, 'duplice'), { id: 'duplice', content: content('legacy') })
  adapter.write(adapter.prepareUpdate(root, 'duplice'), content('legacy-aggiornata'))
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), content('legacy-aggiornata'))
  assert.deepEqual(fs.readdirSync(root).sort(), ['duplice', 'duplice.md'])

  adapter.remove(root, 'duplice')
  assert.equal(fs.existsSync(legacyFile), false)
  assert.equal(fs.existsSync(path.join(directory, 'SKILL.md')), true)
  assert.deepEqual(adapter.read(root, 'duplice'), { id: 'duplice', content: content('directory') })
  adapter.remove(root, 'duplice')
  assert.equal(fs.existsSync(directory), false)
})

test('prepareUpdate blocca il target opaco anche se durante la validazione compare un file legacy', (t) => {
  const root = temporaryDirectory(t)
  const adapter = createSystemSkillsFilesystemAdapter()
  const directory = path.join(root, 'stabile')
  const directorySkill = path.join(directory, 'SKILL.md')
  const legacyFile = path.join(root, 'stabile.md')
  fs.mkdirSync(directory)
  fs.writeFileSync(directorySkill, content('directory-originale'))

  const updateHandle = adapter.prepareUpdate(root, 'stabile')
  fs.writeFileSync(legacyFile, content('legacy-concorrente'), { flag: 'wx' })
  adapter.write(updateHandle, content('directory-aggiornata'))

  assert.equal(fs.readFileSync(directorySkill, 'utf8'), content('directory-aggiornata'))
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), content('legacy-concorrente'))
  assert.throws(
    () => adapter.write(updateHandle, content('secondo-update')),
    /Handle aggiornamento skill di sistema non valido/u,
  )
})

test('il catalogo considera al massimo le prime 500 entry della root', (t) => {
  const root = temporaryDirectory(t)
  const adapter = createSystemSkillsFilesystemAdapter()
  for (let index = 0; index < 510; index += 1) {
    const name = `skill-${String(index).padStart(3, '0')}`
    fs.writeFileSync(path.join(root, `${name}.md`), content(name))
  }

  assert.equal(adapter.list(root).length, 500)
})

test('rifiuta root relative, file e symlink senza seguirli', (t) => {
  const adapter = createSystemSkillsFilesystemAdapter()
  assert.throws(() => adapter.list('skills-relative'), /Directory skill di sistema non valida/u)

  const fileRoot = path.join(temporaryDirectory(t), 'skills-file')
  fs.writeFileSync(fileRoot, 'non directory')
  assert.throws(() => adapter.list(fileRoot), /La directory skill di sistema non è sicura/u)

  const symlinkWorkspace = temporaryDirectory(t)
  const external = temporaryDirectory(t, 'vincodelab-system-skills-external-')
  const symlinkRoot = path.join(symlinkWorkspace, 'skills-link')
  fs.symlinkSync(external, symlinkRoot, 'dir')
  assert.throws(() => adapter.list(symlinkRoot), /La directory skill di sistema non è sicura/u)
})

test('create conserva no-clobber e non rimuove il file pubblicato da un writer concorrente', (t) => {
  const root = temporaryDirectory(t)
  const adapter = createSystemSkillsFilesystemAdapter()
  const directory = path.join(root, 'contesa')
  const skillFile = path.join(directory, 'SKILL.md')
  const concurrentContent = content('concorrente')
  const originalMkdirSync = fs.mkdirSync
  let injected = false

  fs.mkdirSync = function mkdirSyncWithConcurrentWriter(directoryPath, options) {
    const result = originalMkdirSync.call(fs, directoryPath, options)
    if (!injected && directoryPath === directory) {
      injected = true
      fs.writeFileSync(skillFile, concurrentContent, { flag: 'wx' })
    }
    return result
  }

  try {
    assert.throws(
      () => adapter.create(root, 'contesa', content('contesa')),
      (error) => error?.code === 'EEXIST',
    )
  } finally {
    fs.mkdirSync = originalMkdirSync
  }

  assert.equal(injected, true)
  assert.equal(fs.readFileSync(skillFile, 'utf8'), concurrentContent)
})

test('create segnala collisioni preesistenti senza alterare file o directory', (t) => {
  const adapter = createSystemSkillsFilesystemAdapter()
  const directoryRoot = temporaryDirectory(t)
  fs.mkdirSync(path.join(directoryRoot, 'esistente'))
  assert.deepEqual(adapter.create(directoryRoot, 'esistente', content('esistente')), {
    created: false,
    reason: 'conflict',
  })

  const legacyRoot = temporaryDirectory(t)
  const legacyFile = path.join(legacyRoot, 'esistente.md')
  fs.writeFileSync(legacyFile, content('legacy'))
  assert.deepEqual(adapter.create(legacyRoot, 'esistente', content('nuova')), {
    created: false,
    reason: 'conflict',
  })
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), content('legacy'))
})
