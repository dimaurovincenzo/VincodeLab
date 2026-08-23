#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_TIMEOUT_MS = 25_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 60_000
const MAX_DIAGNOSTIC_BYTES = 32 * 1024
const MAX_FAULT_LOG_BYTES = 512 * 1024
const PRODUCT_NAME = 'VincodeLab'
const FAULT_RECOVERY_FILE_ID = 'README.md'
const FAULT_RECOVERY_BASELINE = '# VincodeLab packaged smoke\n'

export const PACKAGED_DOMAIN_FAULTS = Object.freeze([
  { fault: 'ai-crash', category: 'process', code: 'BENCHMARK_AI_CRASH', copy: 'La sessione AI si è interrotta.' },
  { fault: 'pty-failure', category: 'process', code: 'BENCHMARK_PTY_FAILURE', copy: 'Il terminale non è stato avviato.' },
  { fault: 'file-not-found', category: 'not-found', code: 'BENCHMARK_FILE_NOT_FOUND', copy: 'Il file di prova non è più disponibile.' },
  { fault: 'file-permission', category: 'permission', code: 'BENCHMARK_FILE_PERMISSION', copy: 'Il file di prova non è accessibile.' },
  { fault: 'git-failure', category: 'git', code: 'BENCHMARK_GIT_FAILURE', copy: 'Git non ha aggiornato il repository di prova.' },
  { fault: 'github-network', category: 'network', code: 'BENCHMARK_GITHUB_NETWORK', copy: 'GitHub non è raggiungibile.' },
  { fault: 'database-connection', category: 'network', code: 'BENCHMARK_DATABASE_CONNECTION', copy: 'Impossibile raggiungere il database di prova.' },
  { fault: 'database-query', category: 'database', code: 'BENCHMARK_DATABASE_QUERY', copy: 'La query di prova non è stata completata.' },
  { fault: 'sftp-failure', category: 'remote', code: 'BENCHMARK_SFTP_FAILURE', copy: 'Il server remoto di prova non è raggiungibile.' },
])

export const OFFLINE_CHROMIUM_FLAGS = Object.freeze([
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-pings',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=localhost;127.0.0.1',
])

function usage() {
  return [
    'Uso: node scripts/smoke-packaged-macos.mjs [opzioni]',
    '',
    'Opzioni:',
    '  --app <percorso.app>  Bundle già creato; default: release/mac*/VincodeLab.app',
    `  --timeout <ms>        Timeout avvio, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (default ${DEFAULT_TIMEOUT_MS})`,
    '  --fault-recovery      Verifica failure di dominio, persistenza e crash renderer con recovery',
    '  --without-pi          Verifica una macchina pulita senza Pi, Node o npm di sistema',
    '  --json                Output JSON compatto',
    '  --help                Mostra questo messaggio',
    '',
    'Lo script non crea il pacchetto e non usa profilo, workspace o rete dell’utente.',
  ].join('\n')
}

export function parseArguments(argumentsList) {
  const options = { appPath: null, faultRecovery: false, help: false, json: false, timeoutMs: DEFAULT_TIMEOUT_MS, withoutPi: false }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--app') {
      const value = argumentsList[++index]
      if (!value) throw new Error('Percorso --app mancante.')
      options.appPath = path.resolve(value)
    } else if (argument === '--timeout') {
      options.timeoutMs = Number(argumentsList[++index])
    } else if (argument === '--fault-recovery') options.faultRecovery = true
    else if (argument === '--without-pi') options.withoutPi = true
    else if (argument === '--json') options.json = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < MIN_TIMEOUT_MS || options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Timeout non valido: usa un intero tra ${MIN_TIMEOUT_MS} e ${MAX_TIMEOUT_MS} ms.`)
  }
  return options
}

async function regularFile(filePath, { executable = false, nonempty = false } = {}) {
  const stats = await lstat(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`File bundle non sicuro: ${filePath}`)
  if (nonempty && stats.size === 0) throw new Error(`File bundle vuoto: ${filePath}`)
  if (executable && (stats.mode & 0o111) === 0) throw new Error(`File bundle non eseguibile: ${filePath}`)
  return filePath
}

function architectureName(architecture) {
  if (architecture === 'arm64') return 'arm64'
  if (architecture === 'x64') return 'x86_64'
  throw new Error(`Architettura macOS non supportata dallo smoke: ${architecture}`)
}

async function inspectArchitecturesWithFile(filePath) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/file', ['-b', filePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `/usr/bin/file è terminato con codice ${code}.`)))
  })
  const architectures = new Set()
  if (/\barm64\b/u.test(output)) architectures.add('arm64')
  if (/\bx86_64\b/u.test(output)) architectures.add('x86_64')
  return architectures
}

async function firstRegularFile(candidates, options) {
  for (const candidate of candidates) {
    try {
      return await regularFile(candidate, options)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`File nativo mancante; percorsi controllati: ${candidates.join(', ')}`)
}

export async function validatePackagedApp(appPath, {
  architecture = process.arch,
  inspectArchitectures = inspectArchitecturesWithFile,
} = {}) {
  const resolvedApp = path.resolve(appPath)
  if (path.extname(resolvedApp) !== '.app') throw new Error('Il percorso deve indicare un bundle .app macOS.')
  const appStats = await lstat(resolvedApp)
  if (!appStats.isDirectory() || appStats.isSymbolicLink()) throw new Error('Il bundle .app non è una directory regolare.')

  const expectedArchitecture = architectureName(architecture)
  const contents = path.join(resolvedApp, 'Contents')
  const executable = await regularFile(path.join(contents, 'MacOS', path.basename(resolvedApp, '.app')), { executable: true, nonempty: true })
  const resources = path.join(contents, 'Resources')
  await regularFile(path.join(resources, 'app.asar'), { nonempty: true })
  const unpackedModules = path.join(resources, 'app.asar.unpacked', 'node_modules')
  const nodePtyRoot = path.join(unpackedModules, 'node-pty')
  const ptyNative = await firstRegularFile([
    path.join(nodePtyRoot, 'build', 'Release', 'pty.node'),
    path.join(nodePtyRoot, 'prebuilds', `darwin-${architecture}`, 'pty.node'),
  ], { nonempty: true })
  const spawnHelper = await firstRegularFile([
    path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper'),
    path.join(nodePtyRoot, 'prebuilds', `darwin-${architecture}`, 'spawn-helper'),
  ], { executable: true, nonempty: true })
  const betterSqlite3Native = await regularFile(
    path.join(unpackedModules, 'better-sqlite3', 'prebuilds', `darwin-${architecture}.node`),
    { nonempty: true },
  )

  for (const nativeFile of [executable, ptyNative, spawnHelper, betterSqlite3Native]) {
    const architectures = await inspectArchitectures(nativeFile)
    if (!architectures.has(expectedArchitecture)) {
      throw new Error(`Architettura ${expectedArchitecture} assente da ${nativeFile}.`)
    }
  }

  return {
    appPath: resolvedApp,
    executable,
    nativeModules: {
      betterSqlite3: betterSqlite3Native,
      nodePty: ptyNative,
      spawnHelper,
    },
  }
}

async function pathExists(candidate) {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function resolvePackagedApp({ appPath = null, architecture = process.arch, projectRoot = PROJECT_ROOT } = {}) {
  if (appPath) return path.resolve(appPath)
  architectureName(architecture)
  const releaseRoot = path.join(projectRoot, 'release')
  const preferredDirectory = architecture === 'arm64' ? 'mac-arm64' : 'mac'
  const preferred = path.join(releaseRoot, preferredDirectory, `${PRODUCT_NAME}.app`)
  if (await pathExists(preferred)) return preferred

  let entries
  try {
    entries = await readdir(releaseRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Nessun artefatto macOS: crea il pacchetto separatamente prima dello smoke.')
    throw error
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('mac')) continue
    const candidate = path.join(releaseRoot, entry.name, `${PRODUCT_NAME}.app`)
    if (await pathExists(candidate)) candidates.push(candidate)
  }
  if (candidates.length === 0) throw new Error('Nessun bundle VincodeLab.app presente sotto release/mac*.')
  if (candidates.length > 1) throw new Error(`Più bundle disponibili; scegli esplicitamente con --app: ${candidates.join(', ')}`)
  return candidates[0]
}

export async function createSmokeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vincodelab-packaged-smoke-'))
  try {
    const directories = {
      cache: path.join(root, 'cache'),
      data: path.join(root, 'data'),
      gh: path.join(root, 'gh'),
      home: path.join(root, 'home'),
      profile: path.join(root, 'profile'),
      systemBin: path.join(root, 'system-bin'),
      temp: path.join(root, 'tmp'),
      workspaceDirectory: path.join(root, 'workspace'),
    }
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })))
    await mkdir(path.join(directories.home, 'Library', 'Logs'), { recursive: true, mode: 0o700 })
    await writeFile(path.join(directories.workspaceDirectory, 'README.md'), '# VincodeLab packaged smoke\n', { mode: 0o600 })
    const fakePi = path.join(root, 'pi-offline-fixture')
    await writeFile(fakePi, `#!/bin/sh
