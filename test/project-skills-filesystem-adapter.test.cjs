const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createProjectSkillsFilesystemAdapter } = require('../electron/infrastructure/filesystem/project-skills-filesystem.adapter.cjs')

function temporaryDirectory(t, prefix = 'vincodelab-project-skills-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function reference(id, kind = 'directory') {
  return Object.freeze({ id, kind, segments: Object.freeze(id.split('/')) })
}

function content(name) {
  return `---\nname: ${name}\ndescription: Skill ${name}\n---\n`
}

test('crea la root Pi nativa, usa file atomici e rimuove solo la skill richiesta', (t) => {
  const workspacePath = temporaryDirectory(t)
  const adapter = createProjectSkillsFilesystemAdapter()
  const skillsRoot = path.join(workspacePath, '.pi', 'skills')

  assert.deepEqual(adapter.list(workspacePath), [])
  adapter.create(workspacePath, 'prima', content('prima'))
  adapter.create(workspacePath, 'seconda', content('seconda'))

  assert.equal(fs.existsSync(path.join(workspacePath, '.agents', 'skills')), false)
  assert.deepEqual(fs.readdirSync(path.join(skillsRoot, 'prima')), ['SKILL.md'])
  assert.deepEqual(adapter.read(workspacePath, reference('prima')), { id: 'prima', content: content('prima') })

  adapter.write(adapter.prepareUpdate(workspacePath, reference('prima')), content('prima-aggiornata'))
  assert.deepEqual(fs.readdirSync(path.join(skillsRoot, 'prima')), ['SKILL.md'])
  assert.equal(adapter.read(workspacePath, reference('prima')).content, content('prima-aggiornata'))

  adapter.remove(workspacePath, reference('prima'))
  assert.equal(fs.existsSync(path.join(skillsRoot, 'prima')), false)
  assert.equal(fs.existsSync(path.join(skillsRoot, 'seconda', 'SKILL.md')), true)
})

test('mantiene il contratto per skill Markdown dirette e collisioni', (t) => {
  const workspacePath = temporaryDirectory(t)
  const adapter = createProjectSkillsFilesystemAdapter()
  const skillsRoot = path.join(workspacePath, '.pi', 'skills')
  fs.mkdirSync(skillsRoot, { recursive: true })
  fs.writeFileSync(path.join(skillsRoot, 'diretta.md'), content('diretta'))

  const flatReference = reference('diretta.md', 'root-markdown')
  assert.deepEqual(adapter.read(workspacePath, flatReference), { id: 'diretta.md', content: content('diretta') })
  adapter.remove(workspacePath, flatReference)
  assert.equal(fs.existsSync(path.join(skillsRoot, 'diretta.md')), false)

  adapter.create(workspacePath, 'duplicata', content('duplicata'))
  assert.throws(
    () => adapter.create(workspacePath, 'duplicata', content('duplicata')),
    /Esiste già una skill con questo nome/u,
  )
})

test('create non sovrascrive uno SKILL.md pubblicato da una corsa concorrente', (t) => {
  const workspacePath = temporaryDirectory(t)
  const adapter = createProjectSkillsFilesystemAdapter()
  const originalMkdirSync = fs.mkdirSync
  const concurrentContent = content('concorrente')
  let injected = false

  fs.mkdirSync = function mkdirSyncWithConcurrentWriter(directoryPath, options) {
    const result = originalMkdirSync.call(fs, directoryPath, options)
    if (!injected && directoryPath === path.join(workspacePath, '.pi', 'skills', 'contesa')) {
      injected = true
      fs.writeFileSync(path.join(directoryPath, 'SKILL.md'), concurrentContent, { flag: 'wx' })
    }
    return result
  }

  try {
    assert.throws(
      () => adapter.create(workspacePath, 'contesa', content('contesa')),
      (error) => error?.code === 'EEXIST',
    )
  } finally {
    fs.mkdirSync = originalMkdirSync
  }

  assert.equal(injected, true)
  assert.equal(
    fs.readFileSync(path.join(workspacePath, '.pi', 'skills', 'contesa', 'SKILL.md'), 'utf8'),
    concurrentContent,
  )
})

test('prepareUpdate mantiene il target directory anche se compare una skill Markdown alla root', (t) => {
  const workspacePath = temporaryDirectory(t)
  const adapter = createProjectSkillsFilesystemAdapter()
  const skillsRoot = path.join(workspacePath, '.pi', 'skills')
  const skillDirectory = path.join(skillsRoot, 'stabile')
  const directorySkillFile = path.join(skillDirectory, 'SKILL.md')
  const rootMarkdownFile = path.join(skillsRoot, 'stabile.md')
  fs.mkdirSync(skillDirectory, { recursive: true })
  fs.writeFileSync(directorySkillFile, content('directory-originale'))

  const updateHandle = adapter.prepareUpdate(workspacePath, reference('stabile'))
  fs.writeFileSync(rootMarkdownFile, content('root-concorrente'), { flag: 'wx' })
  adapter.write(updateHandle, content('directory-aggiornata'))

  assert.equal(fs.readFileSync(directorySkillFile, 'utf8'), content('directory-aggiornata'))
  assert.equal(fs.readFileSync(rootMarkdownFile, 'utf8'), content('root-concorrente'))
  assert.throws(
    () => adapter.write(updateHandle, content('secondo-update')),
    /Handle aggiornamento skill progetto non valido/u,
  )
})

