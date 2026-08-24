const assert = require('node:assert/strict')
const test = require('node:test')

const { createSystemSkillsUseCases } = require('../electron/domains/ai/system-skills.cjs')
const {
  SYSTEM_SKILLS_STORAGE_METHODS,
  createSystemSkillsStoragePort,
} = require('../electron/domains/ai/system-skills-storage.port.cjs')

function systemSkillsFixture(initialRecords = []) {
  const calls = []
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]))
  const storage = createSystemSkillsStoragePort({
    assertRootPresent(root) {
      calls.push(['assert-root-present', root])
    },
    create(root, name, content) {
      calls.push(['create', root, name, content])
      if (records.has(name)) return { created: false, reason: 'conflict' }
      records.set(name, { id: name, content })
      return { created: true }
    },
    list(root) {
      calls.push(['list', root])
      return [...records.values()].map((record) => ({ ...record }))
    },
    prepareUpdate(root, id) {
      calls.push(['prepare-update', root, id])
      if (!records.has(id)) throw new Error('Skill non trovata.')
      return Object.freeze({ id })
    },
    read(root, id) {
      calls.push(['read', root, id])
      const record = records.get(id)
      if (!record) throw new Error('Skill non trovata.')
      return { ...record }
    },
    remove(root, id) {
      calls.push(['remove', root, id])
      records.delete(id)
    },
    write(handle, content) {
      calls.push(['write', handle, content])
      records.set(handle.id, { id: handle.id, content })
    },
  })
  return {
    calls,
    storage,
    useCases: createSystemSkillsUseCases({ storage }),
  }
}

