import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ipcSource from './helpers/ipc-source.cjs'

const { expandIpcChannelConstants } = ipcSource
import {
  OFFLINE_CHROMIUM_FLAGS,
  PACKAGED_DOMAIN_FAULTS,
  armPersistenceCorruptionScenario,
  cleanupSmokeFixture,
  confirmFaultRecoveryDraftScenario,
  createSmokeFixture,
  exerciseIpcRejectionScenario,
  exerciseDomainFailureScenarios,
  exerciseReactViewCrashScenario,
  isolatedEnvironment,
  packagedElectronArguments,
  parseArguments,
  prepareFaultRecoveryScenario,
  resolvePackagedApp,
  validatePackagedApp,
  verifyCleanMachineScenario,
  verifyFaultLogEvidence,
  verifyFaultRecoveryScenario,
  verifyPersistenceRecoveryScenario,
  verifyRedisSelectScenario,
  visibleCodeMirrorTextMarker,
} from '../scripts/smoke-packaged-macos.mjs'
import {
  OFFLINE_CHROMIUM_FLAGS as SHARED_OFFLINE_CHROMIUM_FLAGS,
  resolvePackagedApp as sharedResolvePackagedApp,
  validatePackagedApp as sharedValidatePackagedApp,
} from '../scripts/lib/packaged-electron.mjs'

test('valida argomenti bounded senza introdurre un percorso di packaging', () => {
  assert.deepEqual(parseArguments(['--app', './release/Test.app', '--timeout', '12000', '--json']), {
    appPath: path.resolve('./release/Test.app'),
    faultRecovery: false,
    help: false,
    json: true,
    redisSelect: false,
    timeoutMs: 12_000,
    withoutPi: false,
  })
  assert.equal(parseArguments(['--fault-recovery']).faultRecovery, true)
  assert.equal(parseArguments(['--redis-select']).redisSelect, true)
  assert.equal(parseArguments(['--without-pi']).withoutPi, true)
  assert.throws(() => parseArguments(['--timeout', '1000']), /Timeout non valido/)
  assert.throws(() => parseArguments(['--package']), /Argomento non riconosciuto/)

  const source = fs.readFileSync(new URL('../scripts/smoke-packaged-macos.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /electron-builder|npm\s+run\s+package/u)
})

test('smoke conserva l API bundle e capture usa direttamente l owner condiviso', () => {
  assert.equal(OFFLINE_CHROMIUM_FLAGS, SHARED_OFFLINE_CHROMIUM_FLAGS)
  assert.equal(resolvePackagedApp, sharedResolvePackagedApp)
  assert.equal(validatePackagedApp, sharedValidatePackagedApp)

  const captureSource = fs.readFileSync(new URL('../scripts/capture-app-screenshots.mjs', import.meta.url), 'utf8')
  assert.match(captureSource, /from '\.\/lib\/packaged-electron\.mjs'/u)
  assert.doesNotMatch(captureSource, /from '\.\/smoke-packaged-macos\.mjs'/u)
})

test('risolve il bundle esplicito preferito o unico e rifiuta assenza e ambiguita', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-packaged-resolution-'))
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }))

  const explicit = path.join(projectRoot, 'Explicit.app')
  assert.equal(await resolvePackagedApp({ appPath: explicit, architecture: 'unsupported', projectRoot }), explicit)
  await assert.rejects(resolvePackagedApp({ architecture: 'arm64', projectRoot }), /Nessun artefatto macOS/)

  const preferred = path.join(projectRoot, 'release', 'mac-arm64', 'VincodeLab.app')
  fs.mkdirSync(preferred, { recursive: true })
  assert.equal(await resolvePackagedApp({ architecture: 'arm64', projectRoot }), preferred)

  fs.rmSync(path.join(projectRoot, 'release'), { recursive: true, force: true })
  const fallback = path.join(projectRoot, 'release', 'mac-fixture', 'VincodeLab.app')
  fs.mkdirSync(fallback, { recursive: true })
  assert.equal(await resolvePackagedApp({ architecture: 'arm64', projectRoot }), fallback)

  const second = path.join(projectRoot, 'release', 'mac-secondary', 'VincodeLab.app')
  fs.mkdirSync(second, { recursive: true })
  await assert.rejects(resolvePackagedApp({ architecture: 'arm64', projectRoot }), /Più bundle disponibili/u)
  await assert.rejects(resolvePackagedApp({ architecture: 'unsupported', projectRoot }), /Architettura macOS non supportata/)
})

