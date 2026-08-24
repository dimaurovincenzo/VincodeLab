const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const test = require('node:test')

const { isApplicationError } = require('../electron/domains/errors/application-error.cjs')
const { isPublicError } = require('../electron/domains/errors/public-error.cjs')
const { getSftpErrorMetadata, parseSftpList, quoteSftpPath } = require('../electron/domains/remote/sftp-protocol.cjs')
const { createSftpService } = require('../electron/infrastructure/remote/sftp-service.adapter.cjs')

function connection() {
  return { id: 'connection-a', workspacePath: '/tmp/workspace-a', sftpPath: '/usr/bin/sftp', socketPath: '/tmp/vl/socket', destination: 'api-test' }
}

function createSpawn(outputs, { onActive } = {}) {
  let active = 0
  return (executable, args, options) => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => child.emit('close', null, 'SIGTERM')
    active += 1
    onActive?.(active, { executable, args, options, child })
    const output = outputs.shift() ?? { stdout: '', stderr: '', exitCode: 0, wait: 0 }
    setTimeout(() => {
      child.stdout.end(output.stdout ?? '')
      child.stderr.end(output.stderr ?? '')
      active -= 1
      child.emit('close', output.exitCode ?? 0, null)
    }, output.wait ?? 0)
    return child
  }
}

test('quota percorsi SFTP e rifiuta caratteri di controllo', () => {
  assert.equal(quoteSftpPath('/srv/File prova.txt'), '"/srv/File prova.txt"')
  assert.equal(quoteSftpPath('/srv/a"b'), '"/srv/a\\"b"')
  assert.equal(quoteSftpPath('/srv/a\\b'), '"/srv/a\\\\b"')
  assert.throws(() => quoteSftpPath('/srv/a\nrm x'), /Percorso remoto non valido/)
})

test('normalizza un elenco OpenSSH senza indovinare righe ambigue', () => {
  const entries = parseSftpList([
    '-rw-r----- 1 1000 1000 12 Aug 21 10:30 File prova.txt',
    'drwxr-xr-x 2 1000 1000 64 Aug 20 2025 config',
    'lrwxrwxrwx 1 1000 1000 8 Aug 20 2025 current -> releases',
    'riga non interpretabile',
  ].join('\n'))

  assert.deepEqual(entries[0], { name: 'File prova.txt', kind: 'file', size: 12, mode: 0o640, modifiedAt: null, linkTarget: null, destructiveAllowed: true })
  assert.equal(entries[1].kind, 'directory')
  assert.deepEqual({ name: entries[2].name, linkTarget: entries[2].linkTarget, destructiveAllowed: entries[2].destructiveAllowed }, { name: 'current', linkTarget: 'releases', destructiveAllowed: false })
  assert.equal(entries[3].kind, 'unknown')
  assert.equal(entries[3].destructiveAllowed, false)
})

test('normalizza il listing assoluto di OpenSSH macOS e filtra dot entry', () => {
  const root = '/private/tmp/vincodelab-sftp-uat/remote'
  const entries = parseSftpList([
    `drwx------    ? vdm wheel 128 Aug 22 22:49 ${root}/.`,
    `drwx------    ? vdm wheel 416 Aug 22 22:49 ${root}/..`,
    `-rw-r--r--    ? vdm wheel  26 Aug 22 22:49 ${root}/seed.txt`,
    `drwxr-x---    ? vdm wheel  64 Aug 22 22:49 ${root}/config`,
    `lrwxr-xr-x    ? vdm wheel   8 Aug 22 22:49 ${root}/current -> releases`,
  ].join('\n'))

  assert.deepEqual(entries.map((entry) => entry.name), ['seed.txt', 'config', 'current'])
  assert.deepEqual(entries.map((entry) => entry.kind), ['file', 'directory', 'link'])
  assert.equal(entries[0].mode, 0o644)
  assert.equal(entries[1].destructiveAllowed, true)
  assert.equal(entries[2].linkTarget, 'releases')
  assert.equal(entries[2].destructiveAllowed, false)
})

