import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setImmediate as yieldImmediate } from 'node:timers/promises'

import { restoreEnvironment, temporaryRoot } from './scenario-fixture.mjs'

const require = createRequire(import.meta.url)
const { activatePendingUpdates } = require('../../../electron/infrastructure/updates/update-activation.adapter.cjs')
const { stageManagedUpdate } = require('../../../electron/infrastructure/updates/update-downloader.adapter.cjs')
const { getManagedUpdate, recordAvailableUpdate, upsertManagedUpdate } = require('../../../electron/infrastructure/persistence/update.repository.cjs')
const { closeDatabase } = require('../../../electron/infrastructure/persistence/workspace.repository.cjs')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function unsafeUpdateResidues(root) {
  const residues = []
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (/vincodelab-(?:update-lock|next|current)|-(?:download|staged)-/u.test(entry.name)) residues.push(entry.name)
      if (entry.isDirectory()) visit(candidate)
    }
  }
  visit(root)
  return residues
}

export async function runUpdateConcurrencyScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-update-')
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = path.join(root, 'data')
  closeDatabase()
  let winners = 0
  let rejectedContenders = 0
  try {
    for (let round = 0; round < config.updateRounds; round += 1) {
      const id = `skill:architecture-${round}`
      const target = path.join(root, 'targets', `skill-${round}`)
      const activeVersion = `active-${round}`
      const availableVersion = `available-${round}`
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'SKILL.md'), `---\nname: architecture-${round}\ndescription: active\n---\n`)
      upsertManagedUpdate({
        id,
        kind: 'skill',
        name: `architecture-${round}`,
        sourceType: 'github',
        owner: 'local-fixture',
        repository: 'local-fixture',
        ref: 'main',
        channel: 'stable',
        activeVersion,
        targetPath: target,
      })
      recordAvailableUpdate(id, { availableVersion, checkedAt: round + 1 })

      const allEntered = deferred()
      const release = deferred()
      let entered = 0
      const attempts = Array.from({ length: config.updateContenders }, (_, contender) => stageManagedUpdate(id, {
        dataDirectory: path.join(root, 'staging'),
        download: async (_record, destination) => {
          fs.writeFileSync(path.join(destination, 'SKILL.md'), `---\nname: architecture-${round}\ndescription: contender-${contender}\n---\n`)
          entered += 1
          if (entered === config.updateContenders) allEntered.resolve()
          await release.promise
        },
      }))
      await allEntered.promise
      release.resolve()
      const settled = await Promise.allSettled(attempts)
      const fulfilled = settled.filter((result) => result.status === 'fulfilled')
      const rejected = settled.filter((result) => result.status === 'rejected')
      assert.equal(fulfilled.length, 1, 'Lo staging concorrente ha prodotto più vincitori.')
      assert.equal(rejected.length, config.updateContenders - 1, 'Numero di staging concorrenti rifiutati errato.')
      winners += fulfilled.length
      rejectedContenders += rejected.length

      const activation = await activatePendingUpdates()
      assert.equal(activation.length, 1, 'Aggiornamenti attivabili inattesi.')
      assert.equal(activation[0].success, true, 'Attivazione concorrente non riuscita.')
      assert.equal(getManagedUpdate(id).activeVersion, availableVersion, 'Versione attiva errata.')
      assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /contender-\d+/u, 'Contenuto vincitore mancante.')
      assert.deepEqual(unsafeUpdateResidues(root), [], 'Residui temporanei aggiornamento.')
      await yieldImmediate()
    }

    return {
      rounds: config.updateRounds,
      contendersPerRound: config.updateContenders,
      winners,
      rejectedContenders,
      residualTemporaryEntries: unsafeUpdateResidues(root).length,
    }
  } finally {
    closeDatabase()
    restoreEnvironment('VINCODELAB_DATA_DIR', previousDirectory)
    fs.rmSync(root, { recursive: true, force: true })
  }
}
