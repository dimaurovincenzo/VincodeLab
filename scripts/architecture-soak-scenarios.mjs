import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { setImmediate as yieldImmediate } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { measureResultRows, RESULT_BYTE_LIMIT } = require('../electron/database-result-budget.cjs')
const { createShellSessionManager } = require('../electron/shell-session-manager.cjs')
const { SqliteWorkerSession, sqliteWorkerDiagnostics } = require('../electron/sqlite-worker-session.cjs')
const { TERMINAL_STREAM_LIMITS, createTerminalStreamController } = require('../electron/terminal-stream-controller.cjs')
const { activatePendingUpdates } = require('../electron/update-activation.cjs')
const { stageManagedUpdate } = require('../electron/update-downloader.cjs')
const { getManagedUpdate, recordAvailableUpdate, upsertManagedUpdate } = require('../electron/update-store.cjs')
const { closeDatabase, getDatabase } = require('../electron/workspace-store.cjs')
const {
  MAX_WORKSPACE_SESSION_BYTES,
  WORKSPACE_SESSION_VERSION,
  createDefaultWorkspaceSessionState,
  getWorkspaceSession,
  saveWorkspaceSession,
} = require('../electron/workspace-session-store.cjs')

const UNICODE_PATTERN = 'A🙂é中'
const UNICODE_PATTERN_BYTES = Buffer.byteLength(UNICODE_PATTERN, 'utf8')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function exactUnicodeBlock(bytes) {
  const repetitions = Math.floor(bytes / UNICODE_PATTERN_BYTES)
  return UNICODE_PATTERN.repeat(repetitions) + 'x'.repeat(bytes - repetitions * UNICODE_PATTERN_BYTES)
}

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function restoreEnvironment(name, previousValue) {
  if (previousValue === undefined) delete process.env[name]
  else process.env[name] = previousValue
}

export async function runTerminalStreamScenario(config) {
  const totalBytes = config.terminalBytes
  assert.equal(totalBytes % TERMINAL_STREAM_LIMITS.blockBytes, 0, 'Il carico terminale deve usare blocchi esatti.')
  const sourceHash = createHash('sha256')
  const renderedHash = createHash('sha256')
  const sent = []
  let expectedSequence = 0
  let pauseCalls = 0
  let resumeCalls = 0
  let ptyPaused = false
  let blocks = 0
  const pty = {
    pause() {
      assert.equal(ptyPaused, false, 'PTY messa in pausa due volte.')
      ptyPaused = true
      pauseCalls += 1
    },
    resume() {
      assert.equal(ptyPaused, true, 'PTY ripresa senza pausa.')
      ptyPaused = false
      resumeCalls += 1
    },
  }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'architecture-soak',
    sendBlock: (block) => sent.push(block),
    sendState: () => undefined,
  })
  controller.rendererReady({ sessionId: 'architecture-soak', watermark: 0 })

  const drain = () => {
    while (sent.length > 0) {
      const block = sent.shift()
      expectedSequence += 1
      blocks += 1
      assert.equal(block.sequence, expectedSequence, 'Sequenza terminale non monotona.')
      assert.ok(Buffer.byteLength(block.data, 'utf8') <= TERMINAL_STREAM_LIMITS.blockBytes, 'Blocco terminale oltre limite.')
      assert.doesNotMatch(block.data, /�/u, 'Unicode terminale corrotto.')
      renderedHash.update(block.data)
      assert.equal(controller.ack({ sessionId: block.sessionId, sequence: block.sequence }), true, 'ACK terminale rifiutato.')
    }
  }

  try {
    const block = exactUnicodeBlock(TERMINAL_STREAM_LIMITS.blockBytes)
    for (let producedBytes = 0; producedBytes < totalBytes; producedBytes += TERMINAL_STREAM_LIMITS.blockBytes) {
      sourceHash.update(block)
      controller.push(block)
      drain()
      if ((producedBytes / TERMINAL_STREAM_LIMITS.blockBytes) % 8 === 7) await yieldImmediate()
    }
    controller.end({ exitCode: 0, signal: 0 })
    drain()
    const diagnostics = controller.getDiagnostics()
    const sourceDigest = sourceHash.digest('hex')
    const renderedDigest = renderedHash.digest('hex')
    assert.equal(diagnostics.receivedBytes, totalBytes, 'Byte terminale ricevuti non esatti.')
    assert.equal(diagnostics.renderedBytes, totalBytes, 'Byte terminale renderizzati non esatti.')
    assert.equal(diagnostics.queuedBytes, 0, 'Coda terminale residua.')
    assert.equal(sourceDigest, renderedDigest, 'Contenuto Unicode terminale alterato.')
    assert.ok(diagnostics.peakQueuedBytes <= TERMINAL_STREAM_LIMITS.pauseBytes + TERMINAL_STREAM_LIMITS.blockBytes, 'Backpressure terminale oltre soglia.')
    assert.equal(ptyPaused, false, 'PTY rimasta in pausa.')
    assert.equal(pauseCalls, resumeCalls, 'Lifecycle pausa/ripresa PTY non bilanciato.')
    return {
      totalBytes,
      receivedBytes: diagnostics.receivedBytes,
      renderedBytes: diagnostics.renderedBytes,
      blocks,
      maxBlockBytes: diagnostics.maxBlockBytes,
      peakQueuedBytes: diagnostics.peakQueuedBytes,
      pauseCalls,
      checksumMatch: true,
      residualQueuedBytes: diagnostics.queuedBytes,
    }
  } finally {
    controller.dispose()
  }
}

