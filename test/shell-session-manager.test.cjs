const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  DEFAULT_MAX_SESSIONS,
  DEFAULT_SHELL_OUTPUT_HISTORY_BYTES,
  SESSION_ID_PATTERN,
  createShellSessionManager: createDomainShellSessionManager,
} = require('../electron/domains/shell/shell-session-manager.cjs')

function createShellSessionManager(options = {}) {
  return createDomainShellSessionManager({
    canonicalizeWorkspace: (workspacePath) => fs.realpathSync(workspacePath),
    getEnvironment: () => ({}),
    getExecutable: () => '/bin/fake-shell',
    isProcessAlive: () => false,
    ...options,
  })
}

function temporaryWorkspace(t, prefix = 'vincodelab-shell-sessions-') {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  return workspace
}

function fakePtyFactory() {
  const processes = []
  let nextPid = 4_000

  function processFactory(executable, args, options) {
    const dataListeners = new Set()
    const exitListeners = new Set()
    const process = {
      pid: nextPid++,
      executable,
      args,
      options,
      writes: [],
      resizes: [],
      kills: 0,
      killSignals: [],
      alive: true,
      pauses: 0,
      resumes: 0,
      paused: false,
      resumeWaiters: [],
      disposedDataListeners: 0,
      disposedExitListeners: 0,
      write(data) { this.writes.push(data) },
      resize(cols, rows) { this.resizes.push({ cols, rows }) },
      kill(signal) {
        this.kills += 1
        this.killSignals.push(signal ?? null)
        queueMicrotask(() => this.emitExit({ exitCode: 0, signal: signal === 'SIGKILL' ? 9 : 0 }))
      },
      pause() { this.pauses += 1; this.paused = true },
      resume() { this.resumes += 1; this.paused = false; this.resumeWaiters.splice(0).forEach((resolve) => resolve()) },
      waitForResume() { return this.paused ? new Promise((resolve) => this.resumeWaiters.push(resolve)) : Promise.resolve() },
      onData(listener) {
        dataListeners.add(listener)
        return { dispose: () => { if (dataListeners.delete(listener)) this.disposedDataListeners += 1 } }
      },
      onExit(listener) {
        exitListeners.add(listener)
        return { dispose: () => { if (exitListeners.delete(listener)) this.disposedExitListeners += 1 } }
      },
      emitData(data) { for (const listener of [...dataListeners]) listener(data) },
      emitExit(event) {
        if (!this.alive) return
        this.alive = false
        for (const listener of [...exitListeners]) listener(event)
      },
    }
    processes.push(process)
    return process
  }

  return { processFactory, processes }
}

function sequentialIds(prefix = 'session') {
  let count = 0
  return () => `${prefix}-${String(++count).padStart(4, '0')}`
}

function connectRenderer(manager, workspace, sessionId) {
  const snapshot = manager.resume(workspace, sessionId)
  assert.equal(manager.rendererReady(workspace, sessionId, {
    attachmentId: snapshot.attachmentId,
    generation: snapshot.generation,
    watermark: snapshot.watermark,
  }), true)
  return snapshot
}

test('se la shell configurata manca espone recovery locale', (t) => {
  const workspace = temporaryWorkspace(t)
  const manager = createShellSessionManager({
    createId: sequentialIds(),
    getExecutable: () => null,
    processFactory: () => { throw new Error('non deve essere invocata') },
  })
  assert.throws(() => manager.create(workspace), (error) => {
    assert.equal(error.publicCode, 'SHELL_NOT_AVAILABLE')
    assert.match(error.publicMessage, /aree che non richiedono il Terminale restano disponibili/u)
    return true
  })
})

test('richiede esplicitamente i collaboratori dell host Shell', () => {
  assert.throws(() => createDomainShellSessionManager({}), /Canonicalizzatore workspace terminale non valido/u)
})

