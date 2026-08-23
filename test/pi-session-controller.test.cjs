const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createPiSessionController } = require('../electron/pi-session-controller.cjs')
const { isPublicError } = require('../electron/public-error.cjs')

function hasPublicCode(code) {
  return (error) => {
    assert.equal(isPublicError(error), true)
    assert.equal(error.publicCode, code)
    return true
  }
}

function fakePty({ pid, exitOnKill = true, ignoreGracefulKill = false, immediateExit, deferredExit, writeError } = {}) {
  const dataListeners = new Set()
  const exitListeners = new Set()
  const process = {
    pid,
    alive: true,
    kills: [],
    writes: [],
    pauses: 0,
    resumes: 0,
    resizes: [],
    disposedDataListeners: 0,
    disposedExitListeners: 0,
    onData(listener) {
      dataListeners.add(listener)
      return { dispose: () => { if (dataListeners.delete(listener)) process.disposedDataListeners += 1 } }
    },
    onExit(listener) {
      exitListeners.add(listener)
      if (immediateExit) listener(immediateExit)
      if (deferredExit) setImmediate(() => process.emitExit(deferredExit))
      return { dispose: () => { if (exitListeners.delete(listener)) process.disposedExitListeners += 1 } }
    },
    emitData(data) {
      for (const listener of [...dataListeners]) listener(data)
    },
    emitExit(event = { exitCode: 0, signal: 0 }) {
      if (!process.alive) return
      process.alive = false
      for (const listener of [...exitListeners]) listener(event)
    },
    kill(signal) {
      process.kills.push(signal ?? null)
      if (ignoreGracefulKill && !signal) return
      if (exitOnKill) process.emitExit({ exitCode: 0, signal: signal === 'SIGKILL' ? 9 : 0 })
    },
    write(data) {
      if (writeError) throw writeError
      process.writes.push(data)
    },
    pause() { process.pauses += 1 },
    resume() { process.resumes += 1 },
    resize(cols, rows) { process.resizes.push({ cols, rows }) },
  }
  return process
}

function testHarness({ executable = '/opt/pi/bin/pi', outcomes = [], stopGraceMs = 5, forceStopMs = 5, isProcessAlive } = {}) {
  let resolvedExecutable = executable
  let nextId = 0
  const processes = []
  const streams = []
  const inputs = []
  const starts = []
  const exits = []
  const errors = []
  const queue = [...outcomes]
  const controller = createPiSessionController({
    resolveExecutable: () => resolvedExecutable,
    environmentForExecutable: () => ({ PATH: '/opt/pi/bin:/usr/bin' }),
    processFactory(_executable, _args, options) {
      const outcome = queue.shift()
      if (outcome instanceof Error) throw outcome
      const ptyProcess = outcome ?? fakePty({ pid: 1_000 + processes.length })
      ptyProcess.options = options
      processes.push(ptyProcess)
      return ptyProcess
    },
    createId: () => `pi-session-${++nextId}`,
    createStream({ sessionId }) {
      const stream = {
        sessionId,
        chunks: [],
        ends: [],
        disposed: 0,
        push(data) { stream.chunks.push(data) },
        end(status) { stream.ends.push(status) },
        dispose() { stream.disposed += 1 },
        waitForInputCapacity: async () => undefined,
      }
      streams.push(stream)
      return stream
    },
    createInput() {
      const input = { disposed: 0, dispose() { input.disposed += 1 } }
      inputs.push(input)
      return input
    },
    onStarted: (event) => starts.push(event),
    onExit: (event) => exits.push(event),
    onError: (event) => errors.push(event),
    isProcessAlive: isProcessAlive ?? ((pid) => processes.find((item) => item.pid === pid)?.alive ?? false),
    stopGraceMs,
    forceStopMs,
  })
  return {
    controller,
    errors,
    exits,
    inputs,
    processes,
    setExecutable(value) { resolvedExecutable = value },
    starts,
    streams,
  }
}

