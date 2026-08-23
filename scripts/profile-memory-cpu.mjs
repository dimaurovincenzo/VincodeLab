#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
const SHUTDOWN_TIMEOUT_MS = 12_000
const STDERR_LIMIT_BYTES = 32 * 1024
const HARNESS_NAME = '__vincodelabAcceleratedReliabilityProfile'
export const MEMORY_CPU_PROFILE_OFFLINE_FLAGS = Object.freeze([
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
])

const PRIVATE_ENVIRONMENT_KEYS = Object.freeze([
  'AWS_ACCESS_KEY_ID',
  'AWS_PROFILE',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'DATABASE_URL',
  'GH_ENTERPRISE_TOKEN',
  'GH_HOST',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'SSH_AGENT_PID',
  'SSH_AUTH_SOCK',
  'VITE_DEV_SERVER_URL',
])

export function isolatedMemoryCpuProfileEnvironment(baseEnvironment, fixture) {
  const environment = {
    ...baseEnvironment,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
    HOME: fixture.homeDirectory,
    USERPROFILE: fixture.homeDirectory,
    VINCODELAB_DATA_DIR: fixture.dataDirectory,
    VINCODELAB_PI_PATH: fixture.fakePi,
    XDG_CACHE_HOME: fixture.cacheDirectory,
    XDG_CONFIG_HOME: fixture.configDirectory,
  }
  for (const key of PRIVATE_ENVIRONMENT_KEYS) delete environment[key]
  return environment
}

export async function cleanupMemoryCpuProfileFixture(root) {
  const resolvedRoot = path.resolve(root)
  const temporaryRoot = path.resolve(os.tmpdir())
  if (!resolvedRoot.startsWith(`${temporaryRoot}${path.sep}`)
    || !path.basename(resolvedRoot).startsWith('vincodelab-memory-cpu-')) {
    throw new Error('Directory temporanea del profilo non valida.')
  }
  await rm(resolvedRoot, { recursive: true, force: true })
}

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