test('crea una shell login nel workspace e inoltra dati, input e resize per sessionId', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const dataEvents = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    getExecutable: () => '/bin/fake-zsh',
    getEnvironment: () => ({ LANG: 'it_IT.UTF-8', TERM: 'non-corretto' }),
    onData: (event) => dataEvents.push(event),
  })

  const session = manager.create(workspace)
  const process = pty.processes[0]
  assert.equal(session.active, true)
  assert.equal(session.status, 'running')
  assert.equal(process.executable, '/bin/fake-zsh')
  assert.deepEqual(process.args, ['-l'])
  assert.deepEqual(process.options, {
    name: 'xterm-256color',
    cols: 120,
    rows: 34,
    cwd: fs.realpathSync(workspace),
    env: { LANG: 'it_IT.UTF-8', TERM: 'xterm-256color' },
  })

  assert.deepEqual(manager.write(workspace, session.sessionId, 'pwd\r'), { written: true })
  assert.deepEqual(process.writes, ['pwd\r'])
  assert.equal(manager.resize(workspace, session.sessionId, { cols: 140, rows: 42 }).cols, 140)
  assert.deepEqual(process.resizes, [{ cols: 140, rows: 42 }])
  const connection = connectRenderer(manager, workspace, session.sessionId)
  process.emitData('output\r\n')
  assert.deepEqual(dataEvents, [{
    workspacePath: fs.realpathSync(workspace),
    sessionId: session.sessionId,
    attachmentId: connection.attachmentId,
    generation: 1,
    sequence: 1,
    data: 'output\r\n',
  }])
  assert.throws(() => manager.write(workspace, session.sessionId, 'x'.repeat(65_537)), /Input terminale non valido/)
  assert.throws(() => manager.resize(workspace, session.sessionId, { cols: 1, rows: 20 }), /Dimensioni terminale non valide/)
})

test('riproduce tramite snapshot l output emesso prima del mount renderer', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const manager = createShellSessionManager({ processFactory: pty.processFactory, createId: sequentialIds() })
  const session = manager.create(workspace)

  pty.processes[0].emitData('prima del listener\r\n')
  const snapshot = manager.resume(workspace, session.sessionId)

  assert.equal(snapshot.generation, 1)
  assert.equal(snapshot.firstSequence, 1)
  assert.equal(snapshot.watermark, 1)
  assert.equal(snapshot.blocks.map((block) => block.data).join(''), 'prima del listener\r\n')
  assert.equal(snapshot.bytes, Buffer.byteLength('prima del listener\r\n'))
  assert.equal(snapshot.truncated, false)
  assert.equal(DEFAULT_SHELL_OUTPUT_HISTORY_BYTES, 4 * 1024 * 1024)
})

test('limita lo storico in byte UTF-8 senza spezzare Unicode e segnala overflow', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const events = []
  let manager
  manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    maxHistoryBytes: 7,
    onData: (event) => {
      events.push(event)
      manager.ack(workspace, event.sessionId, event)
    },
  })
  const session = manager.create(workspace)

  connectRenderer(manager, workspace, session.sessionId)
  pty.processes[0].emitData('A🚀BC🚀D')
  const snapshot = manager.resume(workspace, session.sessionId)

  assert.equal(events.map((event) => event.data).join(''), 'A🚀BC🚀D')
  assert.deepEqual(events.map((event) => event.sequence), [1, 2])
  assert.equal(snapshot.blocks.map((block) => block.data).join(''), '🚀D')
  assert.equal(snapshot.bytes, 5)
  assert.equal(snapshot.droppedBytes, 7)
  assert.equal(snapshot.truncated, true)
  assert.equal(snapshot.firstSequence, 2)
  assert.equal(snapshot.watermark, 2)
  assert.doesNotMatch(snapshot.blocks[0].data, /�/)
})

test('un reconnect può troncare soltanto lo storico bounded e lo dichiara prima di drenare la coda', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const events = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    maxHistoryBytes: 8,
    onData: (event) => events.push(event),
  })
  const session = manager.create(workspace)
  pty.processes[0].emitData('1111')
  pty.processes[0].emitData('2222')
  pty.processes[0].emitData('3333')

  const resumed = manager.resume(workspace, session.sessionId)
  assert.equal(resumed.truncated, true)
  assert.equal(resumed.droppedBytes, 8)
  assert.equal(resumed.blocks.map((block) => block.data).join(''), '3333')
  assert.equal(manager.rendererReady(workspace, session.sessionId, {
    attachmentId: resumed.attachmentId,
    generation: resumed.generation,
    watermark: resumed.watermark,
  }), true)
  assert.deepEqual(events, [])
  assert.equal(manager.diagnostics(workspace, session.sessionId).queuedBytes, 0)
})