test('serializza le operazioni della stessa connessione', async () => {
  let maximumActive = 0
  const service = createSftpService({
    spawn: createSpawn([{ wait: 15 }, { wait: 0 }], { onActive: (active) => { maximumActive = Math.max(maximumActive, active) } }),
    timeoutMs: 1_000,
    maxOutputBytes: 1_024,
    maxConcurrentPerConnection: 1,
  })

  await Promise.all([
    service.mkdir(connection(), '/srv/prima'),
    service.mkdir(connection(), '/srv/seconda'),
  ])
  assert.equal(maximumActive, 1)
})

test('usa ControlPath senza shell e restituisce gli elementi', async () => {
  const calls = []
  const service = createSftpService({
    spawn: createSpawn([{ stdout: '-rw------- 1 user group 4 Aug 21 10:30 .env\n' }], { onActive: (_active, call) => calls.push(call) }),
    timeoutMs: 1_000,
    maxOutputBytes: 1_024,
    maxConcurrentPerConnection: 1,
  })

  const entries = await service.list(connection(), '/srv/app')
  assert.equal(entries[0].name, '.env')
  assert.equal(calls[0].executable, '/usr/bin/sftp')
  assert.equal(calls[0].options.shell, false)
  assert.deepEqual(calls[0].args.slice(0, 5), ['-q', '-b', '-', '-o', 'ControlPath=/tmp/vl/socket'])
})

