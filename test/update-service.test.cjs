const assert = require('node:assert/strict')
const test = require('node:test')

const { createUpdateService } = require('../electron/domains/updates/update-service.cjs')

function createDependencies(overrides = {}) {
  return {
    activatePendingUpdates: () => 'activated',
    checkEligibleUpdates: (records) => records,
    checkManagedUpdate: async () => ({ availableVersion: null, checkedAt: 1 }),
    getManagedUpdate: () => null,
    listManagedUpdates: () => [],
    recordAvailableUpdate: (_id, checked) => checked,
    recordUpdateError: (id, error) => ({ id, error: error.message }),
    rollbackManagedUpdate: () => 'rolled-back',
    setManagedUpdatePolicy: () => 'policy-set',
    stageManagedUpdate: () => 'staged',
    ...overrides,
  }
}

test('il servizio update orchestra check, persistenza e staging automatico tramite porte iniettate', async () => {
  const calls = []
  const records = [
    { id: 'skill:auto', policy: 'automatic' },
    { id: 'skill:error', policy: 'manual' },
  ]
  const checkDependencies = { now: () => 42 }
  const downloadDependencies = { download: async () => undefined }
  const service = createUpdateService(createDependencies({
    checkEligibleUpdates: () => { throw new Error('force deve saltare il filtro') },
    listManagedUpdates: () => records,
    checkManagedUpdate: async (record, dependencies) => {
      calls.push(['check', record.id, dependencies])
      if (record.id === 'skill:error') throw new Error('remoto non disponibile')
      return { availableVersion: 'abcdef2', checkedAt: 42 }
    },
    recordAvailableUpdate: (id, checked) => {
      calls.push(['available', id, checked])
      return { id, policy: 'automatic', availableVersion: checked.availableVersion, restartRequired: false }
    },
    recordUpdateError: (id, error) => {
      calls.push(['error', id, error.message])
      return { id, status: 'error' }
    },
    stageManagedUpdate: async (id, dependencies) => {
      calls.push(['stage', id, dependencies])
      return { id, status: 'ready' }
    },
  }))

  const result = await service.checkUpdates(null, { dependencies: checkDependencies, downloadDependencies, force: true })

  assert.deepEqual(result, [
    { id: 'skill:auto', status: 'ready' },
    { id: 'skill:error', status: 'error' },
  ])
  assert.deepEqual(calls, [
    ['check', 'skill:auto', checkDependencies],
    ['available', 'skill:auto', { availableVersion: 'abcdef2', checkedAt: 42 }],
    ['stage', 'skill:auto', downloadDependencies],
    ['check', 'skill:error', checkDependencies],
    ['error', 'skill:error', 'remoto non disponibile'],
  ])
})

test('il servizio update filtra i check pianificati e segnala un id assente', async () => {
  const checked = []
  const service = createUpdateService(createDependencies({
    checkEligibleUpdates: (records) => records.filter((record) => record.id === 'eligible'),
    checkManagedUpdate: async (record) => {
      checked.push(record.id)
      return { availableVersion: null, checkedAt: 1 }
    },
    getManagedUpdate: () => null,
    listManagedUpdates: () => [{ id: 'eligible' }, { id: 'recent' }],
  }))

  await service.checkUpdates()
  assert.deepEqual(checked, ['eligible'])
  await assert.rejects(() => service.checkUpdates('missing'), /Aggiornamento non trovato/u)
})

test('downloadAll mantiene lo stato persistito quando uno staging fallisce', async () => {
  const service = createUpdateService(createDependencies({
    getManagedUpdate: (id) => ({ id, status: 'error' }),
    listManagedUpdates: () => [
      { id: 'ready', availableVersion: 'v2', restartRequired: false },
      { id: 'already-staged', availableVersion: 'v2', restartRequired: true },
      { id: 'failed', availableVersion: 'v2', restartRequired: false },
      { id: 'current', availableVersion: null, restartRequired: false },
    ],
    stageManagedUpdate: async (id) => {
      if (id === 'failed') throw new Error('download fallito')
      return { id, status: 'ready' }
    },
  }))

  assert.deepEqual(await service.downloadAllUpdates(), [
    { id: 'ready', status: 'ready' },
    { id: 'failed', status: 'error' },
  ])
})

test('il servizio conserva la superficie pubblica dei comandi update', () => {
  const dependencies = createDependencies()
  const service = createUpdateService(dependencies)

  assert.equal(service.activatePendingUpdates, dependencies.activatePendingUpdates)
  assert.equal(service.rollbackManagedUpdate, dependencies.rollbackManagedUpdate)
  assert.equal(service.getManagedUpdate, dependencies.getManagedUpdate)
  assert.equal(service.listManagedUpdates, dependencies.listManagedUpdates)
  assert.equal(service.setManagedUpdatePolicy, dependencies.setManagedUpdatePolicy)
  assert.equal(service.stageManagedUpdate, dependencies.stageManagedUpdate)
})
