const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createPiPackageSkillsFilesystemAdapter } = require('../electron/infrastructure/filesystem/pi-package-skills-filesystem.adapter.cjs')

function temporaryDirectory(t, prefix = 'vincodelab-pi-package-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function writeSkill(root, relativePath, name = path.basename(path.dirname(relativePath))) {
  const skillPath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(skillPath), { recursive: true })
  fs.writeFileSync(skillPath, `---\nname: ${name}\ndescription: Skill ${name}.\n---\n`)
  return skillPath
}

test('scansiona roots dichiarate, file root e directory SKILL.md senza seguire symlink', (t) => {
  const root = temporaryDirectory(t)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'workflow', pi: { skills: ['./workflow-skills'] } }))
  const nestedSkill = writeSkill(root, 'workflow-skills/review/SKILL.md', 'review')
  const rootSkill = writeSkill(root, 'workflow-skills/formatter.md', 'formatter')
  writeSkill(root, 'workflow-skills/references/nested.md', 'nested-document')
  fs.mkdirSync(path.join(root, 'workflow-skills', 'linked'))
  fs.symlinkSync(os.tmpdir(), path.join(root, 'workflow-skills', 'linked', 'outside'), 'dir')

  const records = createPiPackageSkillsFilesystemAdapter().scan([{ source: 'npm:workflow', root }])
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  assert.deepEqual(records.map(({ kind, source, packageName, relativePath, fallbackName }) => ({ kind, source, packageName, relativePath, fallbackName })), [
    { kind: 'readable', source: 'npm:workflow', packageName: 'workflow', relativePath: 'workflow-skills/formatter.md', fallbackName: 'formatter' },
    { kind: 'readable', source: 'npm:workflow', packageName: 'workflow', relativePath: 'workflow-skills/review/SKILL.md', fallbackName: 'review' },
  ])
  assert.equal(records[1].content, fs.readFileSync(nestedSkill, 'utf8'))
  assert.equal(records[0].content, fs.readFileSync(rootSkill, 'utf8'))
})

test('usa la root skills predefinita quando il manifest è assente o supera 1 MiB', (t) => {
  const withoutManifest = temporaryDirectory(t)
  writeSkill(withoutManifest, 'skills/default/SKILL.md', 'default')

  const oversizedManifest = temporaryDirectory(t)
  fs.writeFileSync(path.join(oversizedManifest, 'package.json'), `{"padding":"${'x'.repeat(1024 * 1024)}"}`)
  writeSkill(oversizedManifest, 'skills/oversized/SKILL.md', 'oversized')

  const records = createPiPackageSkillsFilesystemAdapter().scan([
    { source: 'npm:default', root: withoutManifest },
    { source: 'npm:oversized', root: oversizedManifest },
  ])
  assert.deepEqual(records.map(({ source, packageName, relativePath }) => ({ source, packageName, relativePath })), [
    { source: 'npm:default', packageName: 'npm:default', relativePath: 'skills/default/SKILL.md' },
    { source: 'npm:oversized', packageName: 'npm:oversized', relativePath: 'skills/oversized/SKILL.md' },
  ])
})

test('mantiene la singola skill illeggibile come record senza esporre la causa', (t) => {
  const root = temporaryDirectory(t)
  const skillPath = writeSkill(root, 'skills/broken/SKILL.md', 'broken')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'partial-package' }))
  const originalReadFileSync = fs.readFileSync
  fs.readFileSync = (candidate, ...args) => {
    if (candidate === skillPath) throw Object.assign(new Error('permission denied /private/path'), { code: 'EACCES' })
    return originalReadFileSync(candidate, ...args)
  }
  t.after(() => { fs.readFileSync = originalReadFileSync })

  const records = createPiPackageSkillsFilesystemAdapter().scan([{ source: 'npm:partial', root }])
  assert.deepEqual(records, [{
    kind: 'unreadable',
    fallbackName: 'broken',
    packageName: 'partial-package',
    relativePath: 'skills/broken/SKILL.md',
    source: 'npm:partial',
  }])
  assert.doesNotMatch(JSON.stringify(records), /private|EACCES/u)
})