function skillContent(name, description = `Skill ${name}`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

test('la porta storage espone soltanto le capacità semantiche necessarie', () => {
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
  const port = createSystemSkillsStoragePort(implementation)

  assert.deepEqual(SYSTEM_SKILLS_STORAGE_METHODS, ['assertRootPresent', 'create', 'list', 'prepareUpdate', 'read', 'remove', 'write'])
  assert.deepEqual(Object.keys(port), SYSTEM_SKILLS_STORAGE_METHODS)
  assert.deepEqual(port.list('/skills'), ['ok'])
  assert.equal(Object.isFrozen(port), true)
  assert.equal(Object.isFrozen(SYSTEM_SKILLS_STORAGE_METHODS), true)
  assert.throws(() => createSystemSkillsUseCases(), /Porta skill di sistema non valida/u)
  assert.throws(
    () => createSystemSkillsStoragePort({ assertRootPresent() {}, create() {}, list() {}, prepareUpdate() {}, read() {}, remove() {} }),
    /Porta skill di sistema incompleta: write/u,
  )
})

test('list costruisce DTO senza contenuto e ordina sul nome dichiarato', () => {
  const fixture = systemSkillsFixture([
    { id: 'zeta', content: skillContent('alpha', 'Prima') },
    { id: 'beta', content: 'senza frontmatter' },
  ])

  assert.deepEqual(fixture.useCases.listSystemSkills('/skills'), [
    {
      id: 'zeta',
      name: 'alpha',
      description: 'Prima',
      valid: true,
      issues: [{ level: 'warning', message: 'Il nome non coincide con la directory; Pi lo accetta, altri harness potrebbero no.' }],
    },
    {
      id: 'beta',
      name: 'beta',
      description: '',
      valid: false,
      issues: [{ level: 'error', message: 'Frontmatter YAML mancante o non chiuso.' }],
    },
  ])
  assert.deepEqual(fixture.calls, [['list', '/skills']])
})

test('create mantiene validazione, template e collision policy nel dominio', () => {
  for (const name of [undefined, '', 'Nome Skill', 'nome_skill', '-nome', 'nome-', 'nome--skill', 'a'.repeat(65)]) {
    const fixture = systemSkillsFixture()
    assert.throws(() => fixture.useCases.createSystemSkill('/skills', name), (error) => {
      assert.equal(error.publicCode, 'SYSTEM_SKILL_NAME_INVALID')
      assert.equal(error.publicMessage, 'Usa un nome di 1-64 caratteri con lettere minuscole e numeri separati da trattini.')
      return true
    })
    assert.deepEqual(fixture.calls, [])
  }

  const collision = systemSkillsFixture([{ id: 'esistente', content: skillContent('esistente') }])
  assert.throws(() => collision.useCases.createSystemSkill('/skills', 'esistente'), (error) => {
    assert.equal(error.publicCode, 'SYSTEM_SKILL_ALREADY_EXISTS')
    assert.equal(error.publicMessage, 'Esiste già una skill Pi con questo nome. Scegli un nome diverso.')
    return true
  })
  assert.deepEqual(collision.calls.map((call) => call[0]), ['create'])

  const fixture = systemSkillsFixture()
  const result = fixture.useCases.createSystemSkill('/skills', 'redis-inspector')
  assert.equal(result.id, 'redis-inspector')
  assert.equal(result.valid, true)
  assert.match(result.content, /^---\nname: redis-inspector\n/u)
  assert.match(result.content, /Descrivi cosa fa questa skill di sistema/u)
  assert.deepEqual(fixture.calls.map((call) => call[0]), ['create', 'assert-root-present', 'read'])
})

test('get e delete validano l’identificatore prima di delegare', () => {
  const fixture = systemSkillsFixture([{ id: 'review', content: skillContent('review') }])
  assert.equal(fixture.useCases.getSystemSkill('/skills', 'review').content, skillContent('review'))
  fixture.useCases.deleteSystemSkill('/skills', 'review')
  assert.deepEqual(fixture.calls.map((call) => call[0]), ['assert-root-present', 'read', 'assert-root-present', 'remove'])

  const delegatedOperationsBeforeInvalidInput = fixture.calls.filter((call) => ['read', 'remove'].includes(call[0])).length
  for (const id of [undefined, '', '../review', 'review.md', 'review/nested', 'a'.repeat(4_097)]) {
    assert.throws(() => fixture.useCases.getSystemSkill('/skills', id), /Percorso skill non valido/u)
  }
  assert.equal(fixture.calls.filter((call) => ['read', 'remove'].includes(call[0])).length, delegatedOperationsBeforeInvalidInput)
})

test('get, update e delete preservano il controllo storico della root prima dell’ID', () => {
  const rootFailure = new Error('Skill non trovata.')
  const storage = createSystemSkillsStoragePort({
    assertRootPresent() { throw rootFailure },
    create() {},
    list() {},
    prepareUpdate() {},
    read() {},
    remove() {},
    write() {},
  })
  const useCases = createSystemSkillsUseCases({ storage })

  assert.throws(() => useCases.getSystemSkill('/missing', '../invalid'), (error) => error === rootFailure)
  assert.throws(() => useCases.updateSystemSkill('/missing', '../invalid', skillContent('valid')), (error) => error === rootFailure)
  assert.throws(() => useCases.deleteSystemSkill('/missing', '../invalid'), (error) => error === rootFailure)
})

test('update preserva esistenza prima della validazione frontmatter e poi scrive atomicamente', () => {
  for (const content of [undefined, null, 7, 'x'.repeat(200_001)]) {
    const fixture = systemSkillsFixture()
    assert.throws(() => fixture.useCases.updateSystemSkill('/skills', '../demo', content), /Contenuto skill non valido/u)
    assert.deepEqual(fixture.calls, [])
  }

  const missing = systemSkillsFixture()
  assert.throws(
    () => missing.useCases.updateSystemSkill('/skills', 'assente', 'frontmatter non valido'),
    /Skill non trovata/u,
  )
  assert.deepEqual(missing.calls, [
    ['assert-root-present', '/skills'],
    ['prepare-update', '/skills', 'assente'],
  ])

  const invalid = systemSkillsFixture([{ id: 'demo', content: skillContent('demo') }])
  assert.throws(
    () => invalid.useCases.updateSystemSkill('/skills', 'demo', 'frontmatter non valido'),
    /Frontmatter YAML mancante o non chiuso/u,
  )
  assert.deepEqual(invalid.calls, [
    ['assert-root-present', '/skills'],
    ['prepare-update', '/skills', 'demo'],
  ])

  const fixture = systemSkillsFixture([{ id: 'demo', content: skillContent('demo') }])
  const updated = skillContent('demo', 'Aggiornata')
  assert.deepEqual(fixture.useCases.updateSystemSkill('/skills', 'demo', updated), {
    id: 'demo',
    name: 'demo',
    description: 'Aggiornata',
    valid: true,
    issues: [],
    content: updated,
  })
  assert.deepEqual(fixture.calls.map((call) => call[0]), [
    'assert-root-present',
    'prepare-update',
    'write',
    'assert-root-present',
    'read',
  ])
})