test('isola sessioni, focus e processi tra workspace', (t) => {
  const workspaceA = temporaryWorkspace(t, 'vincodelab-shell-a-')
  const workspaceB = temporaryWorkspace(t, 'vincodelab-shell-b-')
  const pty = fakePtyFactory()
  const manager = createShellSessionManager({ processFactory: pty.processFactory, createId: sequentialIds() })

  const firstA = manager.create(workspaceA)
  const secondA = manager.create(workspaceA)
  const firstB = manager.create(workspaceB)

  assert.equal(manager.list(workspaceA).activeSessionId, secondA.sessionId)
  assert.equal(manager.focus(workspaceA, firstA.sessionId).active, true)
  assert.equal(manager.list(workspaceA).sessions.length, 2)
  assert.equal(manager.list(workspaceB).sessions.length, 1)
  assert.equal(manager.list(workspaceB).activeSessionId, firstB.sessionId)
  assert.throws(() => manager.write(workspaceB, firstA.sessionId, 'x'), /non trovata per questo workspace/)
  assert.deepEqual(pty.processes.map((process) => process.options.cwd), [
    fs.realpathSync(workspaceA),
    fs.realpathSync(workspaceA),
    fs.realpathSync(workspaceB),
  ])
})

test('genera ID sicuri e applica il limite per singolo workspace', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const manager = createShellSessionManager({ processFactory: pty.processFactory, maxSessions: 2 })

  const first = manager.create(workspace)
  const second = manager.create(workspace)
  assert.match(first.sessionId, SESSION_ID_PATTERN)
  assert.match(second.sessionId, SESSION_ID_PATTERN)
  assert.notEqual(first.sessionId, second.sessionId)
  assert.throws(() => manager.create(workspace), /al massimo 2 terminali/)
  assert.equal(DEFAULT_MAX_SESSIONS, 8)
  assert.throws(() => createShellSessionManager({ processFactory: pty.processFactory, maxSessions: 0 }), /Limite sessioni/)

  const unsafe = createShellSessionManager({ processFactory: pty.processFactory, createId: () => '../renderer-path' })
  assert.throws(() => unsafe.create(workspace), /ID sessione terminale sicuro/)
})

test('restart conserva ID, cwd, dimensioni e ignora eventi del processo sostituito', async (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const dataEvents = []
  const exitEvents = []
  let manager
  manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    onData: (event) => {
      dataEvents.push(event)
      manager.ack(workspace, event.sessionId, event)
    },
    onExit: (event) => exitEvents.push(event),
  })
  const created = manager.create(workspace)
  connectRenderer(manager, workspace, created.sessionId)
  pty.processes[0].emitData('storico precedente')
  const previousSnapshot = manager.resume(workspace, created.sessionId)
  manager.resize(workspace, created.sessionId, { cols: 160, rows: 50 })
  const original = pty.processes[0]

  const restarted = await manager.restart(workspace, created.sessionId)
  connectRenderer(manager, workspace, created.sessionId)
  const replacement = pty.processes[1]
  assert.equal(restarted.sessionId, created.sessionId)
  assert.equal(restarted.pid, replacement.pid)
  assert.equal(replacement.options.cwd, fs.realpathSync(workspace))
  assert.equal(replacement.options.cols, 160)
  assert.equal(replacement.options.rows, 50)
  assert.equal(original.kills, 1)
  assert.equal(original.disposedDataListeners, 1)
  assert.equal(original.disposedExitListeners, 1)

  original.emitData('stale')
  original.emitExit({ exitCode: 1, signal: 9 })
  replacement.emitData('nuovo')
  assert.deepEqual(dataEvents.map((event) => event.data), ['storico precedente', 'nuovo'])
  assert.deepEqual(exitEvents, [])
  assert.equal(manager.list(workspace).sessions[0].status, 'running')
  const resumed = manager.resume(workspace, created.sessionId)
  assert.equal(previousSnapshot.blocks.map((block) => block.data).join(''), 'storico precedente')
  assert.equal(resumed.blocks.map((block) => block.data).join(''), 'nuovo')
  assert.equal(resumed.generation, 2)
  assert.equal(resumed.firstSequence, 2)
  assert.equal(resumed.watermark, 2)
})