export function rendererHarnessSource() {
  return String.raw`(() => {
    if (window.${HARNESS_NAME}) return true
    const counts = { viewChanges: 0, commandPaletteCycles: 0, quickOpenCycles: 0, uiCycles: 0 }
    const viewLabels = ['Editor', 'Database']
    let viewIndex = 0
    const waitFor = async (predicate, label, timeoutMs = 15000) => {
      const deadline = performance.now() + timeoutMs
      while (performance.now() < deadline) {
        const value = predicate()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      throw new Error('Timeout profilo UI: ' + label)
    }
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const settle = async () => { await nextFrame(); await nextFrame() }
    const navigation = () => document.querySelector('[aria-label="Sezioni applicazione"]')
    const tabFor = (label) => [...(navigation()?.querySelectorAll('[role="tab"]') ?? [])]
      .find((item) => item.textContent?.trim() === label)
    const viewReady = (label) => {
      const selector = label === 'Editor' ? '[aria-label="Editor progetto"]' : '[aria-label="Database workspace"]'
      const element = document.querySelector(selector)
      return Boolean(element) && (label !== 'Database' || element.getAttribute('aria-busy') !== 'true')
    }
    const clickView = async (label, track) => {
      const tab = await waitFor(() => tabFor(label), 'tab ' + label)
      tab.click()
      await waitFor(() => tabFor(label)?.getAttribute('aria-selected') === 'true', 'selezione ' + label)
      await waitFor(() => viewReady(label), 'vista ' + label)
      await settle()
      if (track) counts.viewChanges += 1
    }
    const openDialog = () => document.querySelector('[data-scope="dialog"][data-part="content"][role="dialog"][data-state="open"]')
    const setInputValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setter) setter.call(input, value)
      else input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const closeDialog = async () => {
      const dialog = openDialog()
      if (!dialog) return
      const target = document.activeElement ?? dialog
      const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
      Object.defineProperties(escape, {
        keyCode: { get: () => 27 },
        which: { get: () => 27 },
      })
      target.dispatchEvent(escape)
      // Lo stato React/Ark cambia in modo asincrono. Aspetta prima di usare il
      // fallback pointer, altrimenti un pointerdown senza pointerup lascia i
      // listener once di interact-outside attivi e falsifica il profilo heap.
      await settle()
      const backdrop = document.querySelector('[data-scope="dialog"][data-part="backdrop"]')
      if (backdrop && openDialog()) {
        backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
        backdrop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
      await waitFor(() => !openDialog(), 'chiusura dialog')
      await settle()
    }
    const overlayCycle = async (command, counter, track) => {
      const bridge = window.vincodeLab?.benchmark
      if (!bridge) throw new Error('Bridge benchmark non disponibile.')
      await bridge.dispatchCommand(command)
      const dialog = await waitFor(openDialog, command)
      const input = dialog.querySelector('input[role="combobox"], input')
      if (input) {
        input.focus()
        setInputValue(input, 'profilo-' + String(counts.uiCycles % 7))
        await nextFrame()
      }
      await closeDialog()
      if (track) counts[counter] += 1
    }
    const snapshot = () => ({ ...counts, activeView: viewLabels[viewIndex], dialogOpen: Boolean(openDialog()) })
    const warmup = async () => {
      await waitFor(navigation, 'workbench')
      await overlayCycle('workbench.commandPalette', 'commandPaletteCycles', false)
      await overlayCycle('workbench.quickOpen', 'quickOpenCycles', false)
      await new Promise((resolve) => setTimeout(resolve, 500))
      await clickView('Editor', false)
      await clickView('Database', false)
      await clickView('Editor', false)
      viewIndex = 0
      return snapshot()
    }
    const run = async (cycles, operationSet = 'combined') => {
      if (!['combined', 'control', 'views', 'command-palette', 'quick-open'].includes(operationSet)) throw new Error('Set operazioni UI non valido.')
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        if (operationSet === 'control') {
          // Otto frame approssimano il tempo dei tre percorsi UI combinati senza
          // creare dialog, cambiare vista o avviare IPC. Restano invece identici
          // Runtime.evaluate, checkpoint CDP e GC del processo di misura.
          await settle()
          await settle()
          await settle()
          await settle()
        }
        if (operationSet === 'combined' || operationSet === 'views') {
          viewIndex = viewIndex === 0 ? 1 : 0
          await clickView(viewLabels[viewIndex], true)
        }
        if (operationSet === 'combined' || operationSet === 'command-palette') {
          await overlayCycle('workbench.commandPalette', 'commandPaletteCycles', true)
        }
        if (operationSet === 'combined' || operationSet === 'quick-open') {
          await overlayCycle('workbench.quickOpen', 'quickOpenCycles', true)
        }
        counts.uiCycles += 1
        if (cycle % 5 === 4) await settle()
      }
      return snapshot()
    }
    const cleanup = async () => {
      await closeDialog()
      await clickView('Editor', false)
      viewIndex = 0
      await settle()
      await settle()
      return snapshot()
    }
    const reset = () => {
      counts.viewChanges = 0
      counts.commandPaletteCycles = 0
      counts.quickOpenCycles = 0
      counts.uiCycles = 0
      return snapshot()
    }
    window.${HARNESS_NAME} = Object.freeze({ cleanup, reset, run, warmup })
    return true
  })()`
}

function round(value, digits = 3) {
  const multiplier = 10 ** digits
  return Math.round(value * multiplier) / multiplier
}

function performanceMetric(metrics, name) {
  return metrics.metrics.find((metric) => metric.name === name)?.value ?? null
}

