const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')

const { closeDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const { activatePendingUpdates, rollbackManagedUpdate } = require('../electron/infrastructure/updates/update-activation.adapter.cjs')
const { downloadGitHub, stageManagedUpdate } = require('../electron/infrastructure/updates/update-downloader.adapter.cjs')
const { getManagedUpdate, recordAvailableUpdate, upsertManagedUpdate } = require('../electron/infrastructure/persistence/update.repository.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-update-lifecycle-'))
  const previous = process.env.VINCODELAB_DATA_DIR
  closeDatabase(); process.env.VINCODELAB_DATA_DIR = path.join(root, 'data')
  const target = path.join(root, 'skills', 'review')
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'SKILL.md'), '---\nname: review\ndescription: Versione uno\n---\n')
  upsertManagedUpdate({ id: 'skill:review', kind: 'skill', name: 'review', sourceType: 'github', owner: 'openai', repository: 'review', ref: 'main', channel: 'stable', activeVersion: 'abcdef1', targetPath: target })
  recordAvailableUpdate('skill:review', { availableVersion: 'abcdef2', checkedAt: 1 })
  t.after(() => { closeDatabase(); if (previous === undefined) delete process.env.VINCODELAB_DATA_DIR; else process.env.VINCODELAB_DATA_DIR = previous; fs.rmSync(root, { recursive: true, force: true }) })
  return { root, target }
}