test('un restart con spawn fallito chiude prima il processo precedente e consente retry', async (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const dataEvents = []
  let attempts = 0
  const manager = createShellSessionManager({
    processFactory(...args) {
      attempts += 1
      if (attempts === 2) throw new Error('restart spawn fallito')
      return pty.processFactory(...args)
    },
    createId: sequentialIds(),
    onData: (event) => dataEvents.push(event),
  })
  const session = manager.create(workspace)
  const original = pty.processes[0]
  connectRenderer(manager, workspace, session.sessionId)

  await assert.rejects(manager.restart(workspace, session.sessionId), /restart spawn fallito/)
  original.emitData('stale')

  assert.deepEqual(dataEvents, [])
  assert.equal(original.kills, 1)
  assert.equal(original.alive, false)
  assert.equal(manager.list(workspace).sessions[0].status, 'exited')
  assert.throws(() => manager.write(workspace, session.sessionId, 'echo no\r'), /non è attiva/)

  const recovered = await manager.restart(workspace, session.sessionId)
  assert.equal(recovered.status, 'running')
  assert.equal(pty.processes.length, 2)
})

test('close della sessione attiva sceglie il fallback MRU ed è idempotente', async (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const exitEvents = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    onExit: (event) => exitEvents.push(event),
  })
  const first = manager.create(workspace)
  const second = manager.create(workspace)
  const third = manager.create(workspace)
  manager.focus(workspace, first.sessionId)
  manager.focus(workspace, second.sessionId)

  assert.deepEqual(await manager.close(workspace, second.sessionId), { closed: true, activeSessionId: first.sessionId })
  assert.equal((await manager.close(workspace, second.sessionId)).closed, false)
  assert.equal(manager.list(workspace).activeSessionId, first.sessionId)
  assert.deepEqual(manager.list(workspace).sessions.map((session) => session.sessionId), [first.sessionId, third.sessionId])
  assert.equal(pty.processes[1].kills, 1)
  assert.equal(exitEvents[0].reason, 'closed')
  assert.equal(exitEvents[0].sessionId, second.sessionId)
})

test('close attende exit, applica SIGKILL dopo la deadline e non lascia sessioni residue', async (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    isProcessAlive: (pid) => pty.processes.find((process) => process.pid === pid)?.alive ?? false,
    stopGraceMs: 5,
    forceStopMs: 5,
  })
  const session = manager.create(workspace)
  const process = pty.processes[0]
  process.kill = (signal) => {
    process.kills += 1
    process.killSignals.push(signal ?? null)
    if (signal === 'SIGKILL') queueMicrotask(() => process.emitExit({ exitCode: null, signal: 9 }))
  }

  const firstClose = manager.close(workspace, session.sessionId)
  const concurrentClose = manager.close(workspace, session.sessionId)
  const [firstResult, concurrentResult] = await Promise.all([firstClose, concurrentClose])

  assert.deepEqual(firstResult, { closed: true, activeSessionId: null })
  assert.deepEqual(concurrentResult, { closed: false, activeSessionId: null })
  assert.deepEqual(process.killSignals, [null, 'SIGKILL'])
  assert.equal(process.alive, false)
  assert.equal(process.disposedDataListeners, 1)
  assert.equal(process.disposedExitListeners, 1)
  assert.equal(manager.list(workspace).sessions.length, 0)
})