async function readProcessTable() {
  const output = await new Promise((resolve, reject) => {
    const child = spawn('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,rss='], {
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let value = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { value += chunk })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(value) : reject(new Error(`ps terminato con codice ${code}.`)))
  })
  return String(output).trim().split('\n').map((line) => {
    const [pid, ppid, cpuPercent, rssKiB] = line.trim().split(/\s+/u).map(Number)
    return { cpuPercent, pid, ppid, rssBytes: rssKiB * 1024 }
  }).filter((row) => Number.isInteger(row.pid) && Number.isInteger(row.ppid) && Number.isFinite(row.cpuPercent) && Number.isFinite(row.rssBytes))
}

function summarizeProcesses(rows) {
  return {
    cpuPercent: round(rows.reduce((total, row) => total + row.cpuPercent, 0)),
    processCount: rows.length,
    rssBytes: rows.reduce((total, row) => total + row.rssBytes, 0),
  }
}

async function processTreeMetrics(rootPid) {
  const rows = await readProcessTable()
  const pids = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) {
        pids.add(row.pid)
        changed = true
      }
    }
  }
  const owned = rows.filter((row) => pids.has(row.pid))
  return { metrics: summarizeProcesses(owned), pids: owned.map((row) => row.pid) }
}

async function knownProcessMetrics(pids) {
  const rows = await readProcessTable()
  return summarizeProcesses(rows.filter((row) => pids.has(row.pid)))
}

async function eventListenerInventory(cdp, expression, depth) {
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression,
    objectGroup: 'memory-cpu-listener-inventory',
    returnByValue: false,
  })
  const objectId = evaluated.result?.objectId
  if (!objectId) return { total: 0, types: {} }
  try {
    const { listeners = [] } = await cdp.send('DOMDebugger.getEventListeners', { depth, objectId, pierce: true })
    const types = {}
    for (const listener of listeners) types[listener.type] = (types[listener.type] ?? 0) + 1
    return {
      total: listeners.length,
      types: Object.fromEntries(Object.entries(types).sort(([left], [right]) => left.localeCompare(right))),
    }
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'memory-cpu-listener-inventory' })
  }
}

async function collectEventListenerInventory(cdp) {
  const [documentTree, window] = await Promise.all([
    eventListenerInventory(cdp, 'document', -1),
    eventListenerInventory(cdp, 'globalThis', 0),
  ])
  return { documentTree, window }
}

async function collectCheckpoint(cdp, rootPid, label, cycles) {
  const application = await cdp.evaluate(`(() => {
    let history = { commands: 0, files: 0 }
    try {
      const value = JSON.parse(window.localStorage.getItem('vincodelab.workbench-history.v1') ?? 'null')
      history = {
        commands: Array.isArray(value?.commands) ? value.commands.length : 0,
        files: Array.isArray(value?.files) ? value.files.length : 0,
      }
    } catch {}
    return {
      connectedElements: document.querySelectorAll('*').length,
      history,
      openDialogs: document.querySelectorAll('[role="dialog"][data-state="open"]').length,
    }
  })()`)
  await cdp.send('HeapProfiler.collectGarbage')
  const [dom, heap, rendererPerformance, processes] = await Promise.all([
    cdp.send('Memory.getDOMCounters'),
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Performance.getMetrics'),
    processTreeMetrics(rootPid),
  ])
  const eventListenerInventory = await collectEventListenerInventory(cdp)
  return {
    checkpoint: {
      cycles,
      dom: {
        connectedElements: application.connectedElements,
        documents: dom.documents,
        eventListeners: dom.jsEventListeners,
        historyCommands: application.history.commands,
        historyFiles: application.history.files,
        nodesIncludingRetained: dom.nodes,
        openDialogs: application.openDialogs,
      },
      label,
      listenerInventory: eventListenerInventory,
      process: processes.metrics,
      rendererHeap: {
        totalBytes: heap.totalSize,
        usedBytesAfterGc: heap.usedSize,
      },
      rendererTaskDurationSeconds: performanceMetric(rendererPerformance, 'TaskDuration'),
    },
    pids: processes.pids,
  }
}

