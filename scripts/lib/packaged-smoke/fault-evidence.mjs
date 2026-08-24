import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PACKAGED_DOMAIN_FAULTS } from './fault-scenarios.mjs'

const MAX_FAULT_LOG_BYTES = 512 * 1024

export async function readFixtureAppLogs(root) {
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