test('un arresto PTY non confermato resta registrato e un retry successivo completa il cleanup', async (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const exitEvents = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    isProcessAlive: () => true,
    stopGraceMs: 1,
    forceStopMs: 1,
    onExit: (event) => exitEvents.push(event),
  })
  const session = manager.create(workspace)
  const process = pty.processes[0]
  process.kill = (signal) => {
    process.kills += 1
    process.killSignals.push(signal ?? null)
  }

  await assert.rejects(manager.close(workspace, session.sessionId), (error) => error.code === 'SHELL_STOP_FAILED')
  assert.equal(manager.list(workspace).sessions[0].status, 'running')
  assert.equal(process.alive, true)
  assert.equal(process.disposedExitListeners, 0)
  assert.deepEqual(exitEvents, [])

  process.kill = (signal) => {
    process.kills += 1
    process.killSignals.push(signal ?? null)
    queueMicrotask(() => process.emitExit({ exitCode: 0, signal: 0 }))
  }
  assert.deepEqual(await manager.close(workspace, session.sessionId), { closed: true, activeSessionId: null })
  assert.equal(manager.list(workspace).sessions.length, 0)
  assert.equal(process.alive, false)
  assert.equal(process.disposedExitListeners, 1)
  assert.deepEqual(exitEvents.map((event) => event.reason), ['closed'])
})

test('un exit naturale conserva metadata e consente restart della stessa sessione', async (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const exitEvents = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    onExit: (event) => exitEvents.push(event),
  })
  const session = manager.create(workspace)

  pty.processes[0].emitExit({ exitCode: 7, signal: 0 })
  const exited = manager.list(workspace).sessions[0]
  assert.equal(exited.status, 'exited')
  assert.deepEqual(exited.exitStatus, { exitCode: 7, signal: 0 })
  assert.deepEqual(exitEvents, [{
    workspacePath: fs.realpathSync(workspace),
    sessionId: session.sessionId,
    exitCode: 7,
    signal: 0,
    reason: 'exit',
  }])
  assert.throws(() => manager.write(workspace, session.sessionId, 'x'), /non è attiva/)

  const restarted = await manager.restart(workspace, session.sessionId)
  assert.equal(restarted.status, 'running')
  assert.equal(restarted.exitStatus, null)
  assert.notEqual(restarted.pid, pty.processes[0].pid)
})

test('closeAll e dispose puliscono processi e listener una sola volta', async (t) => {
  const workspaceA = temporaryWorkspace(t, 'vincodelab-shell-cleanup-a-')
  const workspaceB = temporaryWorkspace(t, 'vincodelab-shell-cleanup-b-')
  const pty = fakePtyFactory()
  const manager = createShellSessionManager({ processFactory: pty.processFactory, createId: sequentialIds() })
  manager.create(workspaceA)
  manager.create(workspaceA)
  manager.create(workspaceB)

  assert.deepEqual(await manager.closeAll(workspaceA), { closed: 2 })
  assert.deepEqual(await manager.closeAll(workspaceA), { closed: 0 })
  assert.equal(manager.list(workspaceB).sessions.length, 1)
  assert.deepEqual(await manager.dispose(), { closed: 1 })
  assert.deepEqual(await manager.dispose(), { closed: 0 })
  assert.deepEqual(pty.processes.map((process) => process.kills), [1, 1, 1])
  assert.deepEqual(pty.processes.map((process) => process.disposedDataListeners), [1, 1, 1])
  assert.deepEqual(pty.processes.map((process) => process.disposedExitListeners), [1, 1, 1])
  assert.throws(() => manager.create(workspaceA), /manager dei terminali è stato chiuso/)
})

test('un errore della factory non riserva una sessione o uno slot', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  let attempts = 0
  const manager = createShellSessionManager({
    processFactory(...args) {
      attempts += 1
      if (attempts === 1) throw new Error('spawn fallito')
      return pty.processFactory(...args)
    },
    createId: sequentialIds(),
    maxSessions: 1,
  })

  assert.throws(() => manager.create(workspace), /spawn fallito/)
  assert.equal(manager.list(workspace).sessions.length, 0)
  assert.equal(manager.create(workspace).status, 'running')
})

test('un handle PTY incompleto viene arrestato e non resta registrato', (t) => {
  const workspace = temporaryWorkspace(t)
  let kills = 0
  const manager = createShellSessionManager({
    processFactory: () => ({ kill: () => { kills += 1 } }),
    createId: sequentialIds(),
  })

  assert.throws(() => manager.create(workspace), /processo terminale non è valido/)
  assert.equal(kills, 1)
  assert.equal(manager.list(workspace).sessions.length, 0)
})