function checkpointTrend(checkpoints, readValue) {
  const values = checkpoints.map((checkpoint) => readValue(checkpoint))
  const deltas = values.slice(1).map((value, index) => value - values[index])
  const xValues = checkpoints.map((checkpoint) => checkpoint.cycles)
  const xMean = xValues.reduce((total, value) => total + value, 0) / xValues.length
  const yMean = values.reduce((total, value) => total + value, 0) / values.length
  const denominator = xValues.reduce((total, value) => total + (value - xMean) ** 2, 0)
  const numerator = xValues.reduce((total, value, index) => total + (value - xMean) * (values[index] - yMean), 0)
  return {
    decreaseSteps: deltas.filter((delta) => delta < 0).length,
    flatSteps: deltas.filter((delta) => delta === 0).length,
    increaseSteps: deltas.filter((delta) => delta > 0).length,
    max: Math.max(...values),
    min: Math.min(...values),
    monotonicNonDecreasing: deltas.every((delta) => delta >= 0),
    netDelta: values.at(-1) - values[0],
    firstStepDelta: deltas[0] ?? 0,
    lastStepDelta: deltas.at(-1) ?? 0,
    lastToFirstGrowthRatio: deltas[0] > 0 ? round((deltas.at(-1) ?? 0) / deltas[0]) : null,
    slopePerCycle: denominator === 0 ? 0 : round(numerator / denominator),
  }
}

function blockGrowthComparison(checkpoints, readValue) {
  const first = checkpoints[0]
  const last = checkpoints.at(-1)
  const midpointCycles = last.cycles / 2
  const midpoint = checkpoints.find((checkpoint) => checkpoint.cycles === midpointCycles)
  if (!first || !last || !midpoint || midpoint === first || midpoint === last) return null
  const firstBlockDelta = readValue(midpoint) - readValue(first)
  const secondBlockDelta = readValue(last) - readValue(midpoint)
  return {
    firstBlock: { fromCycle: first.cycles, toCycle: midpoint.cycles, delta: firstBlockDelta },
    secondBlock: { fromCycle: midpoint.cycles, toCycle: last.cycles, delta: secondBlockDelta },
    secondToFirstGrowthRatio: firstBlockDelta > 0 ? round(secondBlockDelta / firstBlockDelta) : null,
  }
}

