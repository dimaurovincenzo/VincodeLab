const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase, getDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const {
  claimManagedUpdateActivation,
  getManagedUpdate,
  listRestartRequiredUpdates,
  recordAvailableUpdate,
  recordActivationResult,
  recordStagedUpdate,
  recordUpdateError,
  releaseManagedUpdateActivation,
  setManagedUpdatePolicy,
  upsertManagedUpdate,
} = require('../electron/infrastructure/persistence/update.repository.cjs')

function withTemporaryDatabase(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-updates-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
}

test('isola stato e policy dei tre canali', (t) => {
  withTemporaryDatabase(t)
  upsertManagedUpdate({ id: 'skill:review', kind: 'skill', name: 'Review', sourceType: 'github', owner: 'openai', repository: 'skills', ref: 'main', channel: 'stable', activeVersion: 'a1' })
  upsertManagedUpdate({ id: 'extension:review', kind: 'pi-extension', name: 'Review', sourceType: 'github', owner: 'openai', repository: 'plugins', ref: 'main', channel: 'stable', activeVersion: 'b1' })

  setManagedUpdatePolicy('skill:review', 'automatic')

  assert.equal(getManagedUpdate('skill:review').policy, 'automatic')
  assert.equal(getManagedUpdate('extension:review').policy, 'manual')
})

test('separa disponibilita download pronto e attivazione', (t) => {
  withTemporaryDatabase(t)
  upsertManagedUpdate({ id: 'skill:review', kind: 'skill', name: 'Review', sourceType: 'github', owner: 'openai', repository: 'skills', ref: 'main', channel: 'stable', activeVersion: 'abcdef1', targetPath: '/tmp/review' })

  recordAvailableUpdate('skill:review', { availableVersion: 'abcdef2', changelog: 'Correzioni', checkedAt: 10 })
  assert.equal(getManagedUpdate('skill:review').status, 'available')
  recordStagedUpdate('skill:review', { stagedVersion: 'abcdef2', stagingPath: '/tmp/staged' })
  assert.equal(getManagedUpdate('skill:review').restartRequired, true)
  assert.deepEqual(listRestartRequiredUpdates().map((item) => item.id), ['skill:review'])
})

test('claim atomico consente un solo proprietario dell attivazione', (t) => {
  withTemporaryDatabase(t)
  upsertManagedUpdate({ id: 'skill:review', kind: 'skill', name: 'Review', sourceType: 'github', owner: 'openai', repository: 'skills', ref: 'main', channel: 'stable', activeVersion: 'abcdef1', targetPath: '/tmp/review' })
  recordAvailableUpdate('skill:review', { availableVersion: 'abcdef2', checkedAt: 10 })
  recordStagedUpdate('skill:review', { stagedVersion: 'abcdef2', stagingPath: '/tmp/staged' })

  const first = claimManagedUpdateActivation('skill:review', { owner: 'owner-one', pid: 101, host: 'test-host' }, 20)
  const second = claimManagedUpdateActivation('skill:review', { owner: 'owner-two', pid: 102, host: 'test-host' }, 21)

  assert.equal(first.status, 'activating')
  assert.equal(first.activation_owner, 'owner-one')
  assert.equal(second, null)

  // Una seconda istanza esegue discovery all'avvio prima dell'attivazione: non
  // deve interpretare il target transitorio come nuova versione gia attiva.
  upsertManagedUpdate({ id: 'skill:review', kind: 'skill', name: 'Review', sourceType: 'github', owner: 'openai', repository: 'skills', ref: 'main', channel: 'stable', activeVersion: 'abcdef2', targetPath: '/tmp/review' })
  assert.equal(getManagedUpdate('skill:review').activeVersion, 'abcdef1')
  assert.equal(getManagedUpdate('skill:review').status, 'activating')

  assert.equal(releaseManagedUpdateActivation('skill:review', 'owner-two'), false)
  assert.equal(releaseManagedUpdateActivation('skill:review', 'owner-one'), true)
  assert.equal(getManagedUpdate('skill:review').status, 'ready')
})

test('conserva solo il backup dell ultima attivazione riuscita', (t) => {
  withTemporaryDatabase(t)
  upsertManagedUpdate({ id: 'runtime:pi', kind: 'pi-runtime', name: 'Pi', sourceType: 'runtime', channel: 'stable', activeVersion: '1.0.0' })

  recordActivationResult('runtime:pi', { activeVersion: '2.0.0', previousVersion: '1.0.0', success: true })
  recordActivationResult('runtime:pi', { activeVersion: '3.0.0', previousVersion: '2.0.0', success: true })

  const update = getManagedUpdate('runtime:pi')
  assert.equal(update.activeVersion, '3.0.0')
  assert.equal(update.rollbackVersion, '2.0.0')
})

test('una modifica esterna rilevata da Pi annulla uno staging ormai superato', (t) => {
  withTemporaryDatabase(t)
  const source = { id: 'extension:review', kind: 'pi-extension', name: 'Review', sourceType: 'github', sourceUrl: 'git:github.com/openai/plugins', owner: 'openai', repository: 'plugins', ref: 'main', channel: 'stable', targetPath: '/tmp/plugin' }
  upsertManagedUpdate({ ...source, activeVersion: 'abcdef1' })
  recordAvailableUpdate(source.id, { availableVersion: 'abcdef2', checkedAt: 10 })
  recordStagedUpdate(source.id, { stagedVersion: 'abcdef2', stagingPath: '/tmp/staged' })

  upsertManagedUpdate({ ...source, activeVersion: 'abcdef3' })

  const update = getManagedUpdate(source.id)
  assert.equal(update.activeVersion, 'abcdef3')
  assert.equal(update.availableVersion, null)
  assert.equal(update.restartRequired, false)
  assert.equal(update.status, 'active')
})

test('persiste solo codici pubblici e redige eventuali errori legacy', (t) => {
  withTemporaryDatabase(t)
  upsertManagedUpdate({ id: 'skill:privacy', kind: 'skill', name: 'Privacy', sourceType: 'github', owner: 'openai', repository: 'skills', ref: 'main', channel: 'stable', activeVersion: 'abcdef1' })
  const privateDetail = 'clone /Users/demo/Segreti/skill?token=ghp_supersegreto Authorization=Bearer abc.def.ghi'

  const update = recordUpdateError('skill:privacy', new Error(privateDetail))

  assert.equal(getDatabase().prepare('SELECT last_error FROM managed_updates WHERE id = ?').get('skill:privacy').last_error, 'UPDATE_STAGE_FAILED')
  assert.equal(update.lastError, 'Preparazione dell aggiornamento non riuscita. [UPDATE_STAGE_FAILED]')
  assert.doesNotMatch(JSON.stringify(update), /Users|Segreti|token|ghp_|Authorization|Bearer|abc\.def|\?/i)

  getDatabase().prepare('UPDATE managed_updates SET last_error = ? WHERE id = ?').run(privateDetail, 'skill:privacy')
  const legacy = getManagedUpdate('skill:privacy')
  assert.equal(legacy.lastError, 'Operazione di aggiornamento non riuscita. [UPDATE_FAILED]')
  assert.doesNotMatch(JSON.stringify(legacy), /Users|Segreti|token|ghp_|Authorization|Bearer|abc\.def|\?/i)
})