test('dispose attende tutti i PTY, conserva il fallimento e consente un cleanup successivo', async (t) => {
  const workspaceA = temporaryWorkspace(t, 'vincodelab-shell-dispose-a-')
  const workspaceB = temporaryWorkspace(t, 'vincodelab-shell-dispose-b-')
  const pty = fakePtyFactory()
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    isProcessAlive: (pid) => pty.processes.find((process) => process.pid === pid)?.alive ?? false,
    stopGraceMs: 1,
    forceStopMs: 1,
  })
  manager.create(workspaceA)
  manager.create(workspaceB)
  const resistant = pty.processes[0]
  resistant.kill = (signal) => {
    resistant.kills += 1
    resistant.killSignals.push(signal ?? null)
  }

  await assert.rejects(manager.dispose(), (error) => error.code === 'SHELL_STOP_FAILED')
  assert.equal(manager.list(workspaceA).sessions.length, 1)
  assert.equal(manager.list(workspaceB).sessions.length, 0)
  assert.equal(pty.processes[1].alive, false)
  assert.equal(pty.processes[1].disposedExitListeners, 1)

  resistant.kill = (signal) => {
    resistant.kills += 1
    resistant.killSignals.push(signal ?? null)
    queueMicrotask(() => resistant.emitExit({ exitCode: 0, signal: 0 }))
  }
  assert.deepEqual(await manager.dispose(), { closed: 1 })
  assert.equal(resistant.alive, false)
  assert.equal(resistant.disposedExitListeners, 1)
  assert.throws(() => manager.list(workspaceA), /manager dei terminali è stato chiuso/)
})

test('mantiene un solo blocco in volo e accetta ACK soltanto per generazione e sequenza correnti', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const events = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    onData: (event) => events.push(event),
  })
  const session = manager.create(workspace)
  const connection = connectRenderer(manager, workspace, session.sessionId)

  pty.processes[0].emitData('uno')
  pty.processes[0].emitData('due')
  assert.deepEqual(events.map((event) => event.data), ['uno'])
  assert.equal(manager.ack(workspace, session.sessionId, { attachmentId: connection.attachmentId, generation: 99, sequence: 1 }), false)
  assert.equal(manager.ack(workspace, session.sessionId, events[0]), true)
  assert.deepEqual(events.map((event) => event.data), ['uno', 'due'])
  assert.equal(manager.ack(workspace, session.sessionId, events[1]), true)
  assert.deepEqual(manager.diagnostics(workspace, session.sessionId), {
    generation: 1,
    receivedBytes: 6,
    acknowledgedBytes: 6,
    queuedBytes: 0,
    queuedBlocks: 0,
    peakQueuedBytes: 6,
    inFlightSequence: null,
    rendererConnected: true,
    paused: false,
    pauseCount: 0,
  })
})

test('applica backpressure con isteresi e riprende il PTY dopo il drenaggio', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const events = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    pauseBytes: 128 * 1024,
    resumeBytes: 64 * 1024,
    onData: (event) => events.push(event),
  })
  const session = manager.create(workspace)
  const process = pty.processes[0]
  connectRenderer(manager, workspace, session.sessionId)

  for (const character of ['a', 'b', 'c']) process.emitData(character.repeat(64 * 1024))
  assert.equal(events.length, 1)
  assert.equal(process.pauses, 1)
  assert.equal(process.paused, true)

  for (let sequence = 1; sequence <= 3; sequence += 1) {
    assert.equal(manager.ack(workspace, session.sessionId, events[sequence - 1]), true)
  }
  assert.equal(process.resumes, 1)
  assert.equal(process.paused, false)
  assert.equal(manager.diagnostics(workspace, session.sessionId).queuedBytes, 0)
})