test('classifica stderr SSH e SFTP senza esporre dettagli tecnici', async (t) => {
  const remoteFile = '/srv/private/report.txt'
  const cases = [
    {
      name: 'host non raggiungibile',
      stderr: 'ssh: Could not resolve hostname server.private.example: Name or service not known token=host-secret',
      operation: 'list',
      category: 'network',
      code: 'SFTP_HOST_UNREACHABLE',
      publicCopy: /server remoto non è raggiungibile/u,
    },
    {
      name: 'autenticazione rifiutata',
      stderr: 'alice@server: Permission denied (publickey,password). token=auth-secret',
      operation: 'download',
      category: 'authentication',
      code: 'SFTP_AUTHENTICATION_REQUIRED',
      publicCopy: /Verifica credenziali e chiave SSH/u,
    },
    {
      name: 'chiave host non verificata',
      stderr: 'Host key verification failed. /Users/alice/.ssh/known_hosts token=host-key-secret',
      operation: 'list',
      category: 'authentication',
      code: 'SFTP_HOST_KEY_UNVERIFIED',
      publicCopy: /identità del server remoto non è verificata/u,
    },
    {
      name: 'chiave host cambiata',
      stderr: 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! Offending key in /Users/alice/.ssh/known_hosts',
      operation: 'list',
      category: 'conflict',
      code: 'SFTP_HOST_KEY_CHANGED',
      publicCopy: /chiave del server remoto è cambiata/u,
    },
    {
      name: 'timeout',
      stderr: 'Connection timed out while opening /srv/private/report.txt token=timeout-secret',
      operation: 'download',
      category: 'timeout',
      code: 'SFTP_TIMEOUT',
      publicCopy: /non ha risposto nel tempo previsto/u,
    },
    {
      name: 'permesso remoto negato',
      stderr: 'remote open "/srv/private/report.txt": Permission denied token=permission-secret',
      operation: 'upload',
      category: 'permission',
      code: 'SFTP_PERMISSION_DENIED',
      publicCopy: /Non hai i permessi necessari/u,
    },
    {
      name: 'file non trovato',
      stderr: 'Couldn\'t stat remote file: No such file or directory /srv/private/report.txt token=missing-secret',
      operation: 'download',
      category: 'not-found',
      code: 'SFTP_NOT_FOUND',
      publicCopy: /non è più disponibile/u,
    },
    {
      name: 'spazio remoto insufficiente',
      stderr: 'remote write "/srv/private/report.txt": No space left on device token=space-secret',
      operation: 'upload',
      category: 'remote',
      code: 'SFTP_NO_SPACE',
      publicCopy: /spazio sul server non è sufficiente/u,
    },
    {
      name: 'trasferimento interrotto',
      stderr: 'Connection reset by peer. lost connection token=connection-secret',
      operation: 'download',
      category: 'network',
      code: 'SFTP_TRANSFER_INTERRUPTED',
      publicCopy: /connessione si è interrotta/u,
    },
    {
      name: 'conflitto destinazione',
      stderr: 'remote rename "/srv/private/old.txt" to "/srv/private/report.txt": File exists token=conflict-secret',
      operation: 'rename',
      category: 'conflict',
      code: 'SFTP_CONFLICT',
      publicCopy: /destinazione è cambiata o esiste già/u,
    },
  ]

  for (const fixture of cases) await t.test(fixture.name, async () => {
    const service = createSftpService({
      spawn: createSpawn([{ stderr: fixture.stderr, exitCode: 1 }]),
      timeoutMs: 1_000,
      maxOutputBytes: 4_096,
      maxConcurrentPerConnection: 1,
    })
    const operation = fixture.operation === 'upload'
      ? service.uploadTemp(connection(), '/tmp/local-report.txt', remoteFile)
      : fixture.operation === 'download'
        ? service.download(connection(), remoteFile, '/tmp/local-report.txt')
        : fixture.operation === 'rename'
          ? service.rename(connection(), '/srv/private/old.txt', remoteFile)
          : service.list(connection(), remoteFile)

    await assert.rejects(operation, (error) => {
      assert.equal(isApplicationError(error), true)
      assert.equal(isPublicError(error), true)
      assert.equal(error.category, fixture.category)
      assert.equal(error.code, fixture.code)
      assert.equal(error.domain, 'remote')
      assert.equal(error.operation, fixture.operation)
      assert.match(error.message, fixture.publicCopy)
      assert.match(error.message, new RegExp(`\\[${fixture.code}\\] \\[ERR-[A-F0-9]{6}\\]$`, 'u'))
      assert.doesNotMatch(error.message, /server\.private|\/srv\/|\/Users\/alice|token|secret|permission denied|no such file|known_hosts/iu)
      assert.equal('stderr' in error, false)

      const metadata = getSftpErrorMetadata(error)
      assert.equal(metadata.category, fixture.category)
      assert.equal(metadata.code, fixture.code)
      assert.equal(metadata.component, 'remote')
      assert.equal(metadata.connectionId, 'connection-a')
      assert.equal(metadata.fileName, 'report.txt')
      assert.equal(metadata.operation, fixture.operation)
      assert.match(metadata.correlationId, /^ERR-[A-F0-9]{6}$/u)
      assert.doesNotMatch(JSON.stringify(metadata), /\/srv\/|private|token|secret|stderr/iu)
      return true
    })
  })
})

test('redige nomi file che sembrano contenere segreti nei metadati SFTP', async () => {
  const service = createSftpService({
    spawn: createSpawn([{ stderr: 'Failure token=raw-secret', exitCode: 1 }]),
    timeoutMs: 1_000,
    maxOutputBytes: 1_024,
    maxConcurrentPerConnection: 1,
  })

  await assert.rejects(service.download(connection(), '/srv/token=private.txt', '/tmp/local.txt'), (error) => {
    assert.equal(getSftpErrorMetadata(error).fileName, 'risorsa-redatta')
    assert.doesNotMatch(`${error.message} ${JSON.stringify(getSftpErrorMetadata(error))}`, /private|raw-secret|token=/u)
    return true
  })
})

test('interrompe processi oltre timeout e limita l output', async () => {
  const timeoutService = createSftpService({ spawn: createSpawn([{ wait: 30 }]), timeoutMs: 5, maxOutputBytes: 1_024, maxConcurrentPerConnection: 1 })
  await assert.rejects(() => timeoutService.list(connection(), '/srv'), (error) => {
    assert.equal(error.category, 'timeout')
    assert.equal(error.code, 'SFTP_TIMEOUT')
    assert.match(error.message, /tempo previsto/u)
    return true
  })

  const outputService = createSftpService({ spawn: createSpawn([{ stdout: 'x'.repeat(32) }]), timeoutMs: 1_000, maxOutputBytes: 16, maxConcurrentPerConnection: 1 })
  await assert.rejects(() => outputService.list(connection(), '/srv'), (error) => {
    assert.equal(error.category, 'remote')
    assert.equal(error.code, 'SFTP_RESPONSE_TOO_LARGE')
    assert.match(error.message, /troppo grande/u)
    return true
  })
})