function createFakePtyFactory() {
  const processes = []
  let nextPid = 20_000
  function processFactory(_executable, _args, options) {
    const dataListeners = new Set()
    const exitListeners = new Set()
    const ptyProcess = {
      pid: nextPid++,
      options,
      killCalls: 0,
      pauseCalls: 0,
      resumeCalls: 0,
      paused: false,
      writes: 0,
      resizes: 0,
      write() { this.writes += 1 },
      resize() { this.resizes += 1 },
      kill(signal) {
        this.killCalls += 1
        this.emitExit({ exitCode: signal === 'SIGKILL' ? null : 0, signal: signal === 'SIGKILL' ? 9 : 0 })
      },
      pause() { this.paused = true; this.pauseCalls += 1 },
      resume() { this.paused = false; this.resumeCalls += 1 },
      onData(listener) {
        dataListeners.add(listener)
        return { dispose: () => dataListeners.delete(listener) }
      },
      onExit(listener) {
        exitListeners.add(listener)
        return { dispose: () => exitListeners.delete(listener) }
      },
      emitData(data) { for (const listener of [...dataListeners]) listener(data) },
      emitExit(event) { for (const listener of [...exitListeners]) listener(event) },
      resourceCount() { return dataListeners.size + exitListeners.size },
    }
    processes.push(ptyProcess)
    return ptyProcess
  }
  return { processFactory, processes }
}

