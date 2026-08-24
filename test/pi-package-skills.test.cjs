const assert = require('node:assert/strict')
const test = require('node:test')

const { listPiPackageSkills, parsePiPackageList } = require('../electron/domains/ai/pi-package-skills.cjs')
const { createPiPackageSkillsSourcePort } = require('../electron/domains/ai/pi-package-skills-source.port.cjs')

function readableSkill(overrides = {}) {
  return {
    kind: 'readable',
    source: 'npm:workflow',
    packageName: 'workflow',
    relativePath: 'skills/review/SKILL.md',
    fallbackName: 'review',
    content: '---\nname: review\ndescription: Controlla il codice.\n---\n\n# Review\n',
    ...overrides,
  }
}

test('parsePiPackageList associa ogni sorgente Pi alla radice installata', () => {
  const output = 'User packages:\n  npm:@scope/skill\n    /tmp/pi/npm/node_modules/@scope/skill\n  git:github.com/acme/workflow@v1\n    /tmp/pi/git/github.com/acme/workflow\n'
  assert.deepEqual(parsePiPackageList(output), [
    { source: 'npm:@scope/skill', root: '/tmp/pi/npm/node_modules/@scope/skill' },
    { source: 'git:github.com/acme/workflow@v1', root: '/tmp/pi/git/github.com/acme/workflow' },
  ])
})

test('il dominio valida, costruisce, deduplica e ordina i record della porta', () => {
  const calls = []
  const source = createPiPackageSkillsSourcePort({
    scan(packages) {
      calls.push(packages)
      return [
        readableSkill(),
        {
          kind: 'unreadable',
          source: 'npm:partial',
          packageName: 'partial-package',
          relativePath: 'skills/broken/SKILL.md',
          fallbackName: 'broken',
        },
        readableSkill({ content: '---\nname: review\ndescription: Versione aggiornata.\n---\n' }),
        { kind: 'readable', source: null },
      ]
    },
  })
  const packages = [{ source: 'npm:workflow', root: '/packages/workflow' }]

  assert.deepEqual(listPiPackageSkills(packages, source), [
    {
      id: 'npm:partial::skills/broken/SKILL.md',
      name: 'broken',
      description: '',
      valid: false,
      issues: [{ level: 'error', message: 'Impossibile leggere la skill dal pacchetto. Controlla o aggiorna il pacchetto di origine.' }],
      source: 'npm:partial',
      packageName: 'partial-package',
      relativePath: 'skills/broken/SKILL.md',
    },
    {
      id: 'npm:workflow::skills/review/SKILL.md',
      name: 'review',
      description: 'Versione aggiornata.',
      valid: true,
      issues: [],
      source: 'npm:workflow',
      packageName: 'workflow',
      relativePath: 'skills/review/SKILL.md',
    },
  ])
  assert.deepEqual(calls, [packages])
})

test('mantiene visibile il record se la validazione della singola skill non può completarsi', () => {
  const hostileRecord = readableSkill()
  Object.defineProperty(hostileRecord, 'content', {
    get() { throw new Error('contenuto non leggibile') },
  })
  const source = createPiPackageSkillsSourcePort({ scan: () => [hostileRecord] })

  assert.deepEqual(listPiPackageSkills([{ source: 'npm:workflow', root: '/packages/workflow' }], source), [{
    id: 'npm:workflow::skills/review/SKILL.md',
    name: 'review',
    description: '',
    valid: false,
    issues: [{ level: 'error', message: 'Impossibile leggere la skill dal pacchetto. Controlla o aggiorna il pacchetto di origine.' }],
    source: 'npm:workflow',
    packageName: 'workflow',
    relativePath: 'skills/review/SKILL.md',
  }])
})

test('la porta propaga i failure di scansione e rifiuta risultati non validi', () => {
  const expected = new Error('manifest non leggibile')
  const failing = createPiPackageSkillsSourcePort({ scan() { throw expected } })
  assert.throws(
    () => listPiPackageSkills([{ source: 'npm:denied', root: '/packages/denied' }], failing),
    (error) => error === expected,
  )

  const invalid = createPiPackageSkillsSourcePort({ scan: () => null })
  assert.throws(
    () => listPiPackageSkills([{ source: 'npm:invalid', root: '/packages/invalid' }], invalid),
    /ha restituito un risultato non valido/u,
  )
  assert.deepEqual(listPiPackageSkills(null), [])
})

test('la porta semantica valida il contratto e conserva il receiver', () => {
  assert.throws(() => createPiPackageSkillsSourcePort(), /Porta catalogo skill dei pacchetti Pi non valida/u)
  assert.throws(() => createPiPackageSkillsSourcePort({}), /incompleta: scan/u)
  const implementation = {
    records: [readableSkill()],
    scan() { return this.records },
  }
  const source = createPiPackageSkillsSourcePort(implementation)
  assert.equal(Object.isFrozen(source), true)
  assert.deepEqual(source.scan([]), implementation.records)
})
