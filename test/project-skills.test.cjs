const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createProjectSkill, deleteProjectSkill, getProjectSkill, listProjectSkills } = require('../electron/domains/ai/project-skills.cjs')
const { validateSkill } = require('../electron/domains/ai/skill-validation.cjs')

test('validateSkill segnala frontmatter mancante e accetta una skill valida', () => {
  assert.equal(validateSkill('contenuto', 'demo').valid, false)
  assert.equal(validateSkill('---\nname: demo\ndescription: Skill demo\n---\n', 'demo').valid, true)
})

test('crea e scopre le skill nel percorso nativo Pi del workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-project-skills-'))
  try {
    createProjectSkill(workspace, 'revisione-codice')

    assert.equal(fs.existsSync(path.join(workspace, '.pi', 'skills', 'revisione-codice', 'SKILL.md')), true)
    assert.equal(fs.existsSync(path.join(workspace, '.agents', 'skills', 'revisione-codice', 'SKILL.md')), false)
    assert.deepEqual(listProjectSkills(workspace).map((skill) => skill.id), ['revisione-codice'])
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('rileva e apre una skill Markdown diretta della radice Pi', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-flat-skill-'))
  try {
    const skillsRoot = path.join(workspace, '.pi', 'skills')
    fs.mkdirSync(skillsRoot, { recursive: true })
    fs.writeFileSync(path.join(skillsRoot, 'controllo-rilascio.md'), '---\nname: controllo-rilascio\ndescription: Verifica il rilascio.\n---\n\n# Controllo rilascio\n')

    assert.deepEqual(listProjectSkills(workspace).map((skill) => skill.id), ['controllo-rilascio.md'])
    assert.match(getProjectSkill(workspace, 'controllo-rilascio.md').content, /Controllo rilascio/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('elimina una skill Markdown diretta senza cancellare le altre skill Pi', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-flat-skill-delete-'))
  try {
    const skillsRoot = path.join(workspace, '.pi', 'skills')
    fs.mkdirSync(path.join(skillsRoot, 'persistente'), { recursive: true })
    fs.writeFileSync(path.join(skillsRoot, 'temporanea.md'), '---\nname: temporanea\ndescription: Skill temporanea.\n---\n')
    fs.writeFileSync(path.join(skillsRoot, 'persistente', 'SKILL.md'), '---\nname: persistente\ndescription: Skill persistente.\n---\n')

    deleteProjectSkill(workspace, 'temporanea.md')

    assert.equal(fs.existsSync(path.join(skillsRoot, 'temporanea.md')), false)
    assert.equal(fs.existsSync(path.join(skillsRoot, 'persistente', 'SKILL.md')), true)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

test('rejects a symbolic-link directory passed as a skill id', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-skills-'))
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-external-skill-'))
  try {
    const skillsRoot = path.join(workspace, '.pi', 'skills')
    fs.mkdirSync(skillsRoot, { recursive: true })
    fs.writeFileSync(path.join(externalDirectory, 'SKILL.md'), '---\nname: external\ndescription: esterna\n---\n')
    fs.symlinkSync(externalDirectory, path.join(skillsRoot, 'linked'), 'dir')
    assert.throws(() => getProjectSkill(workspace, 'linked'), /directory skill richiesta non è sicura/)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(externalDirectory, { recursive: true, force: true })
  }
})