export async function runShellLifecycleScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-shell-')
  const workspaceA = path.join(root, 'workspace-a')
  const workspaceB = path.join(root, 'workspace-b')
  fs.mkdirSync(workspaceA)
  fs.mkdirSync(workspaceB)
  const fakePty = createFakePtyFactory()
  const dataEvents = []
  const ackResults = []
  let nextId = 0
  let manager
  manager = createShellSessionManager({
    processFactory: fakePty.processFactory,
    createId: () => `soak-${String(++nextId).padStart(8, '0')}`,
    getExecutable: () => '/bin/fake-shell',
    getEnvironment: () => ({ LANG: 'C.UTF-8' }),
    onData: (event) => {
      dataEvents.push(event)
      ackResults.push(manager.ack(event.workspacePath, event.sessionId, {
        attachmentId: event.attachmentId,
        generation: event.generation,
        sequence: event.sequence,
      }))
    },
  })
  let expectedEvents = 0
  let expectedEventBytes = 0

  try {
    for (let cycle = 0; cycle < config.shellCycles; cycle += 1) {
      const workspace = cycle % 2 === 0 ? workspaceA : workspaceB
      const first = manager.create(workspace)
      const firstSnapshot = manager.resume(workspace, first.sessionId)
      assert.equal(manager.rendererReady(workspace, first.sessionId, {
        attachmentId: firstSnapshot.attachmentId,
        generation: firstSnapshot.generation,
        watermark: firstSnapshot.watermark,
      }), true, 'Handshake renderer del primo terminale rifiutato.')
      const firstProcess = fakePty.processes.at(-1)
      const firstOutput = `first-${cycle}:${UNICODE_PATTERN}`
      firstProcess.emitData(firstOutput)
      expectedEvents += 1
      expectedEventBytes += Buffer.byteLength(firstOutput)
      manager.write(workspace, first.sessionId, 'pwd\r')
      manager.resize(workspace, first.sessionId, { cols: 80 + cycle % 40, rows: 24 + cycle % 20 })

      const second = manager.create(workspace)
      const secondSnapshot = manager.resume(workspace, second.sessionId)
      assert.equal(manager.rendererReady(workspace, second.sessionId, {
        attachmentId: secondSnapshot.attachmentId,
        generation: secondSnapshot.generation,
        watermark: secondSnapshot.watermark,
      }), true, 'Handshake renderer del secondo terminale rifiutato.')
      const replacedProcess = fakePty.processes.at(-1)
      const beforeRestart = `before-restart-${cycle}:${UNICODE_PATTERN}`
      replacedProcess.emitData(beforeRestart)
      expectedEvents += 1
      expectedEventBytes += Buffer.byteLength(beforeRestart)
      manager.focus(workspace, first.sessionId)
      await manager.restart(workspace, second.sessionId)
      const restartSnapshot = manager.resume(workspace, second.sessionId)
      assert.equal(manager.rendererReady(workspace, second.sessionId, {
        attachmentId: restartSnapshot.attachmentId,
        generation: restartSnapshot.generation,
        watermark: restartSnapshot.watermark,
      }), true, 'Handshake renderer dopo restart rifiutato.')
      const replacement = fakePty.processes.at(-1)
      replacedProcess.emitData('stale-output-must-be-ignored')
      replacedProcess.emitExit({ exitCode: 1, signal: 9 })
      const afterRestart = `after-restart-${cycle}:${UNICODE_PATTERN}`
      replacement.emitData(afterRestart)
      expectedEvents += 1
      expectedEventBytes += Buffer.byteLength(afterRestart)

      const snapshot = manager.resume(workspace, second.sessionId)
      assert.equal(snapshot.blocks.map((item) => item.data).join(''), afterRestart, 'Snapshot restart contiene output stale.')
      assert.equal(snapshot.generation, 2, 'Generazione shell non avanzata.')
      assert.equal((await manager.close(workspace, first.sessionId)).activeSessionId, second.sessionId, 'Fallback sessione attiva errato.')
      assert.equal((await manager.close(workspace, second.sessionId)).closed, true, 'Chiusura sessione fallita.')
      assert.equal(manager.list(workspace).sessions.length, 0, 'Sessioni residue nel workspace.')
      if (cycle % 25 === 24) await yieldImmediate()
    }

    assert.equal((await manager.dispose()).closed, 0, 'Dispose ha trovato sessioni non chiuse.')
    const resourceCount = fakePty.processes.reduce((total, item) => total + item.resourceCount(), 0)
    const killCalls = fakePty.processes.reduce((total, item) => total + item.killCalls, 0)
    const eventBytes = dataEvents.reduce((total, event) => total + Buffer.byteLength(event.data), 0)
    assert.equal(dataEvents.length, expectedEvents, 'Eventi shell persi o stale.')
    assert.ok(ackResults.every(Boolean), 'ACK shell rifiutato durante il lifecycle.')
    assert.equal(eventBytes, expectedEventBytes, 'Byte shell persi.')
    assert.equal(resourceCount, 0, 'Listener PTY residui.')
    assert.equal(killCalls, fakePty.processes.length, 'Processi PTY non chiusi esattamente una volta.')
    return {
      cycles: config.shellCycles,
      processes: fakePty.processes.length,
      dataEvents: dataEvents.length,
      eventBytes,
      killCalls,
      residualListeners: resourceCount,
      residualSessions: 0,
    }
  } finally {
    await manager.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function runSqliteWorkerScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-sqlite-')
  const sqlitePath = path.join(root, 'soak.sqlite')
  let workerSession
  try {
    const database = new Database(sqlitePath)
    database.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
    const insert = database.prepare('INSERT INTO items(id, label) VALUES (?, ?)')
    database.transaction(() => {
      for (let id = 1; id <= config.sqliteRows; id += 1) insert.run(id, `${UNICODE_PATTERN}-${id}`)
    })()
    database.close()

    assert.deepEqual(sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 }, 'Worker SQLite preesistenti.')
    workerSession = new SqliteWorkerSession(sqlitePath)
    await workerSession.ready()
    const pageLimit = Math.min(500, config.sqliteRows - 1)
    const page = await workerSession.request('execute', {
      sql: `SELECT id, label FROM items ORDER BY id LIMIT ${pageLimit + 1}`,
      budgetRowLimit: pageLimit,
    }, { timeoutMs: config.sqliteTimeoutMs })
    assert.equal(page.rows.length, pageLimit, 'Budget righe SQLite non rispettato.')
    assert.equal(page.hasMore, true, 'Sentinella pagina SQLite non rilevata.')
    assert.doesNotMatch(page.rows.at(-1).label, /�/u, 'Unicode SQLite corrotto.')
    const resultBytes = measureResultRows(page.rows)
    assert.ok(resultBytes < RESULT_BYTE_LIMIT, 'Payload SQLite oltre budget.')

    await assert.rejects(
      () => workerSession.request('execute', { sql: 'SELECT randomblob(2097152) AS payload', budgetRowLimit: 1 }, { timeoutMs: config.sqliteTimeoutMs }),
      /database_result_cell_too_large/,
    )
    const recovery = await workerSession.request('execute', { sql: 'SELECT 1 AS recovered', budgetRowLimit: 1 }, { timeoutMs: config.sqliteTimeoutMs })
    assert.deepEqual(recovery.rows, [{ recovered: 1 }], 'Worker SQLite non recuperato dopo budget error.')

    const longQuery = `WITH RECURSIVE counter(value) AS (VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < ${config.sqliteRecursiveRows}) SELECT sum(value) AS total FROM counter`
    const longResult = await workerSession.request('execute', { sql: longQuery, budgetRowLimit: 1 }, { timeoutMs: config.sqliteTimeoutMs })
    assert.equal(longResult.rows.length, 1, 'Query worker SQLite incompleta.')
    assert.equal(sqliteWorkerDiagnostics().pendingRequests, 0, 'Richieste SQLite residue.')
    await workerSession.close()
    workerSession = null
    assert.deepEqual(sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 }, 'Worker SQLite residui.')
    return {
      sourceRows: config.sqliteRows,
      returnedRows: page.rows.length,
      hasMore: page.hasMore,
      resultBytes,
      budgetErrorRecovered: true,
      recursiveRows: config.sqliteRecursiveRows,
      activeWorkers: 0,
      pendingRequests: 0,
    }
  } finally {
    await workerSession?.close().catch(() => undefined)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function unsafeUpdateResidues(root) {
  const residues = []
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name)
      if (/vincodelab-(?:update-lock|next|current)|-(?:download|staged)-/u.test(entry.name)) residues.push(entry.name)
      if (entry.isDirectory()) visit(candidate)
    }
  }
  visit(root)
  return residues
}