async function waitForPath(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timeout in attesa di ${filePath}`)
    await delay(10)
  }
}

function startActivationWorker(t, { dataDirectory, enteredPath, releasePath }) {
  const activationModule = path.join(__dirname, '..', 'electron', 'infrastructure', 'updates', 'update-activation.adapter.cjs')
  const source = `
    const fs = require('node:fs')
    const { setTimeout: delay } = require('node:timers/promises')
    const { activatePendingUpdates } = require(${JSON.stringify(activationModule)})
    ;(async () => {
      const result = await activatePendingUpdates({
        healthCheck: async () => {
          fs.writeFileSync(process.env.VINCODELAB_TEST_ACTIVATION_ENTERED, 'entered')
          while (!fs.existsSync(process.env.VINCODELAB_TEST_ACTIVATION_RELEASE)) await delay(10)
          return true
        },
      })
      process.stdout.write(JSON.stringify(result))
    })().catch((error) => {
      process.stderr.write(error?.stack || String(error))
      process.exitCode = 1
    })
  `
  const child = spawn(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      VINCODELAB_DATA_DIR: dataDirectory,
      VINCODELAB_TEST_ACTIVATION_ENTERED: enteredPath,
      VINCODELAB_TEST_ACTIVATION_RELEASE: releasePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stderr, stdout }))
  })
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  return { child, completion }
}

test('uno staging incompleto non diventa attivabile', async (t) => {
  fixture(t)
  await assert.rejects(() => stageManagedUpdate('skill:review', { download: async () => undefined }), /integrita/i)
  assert.equal(getManagedUpdate('skill:review').restartRequired, false)
})

test('lo staging non espone dettagli privati del downloader', async (t) => {
  fixture(t)
  const privateDetail = 'clone /Users/demo/Segreti/skill?token=ghp_supersegreto Authorization=Bearer abc.def.ghi'

  const error = await stageManagedUpdate('skill:review', {
    download: async () => { throw new Error(privateDetail) },
  }).catch((failure) => failure)

  assert.equal(error.message, 'Preparazione dell aggiornamento non riuscita. [UPDATE_STAGE_FAILED]')
  assert.equal('cause' in error, false)
  const update = getManagedUpdate('skill:review')
  assert.equal(update.lastError, 'Preparazione dell aggiornamento non riuscita. [UPDATE_STAGE_FAILED]')
  assert.doesNotMatch(JSON.stringify({ error: error.message, update }), /Users|Segreti|token|ghp_|Authorization|Bearer|abc\.def|\?/i)
})

test('due staging concorrenti non possono sostituire il contenuto gia dichiarato pronto', async (t) => {
  const { target } = fixture(t)
  let releaseFirst
  const firstMayFinish = new Promise((resolve) => { releaseFirst = resolve })
  let signalFirstStarted
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve })

  const first = stageManagedUpdate('skill:review', {
    download: async (_record, destination) => {
      fs.writeFileSync(path.join(destination, 'SKILL.md'), '---\nname: review\ndescription: Contenuto perdente\n---\n')
      signalFirstStarted()
      await firstMayFinish
    },
  })
  await firstStarted
  const winner = await stageManagedUpdate('skill:review', {
    download: async (_record, destination) => {
      fs.writeFileSync(path.join(destination, 'SKILL.md'), '---\nname: review\ndescription: Contenuto vincente\n---\n')
    },
  })
  assert.equal(winner.restartRequired, true)

  releaseFirst()
  await assert.rejects(first, /UPDATE_STAGE_FAILED/)
  const activation = await activatePendingUpdates()
  assert.equal(activation[0].success, true, activation[0].error)
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Contenuto vincente/)
})

test('accetta lo staging GitHub solo se HEAD coincide con il commit verificato', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-update-download-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls = []
  const run = async (command, args) => {
    calls.push([command, args])
    if (command === 'gh') fs.mkdirSync(path.join(root, '.git'), { recursive: true })
    return { stdout: command === 'git' ? 'abcdef3\n' : '' }
  }

  await assert.rejects(
    () => downloadGitHub({ owner: 'openai', repository: 'skills', ref: 'main', availableVersion: 'abcdef2' }, root, run),
    /non corrisponde alla versione verificata/i,
  )
  assert.deepEqual(calls.map(([command]) => command), ['gh', 'git'])
})

test('prepara senza lifecycle script le dipendenze dichiarate dal pacchetto Pi', async (t) => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-update-dependencies-')), 'package')
  t.after(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }))
  const calls = []
  const run = async (command) => {
    calls.push(command)
    if (command === 'gh') {
      fs.mkdirSync(path.join(root, '.git'), { recursive: true })
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'pi-package', dependencies: { zod: '^4.0.0' } }))
    }
    return { stdout: command === 'git' ? 'abcdef2\n' : '' }
  }

  await downloadGitHub({ owner: 'openai', repository: 'skills', ref: 'main', availableVersion: 'abcdef2' }, root, run, { npmExecutable: '/opt/node/bin/npm', npmEnvironment: { PATH: '/opt/node/bin' } })

  assert.deepEqual(calls, ['gh', 'git', '/opt/node/bin/npm'])
})

test('spiega che npm manca solo quando un aggiornamento Pi ne richiede le dipendenze', async (t) => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-update-no-npm-')), 'package')
  t.after(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }))
  const calls = []
  const run = async (command) => {
    calls.push(command)
    if (command === 'gh') {
      fs.mkdirSync(path.join(root, '.git'), { recursive: true })
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'pi-package', dependencies: { zod: '^4.0.0' } }))
    }
    return { stdout: command === 'git' ? 'abcdef2\n' : '' }
  }

  await assert.rejects(
    () => downloadGitHub(
      { owner: 'openai', repository: 'skills', ref: 'main', availableVersion: 'abcdef2' },
      root,
      run,
      { piExecutable: null, resolveNpmExecutable: () => null },
    ),
    (error) => {
      assert.equal(error.publicCode, 'UPDATE_NPM_NOT_INSTALLED')
      assert.match(error.publicMessage, /VincodeLab continua a funzionare senza npm/u)
      return true
    },
  )
  assert.deepEqual(calls, ['gh', 'git'])
})

test('attiva una skill in modo atomico e mantiene un rollback', async (t) => {
  const { target } = fixture(t)
  await stageManagedUpdate('skill:review', { download: async (_record, destination) => fs.writeFileSync(path.join(destination, 'SKILL.md'), '---\nname: review\ndescription: Versione due\n---\n') })
  const activation = await activatePendingUpdates()
  assert.equal(activation[0].success, true, activation[0].error)
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione due/)
  assert.equal(getManagedUpdate('skill:review').activeVersion, 'abcdef2')
  await rollbackManagedUpdate('skill:review')
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione uno/)
})

test('un health check fallito ripristina automaticamente la versione precedente', async (t) => {
  const { target } = fixture(t)
  await stageManagedUpdate('skill:review', { download: async (_record, destination) => fs.writeFileSync(path.join(destination, 'SKILL.md'), '---\nname: review\ndescription: Versione due\n---\n') })
  await activatePendingUpdates({ healthCheck: async () => false })
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione uno/)
  assert.equal(getManagedUpdate('skill:review').activeVersion, 'abcdef1')
  assert.match(getManagedUpdate('skill:review').lastError, /verifica/i)
})

test('l attivazione redige gli errori tecnici nel risultato e nello stato persistito', async (t) => {
  const { target } = fixture(t)
  await stageManagedUpdate('skill:review', { download: async (_record, destination) => fs.writeFileSync(path.join(destination, 'SKILL.md'), '---\nname: review\ndescription: Versione due\n---\n') })
  const privateDetail = 'health /Users/demo/Segreti/SKILL.md?token=ghp_supersegreto Authorization=Bearer abc.def.ghi'

  const activation = await activatePendingUpdates({ healthCheck: async () => { throw new Error(privateDetail) } })

  assert.equal(activation[0].success, false)
  assert.equal(activation[0].error, 'Attivazione dell aggiornamento non riuscita. [UPDATE_ACTIVATION_FAILED]')
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione uno/)
  const update = getManagedUpdate('skill:review')
  assert.equal(update.lastError, 'Attivazione dell aggiornamento non riuscita. [UPDATE_ACTIVATION_FAILED]')
  assert.doesNotMatch(JSON.stringify({ activation, update }), /Users|Segreti|token|ghp_|Authorization|Bearer|abc\.def|\?/i)
})

test('due processi concorrenti non attivano due volte ne corrompono il backup', async (t) => {
  const { root, target } = fixture(t)
  await stageManagedUpdate('skill:review', { download: async (_record, destination) => fs.writeFileSync(path.join(destination, 'SKILL.md'), '---\nname: review\ndescription: Versione due\n---\n') })
  closeDatabase()
  const enteredPath = path.join(root, 'activation-entered')
  const releasePath = path.join(root, 'activation-release')
  const worker = startActivationWorker(t, { dataDirectory: path.join(root, 'data'), enteredPath, releasePath })

  await waitForPath(enteredPath)
  assert.equal(fs.existsSync(path.join(path.dirname(target), `.${path.basename(target)}.vincodelab-update-lock`)), true)
  const competing = await activatePendingUpdates()
  assert.equal(competing.length, 1)
  assert.equal(competing[0].success, false)
  assert.match(competing[0].error, /corso|disponibile/i)

  fs.writeFileSync(releasePath, 'release')
  const completed = await worker.completion
  assert.equal(completed.code, 0, completed.stderr)
  const winning = JSON.parse(completed.stdout)
  assert.equal(winning[0].success, true, winning[0].error)
  assert.equal(getManagedUpdate('skill:review').activeVersion, 'abcdef2')
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione due/)

  await rollbackManagedUpdate('skill:review')
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione uno/)
})

test('recupera lock e filesystem quando il processo proprietario muore', async (t) => {
  const { root, target } = fixture(t)
  await stageManagedUpdate('skill:review', { download: async (_record, destination) => fs.writeFileSync(path.join(destination, 'SKILL.md'), '---\nname: review\ndescription: Versione due\n---\n') })
  closeDatabase()
  const enteredPath = path.join(root, 'stale-activation-entered')
  const releasePath = path.join(root, 'stale-activation-never-release')
  const worker = startActivationWorker(t, { dataDirectory: path.join(root, 'data'), enteredPath, releasePath })

  await waitForPath(enteredPath)
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione due/)
  worker.child.kill('SIGKILL')
  const killed = await worker.completion
  assert.equal(killed.signal, 'SIGKILL')

  const recovered = await activatePendingUpdates()
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0].success, true, recovered[0].error)
  assert.equal(getManagedUpdate('skill:review').activeVersion, 'abcdef2')
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione due/)

  await rollbackManagedUpdate('skill:review')
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /Versione uno/)
})
