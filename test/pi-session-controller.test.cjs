const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createPiSessionController } = require('../electron/domains/ai/pi-session-controller.cjs')
const { createAiTerminalLaunchPolicy } = require('../electron/domains/ai/ai-terminal-launch-policy.cjs')
const { isPublicError } = require('../electron/domains/errors/public-error.cjs')

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

function testHarness({ executable = '/opt/pi/bin/pi', outcomes = [], stopGraceMs = 5, forceStopMs = 5, isProcessAlive, resolveLaunchCandidates } = {}) {
  let resolvedExecutable = executable
  let nextId = 0
  const processes = []
  const streams = []
  const inputs = []
  const starts = []
  const exits = []
  const errors = []
  const changes = []
  const queue = [...outcomes]
  const launchPolicy = createAiTerminalLaunchPolicy({
    environmentForExecutable: () => ({ PATH: '/opt/pi/bin:/usr/bin' }),
    resolvePiExecutable: () => resolvedExecutable,
  })
  const controller = createPiSessionController({
    resolveLaunchCandidates: resolveLaunchCandidates ?? launchPolicy.resolveCandidates,
    processFactory(executable, args, options) {
      const outcome = queue.shift()
      if (outcome instanceof Error) throw outcome
      const ptyProcess = outcome ?? fakePty({ pid: 1_000 + processes.length })
      ptyProcess.executable = executable
      ptyProcess.args = args
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
    onChanged: (state) => changes.push(state),
    isProcessAlive: isProcessAlive ?? ((pid) => processes.find((item) => item.pid === pid)?.alive ?? false),
    stopGraceMs,
    forceStopMs,
  })
  return {
    controller,
    changes,
    errors,
    exits,
    inputs,
    processes,
    setExecutable(value) { resolvedExecutable = value },
    starts,
    streams,
  }
}

test('gestisce quattro agenti concorrenti con stato, output e lifecycle isolati', async () => {
  const processes = [901, 902, 903, 904].map((pid) => fakePty({ pid }))
  const harness = testHarness({ outcomes: processes })
  const started = await harness.controller.start('/tmp/workspace')
  const second = await harness.controller.create('/tmp/workspace')
  const third = await harness.controller.create('/tmp/workspace')
  const fourth = await harness.controller.create('/tmp/workspace')

  assert.equal(harness.controller.list('/tmp/workspace').sessions.length, 4)
  assert.equal(harness.controller.list('/tmp/workspace').activeSessionId, fourth.sessionId)
  assert.equal(harness.controller.reportActivity(second.sessionId, 'working'), true)
  assert.equal(harness.controller.reportActivity(third.sessionId, 'completed'), true)
  harness.controller.rename('/tmp/workspace', second.sessionId, 'Query database')
  harness.controller.focus('/tmp/workspace', second.sessionId)

  processes[0].emitData('primo')
  processes[1].emitData('secondo')
  processes[2].emitData('terzo')
  processes[3].emitData('quarto')
  assert.deepEqual(harness.streams.map((stream) => stream.chunks), [['primo'], ['secondo'], ['terzo'], ['quarto']])
  const state = harness.controller.list('/tmp/workspace')
  assert.equal(state.sessions.find((session) => session.sessionId === second.sessionId).title, 'Query database')
  assert.equal(state.sessions.find((session) => session.sessionId === second.sessionId).activity, 'working')
  assert.equal(state.sessions.find((session) => session.sessionId === third.sessionId).activity, 'completed')
  await assert.rejects(harness.controller.create('/tmp/workspace'), /al massimo 4 sessioni Pi/)

  const closed = await harness.controller.close('/tmp/workspace', second.sessionId)
  assert.equal(closed.closed, true)
  assert.notEqual(closed.activeSessionId, second.sessionId)
  assert.equal(processes[1].alive, false)
  assert.equal(processes[0].alive, true)
  assert.equal(harness.controller.list('/tmp/workspace').sessions.some((session) => session.sessionId === started.sessionId), true)
  assert.ok(harness.changes.length >= 10)
})

test('richiede candidati e liveness come collaboratori del Terminale AI', () => {
  const base = {
    processFactory() {},
    createStream() {},
    createInput() {},
  }
  assert.throws(() => createPiSessionController(base), /Resolver candidati Terminale AI non valido/u)
  assert.throws(
    () => createPiSessionController({ ...base, resolveLaunchCandidates: () => [] }),
    /Verifica processo Pi non valida/u,
  )
})

test('runtime assenti e spawn throw non avvelenano i tentativi successivi', async () => {
  const spawnError = Object.assign(new Error('posix_spawn ENOENT'), { code: 'ENOENT' })
  const recoveredProcess = fakePty({ pid: 101 })
  const harness = testHarness({ executable: null, outcomes: [spawnError, recoveredProcess] })

  await assert.rejects(harness.controller.start('/tmp/workspace'), hasPublicCode('PI_NOT_INSTALLED'))
  assert.equal(harness.processes.length, 0)
  assert.equal(harness.controller.getState().status, 'error')

  harness.setExecutable('/opt/pi/bin/pi')
  await assert.rejects(harness.controller.start('/tmp/workspace'), hasPublicCode('PI_NOT_RUNNABLE'))
  assert.equal(harness.controller.getState().status, 'error')

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
    assert.equal(error.cause?.code, 'AI_TERMINAL_EARLY_EXIT')
    assert.match(error.cause?.message, /terminato durante l’avvio.*codice 127/)
    return true
  })
  assert.equal(harness.controller.getState().status, 'error')
  assert.deepEqual(harness.exits, [])

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

  const sessionId = harness.controller.getState().activeSessionId
  await assert.rejects(harness.controller.reload('/tmp/workspace', sessionId), /write EPIPE/)
  assert.equal(broken.alive, false)
  assert.equal(harness.controller.getState().status, 'error')

  await harness.controller.start('/tmp/workspace')
  assert.equal(harness.controller.getProcess(), recovered)
  assert.ok(harness.errors.some((event) => event.source === 'reload'))
})

