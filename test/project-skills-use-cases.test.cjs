const assert = require('node:assert/strict')
const test = require('node:test')

const { createProjectSkillsUseCases } = require('../electron/domains/ai/project-skills.cjs')
const {
  PROJECT_SKILLS_STORAGE_METHODS,
  createProjectSkillsStoragePort,
} = require('../electron/domains/ai/project-skills-storage.port.cjs')

function projectSkillsFixture(initialRecords = []) {
  const calls = []
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]))
  const storage = createProjectSkillsStoragePort({
    assertRootPresent(workspacePath) {
      calls.push(['assert-root-present', workspacePath])
    },
    create(workspacePath, name, content) {
      calls.push(['create', workspacePath, name, content])
      records.set(name, { id: name, content })
    },
    list(workspacePath) {
      calls.push(['list', workspacePath])
      return [...records.values()].map((record) => ({ ...record }))
    },
    prepareUpdate(workspacePath, reference) {
      calls.push(['prepare-update', workspacePath, reference])
      if (!records.has(reference.id)) throw new Error('Skill non trovata.')
      return Object.freeze({ id: reference.id })
    },
    read(workspacePath, reference) {
      calls.push(['read', workspacePath, reference])
      const record = records.get(reference.id)
      if (!record) throw new Error('Skill non trovata.')
      return { ...record }
    },
    remove(workspacePath, reference) {
      calls.push(['remove', workspacePath, reference])
      records.delete(reference.id)
    },
    write(handle, content) {
      calls.push(['write', handle, content])
      records.set(handle.id, { id: handle.id, content })
    },
  })
  return {
    calls,
    storage,
    useCases: createProjectSkillsUseCases({ storage }),
  }
}

