const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { listPiPackageSkills, parsePiPackageList } = require('../electron/domains/ai/pi-package-skills.cjs')

test('parsePiPackageList associa ogni sorgente Pi alla radice installata', () => {
  const output = 'User packages:\n  npm:@scope/skill\n    /tmp/pi/npm/node_modules/@scope/skill\n  git:github.com/acme/workflow@v1\n    /tmp/pi/git/github.com/acme/workflow\n'
  assert.deepEqual(parsePiPackageList(output), [
    { source: 'npm:@scope/skill', root: '/tmp/pi/npm/node_modules/@scope/skill' },
    { source: 'git:github.com/acme/workflow@v1', root: '/tmp/pi/git/github.com/acme/workflow' },
  ])
})

test('listPiPackageSkills legge le skill dichiarate da un pacchetto Pi senza file esterni', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-package-'))
  try {
    fs.mkdirSync(path.join(root, 'workflow-skills', 'review'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'workflow', pi: { skills: ['./workflow-skills'] } }))
    fs.writeFileSync(path.join(root, 'workflow-skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Controlla il codice.\n---\n\n# Review\n')
    fs.mkdirSync(path.join(root, 'workflow-skills', 'references'))
    fs.writeFileSync(path.join(root, 'workflow-skills', 'references', 'readme.md'), '# Documento di supporto\n')
    fs.mkdirSync(path.join(root, 'workflow-skills', 'linked'))
    fs.symlinkSync(os.tmpdir(), path.join(root, 'workflow-skills', 'linked', 'outside'), 'dir')

    const skills = listPiPackageSkills([{ source: 'npm:workflow', root }])
    assert.deepEqual(skills.map(({ name, source, packageName, relativePath }) => ({ name, source, packageName, relativePath })), [
      { name: 'review', source: 'npm:workflow', packageName: 'workflow', relativePath: 'workflow-skills/review/SKILL.md' },
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('mantiene visibile una skill di pacchetto illeggibile come elemento non valido', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-package-partial-'))
  const skillDirectory = path.join(root, 'skills', 'broken')
  const skillPath = path.join(skillDirectory, 'SKILL.md')
  fs.mkdirSync(skillDirectory, { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'partial-package' }))
  fs.writeFileSync(skillPath, '# Broken\n')
  const originalReadFileSync = fs.readFileSync
  fs.readFileSync = (candidate, ...args) => {
    if (candidate === skillPath) throw Object.assign(new Error('permission denied /private/path'), { code: 'EACCES' })
    return originalReadFileSync(candidate, ...args)
  }
  t.after(() => {
    fs.readFileSync = originalReadFileSync
    fs.rmSync(root, { recursive: true, force: true })
  })

  const skills = listPiPackageSkills([{ source: 'npm:partial', root }])
  assert.deepEqual(skills, [{
    id: 'npm:partial::skills/broken/SKILL.md',
    name: 'broken',
    description: '',
    valid: false,
    issues: [{ level: 'error', message: 'Impossibile leggere la skill dal pacchetto. Controlla o aggiorna il pacchetto di origine.' }],
    source: 'npm:partial',
    packageName: 'partial-package',
    relativePath: 'skills/broken/SKILL.md',
  }])
  assert.doesNotMatch(JSON.stringify(skills), /private|EACCES/u)
})

test('non scambia un package inaccessibile per un package senza skill', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-package-denied-'))
  const originalLstatSync = fs.lstatSync
  fs.lstatSync = (candidate, ...args) => {
    if (candidate === root) throw Object.assign(new Error('permission denied /private/package'), { code: 'EACCES' })
    return originalLstatSync(candidate, ...args)
  }
  t.after(() => {
    fs.lstatSync = originalLstatSync
    fs.rmSync(root, { recursive: true, force: true })
  })

  assert.throws(
    () => listPiPackageSkills([{ source: 'npm:denied', root }]),
    (error) => error?.code === 'EACCES',
  )
})