test('mantiene lo slot occupato fino al close ed eleva SIGTERM a SIGKILL', async () => {
  let active = 0
  let maximumActive = 0
  let spawnCount = 0
  let notifyStarted
  let notifyTerminated
  const started = new Promise((resolve) => { notifyStarted = resolve })
  const terminated = new Promise((resolve) => { notifyTerminated = resolve })
  const signals = []
  const spawn = () => {
    const ordinal = ++spawnCount
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    active += 1
    maximumActive = Math.max(maximumActive, active)
    let closed = false
    const close = (exitCode, signal) => {
      if (closed) return
      closed = true
      active -= 1
      child.stdout.end()
      child.stderr.end()
      child.emit('close', exitCode, signal)
    }
    child.kill = (signal) => {
      signals.push({ ordinal, signal })
      if (ordinal === 1 && signal === 'SIGTERM') {
        notifyTerminated()
        return true
      }
      if (signal === 'SIGKILL') setImmediate(() => close(null, signal))
      return true
    }
    if (ordinal === 1) notifyStarted()
    else setImmediate(() => close(0, null))
    return child
  }
  const service = createSftpService({ spawn, timeoutMs: 1_000, killGraceMs: 5, maxOutputBytes: 1_024, maxConcurrentPerConnection: 1 })
  const controller = new AbortController()
  const first = service.mkdir(connection(), '/srv/prima', controller.signal)
  await started
  const second = service.mkdir(connection(), '/srv/seconda')

  controller.abort()
  await terminated
  assert.equal(spawnCount, 1)
  assert.equal(active, 1)

  const [firstResult, secondResult] = await Promise.allSettled([first, second])
  assert.equal(firstResult.status, 'rejected')
  assert.match(firstResult.reason.message, /annullato/)
  assert.equal(firstResult.reason.category, 'cancelled')
  assert.equal(firstResult.reason.code, 'SFTP_CANCELLED')
  assert.equal(getSftpErrorMetadata(firstResult.reason).operation, 'mkdir')
  assert.equal(getSftpErrorMetadata(firstResult.reason).fileName, 'prima')
  assert.equal(secondResult.status, 'fulfilled')
  assert.equal(maximumActive, 1)
  assert.deepEqual(signals, [
    { ordinal: 1, signal: 'SIGTERM' },
    { ordinal: 1, signal: 'SIGKILL' },
  ])
  assert.equal(active, 0)
})