test('mette in pausa il PTY se xterm non conferma il blocco in volo e riprende dopo ACK', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const events = []
  let stallCallback = null
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    setTimer(callback) {
      stallCallback = callback
      return { unref() {} }
    },
    clearTimer() {
      stallCallback = null
    },
    onData: (event) => events.push(event),
  })
  const session = manager.create(workspace)
  const process = pty.processes[0]
  connectRenderer(manager, workspace, session.sessionId)

  process.emitData('xterm lento')
  assert.equal(process.paused, false)
  const fireStall = stallCallback
  assert.equal(typeof fireStall, 'function')
  fireStall()
  assert.equal(process.paused, true)
  assert.equal(manager.diagnostics(workspace, session.sessionId).inFlightSequence, 1)

  assert.equal(manager.ack(workspace, session.sessionId, events[0]), true)
  assert.equal(process.paused, false)
  assert.equal(process.pauses, 1)
  assert.equal(process.resumes, 1)
})

test('resume riconsegna lo storico, invalida il volo precedente e non duplica la coda live', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const events = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    onData: (event) => events.push(event),
  })
  const session = manager.create(workspace)
  const previousConnection = connectRenderer(manager, workspace, session.sessionId)
  pty.processes[0].emitData('prima')
  assert.equal(events.length, 1)

  const snapshot = manager.resume(workspace, session.sessionId)
  assert.equal(snapshot.blocks.map((block) => block.data).join(''), 'prima')
  pty.processes[0].emitData('durante')
  assert.deepEqual(events.map((event) => event.data), ['prima'])
  assert.equal(manager.ack(workspace, session.sessionId, events[0]), false)
  assert.equal(manager.rendererReady(workspace, session.sessionId, {
    attachmentId: previousConnection.attachmentId,
    generation: 1,
    watermark: previousConnection.watermark,
  }), false)
  assert.equal(manager.disconnect(workspace, session.sessionId, {
    attachmentId: previousConnection.attachmentId,
    generation: 1,
  }), false)
  assert.equal(manager.rendererReady(workspace, session.sessionId, {
    attachmentId: snapshot.attachmentId,
    generation: 1,
    watermark: snapshot.watermark,
  }), true)
  assert.equal(events.at(-1).data, 'durante')
  assert.equal(events.at(-1).sequence, 2)
  assert.equal(manager.ack(workspace, session.sessionId, events.at(-1)), true)
  assert.equal(manager.diagnostics(workspace, session.sessionId).queuedBytes, 0)

  pty.processes[0].emitData('dopo')
  assert.equal(events.at(-1).data, 'dopo')
  assert.equal(events.at(-1).sequence, 3)
  assert.equal(manager.ack(workspace, session.sessionId, { ...events.at(-1), attachmentId: previousConnection.attachmentId }), false)
  assert.equal(manager.ack(workspace, session.sessionId, events.at(-1)), true)
  assert.equal(manager.disconnect(workspace, session.sessionId, { attachmentId: snapshot.attachmentId, generation: 1 }), true)
  assert.equal(manager.diagnostics(workspace, session.sessionId).rendererConnected, false)
})

test('non riusa attachmentId e non interrompe il consumer attivo se la nuova identità non è sicura', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    createAttachmentId: () => 'attach-0001',
  })
  const session = manager.create(workspace)
  connectRenderer(manager, workspace, session.sessionId)

  assert.throws(() => manager.resume(workspace, session.sessionId), /ID collegamento terminale sicuro/)
  assert.equal(manager.diagnostics(workspace, session.sessionId).rendererConnected, true)
})

