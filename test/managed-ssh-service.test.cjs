const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const test = require('node:test')

const { createManagedSshService, quoteShellArg } = require('../electron/managed-ssh-service.cjs')

function createCommand(destination = 'api-prod') {
  return {
    id: 'command-a',
    categoryId: 'category-a',
    title: 'Produzione',
    kind: 'ssh',
    command: '',
    note: '',
    sshDestination: destination,
    remoteRoot: '/srv/api',
  }
}

function createSpawn(results, calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options })
    const result = results.shift() ?? { exitCode: 0 }
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => undefined
    queueMicrotask(() => {
      if (result.stdout) child.stdout.end(result.stdout)
      else child.stdout.end()
      if (result.stderr) child.stderr.end(result.stderr)
      else child.stderr.end()
      child.emit('close', result.exitCode)
    })
    return child
  }
}

function createFixture(t, results = [], overrides = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-ssh-'))
  const calls = []
  const statuses = []
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))
  const service = createManagedSshService({
    spawn: createSpawn(results, calls),
    accessSync: () => undefined,
    tempRoot,
    sendStatus: (status) => statuses.push(status),
    log: () => undefined,
    delay: async () => undefined,
    ...overrides,
  })
  return { service, calls, statuses, tempRoot }
}

function createTimerHarness() {
  const timers = []
  return {
    clearTimer(timer) {
      timer.active = false
    },
    runNext() {
      const timer = timers.find((candidate) => candidate.active)
      assert.ok(timer, 'timer attivo atteso')
      timer.active = false
      timer.callback()
      return timer.milliseconds
    },
    setTimer(callback, milliseconds) {
      const timer = { active: true, callback, milliseconds }
      timers.push(timer)
      return timer
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

test('crea un socket breve privato e un comando SSH quotato', (t) => {
  const { service } = createFixture(t)
  const launch = service.buildTerminalCommand('/tmp/workspace-a', createCommand())

  assert.match(launch.command, /^'\/usr\/bin\/ssh' -o 'ControlMaster=auto'/)
  assert.ok(Buffer.byteLength(launch.socketPath) < 100)
  assert.equal(launch.connection.destination, 'api-prod')
  assert.equal(launch.connection.remoteRoot, '/srv/api')
  assert.equal(fs.statSync(path.dirname(launch.socketPath)).mode & 0o777, 0o700)
  assert.equal(launch.command.includes('shell: true'), false)
})

test('controlla e chiude il master senza usare una shell', async (t) => {
  const { service, calls } = createFixture(t, [{ exitCode: 0 }, { exitCode: 0 }])
  const { connection } = service.buildTerminalCommand('/tmp/workspace-a', createCommand())

  assert.equal(await service.check(connection.id), true)
  assert.equal(await service.disconnect(connection.id), true)
  assert.deepEqual(calls.map((call) => call.args.at(-2)), ['--', '--'])
  assert.deepEqual(calls.map((call) => call.args.at(-3)), ['check', 'exit'])
  assert.equal(calls.every((call) => call.options.shell === false), true)
  assert.equal(service.get(connection.id).state, 'disconnected')
})

test('registra il cleanup SSH con metadati correlati senza esporre il dettaglio tecnico', async (t) => {
  const logs = []
  const { service } = createFixture(t, [{ exitCode: 0 }], {
    log: (...entry) => logs.push(entry),
    removeSync: () => { throw new Error('token=non-mostrare cleanup negato') },
  })
  const { connection } = service.buildTerminalCommand('/tmp/workspace-a', createCommand())

  assert.equal(await service.disconnect(connection.id), true)
  const cleanup = logs.find(([, event]) => event === 'managed_ssh_socket_cleanup_failed')
  assert.ok(cleanup)
  assert.equal(cleanup[0], 'warn')
  assert.equal(cleanup[2].category, 'filesystem')
  assert.equal(cleanup[2].code, 'SSH_SOCKET_CLEANUP_FAILED')
  assert.match(cleanup[2].correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.equal(JSON.stringify(cleanup).includes('non-mostrare'), false)
  assert.equal('error' in cleanup[2], false)
})

test('isola workspace e rende closeAll idempotente', async (t) => {
  const { service } = createFixture(t, [{ exitCode: 0 }, { exitCode: 0 }])
  service.buildTerminalCommand('/tmp/workspace-a', createCommand('api-a'))
  service.buildTerminalCommand('/tmp/workspace-b', createCommand('api-b'))

  assert.equal(service.list('/tmp/workspace-a').length, 1)
  assert.equal(service.list('/tmp/workspace-b').length, 1)
  await service.closeAll()
  await service.closeAll()
  assert.equal(service.list('/tmp/workspace-a').length, 0)
  assert.equal(service.list('/tmp/workspace-b').length, 0)
})

test('rifiuta destinazioni ambigue e segnala timeout di connessione', async (t) => {
  const { service, statuses } = createFixture(t, [{ exitCode: 255, stderr: 'not connected' }])
  assert.throws(() => service.buildTerminalCommand('/tmp/workspace-a', createCommand('-oProxyCommand=evil')), /Destinazione SSH non valida/)
  const { connection } = service.buildTerminalCommand('/tmp/workspace-a', createCommand())

  const connected = await service.waitUntilConnected(connection.id, { timeoutMs: 0 })
  assert.equal(connected, false)
  assert.equal(service.get(connection.id).state, 'error')
  assert.equal(statuses.at(-1).state, 'error')
})

test('il controllo scaduto termina un child resistente e risolve solo su close', async (t) => {
  const timers = createTimerHarness()
  const kills = []
  let childClosed = false
  const spawn = () => {
    const child = new EventEmitter()
    child.kill = (signal) => {
      kills.push(signal)
      if (signal === 'SIGKILL') queueMicrotask(() => {
        childClosed = true
        child.emit('close', null, 'SIGKILL')
      })
      return true
    }
    return child
  }
  const { service } = createFixture(t, [], {
    spawn,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    controlTimeoutMs: 10,
    killGraceMs: 5,
  })
  const { connection } = service.buildTerminalCommand('/tmp/workspace-a', createCommand())
  let resolved = false
  const checking = service.check(connection.id).then((value) => {
    resolved = true
    return value
  })

  assert.equal(timers.runNext(), 10)
  await Promise.resolve()
  assert.equal(resolved, false)
  assert.equal(childClosed, false)
  assert.deepEqual(kills, ['SIGTERM'])

  assert.equal(timers.runNext(), 5)
  assert.equal(await checking, false)
  assert.equal(resolved, true)
  assert.equal(childClosed, true)
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL'])
})

test('disconnect annulla un check pendente senza resurrezione e conserva uno stato elencabile', async (t) => {
  const calls = []
  const spawn = (_executable, args) => {
    const operation = args.at(-3)
    calls.push(operation)
    const child = new EventEmitter()
    child.kill = () => {
      queueMicrotask(() => child.emit('close', 0))
      return true
    }
    if (operation === 'exit') queueMicrotask(() => child.emit('close', 0))
    return child
  }
  const { service, statuses } = createFixture(t, [], { spawn })
  const launch = service.buildTerminalCommand('/tmp/workspace-a', createCommand())
  const polling = service.waitUntilConnected(launch.connection.id)

  assert.equal(await service.disconnect(launch.connection.id), true)
  assert.equal(await polling, false)
  assert.deepEqual(calls, ['check', 'exit'])
  assert.equal(service.get(launch.connection.id).state, 'disconnected')
  assert.equal(service.list('/tmp/workspace-a').find((item) => item.id === launch.connection.id)?.state, 'disconnected')
  assert.equal(fs.existsSync(path.dirname(launch.socketPath)), false)
  const disconnectedIndex = statuses.findIndex((status) => status.id === launch.connection.id && status.state === 'disconnected')
  assert.notEqual(disconnectedIndex, -1)
  assert.equal(statuses.slice(disconnectedIndex + 1).some((status) => ['connected', 'error'].includes(status.state)), false)

  const next = service.buildTerminalCommand('/tmp/workspace-a', createCommand())
  assert.deepEqual(service.list('/tmp/workspace-a').map((item) => item.id), [next.connection.id])
})

test('un exit SSH non riuscito resta diagnostico e closeWorkspace può essere ritentato', async (t) => {
  const logs = []
  const { service } = createFixture(t, [{ exitCode: 255 }, { exitCode: 0 }], {
    log: (level, event, details) => logs.push({ level, event, details }),
  })
  const launch = service.buildTerminalCommand('/tmp/workspace-a', createCommand('user@private-host'))
  const socketDirectory = path.dirname(launch.socketPath)

  await assert.rejects(service.closeWorkspace('/tmp/workspace-a'), (error) => {
    assert.equal(error.code, 'MANAGED_SSH_CLEANUP_FAILED')
    assert.equal(error.failed, 1)
    return true
  })
  assert.equal(service.list('/tmp/workspace-a').length, 1)
  assert.equal(service.get(launch.connection.id).state, 'error')
  assert.equal(service.get(launch.connection.id).error, 'Chiusura della connessione SSH non confermata. Riprova prima di chiudere il workspace.')
  assert.equal(fs.existsSync(socketDirectory), true)
  assert.equal(JSON.stringify(logs).includes('user@private-host'), false)
  assert.deepEqual(logs.at(-1), {
    level: 'warn',
    event: 'managed_ssh_disconnect_failed',
    details: { connectionId: launch.connection.id, operation: 'exit', reason: 'exit' },
  })

  assert.deepEqual(await service.closeWorkspace('/tmp/workspace-a'), { closed: 1, failed: 0 })
  assert.equal(service.list('/tmp/workspace-a').length, 0)
  assert.equal(fs.existsSync(socketDirectory), false)
})

test('un exit SSH bloccato usa TERM e KILL, conserva il cleanup e il retry non lascia residui', async (t) => {
  const timers = createTimerHarness()
  const kills = []
  let spawnCount = 0
  let unrefs = 0
  const spawn = () => {
    spawnCount += 1
    const child = new EventEmitter()
    child.kill = (signal) => {
      kills.push(signal)
      return true
    }
    child.unref = () => { unrefs += 1 }
    if (spawnCount > 1) queueMicrotask(() => child.emit('close', 0))
    return child
  }
  const { service } = createFixture(t, [], {
    spawn,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    controlTimeoutMs: 10,
    killGraceMs: 5,
  })
  const launch = service.buildTerminalCommand('/tmp/workspace-a', createCommand())
  const socketDirectory = path.dirname(launch.socketPath)
  const closing = service.closeWorkspace('/tmp/workspace-a')

  assert.equal(timers.runNext(), 10)
  assert.equal(timers.runNext(), 5)
  assert.equal(timers.runNext(), 5)
  await assert.rejects(closing, (error) => error.code === 'MANAGED_SSH_CLEANUP_FAILED')
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL'])
  assert.equal(unrefs, 1)
  assert.equal(service.list('/tmp/workspace-a').length, 1)
  assert.equal(service.get(launch.connection.id).state, 'error')
  assert.equal(fs.existsSync(socketDirectory), true)

  assert.deepEqual(await service.closeWorkspace('/tmp/workspace-a'), { closed: 1, failed: 0 })
  assert.equal(service.list('/tmp/workspace-a').length, 0)
  assert.equal(fs.existsSync(socketDirectory), false)
})

test('closeWorkspace e closeAll interrompono i delay senza transizioni tardive', async (t) => {
  const delayed = []
  const delayStarted = deferred()
  let delayCount = 0
  const delay = () => {
    const pending = deferred()
    delayed.push(pending)
    delayCount += 1
    if (delayCount === 2) delayStarted.resolve()
    return pending.promise
  }
  const spawn = (_executable, args) => {
    const child = new EventEmitter()
    child.kill = () => true
    queueMicrotask(() => child.emit('close', args.at(-3) === 'check' ? 255 : 0))
    return child
  }
  const { service, statuses } = createFixture(t, [], { spawn, delay })
  const first = service.buildTerminalCommand('/tmp/workspace-a', createCommand('api-a')).connection
  const second = service.buildTerminalCommand('/tmp/workspace-b', createCommand('api-b')).connection
  const firstPolling = service.waitUntilConnected(first.id, { timeoutMs: 10_000 })
  const secondPolling = service.waitUntilConnected(second.id, { timeoutMs: 10_000 })
  await delayStarted.promise

  await service.closeWorkspace('/tmp/workspace-a')
  assert.equal(await firstPolling, false)
  assert.throws(() => service.get(first.id), /non trovata/)
  assert.equal(service.list('/tmp/workspace-a').length, 0)
  assert.equal(service.get(second.id).state, 'connecting')

  await service.closeAll()
  assert.equal(await secondPolling, false)
  assert.throws(() => service.get(second.id), /non trovata/)
  assert.equal(service.list('/tmp/workspace-b').length, 0)
  for (const pending of delayed) pending.resolve()
  await Promise.resolve()
  const lastState = new Map()
  for (const status of statuses) lastState.set(status.id, status.state)
  assert.equal(lastState.get(first.id), 'disconnected')
  assert.equal(lastState.get(second.id), 'disconnected')
})

test('quota argomenti shell senza consentire espansioni', () => {
  assert.equal(quoteShellArg("a'b"), "'a'\\''b'")
  assert.throws(() => quoteShellArg('a\nrm -rf x'), /Argomento shell non valido/)
})

test('il main chiude i master SSH con shell workspace e applicazione', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  assert.match(main, /createManagedSshService/)
  assert.match(main, /managedSsh\.closeWorkspace\(workspacePath\)/)
  assert.match(main, /managedSsh\.closeAll\(\)/)
})