test('crea profilo e workspace isolati, applica il blocco rete e rimuove la fixture', async () => {
  const fixture = await createSmokeFixture()
  try {
    assert.ok(fixture.root.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`))
    assert.equal(fs.readFileSync(path.join(fixture.workspace, 'README.md'), 'utf8'), '# VincodeLab packaged smoke\n')
    assert.ok((fs.statSync(fixture.fakePi).mode & 0o111) !== 0)

    const environment = isolatedEnvironment(fixture)
    assert.equal(environment.HOME, fixture.home)
    assert.equal(environment.VINCODELAB_DATA_DIR, fixture.data)
    assert.equal(environment.VINCODELAB_LOGS_DIR, path.join(fixture.root, 'logs'))
    assert.equal(environment.VINCODELAB_PI_PATH, fixture.fakePi)
    const cleanEnvironment = isolatedEnvironment(fixture, { withoutPi: true })
    assert.equal(cleanEnvironment.VINCODELAB_PI_PATH, path.join(fixture.root, 'pi-not-installed'))
    assert.equal(cleanEnvironment.PATH, fixture.systemBin)
    assert.equal('SSH_AUTH_SOCK' in environment, false)
    assert.equal('GH_TOKEN' in environment, false)

    const args = packagedElectronArguments({ port: 9_222, profile: fixture.profile, workspace: fixture.workspace })
    assert.ok(args.includes(`--user-data-dir=${fixture.profile}`))
    assert.ok(args.includes('--reliability-benchmark'))
    assert.equal(args.includes('--reliability-fault-injection'), false)
    assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
    for (const flag of OFFLINE_CHROMIUM_FLAGS) assert.ok(args.includes(flag), flag)
    assert.deepEqual(args.slice(-2), ['--workspace', fixture.workspace])

    const faultArgs = packagedElectronArguments({ faultRecovery: true, port: 9_223, profile: fixture.profile, workspace: fixture.workspace })
    assert.ok(faultArgs.includes('--reliability-benchmark'))
    assert.ok(faultArgs.includes('--reliability-fault-injection'))
    const cleanMachineArgs = packagedElectronArguments({ port: 9_224, profile: fixture.profile, withoutPi: true, workspace: fixture.workspace })
    assert.ok(cleanMachineArgs.includes('--clean-machine-smoke'))
  } finally {
    await cleanupSmokeFixture(fixture)
  }
  assert.equal(fs.existsSync(fixture.root), false)
})

test('lo smoke Redis verifica il select portaled nel runtime reale e resta opzionale', () => {
  const scenario = verifyRedisSelectScenario()
  assert.doesNotThrow(() => new Function(`return ${scenario}`))
  assert.match(scenario, /Sezioni applicazione/u)
  assert.match(scenario, /Workspace Redis/u)
  assert.match(scenario, /value-text/u)
  assert.match(scenario, /Standalone/u)
  assert.match(scenario, /Sentinel/u)
  assert.match(scenario, /role="listbox"/u)
  assert.match(scenario, /role="option"/u)
  assert.match(scenario, /getBoundingClientRect/u)
  assert.match(scenario, /getComputedStyle/u)
  assert.match(scenario, /elementFromPoint/u)
  assert.match(scenario, /aria-expanded/u)
  assert.match(scenario, /popupZIndex <= dialogZIndex/u)
  assert.match(scenario, /pointerHitTestPassed: true/u)
  assert.match(scenario, /Host Sentinel/u)
  assert.match(scenario, /Nome master Sentinel/u)
  assert.match(scenario, /dialogClosed: true/u)

  const smokeSource = fs.readFileSync(new URL('../scripts/smoke-packaged-macos.mjs', import.meta.url), 'utf8')
  assert.match(smokeSource, /--redis-select/u)
  assert.match(smokeSource, /if \(redisSelect\)/u)
  assert.match(smokeSource, /cdp\.evaluate\(verifyRedisSelectScenario\(\)\)/u)
  assert.match(smokeSource, /redisSelectSummary \? \{ redisSelect: redisSelectSummary \}/u)
  assert.match(smokeSource, /redisSelect: options\.redisSelect/u)
})

test('il fault recovery usa Page.crash, riconnette CDP e verifica la bozza nel registro main', () => {
  const marker = '\n<!-- fault-recovery-"fixture" -->'
  const visibleMarker = visibleCodeMirrorTextMarker(marker)
  const prepare = prepareFaultRecoveryScenario(marker)
  const confirm = confirmFaultRecoveryDraftScenario(marker)
  const verify = verifyFaultRecoveryScenario(marker)
  const ipcRejection = exerciseIpcRejectionScenario()
  const domainFailures = exerciseDomainFailureScenarios()
  const reactViewCrash = exerciseReactViewCrashScenario(marker)
  const persistenceArm = armPersistenceCorruptionScenario()
  const persistenceVerify = verifyPersistenceRecoveryScenario()
  const cleanMachine = verifyCleanMachineScenario()

  for (const scenario of [ipcRejection, domainFailures, reactViewCrash, persistenceArm, persistenceVerify, prepare, confirm, verify]) {
    assert.doesNotThrow(() => new Function(`return ${scenario}`))
  }
  assert.doesNotThrow(() => new Function(`return ${cleanMachine}`))
  assert.match(cleanMachine, /Runtime del Terminale AI non disponibile/u)
  assert.match(cleanMachine, /Herdr non è disponibile/u)
  assert.match(cleanMachine, /Pi Coding Agent non è installato o utilizzabile/u)
  assert.match(cleanMachine, /Apri impostazioni/u)
  assert.match(cleanMachine, /recoveryVisible/u)
  assert.match(cleanMachine, /databaseDriversReady/u)
  assert.match(cleanMachine, /redisClientReady/u)
  assert.match(cleanMachine, /npmOptional/u)
  assert.match(cleanMachine, /nodeState/u)
  assert.match(cleanMachine, /npmState/u)
  for (const scenario of [prepare, confirm, verify]) assert.match(scenario, /README\.md/)
  assert.match(ipcRejection, /BENCHMARK_IPC_REJECTION/)
  assert.match(ipcRejection, /nextCallSucceeded/)
  assert.match(ipcRejection, /typeof error\.message === 'string'/)
  for (const scenario of PACKAGED_DOMAIN_FAULTS) {
    assert.match(domainFailures, new RegExp(scenario.code, 'u'))
    assert.match(domainFailures, new RegExp(scenario.fault, 'u'))
  }
  assert.match(domainFailures, /typeof error\.message === 'string'/)
  assert.match(persistenceArm, /persistence-corrupt/)
  assert.match(persistenceVerify, /Layout del workspace ripristinato/)
  assert.match(persistenceVerify, /Riferimento ERR-/)
  assert.match(persistenceVerify, /noticeDismissed/)
  assert.match(persistenceVerify, /workspaceSession\.save/)
  assert.match(persistenceVerify, /persistenceWriteSucceeded/)
  assert.match(prepare, /__vincodelabFaultRecoveryToken/)
  assert.match(prepare, /Mostra sorgente/)
  assert.equal(visibleMarker, '<!-- fault-recovery-"fixture" -->')
  assert.ok(`# VincodeLab packaged smoke${visibleMarker}`.includes(visibleMarker))
  assert.equal(visibleCodeMirrorTextMarker('\r\nfixture'), 'fixture')
  assert.equal(visibleCodeMirrorTextMarker(' fixture'), ' fixture')
  assert.match(confirm, /volatileDrafts/)
  assert.match(confirm, /visibleMarker/)
  assert.match(confirm, /mainRegistryMirrored/)
  assert.match(reactViewCrash, /vincodelab:benchmark-view-fault/)
  assert.match(reactViewCrash, /focusConfined/)
  assert.match(reactViewCrash, /shellPreserved/)
  assert.match(verify, /visibleMarker/)
  assert.match(verify, /rendererContextReplaced/)
  assert.match(verify, /mainRegistryRecovered/)

  const smokeSource = fs.readFileSync(new URL('../scripts/smoke-packaged-macos.mjs', import.meta.url), 'utf8')
  assert.match(smokeSource, /cdp\.send\('Input\.insertText'/)
  assert.match(smokeSource, /Inspector\.targetCrashed/)
  assert.match(smokeSource, /cdp\.send\('Page\.crash'/)
  assert.match(smokeSource, /reconnectAfterRendererCrash/)
  assert.match(smokeSource, /verifyFaultLogEvidence/)
  assert.match(smokeSource, /!reactViewCrash\.focusConfined/)
  assert.match(smokeSource, /persistedFileUnchanged: true/)

  const mainSource = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  const windowLifecycleSource = fs.readFileSync(new URL('../electron/app/window-lifecycle-runtime.cjs', import.meta.url), 'utf8')
  const preloadSource = expandIpcChannelConstants(fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8'))
  const lifecycleBenchmarkIpc = expandIpcChannelConstants(fs.readFileSync(new URL('../electron/ipc/domains/lifecycle-benchmark.ipc.cjs', import.meta.url), 'utf8'))
  assert.match(mainSource, /RELIABILITY_FAULT_INJECTION_MODE\s*=\s*RELIABILITY_BENCHMARK_MODE\s*&&\s*process\.argv\.includes\('--reliability-fault-injection'\)/)
  assert.match(windowLifecycleSource, /faultInjectionMode\) return 'reload'/)
  assert.match(mainSource, /registerLifecycleBenchmarkIpc\(\{[\s\S]{0,900}reliabilityFaultInjectionMode: RELIABILITY_FAULT_INJECTION_MODE/)
  assert.match(lifecycleBenchmarkIpc, /if \(reliabilityFaultInjectionMode\) \{[\s\S]{0,220}handlers\.set\('benchmark:injectFault'/)
  assert.match(mainSource, /reliabilityFaultInjection\?\.beforeWorkspaceSessionRead\(\)/)
  assert.match(preloadSource, /benchmarkFaultInjectionMode\s*=\s*benchmarkMode\s*&&\s*process\.argv\.includes\('--vincodelab-reliability-fault-injection'\)/)
  assert.match(preloadSource, /benchmarkFaultInjectionMode \? \{[\s\S]{0,220}injectFault:[\s\S]{0,160}benchmark:injectFault/)
})

test('l’evidenza fault correla gli incidenti core e di dominio e rifiuta dettagli tecnici', () => {
  const domainFailures = PACKAGED_DOMAIN_FAULTS.map((entry, index) => ({
    ...entry,
    correlationId: `ERR-${String(index + 1).padStart(6, 'A')}`,
  }))
  const content = [
    { event: 'ipc_handler_failed', category: 'timeout', code: 'BENCHMARK_IPC_REJECTION', correlationId: 'ERR-A1B2C3' },
    ...domainFailures.map((entry) => ({ event: 'ipc_handler_failed', category: entry.category, code: entry.code, correlationId: entry.correlationId })),
    { event: 'renderer_user_error', component: 'view:editor', operation: 'render', correlationId: 'ERR-ABC123' },
    { event: 'workspace_session_recovered', code: 'PERSISTENCE_SESSION_CORRUPT', correlationId: 'ERR-D4E5F6' },
    { event: 'renderer_process_gone', code: 'RENDERER_PROCESS_GONE', correlationId: 'ERR-102ABC' },
  ].map((entry) => JSON.stringify(entry)).join('\n')

  assert.deepEqual(verifyFaultLogEvidence(content, {
    domainFailures,
    ipcCorrelationId: 'ERR-A1B2C3',
    persistenceCorrelationId: 'ERR-D4E5F6',
    reactViewCorrelationId: 'ERR-ABC123',
  }), {
    correlationsMatched: true,
    domainCorrelationsMatched: true,
    privateDataAbsent: true,
    rendererCorrelationId: 'ERR-102ABC',
  })
  assert.throws(() => verifyFaultLogEvidence(`${content}\ntoken=benchmark-secret`, {
    domainFailures,
    ipcCorrelationId: 'ERR-A1B2C3',
    persistenceCorrelationId: 'ERR-D4E5F6',
    reactViewCorrelationId: 'ERR-ABC123',
  }), /dettagli tecnici riservati/)
})

test('verifica struttura, permessi e architettura dei moduli nativi del bundle', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-packaged-smoke-bundle-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const appPath = path.join(root, 'Fixture.app')
  const contents = path.join(appPath, 'Contents')
  const resources = path.join(contents, 'Resources')
  const modules = path.join(resources, 'app.asar.unpacked', 'node_modules')
  const executable = path.join(contents, 'MacOS', 'Fixture')
  const ptyNative = path.join(modules, 'node-pty', 'build', 'Release', 'pty.node')
  const spawnHelper = path.join(modules, 'node-pty', 'build', 'Release', 'spawn-helper')
  const sqliteNative = path.join(modules, 'better-sqlite3', 'prebuilds', 'darwin-arm64.node')
  for (const directory of [path.dirname(executable), path.dirname(ptyNative), path.dirname(sqliteNative)]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  for (const filePath of [executable, path.join(resources, 'app.asar'), ptyNative, spawnHelper, sqliteNative]) {
    fs.writeFileSync(filePath, 'fixture')
  }
  fs.chmodSync(executable, 0o700)
  fs.chmodSync(spawnHelper, 0o700)

  const inspected = []
  const result = await validatePackagedApp(appPath, {
    architecture: 'arm64',
    inspectArchitectures: async (filePath) => { inspected.push(filePath); return new Set(['arm64']) },
  })
  assert.equal(result.executable, executable)
  assert.equal(result.nativeModules.nodePty, ptyNative)
  assert.equal(result.nativeModules.spawnHelper, spawnHelper)
  assert.equal(result.nativeModules.betterSqlite3, sqliteNative)
  assert.deepEqual(new Set(inspected), new Set([executable, ptyNative, spawnHelper, sqliteNative]))

  fs.chmodSync(spawnHelper, 0o600)
  await assert.rejects(
    validatePackagedApp(appPath, { architecture: 'arm64', inspectArchitectures: async () => new Set(['arm64']) }),
    /non eseguibile/,
  )
})