test('mantiene flussi one-in-flight indipendenti per più sessioni dello stesso workspace', (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  const events = []
  const manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    onData: (event) => events.push(event),
  })
  const first = manager.create(workspace)
  const second = manager.create(workspace)
  connectRenderer(manager, workspace, first.sessionId)
  connectRenderer(manager, workspace, second.sessionId)

  pty.processes[0].emitData('A1')
  pty.processes[0].emitData('A2')
  pty.processes[1].emitData('B1')
  pty.processes[1].emitData('B2')
  assert.deepEqual(events.map(({ sessionId, data }) => [sessionId, data]), [
    [first.sessionId, 'A1'],
    [second.sessionId, 'B1'],
  ])

  assert.equal(manager.ack(workspace, first.sessionId, events[0]), true)
  assert.equal(manager.ack(workspace, second.sessionId, events[1]), true)
  assert.deepEqual(events.map(({ sessionId, data }) => [sessionId, data]), [
    [first.sessionId, 'A1'],
    [second.sessionId, 'B1'],
    [first.sessionId, 'A2'],
    [second.sessionId, 'B2'],
  ])
  assert.equal(manager.ack(workspace, first.sessionId, events[2]), true)
  assert.equal(manager.ack(workspace, second.sessionId, events[3]), true)
  assert.equal(manager.diagnostics(workspace, first.sessionId).queuedBlocks, 0)
  assert.equal(manager.diagnostics(workspace, second.sessionId).queuedBlocks, 0)
})

test('il restart conserva anche output sincrono prodotto durante l’aggancio del nuovo PTY', async (t) => {
  const workspace = temporaryWorkspace(t)
  const pty = fakePtyFactory()
  let attempts = 0
  const manager = createShellSessionManager({
    processFactory(...args) {
      attempts += 1
      const process = pty.processFactory(...args)
      if (attempts === 2) {
        const subscribe = process.onData.bind(process)
        process.onData = (listener) => {
          const subscription = subscribe(listener)
          listener('output immediato')
          return subscription
        }
      }
      return process
    },
    createId: sequentialIds(),
  })
  const session = manager.create(workspace)

  await manager.restart(workspace, session.sessionId)
  const snapshot = manager.resume(workspace, session.sessionId)
  assert.equal(snapshot.generation, 2)
  assert.equal(snapshot.blocks.map((block) => block.data).join(''), 'output immediato')
  assert.equal(snapshot.watermark, 1)
})

test('consegna 100 MiB esatti senza drop e lascia vuota la coda dopo pause e resume', async (t) => {
  const workspace = temporaryWorkspace(t, 'vincodelab-shell-stream-stress-')
  const pty = fakePtyFactory()
  const expectedHash = crypto.createHash('sha256')
  const deliveredHash = crypto.createHash('sha256')
  const totalBytes = 100 * 1024 * 1024
  const chunkBytes = 64 * 1024
  let deliveredBytes = 0
  let resolveDelivered
  const delivered = new Promise((resolve) => { resolveDelivered = resolve })
  let manager
  manager = createShellSessionManager({
    processFactory: pty.processFactory,
    createId: sequentialIds(),
    pauseBytes: 256 * 1024,
    resumeBytes: 64 * 1024,
    onData: (event) => {
      setImmediate(() => {
        deliveredHash.update(event.data)
        deliveredBytes += Buffer.byteLength(event.data)
        manager.ack(workspace, event.sessionId, event)
        if (deliveredBytes === totalBytes) resolveDelivered()
      })
    },
  })
  const session = manager.create(workspace)
  const process = pty.processes[0]
  connectRenderer(manager, workspace, session.sessionId)

  for (let index = 0; index < totalBytes / chunkBytes; index += 1) {
    await process.waitForResume()
    const prefix = `${index.toString(16).padStart(8, '0')}:`
    const chunk = `${prefix}${'x'.repeat(chunkBytes - prefix.length)}`
    expectedHash.update(chunk)
    process.emitData(chunk)
  }
  await delivered

  const diagnostics = manager.diagnostics(workspace, session.sessionId)
  assert.equal(deliveredBytes, totalBytes)
  assert.equal(deliveredHash.digest('hex'), expectedHash.digest('hex'))
  assert.ok(process.pauses > 0)
  assert.equal(process.pauses, process.resumes)
  assert.equal(diagnostics.receivedBytes, totalBytes)
  assert.equal(diagnostics.acknowledgedBytes, totalBytes)
  assert.equal(diagnostics.queuedBytes, 0)
  assert.equal(diagnostics.queuedBlocks, 0)
  assert.equal(diagnostics.inFlightSequence, null)
  assert.ok(diagnostics.peakQueuedBytes <= 320 * 1024, 'il producer deve fermarsi entro un chunk oltre la soglia di pausa')
  await manager.close(workspace, session.sessionId)
})
