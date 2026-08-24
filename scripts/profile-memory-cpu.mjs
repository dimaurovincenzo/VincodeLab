#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MEMORY_CPU_PROFILE_OFFLINE_FLAGS,
  cleanupMemoryCpuProfileFixture,
  isolatedMemoryCpuProfileEnvironment,
  prepareFixture,
} from './lib/memory-cpu-profile/fixture.mjs'
import {
  benchmarkTraces,
  collectCheckpoint,
  evaluateMemoryCpuProfileRunContract,
  expectedOperationCounts,
  knownProcessMetrics,
  performanceMetric,
  processTreeMetrics,
  round,
  serializeMemoryCpuProfileReport,
  summarizeReport,
  summarizeRun,
  summarizeSubsystemDiagnostics,
} from './lib/memory-cpu-profile/measurement-report.mjs'
import { HARNESS_NAME, rendererHarnessSource } from './lib/memory-cpu-profile/renderer-harness.mjs'

const require = createRequire(import.meta.url)
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'electron')
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'docs', 'qa', 'reliability-memory-cpu.json')
const DEFAULT_CYCLES = 120
const DEFAULT_CHECKPOINT_EVERY = 20
const DEFAULT_RUNS = 1
const DEFAULT_IDLE_MS = 1_500
const DEFAULT_WARMUP_CYCLES = 20

export {
  MEMORY_CPU_PROFILE_OFFLINE_FLAGS,
  cleanupMemoryCpuProfileFixture,
  evaluateMemoryCpuProfileRunContract,
  isolatedMemoryCpuProfileEnvironment,
  rendererHarnessSource,
  serializeMemoryCpuProfileReport,
}

const SHUTDOWN_TIMEOUT_MS = 12_000
const STDERR_LIMIT_BYTES = 32 * 1024

export function parseMemoryCpuProfileArguments(argumentsList) {
  const options = {
    checkpointEvery: DEFAULT_CHECKPOINT_EVERY,
    cycles: DEFAULT_CYCLES,
    diagnoseSubsystems: false,
    idleMs: DEFAULT_IDLE_MS,
    output: DEFAULT_OUTPUT,
    runs: DEFAULT_RUNS,
    warmupCycles: DEFAULT_WARMUP_CYCLES,
  }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--cycles') options.cycles = Number(argumentsList[++index])
    else if (argument === '--checkpoint-every') options.checkpointEvery = Number(argumentsList[++index])
    else if (argument === '--diagnose-subsystems') options.diagnoseSubsystems = true
    else if (argument === '--idle-ms') options.idleMs = Number(argumentsList[++index])
    else if (argument === '--output') options.output = path.resolve(argumentsList[++index])
    else if (argument === '--runs') options.runs = Number(argumentsList[++index])
    else if (argument === '--warmup-cycles') options.warmupCycles = Number(argumentsList[++index])
    else throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  if (!Number.isInteger(options.cycles) || options.cycles < 100 || options.cycles > 1_000) {
    throw new Error('Il profilo richiede tra 100 e 1.000 cicli UI.')
  }
  if (!Number.isInteger(options.checkpointEvery) || options.checkpointEvery < 5 || options.checkpointEvery > options.cycles) {
    throw new Error('Intervallo checkpoint non valido.')
  }
  if (!Number.isInteger(options.idleMs) || options.idleMs < 500 || options.idleMs > 30_000) {
    throw new Error('Intervallo idle non valido.')
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 5) {
    throw new Error('Numero run non valido.')
  }
  if (!Number.isInteger(options.warmupCycles) || options.warmupCycles < 0 || options.warmupCycles > 100) {
    throw new Error('Numero cicli warm-up non valido.')
  }
  return options
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => finish(reject, new Error(`${label} oltre ${timeoutMs} ms.`)), timeoutMs)
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )
  })
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForDebugger(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)
      if (target) return target.webSocketDebuggerUrl
    } catch {}
    await delay(40)
  }
  throw new Error('Renderer Electron non disponibile entro il timeout.')
}

