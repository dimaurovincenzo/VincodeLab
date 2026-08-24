const assert = require('node:assert/strict')
const test = require('node:test')
const { createPiSystemUseCases, getPiSystemStatus, installPiPackage, listPiPackages } = require('../electron/domains/ai/pi-system-service.cjs')
const { createPiPackageSkillsSourcePort } = require('../electron/domains/ai/pi-package-skills-source.port.cjs')
const { isPublicError } = require('../electron/domains/errors/public-error.cjs')

function hasPublicCode(code) {
  return (error) => {
    assert.equal(isPublicError(error), true)
    assert.equal(error.publicCode, code)
    return true
  }
}

test('installPiPackage rifiuta sorgenti con controlli e usa argomenti non shell', async () => {
  const calls = []; const resolve = () => '/usr/local/bin/pi'; const run = async (executable, args) => { calls.push({ executable, args }); return { stdout: '', stderr: '' } }
  await assert.rejects(() => installPiPackage('x\n--flag', resolve, run), /Sorgente estensione non valida/)
  await installPiPackage('owner/plugin', resolve, run)
  assert.deepEqual(calls[0].args, ['install', 'owner/plugin'])
})

test('listPiPackages trasforma lista vuota reale in un elenco vuoto', async () => {
  assert.deepEqual(await listPiPackages(() => '/usr/local/bin/pi', async () => ({ stdout: 'No packages installed.\n', stderr: '' })), [])
})

test('getPiSystemStatus distingue Pi assente da Pi pronto senza rigettare il caso atteso', async () => {
  let missingRunnerCalled = false
  const missing = await getPiSystemStatus(() => null, async () => {
    missingRunnerCalled = true
    throw new Error('non deve essere eseguito')
  })
  assert.deepEqual(missing, { state: 'missing', code: 'PI_NOT_INSTALLED', executable: null, version: null })
  assert.equal(missingRunnerCalled, false)

  const ready = await getPiSystemStatus(
    () => '/usr/local/bin/pi',
    async () => ({ stdout: 'pi 0.50.2\n', stderr: '' }),
  )
  assert.deepEqual(ready, { state: 'ready', executable: '/usr/local/bin/pi', version: 'pi 0.50.2' })
})

test('getPiSystemStatus espone errori pubblici distinti per eseguibile guasto e timeout', async () => {
  const notRunnable = Object.assign(new Error('spawn /opt/pi/bin/pi ENOENT'), { code: 'ENOENT' })
  await assert.rejects(
    () => getPiSystemStatus(() => '/opt/pi/bin/pi', async () => { throw notRunnable }),
    hasPublicCode('PI_NOT_RUNNABLE'),
  )

  const timedOut = Object.assign(new Error('command timed out'), { code: 'ETIMEDOUT' })
  await assert.rejects(
    () => getPiSystemStatus(() => '/opt/pi/bin/pi', async () => { throw timedOut }),
    hasPublicCode('PI_COMMAND_TIMEOUT'),
  )
})

test('azioni pacchetto distinguono Pi assente e dipendenze npm/git mancanti', async () => {
  await assert.rejects(() => installPiPackage('owner/plugin', () => null), hasPublicCode('PI_NOT_INSTALLED'))

  const npmMissing = Object.assign(new Error('Pi package install failed'), { stderr: '/bin/sh: npm: command not found' })
  await assert.rejects(
    () => installPiPackage('npm:pacchetto', () => '/opt/pi/bin/pi', async () => { throw npmMissing }),
    hasPublicCode('PI_NPM_NOT_INSTALLED'),
  )

  const gitMissing = Object.assign(new Error('Pi package install failed'), { stderr: 'Error: spawn git ENOENT' })
  await assert.rejects(
    () => installPiPackage('git:https://example.test/plugin.git', () => '/opt/pi/bin/pi', async () => { throw gitMissing }),
    hasPublicCode('PI_GIT_NOT_INSTALLED'),
  )
})

test('i use case configurati usano soltanto il runner iniettato mantenendo le firme IPC', async () => {
  const calls = []
  const scanCalls = []
  const run = async (executable, args) => {
    calls.push([executable, args])
    if (args[0] === '--version') return { stdout: 'pi 1.2.3\n', stderr: '' }
    if (args[0] === 'list') return { stdout: 'User packages:\n  npm:one\n    /tmp/pi/npm/one\n', stderr: '' }
    return { stdout: `${args[0]} complete`, stderr: '' }
  }
  const packageSkillsSource = createPiPackageSkillsSourcePort({
    scan(packages) { scanCalls.push(packages); return [] },
  })
  const useCases = createPiSystemUseCases({ packageSkillsSource, run })
  const resolve = () => '/opt/pi/bin/pi'

  assert.deepEqual(await useCases.getPiSystemStatus(resolve), {
    state: 'ready',
    executable: '/opt/pi/bin/pi',
    version: 'pi 1.2.3',
  })
  assert.deepEqual(await useCases.listPiPackages(resolve), ['npm:one'])
  assert.deepEqual(await useCases.listPiPackageSkills(resolve), [])
  assert.deepEqual(scanCalls, [[{ source: 'npm:one', root: '/tmp/pi/npm/one' }]])
  assert.deepEqual(await useCases.installPiPackage('npm:one', resolve), { output: 'install complete' })
  assert.deepEqual(await useCases.updatePiPackage('npm:one', resolve), { output: 'update complete' })
  assert.deepEqual(await useCases.removePiPackage('npm:one', resolve), { output: 'remove complete' })
  assert.deepEqual(calls.map(([, args]) => args[0]), ['--version', 'list', 'list', 'install', 'update', 'remove'])
  assert.throws(() => createPiSystemUseCases(), /Runner comando Pi non valido/u)
  assert.throws(() => createPiSystemUseCases({ run }), /Porta catalogo skill dei pacchetti Pi non valida/u)
})