test('la scansione ignora symlink ed è limitata a 500 record e profondità 8', (t) => {
  const workspacePath = temporaryDirectory(t)
  const externalPath = temporaryDirectory(t, 'vincodelab-project-skills-external-')
  const adapter = createProjectSkillsFilesystemAdapter()
  const skillsRoot = path.join(workspacePath, '.pi', 'skills')
  fs.mkdirSync(skillsRoot, { recursive: true })

  for (let index = 0; index < 510; index += 1) {
    const name = `skill-${String(index).padStart(3, '0')}.md`
    fs.writeFileSync(path.join(skillsRoot, name), content(`skill-${index}`))
  }
  fs.writeFileSync(path.join(externalPath, 'SKILL.md'), content('esterna'))
  fs.symlinkSync(externalPath, path.join(skillsRoot, 'collegata'), 'dir')

  assert.equal(adapter.list(workspacePath).length, 500)
  fs.rmSync(skillsRoot, { recursive: true })
  fs.mkdirSync(skillsRoot, { recursive: true })

  let allowedParent = skillsRoot
  for (let depth = 1; depth <= 8; depth += 1) {
    allowedParent = path.join(allowedParent, `livello-${depth}`)
    fs.mkdirSync(allowedParent)
  }
  const allowedSkill = path.join(allowedParent, 'consentita')
  fs.mkdirSync(allowedSkill)
  fs.writeFileSync(path.join(allowedSkill, 'SKILL.md'), content('consentita'))

  const blockedParent = path.join(allowedParent, 'livello-9')
  const blockedSkill = path.join(blockedParent, 'oltre-limite')
  fs.mkdirSync(blockedSkill, { recursive: true })
  fs.writeFileSync(path.join(blockedSkill, 'SKILL.md'), content('oltre-limite'))

  assert.deepEqual(adapter.list(workspacePath).map((record) => record.id), [
    'livello-1/livello-2/livello-3/livello-4/livello-5/livello-6/livello-7/livello-8/consentita',
  ])
})

test('rifiuta root e directory skill simboliche senza seguirle', (t) => {
  const adapter = createProjectSkillsFilesystemAdapter()
  const externalPath = temporaryDirectory(t, 'vincodelab-project-skills-external-')

  const piSymlinkWorkspace = temporaryDirectory(t)
  fs.symlinkSync(externalPath, path.join(piSymlinkWorkspace, '.pi'), 'dir')
  assert.throws(() => adapter.list(piSymlinkWorkspace), /La directory skill del progetto non è sicura/u)
  assert.throws(() => adapter.create(piSymlinkWorkspace, 'demo', content('demo')), /La directory skill del progetto non è sicura/u)

  const skillSymlinkWorkspace = temporaryDirectory(t)
  fs.mkdirSync(path.join(skillSymlinkWorkspace, '.pi'))
  fs.symlinkSync(externalPath, path.join(skillSymlinkWorkspace, '.pi', 'skills'), 'dir')
  assert.throws(() => adapter.list(skillSymlinkWorkspace), /La directory skill del progetto non è sicura/u)

  const entrySymlinkWorkspace = temporaryDirectory(t)
  const skillsRoot = path.join(entrySymlinkWorkspace, '.pi', 'skills')
  fs.mkdirSync(skillsRoot, { recursive: true })
  fs.writeFileSync(path.join(externalPath, 'SKILL.md'), content('esterna'))
  fs.symlinkSync(externalPath, path.join(skillsRoot, 'collegata'), 'dir')
  assert.throws(
    () => adapter.read(entrySymlinkWorkspace, reference('collegata')),
    /La directory skill richiesta non è sicura/u,
  )
  assert.deepEqual(adapter.list(entrySymlinkWorkspace), [])
})

test('mantiene i messaggi per root assente, ID inesistente e file non regolare', (t) => {
  const workspacePath = temporaryDirectory(t)
  const adapter = createProjectSkillsFilesystemAdapter()
  assert.throws(() => adapter.read(workspacePath, reference('assente')), /Skill non trovata/u)

  const invalidFilePath = path.join(workspacePath, '.pi', 'skills', 'demo', 'SKILL.md')
  fs.mkdirSync(invalidFilePath, { recursive: true })
  assert.throws(() => adapter.read(workspacePath, reference('demo')), /Il file richiesto non è un file regolare/u)
  assert.throws(() => adapter.prepareUpdate(workspacePath, reference('demo')), /Il file richiesto non è un file regolare/u)
  assert.throws(() => adapter.remove(workspacePath, reference('demo')), /Il file richiesto non è un file regolare/u)
})
