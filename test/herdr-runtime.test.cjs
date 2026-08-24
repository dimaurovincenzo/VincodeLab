const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  createHerdrRuntimeAdapter,
  executableFromPath,
  hasValidHerdrVersionOutput,
  preflightHerdr,
} = require('../electron/infrastructure/processes/herdr-runtime.adapter.cjs')
const {
  HERDR_IDENTITY_ENVIRONMENT_KEYS,
  createAiTerminalLaunchPolicy,
} = require('../electron/domains/ai/ai-terminal-launch-policy.cjs')
const { isPublicError } = require('../electron/domains/errors/public-error.cjs')

function executableFilesystem(existing = new Set()) {
  return {
    realpathFile(candidate) {
      if (!existing.has(candidate)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return candidate
    },
    statFile() { return { isFile: () => true } },
    accessFile() {},
  }
}

test('resolver Herdr accetta override assoluto autorevole, PATH assoluto e candidato ~/.local verificati', () => {
  const filesystem = executableFilesystem(new Set(['/custom/herdr', '/usr/bin/herdr', '/Users/test/.local/bin/herdr']))
  assert.deepEqual(executableFromPath({ VINCODELAB_HERDR_PATH: '/custom/herdr', PATH: '/usr/bin' }, filesystem), { executable: '/custom/herdr' })
  assert.deepEqual(executableFromPath({ PATH: `relative${path.delimiter}/usr/bin` }, filesystem), { executable: '/usr/bin/herdr' })
  assert.deepEqual(executableFromPath({ PATH: '/missing' }, { ...filesystem, userCandidates: ['/Users/test/.local/bin/herdr'] }), { executable: '/Users/test/.local/bin/herdr' })
})

test('clean-machine ignora override e candidati utente senza riscanansionare Homebrew', () => {
  const inspected = []
  const filesystem = {
    realpathFile(candidate) {
      inspected.push(candidate)
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    statFile() { return { isFile: () => true } },
    accessFile() {},
  }
  const result = executableFromPath({ VINCODELAB_HERDR_PATH: '/custom/herdr', PATH: '/usr/bin' }, {
    ...filesystem,
    includeUserCandidates: false,
    userCandidates: ['/Users/test/.local/bin/herdr'],
  })
  assert.deepEqual(result, { reason: 'missing' })
  assert.deepEqual(inspected, ['/usr/bin/herdr'])
})

test('preflight Herdr riconosce versione, timeout, output invalido e failure bounded senza shell', async () => {
  assert.equal(hasValidHerdrVersionOutput('herdr 0.8.2\n', ''), true)
  assert.equal(hasValidHerdrVersionOutput('0.8.2\n', ''), false)

  let received
  const ready = await preflightHerdr('/opt/homebrew/bin/herdr', { PATH: '/opt/homebrew/bin' }, {
    executeFile(file, args, options, callback) {
      received = { file, args, options }
      callback(null, 'herdr version 0.8.2\n', '')
    },
    timeoutMs: 250,
  })
  assert.deepEqual(ready, { available: true, executable: '/opt/homebrew/bin/herdr' })
  assert.equal(received.file, '/opt/homebrew/bin/herdr')
  assert.deepEqual(received.args, ['--version'])
  assert.equal(received.options.timeout, 250)
  assert.equal(Object.hasOwn(received.options, 'shell'), false)

  const timeout = await preflightHerdr('/herdr', {}, {
    executeFile(_file, _args, _options, callback) { callback(Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' }), '', '') },
    timeoutMs: 10,
  })
  assert.deepEqual(timeout, { available: false, reason: 'timeout' })

  const invalid = await preflightHerdr('/herdr', {}, {
    executeFile(_file, _args, _options, callback) { callback(null, 'unexpected output', '') },
    timeoutMs: 10,
  })
  assert.deepEqual(invalid, { available: false, reason: 'invalid-version-output' })

  const failed = await preflightHerdr('/herdr', {}, {
    executeFile(_file, _args, _options, callback) { callback(Object.assign(new Error('ENOEXEC'), { code: 'ENOEXEC' }), '', '') },
    timeoutMs: 10,
  })
  assert.deepEqual(failed, { available: false, reason: 'preflight-failed' })
})

test('adapter Herdr distingue found e missing senza eseguire il binario reale', async () => {
  const found = createHerdrRuntimeAdapter({
    ...executableFilesystem(new Set(['/opt/homebrew/bin/herdr'])),
    executeFile(_file, _args, _options, callback) { callback(null, 'herdr 0.8.2', '') },
    getEnvironment: () => ({ PATH: '/opt/homebrew/bin' }),
    getHomePath: () => '/Users/test',
    timeoutMs: 50,
  })
  assert.deepEqual(await found.inspect(), { available: true, executable: '/opt/homebrew/bin/herdr' })

  let executed = false
  const missing = createHerdrRuntimeAdapter({
    ...executableFilesystem(),
    executeFile() { executed = true },
    getEnvironment: () => ({ PATH: '/usr/bin' }),
    getHomePath: () => '/Users/test',
    timeoutMs: 50,
  })
  assert.deepEqual(await missing.inspect(), { available: false, reason: 'missing' })
  assert.equal(executed, false)
})

function launchPolicyFixture({ environment, herdrEnabled = true, inspection, piExecutable = '/opt/pi/bin/pi' } = {}) {
  let inspections = 0
  const policy = createAiTerminalLaunchPolicy({
    environmentForExecutable: () => environment ?? { PATH: '/opt/pi/bin:/opt/homebrew/bin:/usr/bin', HOMEBREW_PREFIX: '/opt/homebrew' },
    getEnvironment: () => environment ?? { PATH: '/opt/homebrew/bin:/usr/bin', HOMEBREW_PREFIX: '/opt/homebrew' },
    herdrEnabled,
    inspectHerdr: async (receivedEnvironment) => {
      inspections += 1
      assert.equal(receivedEnvironment.PATH.includes('/opt/homebrew/bin'), true)
      return inspection ?? { available: true, executable: '/opt/homebrew/bin/herdr' }
    },
    resolvePiExecutable: () => piExecutable,
  })
  return { inspections: () => inspections, policy }
}

test('policy preferisce Herdr e conserva PATH Pi/Homebrew in entrambi i descriptor', async () => {
  const fixture = launchPolicyFixture()
  const candidates = await fixture.policy.resolveCandidates('/workspace')
  assert.deepEqual(candidates.map(({ runtime }) => runtime), ['herdr', 'pi'])
  assert.deepEqual(candidates[0].args, [])
  assert.equal(candidates[0].options.cwd, '/workspace')
  assert.match(candidates[0].options.env.PATH, /^\/opt\/pi\/bin:/u)
  assert.equal(candidates[0].options.env.HOMEBREW_PREFIX, '/opt/homebrew')
  assert.equal(candidates[1].options.env.PATH.includes('/opt/homebrew/bin'), true)
  assert.equal(fixture.inspections(), 1)
})

test('Herdr può avviarsi senza Pi, ma assenza di entrambi espone un errore combinato', async () => {
  const herdrOnly = launchPolicyFixture({ piExecutable: null })
  const candidates = await herdrOnly.policy.resolveCandidates('/workspace')
  assert.deepEqual(candidates.map(({ runtime }) => runtime), ['herdr'])
  assert.equal(candidates[0].terminalFailure, 'HERDR_NOT_RUNNABLE')

  const unavailable = launchPolicyFixture({ piExecutable: null, inspection: { available: false, reason: 'missing' } })
  await assert.rejects(unavailable.policy.resolveCandidates('/workspace'), (error) => {
    assert.equal(isPublicError(error), true)
    assert.equal(error.publicCode, 'AI_TERMINAL_RUNTIME_UNAVAILABLE')
    return true
  })
})

test('policy evita Herdr nested, pulisce identità dal Pi child e non esegue preflight', async () => {
  const environment = {
    PATH: '/opt/pi/bin:/opt/homebrew/bin:/usr/bin',
    HERDR_ENV: '1',
    HERDR_SESSION: 'fleet-secret',
    HERDR_PANE_ID: 'pane-1',
    HERDR_TAB_ID: 'tab-1',
    HERDR_WORKSPACE_ID: 'workspace-1',
    HERDR_BIN_PATH: '/private/bin',
    HERDR_SOCKET_PATH: '/private/socket',
  }
  const fixture = launchPolicyFixture({ environment })
  const [candidate] = await fixture.policy.resolveCandidates('/workspace')
  assert.equal(candidate.runtime, 'pi')
  assert.equal(candidate.fallbackReason, 'nested-herdr')
  assert.equal(fixture.inspections(), 0)
  for (const key of HERDR_IDENTITY_ENVIRONMENT_KEYS) assert.equal(Object.hasOwn(candidate.options.env, key), false)
  assert.equal(candidate.options.env.PATH, environment.PATH)
})

test('benchmark disabilita Herdr autorevolmente e recovery direct Pi è one-shot', async () => {
  const disabled = launchPolicyFixture({ herdrEnabled: false })
  const [fallback] = await disabled.policy.resolveCandidates('/workspace')
  assert.equal(fallback.runtime, 'pi')
  assert.equal(fallback.fallbackReason, 'disabled')
  assert.equal(disabled.inspections(), 0)

  const normal = launchPolicyFixture()
  const [direct] = await normal.policy.resolveCandidates('/workspace', { runtime: 'pi' })
  assert.equal(direct.runtime, 'pi')
  assert.equal(direct.fallbackReason, undefined)
  assert.equal(normal.inspections(), 0)
})

test('composition root isola Herdr da reliability, screenshot, fault injection e clean-machine smoke', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.match(source, /const RELIABILITY_BENCHMARK_MODE = process\.argv\.includes\('--reliability-benchmark'\)/u)
  assert.match(source, /const SCREENSHOT_CAPTURE_MODE = RELIABILITY_BENCHMARK_MODE && process\.argv\.includes\('--screenshot-capture'\)/u)
  assert.match(source, /const CLEAN_MACHINE_SMOKE_MODE = RELIABILITY_BENCHMARK_MODE && process\.argv\.includes\('--clean-machine-smoke'\)/u)
  assert.match(source, /includeUserCandidates: !CLEAN_MACHINE_SMOKE_MODE/u)
  assert.match(source, /herdrEnabled: !RELIABILITY_BENCHMARK_MODE/u)
  assert.match(source, /inspectHerdr: \(\) => RELIABILITY_BENCHMARK_MODE\s*\? \{ available: false, reason: 'disabled' \}/u)
})