export async function runUpdateConcurrencyScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-update-')
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = path.join(root, 'data')
  closeDatabase()
  let winners = 0
  let rejectedContenders = 0
  try {
    for (let round = 0; round < config.updateRounds; round += 1) {
      const id = `skill:architecture-${round}`
      const target = path.join(root, 'targets', `skill-${round}`)
      const activeVersion = `active-${round}`
      const availableVersion = `available-${round}`
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'SKILL.md'), `---\nname: architecture-${round}\ndescription: active\n---\n`)
      upsertManagedUpdate({
        id,
        kind: 'skill',
        name: `architecture-${round}`,
        sourceType: 'github',
        owner: 'local-fixture',
        repository: 'local-fixture',
        ref: 'main',
        channel: 'stable',
        activeVersion,
        targetPath: target,
      })
      recordAvailableUpdate(id, { availableVersion, checkedAt: round + 1 })

      const allEntered = deferred()
      const release = deferred()
      let entered = 0
      const attempts = Array.from({ length: config.updateContenders }, (_, contender) => stageManagedUpdate(id, {
        dataDirectory: path.join(root, 'staging'),
        download: async (_record, destination) => {
          fs.writeFileSync(path.join(destination, 'SKILL.md'), `---\nname: architecture-${round}\ndescription: contender-${contender}\n---\n`)
          entered += 1
          if (entered === config.updateContenders) allEntered.resolve()
          await release.promise
        },
      }))
      await allEntered.promise
      release.resolve()
      const settled = await Promise.allSettled(attempts)
      const fulfilled = settled.filter((result) => result.status === 'fulfilled')
      const rejected = settled.filter((result) => result.status === 'rejected')
      assert.equal(fulfilled.length, 1, 'Lo staging concorrente ha prodotto più vincitori.')
      assert.equal(rejected.length, config.updateContenders - 1, 'Numero di staging concorrenti rifiutati errato.')
      winners += fulfilled.length
      rejectedContenders += rejected.length

      const activation = await activatePendingUpdates()
      assert.equal(activation.length, 1, 'Aggiornamenti attivabili inattesi.')
      assert.equal(activation[0].success, true, 'Attivazione concorrente non riuscita.')
      assert.equal(getManagedUpdate(id).activeVersion, availableVersion, 'Versione attiva errata.')
      assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /contender-\d+/u, 'Contenuto vincitore mancante.')
      assert.deepEqual(unsafeUpdateResidues(root), [], 'Residui temporanei aggiornamento.')
      await yieldImmediate()
    }

    return {
      rounds: config.updateRounds,
      contendersPerRound: config.updateContenders,
      winners,
      rejectedContenders,
      residualTemporaryEntries: unsafeUpdateResidues(root).length,
    }
  } finally {
    closeDatabase()
    restoreEnvironment('VINCODELAB_DATA_DIR', previousDirectory)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function sessionSnapshot(state) {
  return { version: WORKSPACE_SESSION_VERSION, state }
}

export async function runWorkspacePersistenceScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-workspace-')
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = path.join(root, 'data')
  closeDatabase()
  const workspaceCount = Math.min(16, Math.max(2, Math.ceil(config.workspaceCycles / 10)))
  try {
    for (let cycle = 0; cycle < config.workspaceCycles; cycle += 1) {
      const workspace = path.join(root, `workspace-${cycle % workspaceCount}`)
      const state = createDefaultWorkspaceSessionState()
      state.navigation.section = ['ai', 'editor', 'terminal', 'github', 'database', 'settings'][cycle % 6]
      state.navigation.aiTab = ['terminal', 'skills', 'instructions'][cycle % 3]
      state.terminal.openSessionCount = cycle % 9 === 8 ? 8 : cycle % 8
      state.terminal.activeSessionOrdinal = state.terminal.openSessionCount === 0 ? null : cycle % state.terminal.openSessionCount
      state.github.scroll.changes = cycle * 3
      state.database.scroll.results = cycle * 7
      state.panels.editorExplorer = cycle % 2 === 0 ? 240 + cycle % 100 : null
      const saved = saveWorkspaceSession(workspace, sessionSnapshot(state))
      const loaded = getWorkspaceSession(workspace)
      assert.deepEqual(loaded.state, saved.state, 'Roundtrip sessione workspace non esatto.')
      assert.equal(loaded.version, WORKSPACE_SESSION_VERSION, 'Versione sessione workspace errata.')
      if (cycle % 100 === 99) await yieldImmediate()
    }

    const corruptCases = [
      '{not-json',
      JSON.stringify({ ...createDefaultWorkspaceSessionState(), unexpected: true }),
      'x'.repeat(MAX_WORKSPACE_SESSION_BYTES + 1),
    ]
    for (let index = 0; index < config.workspaceCorruptCases; index += 1) {
      const workspace = path.join(root, `corrupt-${index}`)
      saveWorkspaceSession(workspace, sessionSnapshot(createDefaultWorkspaceSessionState()))
      getDatabase().prepare('UPDATE workspace_ui_state SET payload_json = ? WHERE workspace_path = ?')
        .run(corruptCases[index % corruptCases.length], workspace)
      const recovered = getWorkspaceSession(workspace)
      assert.deepEqual(recovered.state, createDefaultWorkspaceSessionState(), 'Fallback stato corrotto errato.')
      assert.equal(recovered.updatedAt, null, 'Timestamp corrotto non azzerato.')
      assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state WHERE workspace_path = ?').get(workspace).count, 0, 'Stato corrotto non rimosso.')
    }

    const persistedRows = getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state').get().count
    assert.equal(persistedRows, workspaceCount, 'Numero workspace persistiti inatteso.')
    return {
      cycles: config.workspaceCycles,
      workspaceCount,
      corruptCases: config.workspaceCorruptCases,
      recoveredCorruptCases: config.workspaceCorruptCases,
      persistedRows,
      maxPayloadBytes: MAX_WORKSPACE_SESSION_BYTES,
    }
  } finally {
    closeDatabase()
    restoreEnvironment('VINCODELAB_DATA_DIR', previousDirectory)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export const ARCHITECTURE_SCENARIOS = Object.freeze({
  terminal_stream: runTerminalStreamScenario,
  shell_lifecycle: runShellLifecycleScenario,
  sqlite_worker: runSqliteWorkerScenario,
  update_concurrency: runUpdateConcurrencyScenario,
  workspace_persistence: runWorkspacePersistenceScenario,
})

export async function runArchitectureScenario(name, config) {
  const scenario = ARCHITECTURE_SCENARIOS[name]
  if (!scenario) throw new Error('Scenario architetturale non valido.')
  return scenario(config)
}
