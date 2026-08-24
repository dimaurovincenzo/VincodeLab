const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { toApplicationError } = require('../electron/domains/errors/application-error.cjs')
const { toIpcApplicationError } = require('../electron/infrastructure/ipc/ipc-application-error.cjs')
const { createSystemSkillsUseCases } = require('../electron/domains/ai/system-skills.cjs')
const { createSystemSkillsFilesystemAdapter } = require('../electron/infrastructure/filesystem/system-skills-filesystem.adapter.cjs')
const {
  createSystemSkill,
  getSystemSkill,
  listSystemSkills,
} = createSystemSkillsUseCases({ storage: createSystemSkillsFilesystemAdapter() })

const SKILL_CONTENT = '---\nname: available\ndescription: Skill disponibile.\n---\n'

test('crea una skill su una root mancante con permessi privati', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skill-create-'))
  const root = path.join(fixture, 'skills')
  try {
    const skill = createSystemSkill(root, 'redis-inspector')

    assert.equal(skill.id, 'redis-inspector')
    assert.equal(skill.name, 'redis-inspector')
    assert.equal(skill.valid, true)
    assert.match(skill.content, /^---\nname: redis-inspector\n/u)
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(root).mode & 0o777, 0o700)
      assert.equal(fs.statSync(path.join(root, 'redis-inspector')).mode & 0o777, 0o700)
      assert.equal(fs.statSync(path.join(root, 'redis-inspector', 'SKILL.md')).mode & 0o777, 0o600)
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('rifiuta i nomi non validi prima di creare la root e li classifica come validation', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skill-invalid-'))
  try {
    for (const [index, name] of ['', 'Nome Skill', 'nome_skill', '-nome', 'nome-', 'nome--skill', 'a'.repeat(65)].entries()) {
      const root = path.join(fixture, `skills-${index}`)
      assert.throws(() => createSystemSkill(root, name), (error) => {
        assert.equal(error.publicCode, 'SYSTEM_SKILL_NAME_INVALID')
        assert.equal(error.publicMessage, 'Usa un nome di 1-64 caratteri con lettere minuscole e numeri separati da trattini.')

        const incident = toApplicationError(error, { domain: 'filesystem', operation: 'create' })
        assert.equal(incident.category, 'validation')
        assert.equal(incident.domain, 'filesystem')
        assert.equal(incident.operation, 'create')
        assert.equal(incident.severity, 'warning')
        assert.equal(incident.publicCode, 'SYSTEM_SKILL_NAME_INVALID')
        return true
      })
      assert.equal(fs.existsSync(root), false)
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('rifiuta una collisione con una skill legacy senza creare una directory duplicata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skill-legacy-'))
  try {
    fs.writeFileSync(path.join(root, 'legacy.md'), '---\nname: legacy\ndescription: Skill legacy.\n---\n')

    assert.throws(() => createSystemSkill(root, 'legacy'), (error) => {
      assert.equal(error.publicCode, 'SYSTEM_SKILL_ALREADY_EXISTS')
      assert.equal(error.publicMessage, 'Esiste già una skill Pi con questo nome. Scegli un nome diverso.')
      const incident = toApplicationError(error, { domain: 'filesystem', operation: 'create' })
      assert.equal(incident.category, 'conflict')
      assert.equal(incident.severity, 'warning')
      return true
    })
    assert.equal(fs.existsSync(path.join(root, 'legacy')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('traduce una race EEXIST durante la riserva della directory in una collisione recuperabile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skill-race-'))
  const directory = path.join(root, 'concurrent-skill')
  const originalMkdirSync = fs.mkdirSync
  try {
    fs.mkdirSync = (candidate, ...args) => {
      if (candidate === directory) throw Object.assign(new Error('already exists'), { code: 'EEXIST' })
      return originalMkdirSync(candidate, ...args)
    }

    assert.throws(() => createSystemSkill(root, 'concurrent-skill'), (error) => {
      assert.equal(error.publicCode, 'SYSTEM_SKILL_ALREADY_EXISTS')
      return true
    })
  } finally {
    fs.mkdirSync = originalMkdirSync
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rimuove la directory vuota riservata quando la scrittura della skill fallisce', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skill-write-'))
  const skillFile = path.join(root, 'write-failure', 'SKILL.md')
  const originalWriteFileSync = fs.writeFileSync
  const failure = Object.assign(new Error('I/O failure'), { code: 'EIO' })
  try {
    fs.writeFileSync = (candidate, ...args) => {
      if (candidate === skillFile) throw failure
      return originalWriteFileSync(candidate, ...args)
    }

    assert.throws(() => createSystemSkill(root, 'write-failure'), (error) => error === failure)
    assert.equal(fs.existsSync(path.dirname(skillFile)), false)
    assert.doesNotThrow(() => fs.mkdirSync(path.dirname(skillFile)))
  } finally {
    fs.writeFileSync = originalWriteFileSync
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('usa il messaggio contestuale delle Skill Pi per gli errori tecnici di creazione', () => {
  const incident = toIpcApplicationError(
    Object.assign(new Error('I/O failure'), { code: 'EIO' }),
    'systemSkills:create',
  )

  assert.equal(incident.category, 'filesystem')
  assert.match(incident.message, /^Impossibile creare la skill Pi\. Riprova\./u)
})

test('rifiuta traversal e directory symlink per le skill di sistema', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skills-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skill-external-'))
  try {
    assert.throws(() => getSystemSkill(root, '../esterna'), /Percorso skill non valido/)
    fs.writeFileSync(path.join(external, 'SKILL.md'), '---\nname: external\ndescription: esterna\n---\n')
    fs.symlinkSync(external, path.join(root, 'linked'), 'dir')
    assert.throws(() => getSystemSkill(root, 'linked'), /non è sicura/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('il catalogo ignora soltanto race ENOENT, file non regolari e symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skills-list-'))
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skills-list-external-'))
  const racedFile = path.join(root, 'raced.md')
  const originalReadFileSync = fs.readFileSync
  try {
    fs.writeFileSync(path.join(root, 'available.md'), SKILL_CONTENT)
    fs.writeFileSync(racedFile, SKILL_CONTENT)
    fs.mkdirSync(path.join(root, 'non-regular'))
    fs.mkdirSync(path.join(root, 'linked-directory'))
    fs.writeFileSync(path.join(external, 'SKILL.md'), SKILL_CONTENT)
    fs.symlinkSync(path.join(external, 'SKILL.md'), path.join(root, 'linked.md'))
    fs.symlinkSync(path.join(external, 'SKILL.md'), path.join(root, 'linked-directory', 'SKILL.md'))
    fs.readFileSync = (candidate, ...args) => {
      if (candidate === racedFile) throw Object.assign(new Error('entry removed'), { code: 'ENOENT' })
      return originalReadFileSync(candidate, ...args)
    }

    assert.deepEqual(listSystemSkills(root).map((skill) => skill.id), ['available'])
  } finally {
    fs.readFileSync = originalReadFileSync
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(external, { recursive: true, force: true })
  }
})

test('il catalogo propaga EACCES durante l ispezione di una skill', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skills-eacces-'))
  const deniedFile = path.join(root, 'denied.md')
  const originalLstatSync = fs.lstatSync
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  try {
    fs.writeFileSync(deniedFile, SKILL_CONTENT)
    fs.lstatSync = (candidate, ...args) => {
      if (candidate === deniedFile) throw denied
      return originalLstatSync(candidate, ...args)
    }

    assert.throws(() => listSystemSkills(root), (error) => error === denied)
  } finally {
    fs.lstatSync = originalLstatSync
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('il catalogo propaga EIO durante la lettura di una skill', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-system-skills-eio-'))
  const brokenFile = path.join(root, 'broken.md')
  const originalReadFileSync = fs.readFileSync
  const failure = Object.assign(new Error('I/O failure'), { code: 'EIO' })
  try {
    fs.writeFileSync(brokenFile, SKILL_CONTENT)
    fs.readFileSync = (candidate, ...args) => {
      if (candidate === brokenFile) throw failure
      return originalReadFileSync(candidate, ...args)
    }

    assert.throws(() => listSystemSkills(root), (error) => error === failure)
  } finally {
    fs.readFileSync = originalReadFileSync
    fs.rmSync(root, { recursive: true, force: true })
  }
})