test('closeConnection annulla e attende processo attivo e coda', async () => {
  let active = 0
  let spawnCount = 0
  let notifyStarted
  const started = new Promise((resolve) => { notifyStarted = resolve })
  const signals = []
  const spawn = () => {
    spawnCount += 1
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    active += 1
    notifyStarted()
    child.kill = (signal) => {
      signals.push(signal)
      if (signal === 'SIGKILL') {
        active -= 1
        setImmediate(() => child.emit('close', null, signal))
      }
      return true
    }
    return child
  }
  const service = createSftpService({ spawn, timeoutMs: 1_000, killGraceMs: 5, maxOutputBytes: 1_024, maxConcurrentPerConnection: 1 })
  const first = service.mkdir(connection(), '/srv/prima')
  await started
  const second = service.mkdir(connection(), '/srv/seconda')

  const firstClose = service.closeConnection(connection().id)
  const secondClose = service.closeConnection(connection().id)
  assert.equal(firstClose, secondClose)
  await Promise.all([firstClose, secondClose])
  const results = await Promise.allSettled([first, second])

  assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected'])
  assert.equal(spawnCount, 1)
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(active, 0)
  assert.deepEqual(service.getResourceCounts(), { queues: 0, operations: 0 })
  await service.closeConnection(connection().id)
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

test('closeWorkspace drena la coda, blocca nuove operazioni e consente una riapertura esplicita', async () => {
  let spawnCount = 0
  let notifyStarted
  const started = new Promise((resolve) => { notifyStarted = resolve })
  const spawn = () => {
    spawnCount += 1
    const ordinal = spawnCount
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    let closed = false
    const close = (exitCode, signal) => {
      if (closed) return
      closed = true
      child.emit('close', exitCode, signal)
    }
    child.kill = (signal) => {
      setImmediate(() => close(null, signal))
      return true
    }
    if (ordinal === 1) notifyStarted()
    else setImmediate(() => close(0, null))
    return child
  }
  const service = createSftpService({ spawn, timeoutMs: 1_000, killGraceMs: 5, maxOutputBytes: 1_024, maxConcurrentPerConnection: 1 })
  const operation = service.mkdir(connection(), '/srv/prima')
  const operationResult = operation.catch((error) => error)
  await started

  const firstClose = service.closeWorkspace('/tmp/workspace-a')
  const secondClose = service.closeWorkspace('/tmp/workspace-a')
  assert.equal(firstClose, secondClose)
  await Promise.all([firstClose, secondClose])

  assert.match((await operationResult).message, /annullato/)
  assert.deepEqual(service.getResourceCounts(), { queues: 0, operations: 0 })
  await assert.rejects(() => service.mkdir(connection(), '/srv/bloccata'), /annullato/)
  assert.equal(spawnCount, 1)
  assert.equal(service.openWorkspace('/tmp/workspace-a'), true)
  await service.mkdir(connection(), '/srv/dopo-riapertura')
  assert.equal(spawnCount, 2)
})

test('closeAll ha una deadline anche se i child non emettono close e resta idempotente', async () => {
  let started = 0
  let notifyStarted
  const allStarted = new Promise((resolve) => { notifyStarted = resolve })
  let unrefCount = 0
  const signals = []
  const spawn = () => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = (signal) => {
      signals.push(signal)
      return true
    }
    child.unref = () => { unrefCount += 1 }
    started += 1
    if (started === 2) notifyStarted()
    return child
  }
  const service = createSftpService({ spawn, timeoutMs: 1_000, killGraceMs: 5, maxOutputBytes: 1_024, maxConcurrentPerConnection: 1 })
  const firstConnection = connection()
  const secondConnection = { ...connection(), id: 'connection-b', workspacePath: '/tmp/workspace-b', socketPath: '/tmp/vl/socket-b' }
  const first = service.mkdir(firstConnection, '/srv/prima')
  const second = service.mkdir(secondConnection, '/srv/seconda')
  const operationResults = Promise.allSettled([first, second])
  await allStarted
  assert.deepEqual(service.getResourceCounts(), { queues: 2, operations: 2 })

  const firstClose = service.closeAll()
  const secondClose = service.closeAll()
  assert.equal(firstClose, secondClose)
  await Promise.all([firstClose, secondClose])
  const results = await operationResults

  assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected'])
  assert.deepEqual(signals, ['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL'])
  assert.equal(unrefCount, 2)
  assert.deepEqual(service.getResourceCounts(), { queues: 0, operations: 0 })
  await service.closeAll()
  assert.deepEqual(signals, ['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL'])
})

test('il main chiude SFTP prima del disconnect e durante lo shutdown', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const managedSshIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/managed-ssh.ipc.cjs'), 'utf8')
  const runtime = fs.readFileSync(path.join(__dirname, '../electron/domains/remote/remote-runtime.cjs'), 'utf8')
  assert.match(managedSshIpc, /sftpService\.closeConnection\(connectionId\)/)
  assert.match(main, /registerManagedSshIpc\(\{/)
  assert.match(runtime, /remoteFileService\.closeWorkspace\(workspacePath\)/)
  assert.match(runtime, /remoteFileService\.closeAll\(\)/)
  assert.match(runtime, /sftpService\.closeAll\(\)/)
})
