import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export function round(value, digits = 3) {
  const multiplier = 10 ** digits
  return Math.round(value * multiplier) / multiplier
}

export function performanceMetric(metrics, name) {
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

export async function processTreeMetrics(rootPid) {
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

export async function knownProcessMetrics(pids) {
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

export async function collectCheckpoint(cdp, rootPid, label, cycles) {
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

export function summarizeRun(run) {
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

export function summarizeReport(runs) {
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

export function expectedOperationCounts(operationSet, cycles) {
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

export function summarizeSubsystemDiagnostics(runs) {
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

export function benchmarkTraces(stderr) {
  return stderr.split('\n').filter((line) => /^\[reliability-benchmark\] [a-z-]+$/u.test(line)).slice(-32)
}