test('eseguibile assente e spawn throw non avvelenano i tentativi successivi', async () => {
  const spawnError = Object.assign(new Error('posix_spawn ENOENT'), { code: 'ENOENT' })
  const recoveredProcess = fakePty({ pid: 101 })
  const harness = testHarness({ executable: null, outcomes: [spawnError, recoveredProcess] })

  await assert.rejects(harness.controller.start('/tmp/workspace'), hasPublicCode('PI_NOT_INSTALLED'))
  assert.equal(harness.processes.length, 0)
  assert.equal(harness.controller.getState().status, 'idle')

  harness.setExecutable('/opt/pi/bin/pi')
  await assert.rejects(harness.controller.start('/tmp/workspace'), hasPublicCode('PI_NOT_RUNNABLE'))
  assert.equal(harness.controller.getState().status, 'idle')

  await harness.controller.start('/tmp/workspace')
  assert.equal(harness.controller.getState().status, 'running')
  assert.equal(harness.controller.getProcess(), recoveredProcess)
  assert.equal(harness.starts.length, 1)
})

test('un crash immediato durante l’aggancio è notificato e consente recovery', async () => {
  const crashed = fakePty({ pid: 201, deferredExit: { exitCode: 127, signal: 0 } })
  const recovered = fakePty({ pid: 202 })
  const harness = testHarness({ outcomes: [crashed, recovered] })

  await assert.rejects(harness.controller.start('/tmp/workspace'), (error) => {
    assert.equal(hasPublicCode('PI_NOT_RUNNABLE')(error), true)
    assert.equal(error.cause?.code, 'PI_EARLY_EXIT')
    assert.match(error.cause?.message, /terminato durante l’avvio.*codice 127/)
    return true
  })
  assert.equal(harness.controller.getState().status, 'exited')
  assert.deepEqual(harness.exits.map(({ exitCode, reason }) => ({ exitCode, reason })), [{ exitCode: 127, reason: 'exit' }])

  await harness.controller.start('/tmp/workspace')
  assert.equal(harness.controller.getProcess(), recovered)
  assert.equal(harness.controller.getState().status, 'running')
})

test('inoltra senza perdita un flusso PTY continuo e ignora i dati stale', async () => {
  const first = fakePty({ pid: 301 })
  const second = fakePty({ pid: 302 })
  const harness = testHarness({ outcomes: [first, second] })
  await harness.controller.start('/tmp/workspace')

  const expected = crypto.createHash('sha256')
  for (let index = 0; index < 4_096; index += 1) {
    const chunk = `${index.toString(16).padStart(8, '0')}:${'x'.repeat(1_015)}`
    expected.update(chunk)
    first.emitData(chunk)
  }
  const actual = crypto.createHash('sha256').update(harness.streams[0].chunks.join(''))
  assert.equal(actual.digest('hex'), expected.digest('hex'))

  await harness.controller.start('/tmp/workspace')
  first.emitData('stale')
  second.emitData('corrente')
  assert.equal(harness.streams[0].chunks.at(-1), `${(4_095).toString(16).padStart(8, '0')}:${'x'.repeat(1_015)}`)
  assert.deepEqual(harness.streams[1].chunks, ['corrente'])
})

test('start-stop-start rapido resta seriale e pulisce listener, stream e input', async () => {
  const first = fakePty({ pid: 401, exitOnKill: false })
  first.kill = function kill(signal) {
    first.kills.push(signal ?? null)
    setImmediate(() => first.emitExit({ exitCode: 0, signal: signal === 'SIGKILL' ? 9 : 0 }))
  }
  const second = fakePty({ pid: 402 })
  const harness = testHarness({ outcomes: [first, second], stopGraceMs: 50, forceStopMs: 10 })
  await harness.controller.start('/tmp/workspace-a')

  const stopping = harness.controller.stop('workspace-change')
  const starting = harness.controller.start('/tmp/workspace-b')
  await Promise.all([stopping, starting])

  assert.equal(first.alive, false)
  assert.equal(harness.controller.getProcess(), second)
  assert.equal(harness.controller.getState().workspacePath, '/tmp/workspace-b')
  assert.equal(first.disposedDataListeners, 1)
  assert.equal(first.disposedExitListeners, 1)
  assert.equal(harness.streams[0].disposed, 1)
  assert.equal(harness.inputs[0].disposed, 1)
  assert.equal(harness.exits[0].reason, 'workspace-change')
})