test('propaga errori I/O e JSON del manifest invece di trasformarli in cataloghi vuoti', (t) => {
  const corruptRoot = temporaryDirectory(t)
  fs.writeFileSync(path.join(corruptRoot, 'package.json'), '{json-corrotto')
  const adapter = createPiPackageSkillsFilesystemAdapter()
  assert.throws(() => adapter.scan([{ source: 'npm:corrupt', root: corruptRoot }]), SyntaxError)

  const deniedRoot = temporaryDirectory(t)
  const deniedManifest = path.join(deniedRoot, 'package.json')
  fs.writeFileSync(deniedManifest, '{}')
  const originalReadFileSync = fs.readFileSync
  fs.readFileSync = (candidate, ...args) => {
    if (candidate === deniedManifest) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    return originalReadFileSync(candidate, ...args)
  }
  try {
    assert.throws(
      () => adapter.scan([{ source: 'npm:denied', root: deniedRoot }]),
      (error) => error?.code === 'EACCES',
    )
  } finally {
    fs.readFileSync = originalReadFileSync
  }
})

test('non segue package root symlink e propaga un package root inaccessibile', (t) => {
  const adapter = createPiPackageSkillsFilesystemAdapter()
  const external = temporaryDirectory(t, 'vincodelab-pi-package-external-')
  writeSkill(external, 'skills/external/SKILL.md', 'external')
  const container = temporaryDirectory(t)
  const linkedRoot = path.join(container, 'linked-package')
  fs.symlinkSync(external, linkedRoot, 'dir')
  assert.deepEqual(adapter.scan([{ source: 'npm:linked', root: linkedRoot }]), [])

  const deniedRoot = temporaryDirectory(t)
  const originalLstatSync = fs.lstatSync
  fs.lstatSync = (candidate, ...args) => {
    if (candidate === deniedRoot) throw Object.assign(new Error('permission denied /private/package'), { code: 'EACCES' })
    return originalLstatSync(candidate, ...args)
  }
  try {
    assert.throws(
      () => adapter.scan([{ source: 'npm:denied', root: deniedRoot }]),
      (error) => error?.code === 'EACCES',
    )
  } finally {
    fs.lstatSync = originalLstatSync
  }
})

test('limita ogni pacchetto a 500 skill e non attraversa oltre la profondità massima', (t) => {
  const root = temporaryDirectory(t)
  fs.mkdirSync(path.join(root, 'skills'))
  for (let index = 0; index < 510; index += 1) {
    fs.writeFileSync(path.join(root, 'skills', `skill-${String(index).padStart(3, '0')}.md`), `# Skill ${index}\n`)
  }
  assert.equal(createPiPackageSkillsFilesystemAdapter().scan([{ source: 'npm:many', root }]).length, 500)

  const multiRoot = temporaryDirectory(t)
  fs.writeFileSync(path.join(multiRoot, 'package.json'), JSON.stringify({ pi: { skills: ['first', 'second'] } }))
  for (const directoryName of ['first', 'second']) {
    fs.mkdirSync(path.join(multiRoot, directoryName))
    for (let index = 0; index < 300; index += 1) {
      fs.writeFileSync(path.join(multiRoot, directoryName, `${directoryName}-${String(index).padStart(3, '0')}.md`), '# Skill\n')
    }
  }
  assert.equal(createPiPackageSkillsFilesystemAdapter().scan([{ source: 'npm:multi-root', root: multiRoot }]).length, 500)

  const deepRoot = temporaryDirectory(t)
  let directory = path.join(deepRoot, 'skills')
  for (let depth = 0; depth < 10; depth += 1) directory = path.join(directory, `level-${depth}`)
  writeSkill(deepRoot, `${path.relative(deepRoot, directory)}/SKILL.md`, 'too-deep')
  assert.deepEqual(createPiPackageSkillsFilesystemAdapter().scan([{ source: 'npm:deep', root: deepRoot }]), [])
})