case "$1" in
  --version) printf '%s\\n' 'pi-offline-smoke 1.0' ;;
  list) exit 0 ;;
  *) exit 64 ;;
esac
`, { mode: 0o700 })
    await chmod(fakePi, 0o700)
    return {
      root,
      ...directories,
      fakePi,
      workspace: await realpath(directories.workspaceDirectory),
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export async function cleanupSmokeFixture(fixture) {
  const resolvedRoot = path.resolve(fixture?.root ?? '')
  const temporaryRoot = path.resolve(os.tmpdir())
  const relative = path.relative(temporaryRoot, resolvedRoot)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !path.basename(resolvedRoot).startsWith('vincodelab-packaged-smoke-')) {
    throw new Error('Cleanup smoke rifiutato: directory temporanea non riconosciuta.')
  }
  await rm(resolvedRoot, { recursive: true, force: true })
}

export function isolatedEnvironment(fixture, { withoutPi = false } = {}) {
  return {
    GH_CONFIG_DIR: fixture.gh,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: fixture.home,
    HTTPS_PROXY: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    LANG: 'en_US.UTF-8',
    LOGNAME: 'vincodelab-smoke',
    NO_PROXY: '127.0.0.1,localhost',
    PATH: fixture.systemBin,
    SHELL: '/bin/sh',
    TMPDIR: fixture.temp,
    USER: 'vincodelab-smoke',
    VINCODELAB_DATA_DIR: fixture.data,
    VINCODELAB_LOGS_DIR: path.join(fixture.root, 'logs'),
    VINCODELAB_PI_PATH: withoutPi ? path.join(fixture.root, 'pi-not-installed') : fixture.fakePi,
    XDG_CACHE_HOME: fixture.cache,
    XDG_CONFIG_HOME: path.join(fixture.profile, 'config'),
    XDG_DATA_HOME: path.join(fixture.profile, 'share'),
  }
}

export function packagedElectronArguments({ faultRecovery = false, port, profile, withoutPi = false, workspace }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Porta DevTools non valida.')
  return [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--reliability-benchmark',
    ...(faultRecovery ? ['--reliability-fault-injection'] : []),
    ...(withoutPi ? ['--clean-machine-smoke'] : []),
    ...OFFLINE_CHROMIUM_FLAGS,
    '--workspace',
    workspace,
  ]
}

async function reserveLoopbackPort() {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('Impossibile riservare la porta DevTools locale.')
  return port
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Smoke interrotto.')
}

async function waitForDebugger(port, deadline, childState, signal) {
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    if (childState.exited) {
      if (childState.error) throw new Error(`Avvio del bundle fallito: ${childState.error.message}`)
      throw new Error(`Il bundle è terminato prima del renderer (code=${childState.code}, signal=${childState.signal ?? 'none'}).`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(300) })
      const targets = await response.json()
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)
      if (target) return target
    } catch {}
    await delay(50)
  }
  throw new Error('Renderer Electron non disponibile entro il timeout.')
}

function createCdpClient(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  const runtimeDiagnostics = []
  let sequence = 0
  let resolveClosed
  let resolveCrashed
  const closed = new Promise((resolve) => { resolveClosed = resolve })
  const crashed = new Promise((resolve) => { resolveCrashed = resolve })
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const rejectPending = () => {
    for (const { reject } of pending.values()) reject(new Error('Connessione DevTools chiusa.'))
    pending.clear()
  }
  socket.addEventListener('close', () => {
    rejectPending()
    resolveClosed()
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Inspector.targetCrashed') resolveCrashed(message.params ?? {})
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text
      if (typeof detail === 'string') runtimeDiagnostics.push(detail)
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const detail = message.params.args?.map((argument) => argument.description ?? argument.value).filter((value) => typeof value === 'string').join(' ')
      if (detail) runtimeDiagnostics.push(detail)
    }
    if (!message.id || !pending.has(message.id)) return
    const request = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  const send = async (method, params = {}) => {
    await opened
    const id = ++sequence
    const response = new Promise((resolve, reject) => pending.set(id, { reject, resolve }))
    socket.send(JSON.stringify({ id, method, params }))
    return response
  }
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Valutazione renderer fallita.')
    return response.result.value
  }
  return {
    close: () => {
      try { socket.close() } catch {}
    },
    closed,
    crashed,
    diagnostics: () => runtimeDiagnostics.slice(-8),
    evaluate,
    send,
  }
}

function rendererSmokeScenario() {
  return String.raw`(async () => {
    const deadline = performance.now() + 15000
    let navigation
    while (performance.now() < deadline) {
      navigation = document.querySelector('[aria-label="Sezioni applicazione"]')
      if (document.readyState === 'complete' && navigation?.isConnected) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!navigation?.isConnected) {
      const text = document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 600) ?? ''
      throw new Error('Workbench non renderizzato: ' + text)
    }
    const bridge = window.vincodeLab
    if (!bridge?.workspace?.getActive || !bridge?.preferences?.get || !bridge?.benchmark?.shutdown) {
      throw new Error('Preload bridge incompleto nel bundle.')
    }
    const [activeWorkspace, preferences] = await Promise.all([
      bridge.workspace.getActive(),
      bridge.preferences.get(),
    ])
    return {
      activeWorkspace: activeWorkspace?.path ?? null,
      bodyTextLength: document.body?.innerText?.length ?? 0,
      documentTitle: document.title,
      navigationConnected: navigation.isConnected,
      preferenceDefinitions: Array.isArray(preferences?.schema) ? preferences.schema.length : -1,
      readyState: document.readyState,
    }
  })()`
}

export function verifyCleanMachineScenario() {
  return String.raw`(async () => {
    const deadline = performance.now() + 15000
    let notice
    while (performance.now() < deadline) {
      notice = [...document.querySelectorAll('[role="status"], [role="alert"]')]
        .find((element) => element.textContent?.includes('Pi Coding Agent non installato'))
      if (notice) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!notice) throw new Error('Messaggio Pi non installato non visibile.')
    const bridge = window.vincodeLab
    if (!bridge?.runtime?.capabilities || !bridge?.workspace?.getActive) throw new Error('Bridge compatibilità incompleto.')
    const [capabilities, activeWorkspace] = await Promise.all([
      bridge.runtime.capabilities(),
      bridge.workspace.getActive(),
    ])
    const byId = new Map((capabilities?.items ?? []).map((item) => [item.id, item]))
    const databaseDrivers = ['database-sqlite', 'database-postgresql', 'database-mysql', 'database-sqlserver']
    const navigationText = document.querySelector('[aria-label="Sezioni applicazione"]')?.textContent ?? ''
    const bodyText = document.body?.innerText ?? ''
    return {
      activeWorkspace: activeWorkspace?.path ?? null,
      databaseDriversReady: databaseDrivers.every((id) => byId.get(id)?.state === 'ready'),
      redisClientReady: byId.get('redis-client')?.state === 'ready',
      navigationPreserved: ['Editor', 'Terminale', 'GitHub', 'Database', 'Redis'].every((label) => navigationText.includes(label)),
      nodeState: byId.get('node-system')?.state ?? null,
      npmOptional: byId.get('npm-system')?.kind === 'optional',
      npmState: byId.get('npm-system')?.state ?? null,
      piState: byId.get('pi-agent')?.state ?? null,
      sanitized: !/Something went wrong|Cannot find module|MODULE_NOT_FOUND|ERR_DLOPEN|stack trace/iu.test(bodyText),
      userMessage: notice.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }
  })()`
}

export function exerciseIpcRejectionScenario() {
  return String.raw`(async () => {
    const bridge = window.vincodeLab
    if (!bridge?.benchmark?.injectFault || !bridge?.benchmark?.probe) throw new Error('Bridge fault injection non disponibile.')
    let message = ''
    try {
      await bridge.benchmark.injectFault('ipc-rejection')
    } catch (error) {
      message = error && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : error instanceof Error ? error.message : String(error)
    }
    const correlationId = message.match(/\[(ERR-[A-F0-9]{6})\]/)?.[1]
    if (!correlationId || !message.includes('[BENCHMARK_IPC_REJECTION]')) {
      throw new Error('La rejection IPC non contiene classificazione e correlation ID pubblici.')
    }
    if (/benchmark-secret|\/Users\/benchmark|query\.sql|token=/iu.test(message)) {
      throw new Error('La rejection IPC espone dettagli tecnici della fault injection.')
    }
    const [probe, activeWorkspace] = await Promise.all([
      bridge.benchmark.probe(),
      bridge.workspace.getActive(),
    ])
    if (!probe?.ok || !activeWorkspace?.path) throw new Error('La chiamata successiva alla rejection IPC non è riuscita.')
    return {
      code: 'BENCHMARK_IPC_REJECTION',
      correlationId,
      nextCallSucceeded: true,
      sanitized: true,
    }
  })()`
}

export function exerciseDomainFailureScenarios() {
  const scenarios = JSON.stringify(PACKAGED_DOMAIN_FAULTS)
  return `(async () => {
    const bridge = window.vincodeLab?.benchmark
    if (!bridge?.injectFault || !bridge?.probe) throw new Error('Bridge fault injection non disponibile.')
    const scenarios = ${scenarios}
    const incidents = []
    for (const scenario of scenarios) {
      let message = ''
      try {
        await bridge.injectFault(scenario.fault)
      } catch (error) {
        message = error && typeof error === 'object' && typeof error.message === 'string'
          ? error.message
          : error instanceof Error ? error.message : String(error)
      }
      const correlationId = message.match(/\\[(ERR-[A-F0-9]{6})\\]/)?.[1]
      if (!correlationId || !message.includes('[' + scenario.code + ']') || !message.includes(scenario.copy)) {
        throw new Error('Failure controllato senza messaggio pubblico completo: ' + scenario.fault)
      }
      if (/benchmark-secret|access_token|\\/tmp\\/vincodelab-private/iu.test(message)) {
        throw new Error('Failure controllato con dettaglio tecnico esposto: ' + scenario.fault)
      }
      const probe = await bridge.probe()
      if (!probe?.ok) throw new Error('Recovery non confermata dopo il failure: ' + scenario.fault)
      incidents.push({
        category: scenario.category,
        code: scenario.code,
        correlationId,
        fault: scenario.fault,
        messageActionable: true,
        nextCallSucceeded: true,
        sanitized: true,
      })
    }
    return { incidents, nextCallsSucceeded: true }
  })()`
}

export function armPersistenceCorruptionScenario() {
  return String.raw`(async () => {
    const bridge = window.vincodeLab?.benchmark
    if (!bridge?.injectFault || !bridge?.probe) throw new Error('Bridge fault injection non disponibile.')
    const result = await bridge.injectFault('persistence-corrupt')
    if (!result?.armed || result.fault !== 'persistence-corrupt') throw new Error('Corruzione persistenza non armata.')
    return { armed: true }
  })()`
}

export function verifyPersistenceRecoveryScenario() {
  return String.raw`(async () => {
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout verifica persistenza corrotta: ' + label)
    }
    const bridge = window.vincodeLab
    if (!bridge?.benchmark?.probe || !bridge?.workspaceSession?.get) throw new Error('Bridge recovery persistenza non disponibile.')
    const notice = await waitFor(() => [...document.querySelectorAll('[role="status"], [role="alert"]')]
      .find((element) => element.textContent?.includes('Layout del workspace ripristinato')
        && /Riferimento ERR-[A-F0-9]{6}/u.test(element.textContent ?? '')), 'messaggio recovery')
    const noticeText = notice.textContent ?? ''
    const correlationId = noticeText.match(/Riferimento (ERR-[A-F0-9]{6})/u)?.[1]
    if (!correlationId) throw new Error('Correlation ID recovery persistenza assente.')
    if (/benchmark-secret|\/Users\/benchmark|query\.sql|token=/iu.test(document.body?.innerText ?? '')) {
      throw new Error('Il recovery persistenza espone dettagli tecnici della fault injection.')
    }
    const recovery = [...notice.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Continua')
    if (!recovery) throw new Error('Azione recovery persistenza assente.')
    recovery.click()
    await waitFor(() => !notice.isConnected, 'chiusura messaggio recovery')
    const [nextSnapshot, probe, activeWorkspace] = await Promise.all([
      bridge.workspaceSession.get(),
      bridge.benchmark.probe(),
      bridge.workspace.getActive(),
    ])
    if (nextSnapshot?.recovery || !probe?.ok || !activeWorkspace?.path) {
      throw new Error('La chiamata successiva al recovery persistenza non è riuscita.')
    }
    const savedSnapshot = await bridge.workspaceSession.save({ version: nextSnapshot.version, state: nextSnapshot.state })
    if (!Number.isInteger(savedSnapshot?.updatedAt) || savedSnapshot.updatedAt < 1) {
      throw new Error('La persistenza non ha accettato un nuovo salvataggio dopo il recovery.')
    }
    return {
      correlationId,
      nextCallSucceeded: true,
      noticeDismissed: true,
      noticeVisible: true,
      persistenceWriteSucceeded: true,
      sanitized: true,
    }
  })()`
}

export function prepareFaultRecoveryScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedFileId = JSON.stringify(fileId)
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const fileId = ${serializedFileId}
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout preparazione fault recovery: ' + label)
    }
    const editorNavigation = await waitFor(() => [...document.querySelectorAll('[aria-label="Sezioni applicazione"] [role="tab"]')]
      .find((element) => element.textContent?.trim() === 'Editor'), 'navigazione Editor')
    editorNavigation.click()
    const projectEditor = await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor progetto')
    const fileEntry = await waitFor(() => [...projectEditor.querySelectorAll('[data-workspace-context-id]')]
      .find((element) => element.getAttribute('data-workspace-context-id') === fileId), 'file README')
    fileEntry.click()
    await waitFor(() => [...projectEditor.querySelectorAll('[aria-label="File aperti"] [role="tab"]')]
      .find((element) => element.textContent?.includes(fileId)), 'tab README')
    const sourceToggle = await waitFor(() => [...projectEditor.querySelectorAll('button')]
      .find((element) => ['Mostra sorgente', 'Mostra anteprima'].includes(element.getAttribute('aria-label') ?? '')), 'toggle sorgente')
    if (sourceToggle.getAttribute('aria-label') === 'Mostra sorgente') sourceToggle.click()
    const content = await waitFor(() => projectEditor.querySelector('.cm-content[contenteditable="true"]'), 'CodeMirror editabile')
    content.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(content)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
    globalThis.__vincodelabFaultRecoveryToken = marker
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    return {
      baseline: content.textContent ?? '',
      editorFocused: document.activeElement === content,
      fileId,
      sourceMode: Boolean(projectEditor.querySelector('[aria-label="Mostra anteprima"]')),
    }
  })()`
}

