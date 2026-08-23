import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MEMORY_CPU_PROFILE_OFFLINE_FLAGS,
  cleanupMemoryCpuProfileFixture,
  evaluateMemoryCpuProfileRunContract,
  isolatedMemoryCpuProfileEnvironment,
  parseMemoryCpuProfileArguments,
  rendererHarnessSource,
  serializeMemoryCpuProfileReport,
} from '../scripts/profile-memory-cpu.mjs'

test('valida gli argomenti del profilo entro limiti accelerati e ripetibili', () => {
  const defaults = parseMemoryCpuProfileArguments([])
  assert.equal(defaults.cycles, 120)
  assert.equal(defaults.checkpointEvery, 20)
  assert.equal(defaults.runs, 1)
  assert.equal(defaults.warmupCycles, 20)
  assert.equal(defaults.idleMs, 1_500)

  assert.deepEqual(parseMemoryCpuProfileArguments([
    '--cycles', '240',
    '--checkpoint-every', '20',
    '--runs', '2',
    '--warmup-cycles', '100',
    '--idle-ms', '30000',
    '--diagnose-subsystems',
    '--output', './docs/qa/profile.json',
  ]), {
    checkpointEvery: 20,
    cycles: 240,
    diagnoseSubsystems: true,
    idleMs: 30_000,
    output: path.resolve('./docs/qa/profile.json'),
    runs: 2,
    warmupCycles: 100,
  })

  for (const argumentsList of [
    ['--cycles', '99'],
    ['--cycles', '1001'],
    ['--cycles'],
    ['--checkpoint-every', '4'],
    ['--cycles', '100', '--checkpoint-every', '101'],
    ['--idle-ms', '499'],
    ['--idle-ms', '30001'],
    ['--runs', '0'],
    ['--runs', '6'],
    ['--warmup-cycles', '-1'],
    ['--warmup-cycles', '101'],
    ['--unknown'],
  ]) assert.throws(() => parseMemoryCpuProfileArguments(argumentsList))
})

test('isola profilo, home, configurazione e credenziali prima di avviare Electron', () => {
  const fixture = {
    cacheDirectory: '/isolated/cache',
    configDirectory: '/isolated/config',
    dataDirectory: '/isolated/data',
    fakePi: '/isolated/pi',
    homeDirectory: '/isolated/home',
  }
  const environment = isolatedMemoryCpuProfileEnvironment({
    AWS_ACCESS_KEY_ID: 'private',
    DATABASE_URL: 'postgres://private',
    GH_TOKEN: 'private',
    GITHUB_TOKEN: 'private',
    PATH: '/safe/bin',
    SSH_AUTH_SOCK: '/private/agent',
    VITE_DEV_SERVER_URL: 'https://private.invalid',
  }, fixture)

  assert.equal(environment.PATH, '/safe/bin')
  assert.equal(environment.HOME, fixture.homeDirectory)
  assert.equal(environment.USERPROFILE, fixture.homeDirectory)
  assert.equal(environment.VINCODELAB_DATA_DIR, fixture.dataDirectory)
  assert.equal(environment.VINCODELAB_PI_PATH, fixture.fakePi)
  assert.equal(environment.XDG_CACHE_HOME, fixture.cacheDirectory)
  assert.equal(environment.XDG_CONFIG_HOME, fixture.configDirectory)
  for (const key of ['AWS_ACCESS_KEY_ID', 'DATABASE_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'VITE_DEV_SERVER_URL']) {
    assert.equal(key in environment, false, key)
  }
  for (const flag of ['--disable-background-networking', '--disable-component-update', '--disable-sync']) {
    assert.ok(MEMORY_CPU_PROFILE_OFFLINE_FLAGS.includes(flag), flag)
  }
})

function validRun() {
  return {
    afterShutdown: { processCount: 0 },
    isolation: {
      blockedExternalRequests: 0,
      externalNetworkBlockedByCdp: true,
      temporaryArtifactsRemoved: true,
      temporaryDataDirectory: true,
      temporaryProfile: true,
      temporaryWorkspace: true,
      userEnvironmentCredentialsRemoved: true,
      userFilesOpened: 0,
    },
    operations: { commandPaletteCycles: 120, quickOpenCycles: 120, viewChanges: 120 },
    shutdown: { graceful: true },
  }
}

test('il contratto rende espliciti fault di privacy, cleanup, lifecycle e conteggio', () => {
  const expected = { commandPaletteCycles: 120, quickOpenCycles: 120, viewChanges: 120 }
  assert.deepEqual(evaluateMemoryCpuProfileRunContract(validRun(), expected), { failures: [], ok: true })

  const fault = structuredClone(validRun())
  fault.afterShutdown.processCount = 1
  fault.isolation.blockedExternalRequests = 1
  fault.isolation.temporaryArtifactsRemoved = false
  fault.isolation.userEnvironmentCredentialsRemoved = false
  fault.isolation.userFilesOpened = 1
  fault.operations.quickOpenCycles = 119
  fault.shutdown.graceful = false
  assert.deepEqual(evaluateMemoryCpuProfileRunContract(fault, expected), {
    failures: [
      'EXTERNAL_NETWORK_ATTEMPTED',
      'USER_ENVIRONMENT_NOT_ISOLATED',
      'TEMPORARY_ARTIFACTS_REMAIN',
      'USER_FILE_ACCESSED',
      'RESIDUAL_PROCESS',
      'NON_GRACEFUL_SHUTDOWN',
      'OPERATION_COUNT_MISMATCH',
    ],
    ok: false,
  })
})

test('il fallback dialog completa la sequenza pointer senza creare listener once residui', () => {
  const source = rendererHarnessSource()
  const escapeIndex = source.indexOf('target.dispatchEvent(escape)')
  const settleIndex = source.indexOf('await settle()', escapeIndex)
  const fallbackIndex = source.indexOf("new PointerEvent('pointerdown'", settleIndex)
  const pointerUpIndex = source.indexOf("new PointerEvent('pointerup'", fallbackIndex)
  const clickIndex = source.indexOf("new MouseEvent('click'", pointerUpIndex)

  assert.ok(escapeIndex >= 0)
  assert.ok(escapeIndex < settleIndex && settleIndex < fallbackIndex)
  assert.ok(fallbackIndex < pointerUpIndex && pointerUpIndex < clickIndex)
})

test('serializzazione privacy-safe e cleanup accettano soltanto la fixture dedicata', async (t) => {
  assert.equal(serializeMemoryCpuProfileReport({ ok: true }, ['/private/sentinel']), '{\n  "ok": true\n}\n')
  assert.throws(
    () => serializeMemoryCpuProfileReport({ leaked: '/private/sentinel/workspace' }, ['/private/sentinel']),
    /percorso locale non consentito/,
  )

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-memory-cpu-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'fixture'), 'temporary')
  await cleanupMemoryCpuProfileFixture(root)
  assert.equal(fs.existsSync(root), false)
  await assert.rejects(cleanupMemoryCpuProfileFixture(path.resolve('.')), /Directory temporanea.*non valida/)
})