function createCdpClient(url) {
  const socket = new WebSocket(url)
  const listeners = new Map()
  const pending = new Map()
  let sequence = 0
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
      return
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {})
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('Connessione CDP chiusa.'))
    pending.clear()
  })
  const send = async (method, params = {}) => {
    await opened
    const id = ++sequence
    const response = new Promise((resolve, reject) => pending.set(id, { reject, resolve }))
    socket.send(JSON.stringify({ id, method, params }))
    return response
  }
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(description || 'Valutazione renderer fallita.')
    }
    return result.result.value
  }
  const on = (method, listener) => {
    const current = listeners.get(method) ?? new Set()
    current.add(listener)
    listeners.set(method, current)
    return () => current.delete(listener)
  }
  return { close: () => socket.close(), evaluate, on, send }
}

async function terminateChild(child, childExited) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try { child.kill('SIGTERM') } catch {}
  }
  await Promise.race([childExited, delay(1_000)])
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try { child.kill('SIGKILL') } catch {}
  }
  await Promise.race([childExited, delay(1_000)])
}

async function runOnce(runIndex, options, operationSet = 'combined') {
  const root = await mkdtemp(path.join(os.tmpdir(), `vincodelab-memory-cpu-${runIndex}-`))
  const dataDirectory = path.join(root, 'data')
  const homeDirectory = path.join(root, 'home')
  const profileDirectory = path.join(root, 'profile')
  const cacheDirectory = path.join(root, 'cache')
  const configDirectory = path.join(root, 'config')
  await Promise.all([dataDirectory, homeDirectory, profileDirectory, cacheDirectory, configDirectory]
    .map((directory) => mkdir(directory, { recursive: true })))
  let child
  let childExited
  let cdp
  let report
  try {
    const fixture = await prepareFixture(root, dataDirectory)
    const port = await reservePort()
    const childEnvironment = isolatedMemoryCpuProfileEnvironment(process.env, {
      cacheDirectory,
      configDirectory,
      dataDirectory,
      fakePi: fixture.fakePi,
      homeDirectory,
    })
    child = spawn(ELECTRON, [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDirectory}`,
      ...MEMORY_CPU_PROFILE_OFFLINE_FLAGS,
      '--reliability-benchmark',
      PROJECT_ROOT,
      '--workspace', fixture.workspace,
    ], {
      cwd: PROJECT_ROOT,
      detached: true,
      env: childEnvironment,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const startedAt = performance.now()
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr, 'utf8') < STDERR_LIMIT_BYTES) stderr += chunk
    })
    childExited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
    const knownPids = new Set([child.pid])
    const externalRequests = []

    cdp = createCdpClient(await waitForDebugger(port, Date.now() + 30_000))
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      try {
        const protocol = new URL(request.url).protocol
        if (protocol === 'http:' || protocol === 'https:' || protocol === 'ws:' || protocol === 'wss:') externalRequests.push(protocol)
      } catch {}
    })
    await Promise.all([
      cdp.send('Runtime.enable'),
      cdp.send('HeapProfiler.enable'),
      cdp.send('Performance.enable'),
      cdp.send('Network.enable'),
    ])
    await cdp.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] })
    await cdp.evaluate(rendererHarnessSource())
    await withTimeout(cdp.evaluate(`window.${HARNESS_NAME}.warmup()`), 30_000, 'Warm-up UI')
    if (options.warmupCycles > 0) {
      await withTimeout(cdp.evaluate(`window.${HARNESS_NAME}.run(${options.warmupCycles}, ${JSON.stringify(operationSet)})`), 60_000, 'Warm-up steady-state')
    }
    await cdp.evaluate(`window.${HARNESS_NAME}.reset()`)
    await delay(500)

    const checkpoints = []
    const baselineSample = await collectCheckpoint(cdp, child.pid, 'before-operations-after-gc', 0)
    checkpoints.push(baselineSample.checkpoint)
    for (const pid of baselineSample.pids) knownPids.add(pid)
    const baselineTaskDuration = baselineSample.checkpoint.rendererTaskDurationSeconds
    const operationsStarted = performance.now()
    let completedCycles = 0
    let operations
    while (completedCycles < options.cycles) {
      const segment = Math.min(options.checkpointEvery, options.cycles - completedCycles)
      operations = await withTimeout(
        cdp.evaluate(`window.${HARNESS_NAME}.run(${segment}, ${JSON.stringify(operationSet)})`),
        60_000,
        `Segmento UI ${completedCycles + 1}-${completedCycles + segment}`,
      )
      completedCycles += segment
      const sample = await collectCheckpoint(cdp, child.pid, `after-${completedCycles}-cycles-after-gc`, completedCycles)
      checkpoints.push(sample.checkpoint)
      for (const pid of sample.pids) knownPids.add(pid)
    }
    const operationsDurationMs = performance.now() - operationsStarted
    const expectedOperations = expectedOperationCounts(operationSet, options.cycles)
    if (operations.viewChanges !== expectedOperations.viewChanges
      || operations.commandPaletteCycles !== expectedOperations.commandPaletteCycles
      || operations.quickOpenCycles !== expectedOperations.quickOpenCycles
      || operations.uiCycles !== options.cycles
      || operations.dialogOpen) {
      throw new Error('Conteggio operazioni UI non corrispondente al profilo richiesto.')
    }

    const postOperationTree = await processTreeMetrics(child.pid)
    for (const pid of postOperationTree.pids) knownPids.add(pid)
    const postOperationPerformance = await cdp.send('Performance.getMetrics')
    const postOperationTaskDuration = performanceMetric(postOperationPerformance, 'TaskDuration')
    const idleStarted = performance.now()
    await delay(options.idleMs)
    const idleDurationMs = performance.now() - idleStarted
    const postIdlePerformance = await cdp.send('Performance.getMetrics')
    const postIdleTaskDuration = performanceMetric(postIdlePerformance, 'TaskDuration')
    const postIdleTree = await processTreeMetrics(child.pid)
    for (const pid of postIdleTree.pids) knownPids.add(pid)

    const cleanupState = await withTimeout(cdp.evaluate(`(async () => {
      const state = await window.${HARNESS_NAME}.cleanup()
      delete window.${HARNESS_NAME}
      return state
    })()`), 30_000, 'Cleanup UI')
    if (cleanupState.dialogOpen) throw new Error('Dialog residuo dopo cleanup UI.')
    await delay(250)
    const immediateCleanupSample = await collectCheckpoint(cdp, child.pid, 'after-cleanup-immediate-after-gc', options.cycles)
    for (const pid of immediateCleanupSample.pids) knownPids.add(pid)
    await delay(options.idleMs)
    const cleanupSample = await collectCheckpoint(cdp, child.pid, 'after-cleanup-settled-after-gc', options.cycles)
    for (const pid of cleanupSample.pids) knownPids.add(pid)

    const rendererDuringOperationsPercent = baselineTaskDuration === null || postOperationTaskDuration === null
      ? null
      : round(((postOperationTaskDuration - baselineTaskDuration) / (operationsDurationMs / 1_000)) * 100)
    const rendererPostOperationPercent = postOperationTaskDuration === null || postIdleTaskDuration === null
      ? null
      : round(((postIdleTaskDuration - postOperationTaskDuration) / (idleDurationMs / 1_000)) * 100)

    const shutdownStarted = performance.now()
    await withTimeout(cdp.evaluate('window.vincodeLab.benchmark.shutdown()'), SHUTDOWN_TIMEOUT_MS, 'Shutdown benchmark')
    const exit = await withTimeout(childExited, SHUTDOWN_TIMEOUT_MS, 'Exit Electron')
    const shutdownDurationMs = performance.now() - shutdownStarted
    await delay(250)
    const afterShutdown = await knownProcessMetrics(knownPids)
    const blockedExternalRequests = externalRequests.length

    report = {
      afterCleanup: cleanupSample.checkpoint,
      afterCleanupImmediate: immediateCleanupSample.checkpoint,
      afterShutdown,
      checkpoints,
      durationMs: performance.now() - startedAt,
      isolation: {
        blockedExternalRequests,
        externalNetworkBlockedByCdp: true,
        temporaryDataDirectory: true,
        temporaryProfile: true,
        temporaryWorkspace: true,
        userEnvironmentCredentialsRemoved: true,
        userFilesOpened: 0,
      },
      operations: {
        commandPaletteCycles: operations.commandPaletteCycles,
        durationMs: operationsDurationMs,
        operationSet,
        quickOpenCycles: operations.quickOpenCycles,
        uiCycles: operations.uiCycles,
        viewChanges: operations.viewChanges,
        views: ['Editor', 'Database'],
      },
      postOperation: { process: postOperationTree.metrics },
      postOperationIdle: { durationMs: idleDurationMs, process: postIdleTree.metrics },
      rendererCpu: {
        duringOperationsPercent: rendererDuringOperationsPercent,
        postOperationPercent: rendererPostOperationPercent,
        source: 'CDP Performance.TaskDuration',
      },
      run: runIndex,
      shutdown: {
        durationMs: shutdownDurationMs,
        exitCode: exit.code,
        graceful: exit.code === 0 && exit.signal === null,
        signal: exit.signal,
        traces: benchmarkTraces(stderr),
      },
    }
  } catch (error) {
    if (child && childExited) await terminateChild(child, childExited)
    throw error
  } finally {
    cdp?.close()
    if (child && childExited) await terminateChild(child, childExited)
    child?.stderr?.destroy()
    await cleanupMemoryCpuProfileFixture(root)
  }
  report.isolation.temporaryArtifactsRemoved = true
  report.contract = evaluateMemoryCpuProfileRunContract(report, expectedOperationCounts(operationSet, options.cycles))
  report.summary = summarizeRun(report)
  report.ok = report.contract.ok
  return report
}

async function candidateMetadata() {
  const renderer = await stat(path.join(PROJECT_ROOT, 'dist', 'index.html'))
  return {
    architecture: process.arch,
    electronVersion: require('electron/package.json').version,
    mode: 'unpackaged-development-candidate',
    nodeVersion: process.version,
    platform: process.platform,
    renderer: 'dist/index.html',
    rendererBuiltAt: renderer.mtime.toISOString(),
  }
}

export async function runMemoryCpuProfile(options) {
  const runs = []
  for (let runIndex = 1; runIndex <= options.runs; runIndex += 1) runs.push(await runOnce(runIndex, options, 'combined'))
  const subsystemRuns = []
  if (options.diagnoseSubsystems) {
    const diagnosticOptions = { ...options, cycles: 100 }
    for (const operationSet of ['control', 'views', 'command-palette', 'quick-open']) {
      subsystemRuns.push(await runOnce(`diagnostic-${operationSet}`, diagnosticOptions, operationSet))
    }
  }
  const subsystemDiagnostics = options.diagnoseSubsystems ? summarizeSubsystemDiagnostics(subsystemRuns) : null
  const summary = summarizeReport(runs)
  return {
    candidate: await candidateMetadata(),
    configuration: {
      checkpointEvery: options.checkpointEvery,
      cyclesPerRun: options.cycles,
      diagnoseSubsystems: options.diagnoseSubsystems,
      gc: 'CDP HeapProfiler.collectGarbage before every heap sample',
      idleAfterOperationsMs: options.idleMs,
      runs: options.runs,
      warmupCycles: options.warmupCycles,
    },
    generatedAt: new Date().toISOString(),
    limitations: [
      'Profilo accelerato e non soak: non dimostra stabilità su 8-12 ore.',
      'Il trend heap dopo GC evidenzia crescita monotona nel run, ma un singolo profilo non prova o esclude da solo un memory leak.',
      'La CPU aggregata deriva da ps ed è sensibile al carico del sistema; TaskDuration misura il main thread renderer, non GPU e helper.',
      'Il controllo processi post-shutdown verifica i PID osservati durante il run; child estremamente brevi tra due checkpoint possono non essere campionati.',
      'Il profilo evita terminale, GitHub e servizi remoti per non leggere configurazioni utente o produrre traffico di rete.',
    ],
    ok: runs.every((run) => run.ok) && subsystemRuns.every((run) => run.ok) && summary.allOperationsCompleted,
    runs,
    schemaVersion: 1,
    suite: 'accelerated-memory-cpu',
    subsystemDiagnostics: subsystemDiagnostics ? { ...subsystemDiagnostics, runs: subsystemRuns } : null,
    summary,
  }
}

async function main() {
  const options = parseMemoryCpuProfileArguments(process.argv.slice(2))
  const report = await runMemoryCpuProfile(options)
  const serialized = serializeMemoryCpuProfileReport(report)
  await mkdir(path.dirname(options.output), { recursive: true })
  await writeFile(options.output, serialized)
  process.stdout.write(serialized)
  if (!report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