test('lo shutdown attende exit e rilascia tutte le risorse della sessione', async () => {
  const process = fakePty({ pid: 801 })
  const harness = testHarness({ outcomes: [process] })
  await harness.controller.start('/tmp/workspace')

  const result = await harness.controller.stop('shutdown')

  assert.deepEqual(result, { stopped: true, closed: 1 })
  assert.equal(harness.controller.getState().status, 'idle')
  assert.equal(harness.streams[0].disposed, 1)
  assert.equal(harness.inputs[0].disposed, 1)
  assert.equal(harness.exits[0].reason, 'shutdown')
})

test('il main attende controller Pi su restart, cambio workspace e shutdown', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const shutdownRuntime = fs.readFileSync(path.join(__dirname, '../electron/app/application-shutdown-runtime.cjs'), 'utf8')
  const runtime = fs.readFileSync(path.join(__dirname, '../electron/domains/ai/pi-runtime.cjs'), 'utf8')
  const cleanup = fs.readFileSync(path.join(__dirname, '../electron/domains/workspace/workspace-runtime-cleanup.cjs'), 'utf8')
  const opener = fs.readFileSync(path.join(__dirname, '../electron/domains/workspace/workspace-opener.cjs'), 'utf8')

  assert.match(source, /const piRuntime = createPiRuntime\(\{/)
  assert.match(source, /deliverPiConfigData: \(payload\) => sendToRenderer\(IPC_CHANNELS\.PI_CONFIG_DATA, payload\)/)
  assert.match(source, /deliverPiConfigExit: \(payload\) => sendToRenderer\(IPC_CHANNELS\.PI_CONFIG_EXIT, payload\)/)
  assert.match(source, /deliverTerminalExit: \(payload\) => sendToRenderer\(IPC_CHANNELS\.TERMINAL_EXIT, payload\)/)
  assert.match(source, /deliverTerminalOutput: \(payload\) => sendToRenderer\(IPC_CHANNELS\.TERMINAL_OUTPUT, payload\)/)
  assert.match(source, /deliverTerminalStreamState: \(payload\) => sendToRenderer\(IPC_CHANNELS\.TERMINAL_STREAM_STATE, payload\)/)
  assert.match(source, /const piSessionController = piRuntime\.controller/)
  assert.match(runtime, /async function restart\(sessionId\)[\s\S]*?controller\.restart\(requireActiveWorkspace\(\), sessionId\)/)
  assert.match(cleanup, /cleanupWorkspaceRuntime\(workspacePath, reason\)[\s\S]*?await stopTerminal\(reason\)/)
  assert.match(source, /const openWorkspace = workspaceOpener\.open/)
  assert.match(opener, /async function open\(workspacePath\)[\s\S]*?await cleanupWorkspaceRuntime\(previousWorkspacePath, 'workspace-change'\)[\s\S]*?await stopTerminal\('workspace-change'\)[\s\S]*?await startPi\(normalizedWorkspacePath\)/)
  assert.match(shutdownRuntime, /async function shutdownApplication\(\)[\s\S]*?await stopTerminal\('shutdown'\)[\s\S]*?await withDeadline\(githubOperations\.abortAndWaitMatching\(\), 4_000, 'github-operations'\)/)
  assert.doesNotMatch(source, /let terminalProcess|let terminalStream|let terminalInput/)
  assert.doesNotMatch(runtime, /ipc\/channels\.cjs|IPC_CHANNELS|sendToRenderer|['"](?:terminal|piConfig):/)
})
