const assert = require('node:assert/strict')
const test = require('node:test')

const { createShellOutputTransport, splitUtf8Output } = require('../electron/domains/shell/shell-output-transport.cjs')
const { createShellProcessLifecycle } = require('../electron/domains/shell/shell-process-lifecycle.cjs')
const { publicWorkspace, validateDimensions } = require('../electron/domains/shell/shell-session-model.cjs')

test('il modello valida le dimensioni e serializza le sessioni in ordine di creazione', () => {
  assert.deepEqual(validateDimensions({ cols: '120', rows: 34 }), { cols: 120, rows: 34 })
  assert.throws(() => validateDimensions({ cols: 1, rows: 34 }), /Dimensioni terminale non valide/u)

  const newer = {
    sessionId: 'session-0002', title: 'Terminale 2', status: 'exited', createdAt: 2, lastFocusedAt: 2,
    creationSequence: 2, cols: 120, rows: 34, process: null, exitStatus: { exitCode: 7, signal: 0 },
  }
  const older = {
    sessionId: 'session-0001', title: 'Terminale 1', status: 'running', createdAt: 1, lastFocusedAt: 1,
    creationSequence: 1, cols: 80, rows: 24, process: { pid: 42 }, exitStatus: null,
  }
  const state = {
    root: '/workspace',
    activeSessionId: older.sessionId,
    sessions: new Map([[newer.sessionId, newer], [older.sessionId, older]]),
  }
  const result = publicWorkspace(state)

  assert.deepEqual(result.sessions.map(({ sessionId }) => sessionId), ['session-0001', 'session-0002'])
  assert.equal(result.sessions[0].active, true)
  assert.equal(result.sessions[0].pid, 42)
  assert.deepEqual(result.sessions[1].exitStatus, { exitCode: 7, signal: 0 })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.sessions), true)
})

test('il trasporto output conserva i confini UTF-8 e consegna un solo blocco live per ACK', () => {
  const chunks = splitUtf8Output('a🙂èb', 4)
  assert.equal(chunks.map(({ data }) => data).join(''), 'a🙂èb')
  assert.ok(chunks.every(({ bytes }) => bytes <= 4))

  const events = []
  const transport = createShellOutputTransport({ onData: (event) => events.push(event) })
  const process = {
    pause() {},
    resume() {},
  }
  const session = {
    workspacePath: '/workspace',
    sessionId: 'session-0001',
    generation: 1,
    status: 'running',
    process,
    exitStatus: null,
  }
  transport.initialize(session)
  transport.append(session, 1, 'storico')
  const snapshot = transport.resume(session, 'attach-0001')
  assert.equal(snapshot.blocks.map(({ data }) => data).join(''), 'storico')
  assert.equal(transport.rendererReady(session, snapshot), true)

  transport.append(session, 1, 'live')
  assert.deepEqual(events.map(({ data }) => data), ['live'])
  assert.equal(transport.acknowledge(session, events[0]), true)
  assert.equal(transport.diagnostics(session).queuedBytes, 0)
})

test('il lifecycle prende ownership del PTY prima di riprodurre eventi sincroni e conferma la chiusura', async () => {
  const dataEvents = []
  const exitEvents = []
  let exitListener = null
  let stopped = 0
  let disposed = 0
  const ptyProcess = {
    pid: 91,
    write() {},
    resize() {},
    pause() {},
    resume() {},
    kill() {
      queueMicrotask(() => exitListener({ exitCode: 0, signal: 0 }))
    },
    onData(listener) {
      listener('output sincrono')
      return { dispose: () => { disposed += 1 } }
    },
    onExit(listener) {
      exitListener = listener
      return { dispose: () => { disposed += 1 } }
    },
  }
  const lifecycle = createShellProcessLifecycle({
    processFactory: () => ptyProcess,
    getExecutable: () => '/bin/fake-shell',
    getEnvironment: () => ({}),
    isProcessAlive: () => false,
    onData: (session, generation, data) => dataEvents.push({ owned: session.process === ptyProcess, generation, data }),
    onExit: (event) => exitEvents.push(event),
    onProcessStopped: () => { stopped += 1 },
  })
  const session = {
    sessionId: 'session-0001',
    workspacePath: '/workspace',
    cols: 120,
    rows: 34,
    status: 'starting',
    generation: 0,
    process: null,
    processExit: null,
    stopReason: null,
    dataSubscription: null,
    exitSubscription: null,
    exitStatus: null,
  }

  lifecycle.spawn(session)
  assert.deepEqual(dataEvents, [{ owned: true, generation: 1, data: 'output sincrono' }])
  await lifecycle.terminate(session, 'closed')

  assert.equal(session.process, null)
  assert.equal(session.status, 'exited')
  assert.deepEqual(session.exitStatus, { exitCode: 0, signal: 0 })
  assert.equal(stopped, 1)
  assert.equal(disposed, 2)
  assert.deepEqual(exitEvents.map(({ reason }) => reason), ['closed'])
})
