const { checkEligibleUpdates, checkManagedUpdate } = require('./update-checker.cjs')
const { stageManagedUpdate } = require('./update-downloader.cjs')
const { activatePendingUpdates, rollbackManagedUpdate } = require('./update-activation.cjs')
const { getManagedUpdate, listManagedUpdates, recordAvailableUpdate, recordUpdateError, setManagedUpdatePolicy } = require('./update-store.cjs')

async function checkUpdates(id = null, options = {}) {
  const records = id ? [getManagedUpdate(id)].filter(Boolean) : options.force ? listManagedUpdates() : checkEligibleUpdates(listManagedUpdates())
  if (id && records.length === 0) throw new Error('Aggiornamento non trovato.')
  const results = []
  for (const record of records) {
    try {
      const checked = await checkManagedUpdate(record, options.dependencies)
      const updated = recordAvailableUpdate(record.id, checked)
      results.push(updated)
      if (updated.policy === 'automatic' && updated.availableVersion && !updated.restartRequired) results[results.length - 1] = await stageManagedUpdate(updated.id, options.downloadDependencies)
    } catch (error) {
      results.push(recordUpdateError(record.id, error))
    }
  }
  return results
}

async function downloadAllUpdates() {
  const results = []
  for (const update of listManagedUpdates().filter((item) => item.availableVersion && !item.restartRequired)) {
    try { results.push(await stageManagedUpdate(update.id)) } catch { results.push(getManagedUpdate(update.id)) }
  }
  return results
}

module.exports = {
  activatePendingUpdates,
  checkUpdates,
  downloadAllUpdates,
  getManagedUpdate,
  listManagedUpdates,
  rollbackManagedUpdate,
  setManagedUpdatePolicy,
  stageManagedUpdate,
}