function summarizeRun(run) {
  const baseline = run.checkpoints[0]
  const afterOperations = run.checkpoints.at(-1)
  const heapTrend = checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.rendererHeap.usedBytesAfterGc)
  const rssTrend = checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.process.rssBytes)
  const processCounts = run.checkpoints.map((checkpoint) => checkpoint.process.processCount)
  return {
    cpu: {
      aggregateAfterOperationsPercent: run.postOperation.process.cpuPercent,
      aggregateAfterIdlePercent: run.postOperationIdle.process.cpuPercent,
      rendererDuringOperationsPercent: run.rendererCpu.duringOperationsPercent,
      rendererPostOperationPercent: run.rendererCpu.postOperationPercent,
    },
    heap: {
      afterCleanupBytes: run.afterCleanup.rendererHeap.usedBytesAfterGc,
      afterOperationsBytes: afterOperations.rendererHeap.usedBytesAfterGc,
      cleanupDeltaFromBaselineBytes: run.afterCleanup.rendererHeap.usedBytesAfterGc - baseline.rendererHeap.usedBytesAfterGc,
      cleanupRecoveredBytes: afterOperations.rendererHeap.usedBytesAfterGc - run.afterCleanup.rendererHeap.usedBytesAfterGc,
      growthBytes: afterOperations.rendererHeap.usedBytesAfterGc - baseline.rendererHeap.usedBytesAfterGc,
      blockComparison: blockGrowthComparison(run.checkpoints, (checkpoint) => checkpoint.rendererHeap.usedBytesAfterGc),
      trend: heapTrend,
    },
    rendererObjects: {
      connectedElementTrend: checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.dom.connectedElements),
      documentTrend: checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.dom.documents),
      eventListenerTrend: checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.dom.eventListeners),
      historyCommandTrend: checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.dom.historyCommands),
      historyFileTrend: checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.dom.historyFiles),
      retainedNodeTrend: checkpointTrend(run.checkpoints, (checkpoint) => checkpoint.dom.nodesIncludingRetained),
    },
    process: {
      afterCleanupCount: run.afterCleanup.process.processCount,
      afterOperationsCount: afterOperations.process.processCount,
      baselineCount: baseline.process.processCount,
      checkpointCountMax: Math.max(...processCounts),
      checkpointCountMin: Math.min(...processCounts),
      knownProcessesAfterShutdown: run.afterShutdown.processCount,
      rssAfterCleanupBytes: run.afterCleanup.process.rssBytes,
      rssAfterOperationsBytes: afterOperations.process.rssBytes,
      rssGrowthBytes: afterOperations.process.rssBytes - baseline.process.rssBytes,
      rssTrend,
    },
    signals: {
      cleanupReducedHeap: run.afterCleanup.rendererHeap.usedBytesAfterGc <= afterOperations.rendererHeap.usedBytesAfterGc,
      noKnownProcessesAfterShutdown: run.afterShutdown.processCount === 0,
      rendererHeapMonotonicGrowth: heapTrend.monotonicNonDecreasing && heapTrend.increaseSteps > 0,
      rendererHeapGrowthRateSlowed: heapTrend.firstStepDelta > 0 && heapTrend.lastStepDelta <= heapTrend.firstStepDelta * 0.25,
      rssMonotonicGrowth: rssTrend.monotonicNonDecreasing && rssTrend.increaseSteps > 0,
      stableProcessCountAfterWarmup: Math.min(...processCounts) === Math.max(...processCounts),
    },
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function summarizeReport(runs) {
  return {
    allOperationsCompleted: runs.every((run) => run.operations.viewChanges >= 100
      && run.operations.viewChanges === run.operations.commandPaletteCycles
      && run.operations.viewChanges === run.operations.quickOpenCycles),
    gracefulShutdownRuns: runs.filter((run) => run.shutdown.graceful).length,
    heapCleanupDeltaBytes: {
      max: Math.max(...runs.map((run) => run.summary.heap.cleanupDeltaFromBaselineBytes)),
      median: median(runs.map((run) => run.summary.heap.cleanupDeltaFromBaselineBytes)),
      min: Math.min(...runs.map((run) => run.summary.heap.cleanupDeltaFromBaselineBytes)),
    },
    knownResidualProcessRuns: runs.filter((run) => run.afterShutdown.processCount > 0).length,
    rendererHeapMonotonicGrowthRuns: runs.filter((run) => run.summary.signals.rendererHeapMonotonicGrowth).length,
    rssMonotonicGrowthRuns: runs.filter((run) => run.summary.signals.rssMonotonicGrowth).length,
    runs: runs.length,
    totalBlockedExternalRequests: runs.reduce((total, run) => total + run.isolation.blockedExternalRequests, 0),
  }
}

function expectedOperationCounts(operationSet, cycles) {
  return {
    commandPaletteCycles: operationSet === 'combined' || operationSet === 'command-palette' ? cycles : 0,
    quickOpenCycles: operationSet === 'combined' || operationSet === 'quick-open' ? cycles : 0,
    viewChanges: operationSet === 'combined' || operationSet === 'views' ? cycles : 0,
  }
}

