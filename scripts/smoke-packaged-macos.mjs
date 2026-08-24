#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { OFFLINE_CHROMIUM_FLAGS, resolvePackagedApp, validatePackagedApp } from './lib/packaged-electron.mjs'
import { rendererSmokeScenario, verifyCleanMachineScenario, verifyRedisSelectScenario } from './lib/packaged-smoke/baseline-scenarios.mjs'
import { readFixtureAppLogs, verifyFaultLogEvidence } from './lib/packaged-smoke/fault-evidence.mjs'
import {
  PACKAGED_DOMAIN_FAULTS,
  armPersistenceCorruptionScenario,
  confirmFaultRecoveryDraftScenario,
  exerciseDomainFailureScenarios,
  exerciseIpcRejectionScenario,
  exerciseReactViewCrashScenario,
  prepareFaultRecoveryScenario,
  verifyFaultRecoveryScenario,
  verifyPersistenceRecoveryScenario,
  visibleCodeMirrorTextMarker,
} from './lib/packaged-smoke/fault-scenarios.mjs'
import {
  FAULT_RECOVERY_BASELINE,
  FAULT_RECOVERY_FILE_ID,
  cleanupSmokeFixture,
  createSmokeFixture,
  isolatedEnvironment,
  packagedElectronArguments,
} from './lib/packaged-smoke/fixture.mjs'

const DEFAULT_TIMEOUT_MS = 25_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 60_000
const MAX_DIAGNOSTIC_BYTES = 32 * 1024

export { OFFLINE_CHROMIUM_FLAGS, resolvePackagedApp, validatePackagedApp }
export {
  PACKAGED_DOMAIN_FAULTS,
  armPersistenceCorruptionScenario,
  cleanupSmokeFixture,
  confirmFaultRecoveryDraftScenario,
  createSmokeFixture,
  exerciseDomainFailureScenarios,
  exerciseIpcRejectionScenario,
  exerciseReactViewCrashScenario,
  isolatedEnvironment,
  packagedElectronArguments,
  prepareFaultRecoveryScenario,
  verifyCleanMachineScenario,
  verifyFaultLogEvidence,
  verifyFaultRecoveryScenario,
  verifyPersistenceRecoveryScenario,
  verifyRedisSelectScenario,
  visibleCodeMirrorTextMarker,
}

function usage() {
  return [
    'Uso: node scripts/smoke-packaged-macos.mjs [opzioni]',
    '',
    'Opzioni:',
    '  --app <percorso.app>  Bundle già creato; default: release/mac*/VincodeLab.app',
    `  --timeout <ms>        Timeout avvio, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (default ${DEFAULT_TIMEOUT_MS})`,
    '  --fault-recovery      Verifica failure di dominio, persistenza e crash renderer con recovery',
    '  --redis-select        Verifica il select modalità Redis nel bundle reale',
    '  --without-pi          Verifica una macchina pulita senza Pi, Node o npm di sistema',
    '  --json                Output JSON compatto',
    '  --help                Mostra questo messaggio',
    '',
    'Lo script non crea il pacchetto e non usa profilo, workspace o rete dell’utente.',
  ].join('\n')
}

export function parseArguments(argumentsList) {
  const options = { appPath: null, faultRecovery: false, help: false, json: false, redisSelect: false, timeoutMs: DEFAULT_TIMEOUT_MS, withoutPi: false }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--app') {
      const value = argumentsList[++index]
      if (!value) throw new Error('Percorso --app mancante.')
      options.appPath = path.resolve(value)
    } else if (argument === '--timeout') {
      options.timeoutMs = Number(argumentsList[++index])
    } else if (argument === '--fault-recovery') options.faultRecovery = true
    else if (argument === '--redis-select') options.redisSelect = true
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

export async function runPackagedSmoke({ appPath, faultRecovery = false, redisSelect = false, timeoutMs = DEFAULT_TIMEOUT_MS, signal, withoutPi = false } = {}) {
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
  let redisSelectSummary
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
    if (redisSelect) {
      stage = 'verifica select modalità Redis'
      redisSelectSummary = await Promise.race([
        cdp.evaluate(verifyRedisSelectScenario()),
        timeoutPromise(timeoutMs, 'Timeout verifica select modalità Redis.'),
      ])
      if (!redisSelectSummary.attempted || !redisSelectSummary.dialogClosed || !redisSelectSummary.listboxVisible
        || !redisSelectSummary.popupAboveDialog || redisSelectSummary.popupZIndex <= redisSelectSummary.dialogZIndex
        || !redisSelectSummary.pointerHitTestPassed
        || redisSelectSummary.initialValue !== 'Standalone' || redisSelectSummary.selectedValue !== 'Sentinel'
        || !redisSelectSummary.sentinelFieldsVisible
        || !redisSelectSummary.optionLabels.includes('Standalone') || !redisSelectSummary.optionLabels.includes('Sentinel')) {
        throw new Error('Select modalità Redis non verificato nel bundle.')
      }
    }
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
        || !cleanMachineSummary.recoveryVisible
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
    ...(redisSelectSummary ? { redisSelect: redisSelectSummary } : {}),
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
    const result = await runPackagedSmoke({ appPath, faultRecovery: options.faultRecovery, redisSelect: options.redisSelect, signal: controller.signal, timeoutMs: options.timeoutMs, withoutPi: options.withoutPi })
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