export function visibleCodeMirrorTextMarker(marker) {
  if (typeof marker !== 'string') throw new TypeError('Marker fault recovery non valido.')
  return marker.replace(/^\r?\n/u, '')
}

export function confirmFaultRecoveryDraftScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedVisibleMarker = JSON.stringify(visibleCodeMirrorTextMarker(marker))
  const serializedFileId = JSON.stringify(fileId)
  const serializedResource = JSON.stringify(JSON.stringify(['workspace', fileId]))
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const visibleMarker = ${serializedVisibleMarker}
    const fileId = ${serializedFileId}
    const resource = ${serializedResource}
    const deadline = performance.now() + 10000
    let lastObservation = { draftCount: -1, draftContainsMarker: false, markerVisible: false, matchingIdentity: false, workspaceAvailable: false }
    while (performance.now() < deadline) {
      const editor = document.querySelector('[aria-label="Editor progetto"] .cm-content[contenteditable="true"]')
      const [activeWorkspace, drafts] = await Promise.all([
        window.vincodeLab?.workspace?.getActive?.(),
        window.vincodeLab?.volatileDrafts?.list?.(),
      ])
      const matchingIdentity = Array.isArray(drafts) ? drafts.find((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource) : null
      const mainDraft = Array.isArray(drafts) ? drafts.find((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource
        && draft.content.includes(marker)) : null
      lastObservation = {
        draftCount: Array.isArray(drafts) ? drafts.length : -1,
        draftContainsMarker: Boolean(matchingIdentity?.content?.includes(marker)),
        markerVisible: Boolean(editor?.textContent?.includes(visibleMarker)),
        matchingIdentity: Boolean(matchingIdentity),
        workspaceAvailable: Boolean(activeWorkspace?.path),
      }
      if (editor?.textContent?.includes(visibleMarker) && mainDraft) {
        return { fileId, mainRegistryMirrored: true, markerVisible: true }
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('La bozza non è stata specchiata nel registro main prima del crash: ' + JSON.stringify(lastObservation))
  })()`
}

export function exerciseReactViewCrashScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedVisibleMarker = JSON.stringify(visibleCodeMirrorTextMarker(marker))
  const serializedFileId = JSON.stringify(fileId)
  const serializedResource = JSON.stringify(JSON.stringify(['workspace', fileId]))
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const visibleMarker = ${serializedVisibleMarker}
    const fileId = ${serializedFileId}
    const resource = ${serializedResource}
    const deadline = performance.now() + 15000
    let lastObservation = null
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout verifica crash React locale: ' + label
        + (lastObservation ? '; stato: ' + JSON.stringify(lastObservation) : ''))
    }
    window.dispatchEvent(new CustomEvent('vincodelab:benchmark-view-fault', { detail: { viewName: 'Editor' } }))
    const notice = await waitFor(() => [...document.querySelectorAll('[role="alert"], [role="status"]')]
      .find((element) => element.textContent?.includes('Editor non è disponibile')
        && /Riferimento ERR-[A-F0-9]{6}/u.test(element.textContent ?? '')), 'fallback Editor')
    const correlationId = (notice.textContent ?? '').match(/Riferimento (ERR-[A-F0-9]{6})/u)?.[1]
    if (!correlationId) throw new Error('Correlation ID crash React locale assente.')
    if (/benchmark-react-secret|access_token|\/tmp\/vincodelab-private/iu.test(document.body?.innerText ?? '')) {
      throw new Error('Il crash React locale espone dettagli tecnici riservati.')
    }
    const navigation = document.querySelector('[aria-label="Sezioni applicazione"]')
    if (!navigation?.isConnected) throw new Error('La shell non è rimasta disponibile dopo il crash React locale.')
    const focusConfined = notice === document.activeElement || notice.contains(document.activeElement)
    const retry = [...notice.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Riprova')
    if (!retry) throw new Error('Recovery locale della vista assente.')
    retry.click()
    await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor rimontato')
    const restored = await waitFor(async () => {
      // Il refresh dello snapshot parent e il reset del boundary possono
      // produrre due commit consecutivi: rileggiamo sempre la vista connessa.
      const projectEditor = document.querySelector('[aria-label="Editor progetto"]')
      const codeMirrorContent = projectEditor?.querySelector('.cm-content')
      const editor = projectEditor?.querySelector('.cm-content[contenteditable="true"]')
      const sourceToggle = [...(projectEditor?.querySelectorAll('button') ?? [])]
        .find((button) => ['Mostra sorgente', 'Mostra anteprima'].includes(button.getAttribute('aria-label') ?? ''))
      const [activeWorkspace, drafts, session] = await Promise.all([
        window.vincodeLab?.workspace?.getActive?.(),
        window.vincodeLab?.volatileDrafts?.list?.(),
        window.vincodeLab?.workspaceSession?.get?.(),
      ])
      const matchingDraft = Array.isArray(drafts) && drafts.some((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource
        && draft.content.includes(marker))
      const openFiles = session?.state?.editor?.openFiles
      lastObservation = {
        activeFileMatches: session?.state?.editor?.activeFile?.id === fileId,
        codeMirrorFound: Boolean(codeMirrorContent),
        contentEditable: codeMirrorContent?.getAttribute('contenteditable') ?? null,
        editorFound: Boolean(editor),
        projectEditorConnected: Boolean(projectEditor?.isConnected),
        mainDraftCount: Array.isArray(drafts) ? drafts.length : -1,
        markerVisible: Boolean(editor?.textContent?.includes(visibleMarker)),
        matchingDraft: Boolean(matchingDraft),
        openFileCount: Array.isArray(openFiles) ? openFiles.length : -1,
        openFileMatches: Array.isArray(openFiles) && openFiles.some((file) => file?.id === fileId),
        sourceMode: sourceToggle?.getAttribute('aria-label') === 'Mostra anteprima',
      }
      return editor?.textContent?.includes(visibleMarker) ? editor : null
    }, 'bozza Editor recuperata')
    const probe = await window.vincodeLab?.benchmark?.probe?.()
    if (!probe?.ok || !restored) throw new Error('La chiamata successiva al crash React locale non è riuscita.')
    return {
      correlationId,
      fileId,
      focusConfined,
      markerRecovered: true,
      nextCallSucceeded: true,
      shellPreserved: true,
    }
  })()`
}

export function verifyFaultRecoveryScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedVisibleMarker = JSON.stringify(visibleCodeMirrorTextMarker(marker))
  const serializedFileId = JSON.stringify(fileId)
  const serializedResource = JSON.stringify(JSON.stringify(['workspace', fileId]))
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const visibleMarker = ${serializedVisibleMarker}
    const fileId = ${serializedFileId}
    const resource = ${serializedResource}
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout verifica fault recovery: ' + label)
    }
    if (globalThis.__vincodelabFaultRecoveryToken === marker) {
      throw new Error('Il contesto renderer non è stato sostituito dopo Page.crash.')
    }
    const editorNavigation = await waitFor(() => [...document.querySelectorAll('[aria-label="Sezioni applicazione"] [role="tab"]')]
      .find((element) => element.textContent?.trim() === 'Editor'), 'navigazione Editor')
    editorNavigation.click()
    const projectEditor = await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor progetto')
    const fileEntry = await waitFor(() => [...projectEditor.querySelectorAll('[data-workspace-context-id]')]
      .find((element) => element.getAttribute('data-workspace-context-id') === fileId), 'file README')
    fileEntry.click()
    await waitFor(() => [...projectEditor.querySelectorAll('[aria-label="File aperti"] [role="tab"]')]
      .find((element) => element.textContent?.includes(fileId)), 'tab README')
    const sourceToggle = await waitFor(() => [...projectEditor.querySelectorAll('button')]
      .find((element) => ['Mostra sorgente', 'Mostra anteprima'].includes(element.getAttribute('aria-label') ?? '')), 'toggle sorgente')
    if (sourceToggle.getAttribute('aria-label') === 'Mostra sorgente') sourceToggle.click()
    const restored = await waitFor(async () => {
      const editor = projectEditor.querySelector('.cm-content[contenteditable="true"]')
      if (!editor?.textContent?.includes(visibleMarker)) return null
      const activeWorkspace = await window.vincodeLab.workspace.getActive()
      const drafts = await window.vincodeLab.volatileDrafts.list()
      const mainDraft = drafts.find((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource
        && draft.content.includes(marker))
      return mainDraft ? { activeWorkspace: activeWorkspace?.path ?? null, mainDraft } : null
    }, 'marker recuperato')
    const probe = await window.vincodeLab?.benchmark?.probe?.()
    if (!probe?.ok) throw new Error('La chiamata successiva al crash renderer non è riuscita.')
    return {
      activeWorkspace: restored.activeWorkspace,
      fileId,
      mainRegistryRecovered: true,
      markerRecovered: true,
      nextCallSucceeded: true,
      rendererContextReplaced: true,
    }
  })()`
}

async function readFixtureAppLogs(root) {
  const queue = [root]
  const logFiles = []
  let visitedDirectories = 0
  while (queue.length > 0 && visitedDirectories < 256) {
    const directory = queue.shift()
    visitedDirectories += 1
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) queue.push(candidate)
      else if (entry.isFile() && (entry.name === 'app.log' || entry.name === 'app.log.1')) logFiles.push(candidate)
    }
  }
  if (logFiles.length === 0) throw new Error('Log applicazione isolato non trovato dopo il fault smoke.')
  let content = ''
  for (const filePath of logFiles.sort()) {
    if (Buffer.byteLength(content, 'utf8') >= MAX_FAULT_LOG_BYTES) break
    content += await readFile(filePath, 'utf8')
  }
  return content.slice(-MAX_FAULT_LOG_BYTES)
}

export function verifyFaultLogEvidence(content, { domainFailures = [], ipcCorrelationId, persistenceCorrelationId, reactViewCorrelationId }) {
  if (typeof content !== 'string' || !/^ERR-[A-F0-9]{6}$/u.test(ipcCorrelationId ?? '') || !/^ERR-[A-F0-9]{6}$/u.test(persistenceCorrelationId ?? '')) {
    throw new TypeError('Evidenza log fault non valida.')
  }
  if (/benchmark-secret|access_token|\/Users\/benchmark|\/tmp\/vincodelab-private|query\.sql|token=/iu.test(content)) {
    throw new Error('Il log fault contiene dettagli tecnici riservati.')
  }
  const records = content.split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
  const ipc = records.find((entry) => entry.event === 'ipc_handler_failed'
    && entry.code === 'BENCHMARK_IPC_REJECTION'
    && entry.category === 'timeout'
    && entry.correlationId === ipcCorrelationId)
  const persistence = records.find((entry) => entry.event === 'workspace_session_recovered'
    && entry.code === 'PERSISTENCE_SESSION_CORRUPT'
    && entry.correlationId === persistenceCorrelationId)
  const renderer = records.find((entry) => entry.event === 'renderer_process_gone'
    && entry.code === 'RENDERER_PROCESS_GONE'
    && /^ERR-[A-F0-9]{6}$/u.test(entry.correlationId ?? ''))
  const reactView = records.find((entry) => entry.event === 'renderer_user_error'
    && entry.component === 'view:editor'
    && entry.operation === 'render'
    && entry.correlationId === reactViewCorrelationId)
  const domainCorrelationsMatched = PACKAGED_DOMAIN_FAULTS.every((expected) => {
    const incident = domainFailures.find((candidate) => candidate?.fault === expected.fault)
    return Boolean(incident && records.some((entry) => entry.event === 'ipc_handler_failed'
      && entry.category === expected.category
      && entry.code === expected.code
      && entry.correlationId === incident.correlationId))
  })
  if (!ipc || !persistence || !renderer || !reactView || !domainCorrelationsMatched) throw new Error('Correlation ID fault non ritrovati nel log applicazione isolato.')
  return {
    correlationsMatched: true,
    domainCorrelationsMatched: true,
    privateDataAbsent: true,
    rendererCorrelationId: renderer.correlationId,
  }
}

function cappedAppend(current, chunk) {
  if (Buffer.byteLength(current, 'utf8') >= MAX_DIAGNOSTIC_BYTES) return current
  return `${current}${chunk}`.slice(0, MAX_DIAGNOSTIC_BYTES)
}

function timeoutPromise(milliseconds, message) {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    timer.unref?.()
  })
}

function unrefDelay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref?.()
  })
}

async function reconnectAfterRendererCrash({ childState, expression, port, signal, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    let candidate
    try {
      const target = await waitForDebugger(port, deadline, childState, signal)
      candidate = createCdpClient(target.webSocketDebuggerUrl)
      await Promise.race([
        candidate.send('Runtime.enable'),
        timeoutPromise(Math.min(1_500, Math.max(1, deadline - Date.now())), 'Timeout connessione al renderer recuperato.'),
      ])
      const result = await Promise.race([
        candidate.evaluate(expression),
        timeoutPromise(Math.max(1, deadline - Date.now()), 'Timeout scenario sul renderer recuperato.'),
      ])
      return { cdp: candidate, result }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      candidate?.close()
      if (Date.now() < deadline) await delay(100)
    }
  }
  throw new Error(`Renderer non recuperato dopo Page.crash${lastError ? `: ${lastError.message}` : '.'}`)
}

async function processGroupMembers(processGroupId) {
  const output = await new Promise((resolve) => {
    const child = spawn('/bin/ps', ['-axo', 'pid=,pgid='], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.once('close', () => resolve(stdout))
    child.once('error', () => resolve(''))
  })
  return String(output).split('\n').map((line) => line.trim().split(/\s+/u).map(Number))
    .filter(([pid, pgid]) => Number.isInteger(pid) && pgid === processGroupId)
    .map(([pid]) => pid)
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

async function waitForNoProcessGroup(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const members = await processGroupMembers(processGroupId)
    if (members.length === 0) return []
    await delay(50)
  }
  return processGroupMembers(processGroupId)
}

async function shutdownChild({ cdp, child, childExited, childState }) {
  let graceful = childState.exited
  if (!childState.exited && cdp) {
    try {
      await Promise.race([
        cdp.evaluate('window.vincodeLab?.benchmark?.shutdown()'),
        timeoutPromise(3_000, 'Timeout richiesta shutdown.'),
      ])
    } catch {}
  }
  cdp?.close()
  if (!childState.exited) {
    await Promise.race([childExited.then(() => { graceful = true }), unrefDelay(8_000)])
  }
  if (!childState.exited) {
    signalProcessGroup(child.pid, 'SIGTERM')
    await Promise.race([childExited, unrefDelay(2_000)])
  }
  if (!childState.exited) {
    signalProcessGroup(child.pid, 'SIGKILL')
    await Promise.race([childExited, unrefDelay(1_000)])
  }
  let remaining = await waitForNoProcessGroup(child.pid, 2_000)
  if (remaining.length > 0) {
    signalProcessGroup(child.pid, 'SIGKILL')
    remaining = await waitForNoProcessGroup(child.pid, 1_000)
  }
  return { graceful, remainingProcesses: remaining }
}

function relativeBundlePath(appPath, filePath) {
  return path.relative(appPath, filePath).split(path.sep).join('/')
}

export async function runPackagedSmoke({ appPath, faultRecovery = false, timeoutMs = DEFAULT_TIMEOUT_MS, signal, withoutPi = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('Lo smoke del bundle macOS richiede macOS.')
  const bundle = await validatePackagedApp(appPath)
  const fixture = await createSmokeFixture()
  const startedAt = Date.now()
  let child
  let cdp
  let childExited
  let childState
  let stderr = ''
  let primaryError
  let renderer
  let cleanMachineSummary
  let faultRecoverySummary
  let cleanup
  let stage = 'avvio bundle'
  try {
    throwIfAborted(signal)
    const port = await reserveLoopbackPort()
    child = spawn(bundle.executable, packagedElectronArguments({ faultRecovery, port, profile: fixture.profile, withoutPi, workspace: fixture.workspace }), {
      cwd: fixture.workspace,
      detached: true,
      env: isolatedEnvironment(fixture, { withoutPi }),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    childState = { code: null, error: null, exited: false, signal: null }
    childExited = new Promise((resolve) => {
      const settle = () => {
        if (childState.exited) return
        childState.exited = true
        resolve()
      }
      child.once('error', (error) => {
        childState.error = error
        settle()
      })
      child.once('exit', (code, exitSignal) => {
        childState.code = code
        childState.signal = exitSignal
        settle()
      })
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr = cappedAppend(stderr, chunk) })
    stage = 'connessione DevTools iniziale'
    const target = await waitForDebugger(port, Date.now() + timeoutMs, childState, signal)
    cdp = createCdpClient(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    stage = 'verifica renderer iniziale'
    renderer = await Promise.race([
      cdp.evaluate(rendererSmokeScenario()),
      timeoutPromise(timeoutMs, 'Timeout verifica renderer.'),
    ])
    if (renderer.activeWorkspace !== fixture.workspace) throw new Error('Il renderer non usa il workspace temporaneo richiesto.')
    if (renderer.preferenceDefinitions < 1) throw new Error('Il bridge preferenze non ha restituito lo schema atteso.')
    if (withoutPi) {
      stage = 'verifica macchina pulita senza Pi'
      cleanMachineSummary = await Promise.race([
        cdp.evaluate(verifyCleanMachineScenario()),
        timeoutPromise(timeoutMs, 'Timeout verifica macchina pulita.'),
      ])
      if (cleanMachineSummary.activeWorkspace !== fixture.workspace
        || cleanMachineSummary.piState !== 'missing'
        || !cleanMachineSummary.databaseDriversReady
        || !cleanMachineSummary.redisClientReady
        || !cleanMachineSummary.navigationPreserved
        || cleanMachineSummary.nodeState !== 'missing'
        || !cleanMachineSummary.npmOptional
        || cleanMachineSummary.npmState !== 'missing'
        || !cleanMachineSummary.sanitized) {
        throw new Error('Degradazione su macchina pulita non confermata.')
      }
    }
    if (faultRecovery) {
      stage = 'fault IPC rejection'
      const ipcRejection = await Promise.race([
        cdp.evaluate(exerciseIpcRejectionScenario()),
        timeoutPromise(timeoutMs, 'Timeout fault IPC rejection.'),
      ])
      if (!ipcRejection.nextCallSucceeded || !ipcRejection.sanitized) throw new Error('Recovery IPC rejection non confermato.')

      stage = 'fault di dominio'
      const domainFailures = await Promise.race([
        cdp.evaluate(exerciseDomainFailureScenarios()),
        timeoutPromise(timeoutMs, 'Timeout fault di dominio.'),
      ])
      if (!domainFailures.nextCallsSucceeded || domainFailures.incidents.length !== PACKAGED_DOMAIN_FAULTS.length) {
        throw new Error('Recovery dei failure di dominio non confermato.')
      }

      stage = 'preparazione persistenza corrotta'
      const persistenceArmed = await Promise.race([
        cdp.evaluate(armPersistenceCorruptionScenario()),
        timeoutPromise(timeoutMs, 'Timeout preparazione fault persistenza.'),
      ])
      if (!persistenceArmed.armed) throw new Error('Fault persistenza non armato.')
      await cdp.send('Page.reload')
      cdp.close()
      cdp = undefined
      stage = 'recovery persistenza corrotta'
      const persistenceRecovered = await reconnectAfterRendererCrash({
        childState,
        expression: verifyPersistenceRecoveryScenario(),
        port,
        signal,
        timeoutMs,
      })
      cdp = persistenceRecovered.cdp
      if (!persistenceRecovered.result.noticeVisible || !persistenceRecovered.result.noticeDismissed
        || !persistenceRecovered.result.nextCallSucceeded || !persistenceRecovered.result.persistenceWriteSucceeded) {
        throw new Error('Recovery persistenza corrotta non confermato.')
      }

      stage = 'preparazione bozza Editor'
      const marker = `\n<!-- vincodelab-renderer-recovery-${process.pid}-${Date.now()} -->`
      const prepared = await Promise.race([
        cdp.evaluate(prepareFaultRecoveryScenario(marker)),
        timeoutPromise(timeoutMs, 'Timeout preparazione bozza per fault recovery.'),
      ])
      if (!prepared.editorFocused || !prepared.sourceMode || !prepared.baseline.includes('VincodeLab packaged smoke')) {
        throw new Error('README non pronto in modalità sorgente prima del fault injection.')
      }
      await cdp.send('Input.insertText', { text: marker })
      stage = 'mirroring bozza Editor'
      const mirrored = await Promise.race([
        cdp.evaluate(confirmFaultRecoveryDraftScenario(marker)),
        timeoutPromise(timeoutMs, 'Timeout mirroring bozza prima del crash.'),
      ])
      if (!mirrored.mainRegistryMirrored || !mirrored.markerVisible) throw new Error('Bozza fault recovery non confermata prima del crash.')

      stage = 'crash React locale'
      const reactViewCrash = await Promise.race([
        cdp.evaluate(exerciseReactViewCrashScenario(marker)),
        timeoutPromise(timeoutMs, 'Timeout crash React locale.'),
      ])
      if (!reactViewCrash.focusConfined || !reactViewCrash.markerRecovered
        || !reactViewCrash.nextCallSucceeded || !reactViewCrash.shellPreserved) {
        throw new Error('Recovery del crash React locale non confermato.')
      }

      stage = 'crash renderer Page.crash'
      await cdp.send('Inspector.enable')
      const crashRequested = cdp.send('Page.crash').catch(() => undefined)
      await Promise.race([
        cdp.crashed,
        cdp.closed,
        crashRequested.then(() => Promise.race([cdp.crashed, cdp.closed])),
        timeoutPromise(5_000, 'Page.crash non ha terminato il renderer.'),
      ])
      cdp.close()
      cdp = undefined

      stage = 'recovery renderer dopo Page.crash'
      const recovered = await reconnectAfterRendererCrash({
        childState,
        expression: verifyFaultRecoveryScenario(marker),
        port,
        signal,
        timeoutMs,
      })
      cdp = recovered.cdp
      if (recovered.result.activeWorkspace !== fixture.workspace) throw new Error('Il renderer recuperato ha perso il workspace temporaneo.')
      if (!recovered.result.mainRegistryRecovered || !recovered.result.markerRecovered || !recovered.result.rendererContextReplaced) {
        throw new Error('Il renderer recuperato non ha ripristinato la bozza dal registro main.')
      }
      stage = 'verifica file persistito'
      const persistedReadme = await readFile(path.join(fixture.workspace, FAULT_RECOVERY_FILE_ID), 'utf8')
      if (persistedReadme !== FAULT_RECOVERY_BASELINE) throw new Error('Il fault recovery ha scritto la bozza sul file senza richiesta.')
      faultRecoverySummary = {
        attempted: true,
        domainFailures,
        file: FAULT_RECOVERY_FILE_ID,
        ipcRejection,
        mainRegistryRecovered: true,
        markerRecovered: true,
        persistence: persistenceRecovered.result,
        persistedFileUnchanged: true,
        reactViewCrash,
        rendererCrash: {
          mainRegistryRecovered: true,
          markerRecovered: true,
          nextCallSucceeded: recovered.result.nextCallSucceeded,
          rendererContextReplaced: true,
        },
        rendererContextReplaced: true,
      }
    }
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error))
    const runtimeDiagnostic = cdp?.diagnostics?.().join(' | ')
      .replace(/\b(?:password|passwd|pwd|token|secret|authorization|cookie|api[-_ ]?key)\b\s*[:=]\s*[^\s,;|]+/giu, '[SECRET REDACTED]')
      .replace(/\/(?:Users|home|tmp|private\/tmp|var\/folders)(?:\/[^\s:|)\]]*)?/gu, '[PATH REDACTED]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[EMAIL REDACTED]')
      .slice(0, 4_000)
    primaryError = new Error(`${stage}: ${cause.message}${runtimeDiagnostic ? `; diagnostica renderer: ${runtimeDiagnostic}` : ''}`, { cause })
  } finally {
    try {
      if (child && childExited && childState) {
        cleanup = await shutdownChild({ cdp, child, childExited, childState })
        if (faultRecoverySummary) {
          const logEvidence = verifyFaultLogEvidence(await readFixtureAppLogs(fixture.root), {
            domainFailures: faultRecoverySummary.domainFailures.incidents,
            ipcCorrelationId: faultRecoverySummary.ipcRejection.correlationId,
            persistenceCorrelationId: faultRecoverySummary.persistence.correlationId,
            reactViewCorrelationId: faultRecoverySummary.reactViewCrash.correlationId,
          })
          faultRecoverySummary.logs = logEvidence
          faultRecoverySummary.rendererCrash.correlationId = logEvidence.rendererCorrelationId
        }
      }
    } catch (error) {
      primaryError ??= error instanceof Error ? error : new Error(String(error))
    }
    child?.stderr?.destroy()
    try {
      await cleanupSmokeFixture(fixture)
    } catch (error) {
      primaryError ??= error instanceof Error ? error : new Error(String(error))
    }
  }

  if (!cleanup || cleanup.remainingProcesses.length > 0) {
    const detail = cleanup ? cleanup.remainingProcesses.join(', ') : 'stato sconosciuto'
    primaryError ??= new Error(`Cleanup processi incompleto: ${detail}.`)
  }
  if (!primaryError && !cleanup.graceful) primaryError = new Error('Il bundle ha richiesto una terminazione forzata durante il cleanup.')
  if (primaryError) {
    const diagnostic = stderr.trim().slice(0, 2_000)
    throw new Error(`${primaryError.message}${diagnostic ? `; stderr Electron: ${diagnostic}` : ''}`, { cause: primaryError })
  }

  const { activeWorkspace: _activeWorkspace, ...rendererSummary } = renderer
  const { activeWorkspace: _cleanMachineActiveWorkspace, ...cleanMachineResult } = cleanMachineSummary ?? {}

  return {
    durationMs: Date.now() - startedAt,
    nativeModules: {
      betterSqlite3: relativeBundlePath(bundle.appPath, bundle.nativeModules.betterSqlite3),
      nodePty: relativeBundlePath(bundle.appPath, bundle.nativeModules.nodePty),
      spawnHelper: relativeBundlePath(bundle.appPath, bundle.nativeModules.spawnHelper),
    },
    network: { externalRequestsBlocked: true, inspector: 'loopback-only' },
    ok: true,
    processCleanup: cleanup,
    renderer: { ...rendererSummary, activeWorkspaceMatchesFixture: true },
    ...(cleanMachineSummary ? { cleanMachine: { ...cleanMachineResult, activeWorkspaceMatchesFixture: true } } : {}),
    ...(faultRecoverySummary ? { faultRecovery: faultRecoverySummary } : {}),
    temporaryDataRemoved: true,
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const controller = new AbortController()
  const interrupt = (signalName) => controller.abort(new Error(`Smoke interrotto da ${signalName}.`))
  const onSigint = () => interrupt('SIGINT')
  const onSigterm = () => interrupt('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  try {
    const appPath = await resolvePackagedApp({ appPath: options.appPath })
    const result = await runPackagedSmoke({ appPath, faultRecovery: options.faultRecovery, signal: controller.signal, timeoutMs: options.timeoutMs, withoutPi: options.withoutPi })
    process.stdout.write(`${JSON.stringify(result, null, options.json ? 0 : 2)}\n`)
  } finally {
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[packaged-macos-smoke] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