export function evaluateMemoryCpuProfileRunContract(run, expectedOperations) {
  const failures = []
  if (run.isolation.blockedExternalRequests !== 0) failures.push('EXTERNAL_NETWORK_ATTEMPTED')
  if (!run.isolation.externalNetworkBlockedByCdp) failures.push('NETWORK_BLOCK_NOT_ACTIVE')
  if (!run.isolation.temporaryDataDirectory
    || !run.isolation.temporaryProfile
    || !run.isolation.temporaryWorkspace) failures.push('NON_TEMPORARY_INPUT')
  if (!run.isolation.userEnvironmentCredentialsRemoved) failures.push('USER_ENVIRONMENT_NOT_ISOLATED')
  if (!run.isolation.temporaryArtifactsRemoved) failures.push('TEMPORARY_ARTIFACTS_REMAIN')
  if (run.isolation.userFilesOpened !== 0) failures.push('USER_FILE_ACCESSED')
  if (run.afterShutdown.processCount !== 0) failures.push('RESIDUAL_PROCESS')
  if (!run.shutdown.graceful) failures.push('NON_GRACEFUL_SHUTDOWN')
  for (const [name, expected] of Object.entries(expectedOperations)) {
    if (run.operations[name] !== expected) failures.push('OPERATION_COUNT_MISMATCH')
  }
  return Object.freeze({ failures: Object.freeze([...new Set(failures)]), ok: failures.length === 0 })
}

export function serializeMemoryCpuProfileReport(report, forbiddenPaths = [PROJECT_ROOT, os.tmpdir()]) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (forbiddenPaths.some((forbiddenPath) => forbiddenPath && serialized.includes(path.resolve(forbiddenPath)))) {
    throw new Error('Il report contiene un percorso locale non consentito.')
  }
  return serialized
}

function summarizeSubsystemDiagnostics(runs) {
  const byOperationSet = Object.fromEntries(runs.map((run) => [run.operations.operationSet, {
    cleanupDeltaFromBaselineBytes: run.summary.heap.cleanupDeltaFromBaselineBytes,
    heapGrowthBytes: run.summary.heap.growthBytes,
    rendererHeapMonotonicGrowth: run.summary.signals.rendererHeapMonotonicGrowth,
    rssGrowthBytes: run.summary.process.rssGrowthBytes,
  }]))
  const heapRanking = Object.entries(byOperationSet)
    .sort((left, right) => right[1].heapGrowthBytes - left[1].heapGrowthBytes)
    .map(([operationSet, metrics]) => ({ operationSet, heapGrowthBytes: metrics.heapGrowthBytes }))
  return {
    byOperationSet,
    cyclesPerOperationSet: runs[0]?.operations.uiCycles ?? 0,
    freshElectronProcessPerOperationSet: true,
    largestObservedHeapGrowthSubsystem: heapRanking[0]?.operationSet ?? null,
    rankingByHeapGrowth: heapRanking,
  }
}

async function prepareFixture(root, dataDirectory) {
  const workspaceDirectory = path.join(root, 'workspace')
  const sqlitePath = path.join(root, 'fixture.sqlite')
  const fakePi = path.join(root, 'pi-fixture')
  await mkdir(path.join(workspaceDirectory, 'src'), { recursive: true })
  await mkdir(path.join(workspaceDirectory, 'docs'), { recursive: true })
  const workspace = await realpath(workspaceDirectory)
  const files = [
    writeFile(path.join(workspace, 'README.md'), '# Profilo memoria e CPU\n'),
    writeFile(path.join(workspace, 'src', 'index.ts'), 'export const fixture = true\n'),
    ...Array.from({ length: 32 }, (_, index) => writeFile(
      path.join(workspace, 'docs', `fixture-${String(index).padStart(2, '0')}.md`),
      `# Fixture ${index}\n\nContenuto locale deterministico.\n`,
    )),
  ]
  await Promise.all(files)
  await writeFile(fakePi, '#!/bin/sh\nexit 0\n')
  await chmod(fakePi, 0o700)

  const previousDataDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  const { createConnection } = require('../electron/database-store.cjs')
  const { closeDatabase } = require('../electron/workspace-store.cjs')
  try {
    createConnection(workspace, { name: 'Profilo SQLite locale', driver: 'sqlite', sqlitePath })
  } finally {
    closeDatabase()
    if (previousDataDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDataDirectory
  }
  return { fakePi, workspace }
}

function benchmarkTraces(stderr) {
  return stderr.split('\n').filter((line) => /^\[reliability-benchmark\] [a-z-]+$/u.test(line)).slice(-32)
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