test('un processo che ignora lo stop graceful riceve SIGKILL prima del replacement', async () => {
  const blocked = fakePty({ pid: 501, ignoreGracefulKill: true })
  const replacement = fakePty({ pid: 502 })
  const harness = testHarness({ outcomes: [blocked, replacement], stopGraceMs: 2, forceStopMs: 10 })
  await harness.controller.start('/tmp/workspace')

  await harness.controller.start('/tmp/workspace')

  assert.deepEqual(blocked.kills, [null, 'SIGKILL'])
  assert.equal(blocked.alive, false)
  assert.equal(harness.controller.getProcess(), replacement)
  assert.equal(harness.processes.filter((item) => item.alive).length, 1)
})

test('se neppure SIGKILL è confermato blocca il doppio processo ma recupera dopo exit', async () => {
  const stuck = fakePty({ pid: 601, exitOnKill: false })
  const replacement = fakePty({ pid: 602 })
  const harness = testHarness({
    outcomes: [stuck, replacement],
    stopGraceMs: 1,
    forceStopMs: 1,
    isProcessAlive: (pid) => pid === stuck.pid ? stuck.alive : false,
  })
  await harness.controller.start('/tmp/workspace')

  await assert.rejects(harness.controller.start('/tmp/workspace'), (error) => error.code === 'PI_STOP_FAILED')
  assert.equal(harness.processes.length, 1, 'non deve creare un replacement finché il vecchio PID risulta vivo')
  assert.equal(harness.controller.getProcess(), stuck)

  stuck.emitExit({ exitCode: 1, signal: 9 })
  await harness.controller.start('/tmp/workspace')
  assert.equal(harness.controller.getProcess(), replacement)
  assert.equal(harness.controller.getState().status, 'running')
})

test('un errore write/reload chiude la sessione guasta e permette un nuovo avvio', async () => {
  const broken = fakePty({ pid: 701, writeError: new Error('write EPIPE') })
  const recovered = fakePty({ pid: 702 })
  const harness = testHarness({ outcomes: [broken, recovered] })
  await harness.controller.start('/tmp/workspace')

  await assert.rejects(harness.controller.reload(), /write EPIPE/)
  assert.equal(broken.alive, false)
  assert.equal(harness.controller.getState().status, 'idle')

  await harness.controller.start('/tmp/workspace')
  assert.equal(harness.controller.getProcess(), recovered)
  assert.ok(harness.errors.some((event) => event.source === 'reload'))
})

test('lo shutdown attende exit e rilascia tutte le risorse della sessione', async () => {
  const process = fakePty({ pid: 801 })
  const harness = testHarness({ outcomes: [process] })
  await harness.controller.start('/tmp/workspace')

  const result = await harness.controller.stop('shutdown')

  assert.deepEqual(result, { stopped: true })
  assert.equal(harness.controller.getState().status, 'idle')
  assert.equal(harness.streams[0].disposed, 1)
  assert.equal(harness.inputs[0].disposed, 1)
  assert.equal(harness.exits[0].reason, 'shutdown')
})

test('il main attende controller Pi su restart, cambio workspace e shutdown', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.match(source, /const piSessionController = createPiSessionController\(/)
  assert.match(source, /async function restartPi\(\)[\s\S]*?await startPi\(workspacePath\)/)
  assert.match(source, /async function cleanupWorkspaceRuntime\(workspacePath, reason\)[\s\S]*?await stopTerminal\(reason\)/)
  assert.match(source, /async function openWorkspace\(workspacePath\)[\s\S]*?await cleanupWorkspaceRuntime\(previousWorkspacePath, 'workspace-change'\)[\s\S]*?await stopTerminal\('workspace-change'\)[\s\S]*?await startPi\(normalizedWorkspacePath\)/)
  assert.match(source, /async function shutdownApplication\(\)[\s\S]*?await stopTerminal\('shutdown'\)[\s\S]*?await withCleanupDeadline\(githubOperations\.abortAndWaitMatching\(\), 4_000, 'github-operations'\)/)
  assert.doesNotMatch(source, /let terminalProcess|let terminalStream|let terminalInput/)
})