function skillContent(name, description = `Skill ${name}`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

test('la porta storage delle skill è minima, completa e immutabile', () => {
  const implementation = {
    prefix: 'ok',
    assertRootPresent() {},
    create() {},
    list() { return [this.prefix] },
    prepareUpdate() {},
    read() {},
    remove() {},
    write() {},
  }
  const port = createProjectSkillsStoragePort(implementation)

  assert.deepEqual(PROJECT_SKILLS_STORAGE_METHODS, ['assertRootPresent', 'create', 'list', 'prepareUpdate', 'read', 'remove', 'write'])
  assert.deepEqual(Object.keys(port), PROJECT_SKILLS_STORAGE_METHODS)
  assert.deepEqual(port.list('/workspace'), ['ok'])
  assert.equal(Object.isFrozen(port), true)
  assert.equal(Object.isFrozen(PROJECT_SKILLS_STORAGE_METHODS), true)
  assert.throws(() => createProjectSkillsUseCases(), /Porta skill progetto non valida/u)
  assert.throws(
    () => createProjectSkillsStoragePort({ assertRootPresent() {}, create() {}, list() {}, prepareUpdate() {}, read() {}, remove() {} }),
    /Porta skill progetto incompleta: write/u,
  )
})

test('list costruisce DTO senza contenuto e li ordina per nome dichiarato', () => {
  const fixture = projectSkillsFixture([
    { id: 'zeta', content: skillContent('alpha', 'Prima') },
    { id: 'beta.md', content: 'contenuto senza frontmatter' },
  ])

  assert.deepEqual(fixture.useCases.listProjectSkills('/workspace'), [
    {
      id: 'zeta',
      name: 'alpha',
      description: 'Prima',
      valid: true,
      issues: [{ level: 'warning', message: 'Il nome non coincide con la directory; Pi lo accetta, altri harness potrebbero no.' }],
    },
    {
      id: 'beta.md',
      name: 'beta',
      description: '',
      valid: false,
      issues: [{ level: 'error', message: 'Frontmatter YAML mancante o non chiuso.' }],
    },
  ])
  assert.deepEqual(fixture.calls, [['list', '/workspace']])
})

test('create valida il nome, delega il template e restituisce il DTO completo', () => {
  for (const name of [undefined, '', 'Nome-Invalido', 'nome_errore', 'x'.repeat(65)]) {
    const fixture = projectSkillsFixture()
    assert.throws(
      () => fixture.useCases.createProjectSkill('/workspace', name),
      /Il nome skill deve usare lowercase, numeri e trattini \(massimo 64 caratteri\)/u,
    )
    assert.deepEqual(fixture.calls, [])
  }

  const fixture = projectSkillsFixture()
  const result = fixture.useCases.createProjectSkill('/workspace', 'revisione-codice')
  assert.equal(result.id, 'revisione-codice')
  assert.equal(result.name, 'revisione-codice')
  assert.equal(result.valid, true)
  assert.match(result.content, /^---\nname: revisione-codice\n/u)
  assert.match(result.content, /Definisci qui il workflow che Pi deve seguire\./u)
  assert.deepEqual(fixture.calls.map((call) => call[0]), ['create', 'assert-root-present', 'read'])
})

test('get normalizza gli ID dopo la guardia root e blocca traversal prima della lettura', () => {
  const fixture = projectSkillsFixture([
    { id: 'gruppo/demo', content: skillContent('demo') },
    { id: 'diretta.md', content: skillContent('diretta') },
  ])

  assert.equal(fixture.useCases.getProjectSkill('/workspace', '/gruppo//demo/').id, 'gruppo/demo')
  assert.equal(fixture.useCases.getProjectSkill('/workspace', 'diretta.md').id, 'diretta.md')
  const readsBeforeInvalidInput = fixture.calls.filter((call) => call[0] === 'read').length
  for (const skillId of [undefined, '', '/', '.', '..', 'gruppo/../demo', 'gruppo/file.md', 'x'.repeat(4_097)]) {
    assert.throws(
      () => fixture.useCases.getProjectSkill('/workspace', skillId),
      /Percorso skill non valido/u,
    )
  }
  assert.equal(fixture.calls.filter((call) => call[0] === 'read').length, readsBeforeInvalidInput)

  const literalBackslash = projectSkillsFixture([{ id: 'foo\\bar', content: skillContent('foo-bar') }])
  assert.equal(literalBackslash.useCases.getProjectSkill('/workspace', 'foo\\bar').id, 'foo\\bar')
})

test('update preserva root, riferimento ed esistenza prima del frontmatter e scrive sul target preparato', () => {
  for (const content of [undefined, null, 3, 'x'.repeat(200_001)]) {
    const fixture = projectSkillsFixture()
    assert.throws(() => fixture.useCases.updateProjectSkill('/workspace', '../demo', content), /Contenuto skill non valido/u)
    assert.deepEqual(fixture.calls, [])
  }

  const missing = projectSkillsFixture()
  assert.throws(
    () => missing.useCases.updateProjectSkill('/workspace', 'demo', 'senza frontmatter'),
    /Skill non trovata/u,
  )
  assert.deepEqual(missing.calls.map((call) => call[0]), ['assert-root-present', 'prepare-update'])

  const invalidReference = projectSkillsFixture()
  assert.throws(
    () => invalidReference.useCases.updateProjectSkill('/workspace', '../demo', 'senza frontmatter'),
    /Percorso skill non valido/u,
  )
  assert.deepEqual(invalidReference.calls.map((call) => call[0]), ['assert-root-present'])

  const invalid = projectSkillsFixture([{ id: 'demo', content: skillContent('demo') }])
  assert.throws(
    () => invalid.useCases.updateProjectSkill('/workspace', 'demo', 'senza frontmatter'),
    /Frontmatter YAML mancante o non chiuso/u,
  )
  assert.deepEqual(invalid.calls.map((call) => call[0]), ['assert-root-present', 'prepare-update'])

  const fixture = projectSkillsFixture([{ id: 'diretta.md', content: skillContent('diretta') }])
  const content = skillContent('diretta', 'Aggiornata')
  assert.deepEqual(fixture.useCases.updateProjectSkill('/workspace', 'diretta.md', content), {
    id: 'diretta.md',
    name: 'diretta',
    description: 'Aggiornata',
    valid: true,
    issues: [],
    content,
  })
  assert.deepEqual(fixture.calls.map((call) => call[0]), [
    'assert-root-present',
    'prepare-update',
    'write',
    'assert-root-present',
    'read',
  ])
})

test('get, update e delete mantengono la root assente prioritaria rispetto a ID e frontmatter', () => {
  const rootFailure = new Error('Skill non trovata.')
  const storage = createProjectSkillsStoragePort({
    assertRootPresent() { throw rootFailure },
    create() {},
    list() {},
    prepareUpdate() {},
    read() {},
    remove() {},
    write() {},
  })
  const useCases = createProjectSkillsUseCases({ storage })

  assert.throws(() => useCases.getProjectSkill('/missing', '../invalid'), (error) => error === rootFailure)
  assert.throws(
    () => useCases.updateProjectSkill('/missing', 'demo', 'frontmatter non valido'),
    (error) => error === rootFailure,
  )
  assert.throws(() => useCases.deleteProjectSkill('/missing', '../invalid'), (error) => error === rootFailure)
})

test('delete valida e delega il riferimento senza esporre percorsi filesystem', () => {
  const fixture = projectSkillsFixture([{ id: 'gruppo/demo', content: skillContent('demo') }])

  assert.equal(fixture.useCases.deleteProjectSkill('/workspace', 'gruppo/demo'), undefined)
  assert.equal(fixture.calls.length, 2)
  assert.equal(fixture.calls[0][0], 'assert-root-present')
  assert.equal(fixture.calls[1][0], 'remove')
  assert.deepEqual(fixture.calls[1][2], {
    id: 'gruppo/demo',
    kind: 'directory',
    segments: ['gruppo', 'demo'],
  })
})
