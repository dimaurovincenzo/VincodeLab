const assert = require('node:assert/strict')
const test = require('node:test')

const { createProjectInstructionsUseCases } = require('../electron/domains/ai/project-instructions.cjs')
const {
  PROJECT_INSTRUCTIONS_STORAGE_METHODS,
  createProjectInstructionsStoragePort,
} = require('../electron/domains/ai/project-instructions-storage.port.cjs')

function instructionsFixture({ storedContent = null } = {}) {
  const calls = []
  const storage = createProjectInstructionsStoragePort({
    read(workspacePath) {
      calls.push(['read', workspacePath])
      return storedContent
    },
    remove(workspacePath) {
      calls.push(['remove', workspacePath])
      storedContent = null
    },
    write(workspacePath, content) {
      calls.push(['write', workspacePath, content])
      storedContent = content
    },
  })
  return {
    calls,
    storage,
    useCases: createProjectInstructionsUseCases({ storage }),
  }
}

test('la porta storage espone soltanto le tre operazioni richieste e le lega all’implementazione', () => {
  const implementation = {
    prefix: 'contenuto',
    read() { return this.prefix },
    remove() {},
    write() {},
  }
  const port = createProjectInstructionsStoragePort(implementation)

  assert.deepEqual(PROJECT_INSTRUCTIONS_STORAGE_METHODS, ['read', 'remove', 'write'])
  assert.deepEqual(Object.keys(port), PROJECT_INSTRUCTIONS_STORAGE_METHODS)
  assert.equal(port.read('/workspace'), 'contenuto')
  assert.equal(Object.isFrozen(port), true)
  assert.equal(Object.isFrozen(PROJECT_INSTRUCTIONS_STORAGE_METHODS), true)
})

test('rifiuta una porta assente o incompleta prima di creare i casi d’uso', () => {
  assert.throws(() => createProjectInstructionsUseCases(), /Porta istruzioni progetto non valida/u)
  assert.throws(
    () => createProjectInstructionsStoragePort({ read() {}, remove() {} }),
    /Porta istruzioni progetto incompleta: write/u,
  )
})

test('get distingue risorsa assente, contenuto vuoto e contenuto presente', () => {
  const missing = instructionsFixture()
  assert.deepEqual(missing.useCases.getProjectInstructions('/workspace/missing'), { exists: false, content: '' })
  assert.deepEqual(missing.calls, [['read', '/workspace/missing']])

  const empty = instructionsFixture({ storedContent: '' })
  assert.deepEqual(empty.useCases.getProjectInstructions('/workspace/empty'), { exists: true, content: '' })

  const present = instructionsFixture({ storedContent: '# Regole' })
  assert.deepEqual(present.useCases.getProjectInstructions('/workspace/present'), { exists: true, content: '# Regole' })
})

test('save valida tipo e limite prima di invocare la porta', () => {
  for (const content of [undefined, null, 7, 'x'.repeat(200_001)]) {
    const fixture = instructionsFixture()
    assert.throws(
      () => fixture.useCases.saveProjectInstructions('/workspace', content),
      /Le istruzioni progetto non sono valide o superano 200\.000 caratteri/u,
    )
    assert.deepEqual(fixture.calls, [])
  }

  const fixture = instructionsFixture()
  const content = 'x'.repeat(200_000)
  assert.deepEqual(
    fixture.useCases.saveProjectInstructions('/workspace', content),
    { exists: true, content },
  )
  assert.deepEqual(fixture.calls, [['write', '/workspace', content]])
})

test('clear delega anche quando la risorsa è assente e restituisce il DTO storico', () => {
  const fixture = instructionsFixture({ storedContent: '# Regole' })

  assert.deepEqual(
    fixture.useCases.clearProjectInstructions('/workspace'),
    { exists: false, content: '' },
  )
  assert.deepEqual(fixture.calls, [['remove', '/workspace']])
  assert.deepEqual(fixture.useCases.getProjectInstructions('/workspace'), { exists: false, content: '' })
  assert.equal(Object.isFrozen(fixture.useCases), true)
})
