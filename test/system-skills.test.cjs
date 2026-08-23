const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { getSystemSkill, listSystemSkills } = require('../electron/system-skills.cjs')

const SKILL_CONTENT = '---\nname: available\ndescription: Skill disponibile.\n---\n'

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
