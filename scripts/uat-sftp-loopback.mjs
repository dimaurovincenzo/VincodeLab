#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename as renameFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { createSftpService } = require('../electron/infrastructure/remote/sftp-service.adapter.cjs')

const LOOPBACK_HOST = '127.0.0.1'
const SSH_PATH = '/usr/bin/ssh'
const SFTP_PATH = '/usr/bin/sftp'
const SSH_KEYGEN_PATH = '/usr/bin/ssh-keygen'
const SSHD_PATH = '/usr/sbin/sshd'
const DEFAULT_TIMEOUT_MS = 30_000
const MINIMUM_HIGH_PORT = 49_152
const MAXIMUM_PORT = 65_535
const CANCEL_FIXTURE_BYTES = 512 * 1024 * 1024
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024
const FIXTURE_PREFIX = '/tmp/vincodelab-sftp-uat-'

class UatFailure extends Error {
  constructor(stage, code) {
    super(code)
    this.name = 'UatFailure'
    this.stage = stage
    this.code = code
  }
}

function fail(stage, code) {
  throw new UatFailure(stage, code)
}

function ensure(condition, stage, code) {
  if (!condition) fail(stage, code)
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < MINIMUM_HIGH_PORT || port > MAXIMUM_PORT) throw new Error('Porta loopback non valida.')
  return port
}

function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]+$/u.test(username)) throw new Error('Account locale non valido.')
  return username
}

function validateAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) throw new Error(`${label} non valido.`)
  return value
}

function quoteSshdValue(value) {
  validateAbsolutePath(value, 'Percorso configurazione sshd')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function parseCliArguments(args) {
  const options = { execute: false, help: false, outputPath: null, timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--run') options.execute = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--output') {
      const outputValue = args[++index]
      if (!outputValue || outputValue.startsWith('--')) throw new Error('Percorso report non valido.')
      options.outputPath = path.resolve(outputValue)
    }
    else if (argument === '--timeout-ms') options.timeoutMs = Number(args[++index])
    else throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10_000 || options.timeoutMs > 120_000) {
    throw new Error('Timeout UAT non valido.')
  }
  if (options.outputPath !== null && !path.isAbsolute(options.outputPath)) throw new Error('Percorso report non valido.')
  return options
}

export function buildSshdConfig({
  port,
  username,
  hostKeyPath,
  authorizedKeysPath,
  pidFilePath,
  remoteRoot,
}) {
  validatePort(port)
  validateUsername(username)
  const hostKey = quoteSshdValue(hostKeyPath)
  const authorizedKeys = quoteSshdValue(authorizedKeysPath)
  const pidFile = quoteSshdValue(pidFilePath)
  const sftpRoot = quoteSshdValue(remoteRoot)
  return [
    `Port ${port}`,
    'AddressFamily inet',
    `ListenAddress ${LOOPBACK_HOST}`,
    `HostKey ${hostKey}`,
    `PidFile ${pidFile}`,
    `AuthorizedKeysFile ${authorizedKeys}`,
    `AllowUsers ${username}`,
    'AuthenticationMethods publickey',
    'PubkeyAuthentication yes',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'ChallengeResponseAuthentication no',
    'PermitEmptyPasswords no',
    'HostbasedAuthentication no',
    'GSSAPIAuthentication no',
    'UsePAM no',
    'PermitRootLogin no',
    'StrictModes no',
    'IgnoreRhosts yes',
    'PermitUserEnvironment no',
    'PermitUserRC no',
    'AllowAgentForwarding no',
    'AllowTcpForwarding no',
    'X11Forwarding no',
    'PermitTunnel no',
    'GatewayPorts no',
    'PermitTTY no',
    'UseDNS no',
    'MaxAuthTries 2',
    'MaxSessions 8',
    'LogLevel ERROR',
    `Subsystem sftp internal-sftp -d ${sftpRoot}`,
    '',
  ].join('\n')
}

export function buildKnownHostsLine({ host = LOOPBACK_HOST, port, publicKey }) {
  validatePort(port)
  if (host !== LOOPBACK_HOST) throw new Error('Host UAT non consentito.')
  const [keyType, keyData] = String(publicKey).trim().split(/\s+/u)
  if (keyType !== 'ssh-ed25519' || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(keyData ?? '')) throw new Error('Chiave host non valida.')
  return `[${LOOPBACK_HOST}]:${port} ${keyType} ${keyData}\n`
}

export function buildSshClientOptions({ port, identityPath, knownHostsPath }) {
  validatePort(port)
  validateAbsolutePath(identityPath, 'Chiave client')
  validateAbsolutePath(knownHostsPath, 'Known hosts')
  return [
    '-F', '/dev/null',
    '-p', String(port),
    '-i', identityPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'BatchMode=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=1',
    '-o', 'LogLevel=ERROR',
  ]
}

export function buildSftpIsolationArguments({ serviceArguments, port, identityPath, knownHostsPath }) {
  validatePort(port)
  validateAbsolutePath(identityPath, 'Chiave client SFTP')
  validateAbsolutePath(knownHostsPath, 'Known hosts SFTP')
  if (!Array.isArray(serviceArguments) || serviceArguments.some((argument) => typeof argument !== 'string')) {
    throw new Error('Argomenti SFTP non validi.')
  }
  const separatorIndex = serviceArguments.lastIndexOf('--')
  const destination = serviceArguments[separatorIndex + 1]
  if (separatorIndex < 0 || separatorIndex !== serviceArguments.length - 2 || !destination?.endsWith(`@${LOOPBACK_HOST}`)) {
    throw new Error('Destinazione SFTP UAT non valida.')
  }
  if (!serviceArguments.some((argument) => argument === '-o')
    || !serviceArguments.some((argument) => argument.startsWith('ControlPath='))) {
    throw new Error('ControlPath SFTP mancante.')
  }
  return [
    ...serviceArguments.slice(0, separatorIndex),
    '-F', '/dev/null',
    '-P', String(port),
    '-i', identityPath,
    '-l', '8192',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'BatchMode=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=1',
    '-o', 'LogLevel=ERROR',
    '--', destination,
  ]
}

export function buildAuthenticationArguments({ port, identityPath, knownHostsPath, destination }) {
  if (typeof destination !== 'string' || !destination.endsWith(`@${LOOPBACK_HOST}`)) throw new Error('Destinazione UAT non valida.')
  return [
    ...buildSshClientOptions({ port, identityPath, knownHostsPath }),
    '-N',
    '--', destination,
  ]
}

export function buildControlMasterArguments({ port, identityPath, knownHostsPath, socketPath, destination }) {
  validateAbsolutePath(socketPath, 'Socket ControlMaster')
  const authentication = buildAuthenticationArguments({ port, identityPath, knownHostsPath, destination })
  authentication.splice(authentication.length - 2, 0,
    '-o', 'ControlMaster=yes',
    '-o', 'ControlPersist=no',
    '-o', `ControlPath=${socketPath}`)
  return authentication
}

export function buildControlCommandArguments({ port, identityPath, knownHostsPath, socketPath, destination, operation }) {
  if (!['check', 'exit'].includes(operation)) throw new Error('Operazione ControlMaster non valida.')
  validateAbsolutePath(socketPath, 'Socket ControlMaster')
  if (typeof destination !== 'string' || !destination.endsWith(`@${LOOPBACK_HOST}`)) throw new Error('Destinazione UAT non valida.')
  return [
    ...buildSshClientOptions({ port, identityPath, knownHostsPath }),
    '-S', socketPath,
    '-O', operation,
    '--', destination,
  ]
}

function isolatedEnvironment(homePath, temporaryPath, username) {
  return {
    HOME: homePath,
    LANG: 'C',
    LC_ALL: 'C',
    LOGNAME: username,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: temporaryPath,
    USER: username,
  }
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_COMMAND_OUTPUT_BYTES) return current
  return `${current}${String(chunk)}`.slice(0, MAX_COMMAND_OUTPUT_BYTES)
}

function runCommand(executable, args, { env, onExit, onSpawn, timeoutMs, signal } = {}) {
  return new Promise((resolve) => {
    let child
    let settled = false
    let stderr = ''
    let stdout = ''
    let timedOut = false
    let aborted = false
    let killTimer
    let forceTimer
    let timer

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      clearTimeout(forceTimer)
      signal?.removeEventListener('abort', onAbort)
      if (Number.isInteger(child?.pid) && !processAlive(child.pid)) onExit?.(child.pid)
      resolve({ ...result, aborted, stderr, stdout, timedOut })
    }
    const terminate = (reason) => {
      if (!child || settled) return
      if (reason === 'timeout') timedOut = true
      if (reason === 'abort') aborted = true
      try { child.kill('SIGTERM') } catch {}
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        forceTimer = setTimeout(() => finish({ code: null, signal: 'SIGKILL', spawnFailed: false }), 500)
      }, 250)
    }
    const onAbort = () => terminate('abort')

    try {
      child = spawn(executable, args, {
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (Number.isInteger(child.pid)) onSpawn?.(child.pid)
    } catch {
      finish({ code: null, signal: null, spawnFailed: true })
      return
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', () => finish({ code: null, signal: null, spawnFailed: true }))
    child.once('close', (code, processSignal) => finish({ code, signal: processSignal, spawnFailed: false }))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    timer = setTimeout(() => terminate('timeout'), timeoutMs ?? DEFAULT_TIMEOUT_MS)
  })
}

function startTrackedProcess(executable, args, { env }) {
  let stderr = ''
  let stdout = ''
  let closeResult
  let settleExit
  const exited = new Promise((resolve) => { settleExit = resolve })
  const child = spawn(executable, args, {
    detached: true,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const finish = (result) => {
    if (closeResult) return
    closeResult = result
    settleExit(result)
  }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk) })
  child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk) })
  child.once('error', () => finish({ code: null, signal: null, spawnFailed: true }))
  child.once('close', (code, processSignal) => finish({ code, signal: processSignal, spawnFailed: false }))
  return {
    child,
    exited,
    get closed() { return closeResult !== undefined },
    get output() { return { stderr, stdout } },
    get result() { return closeResult },
    pid: child.pid,
  }
}

function processGroupAlive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

function parseProcessTable(output) {
  return String(output).split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line)
    if (!match) return []
    return [{ command: match[3], pid: Number(match[1]), ppid: Number(match[2]) }]
  })
}

async function collectDescendantPids(rootPid, env) {
  if (!Number.isInteger(rootPid) || rootPid < 2) return []
  const processTable = await runCommand('/bin/ps', ['-axo', 'pid=,ppid=,command='], { env, timeoutMs: 2_000 })
  if (processTable.code !== 0 || processTable.timedOut || processTable.spawnFailed) return []
  const rows = parseProcessTable(processTable.stdout)
  const descendants = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid)
        changed = true
      }
    }
  }
  descendants.delete(rootPid)
  return [...descendants]
}

async function waitForCondition(predicate, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new UatFailure('interrupted', 'INTERRUPTED')
    if (await predicate()) return true
    await delay(25)
  }
  return false
}

async function terminateTrackedProcess(tracked) {
  if (!tracked?.pid) return true
  if (processGroupAlive(tracked.pid)) {
    try { process.kill(-tracked.pid, 'SIGTERM') } catch {}
    await waitForCondition(() => !processGroupAlive(tracked.pid), 1_500)
  }
  if (processGroupAlive(tracked.pid)) {
    try { process.kill(-tracked.pid, 'SIGKILL') } catch {}
    await waitForCondition(() => !processGroupAlive(tracked.pid), 1_500)
  }
  return !processGroupAlive(tracked.pid)
}

function canConnect(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: LOOPBACK_HOST, port })
    let settled = false
    const finish = (connected) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function reserveHighLoopbackPort() {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const port = randomInt(MINIMUM_HIGH_PORT, MAXIMUM_PORT + 1)
    const server = net.createServer()
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen({ exclusive: true, host: LOOPBACK_HOST, port }, resolve)
      })
      await new Promise((resolve) => server.close(resolve))
      return port
    } catch {
      try { server.close() } catch {}
    }
  }
  fail('preflight', 'HIGH_PORT_UNAVAILABLE')
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function sha256File(targetPath) {
  const content = await readFile(targetPath)
  return createHash('sha256').update(content).digest('hex')
}

function initialChecks() {
  return {
    isolation: {
      highPort: false,
      hostKeyPinned: false,
      loopbackOnly: false,
      noUserSshConfiguration: false,
      nonRoot: false,
      temporaryConfig: false,
      temporaryHome: false,
    },
    authentication: {
      badKeyRejected: false,
      goodKeyAccepted: false,
    },
    sftp: {
      cancellation: false,
      chmod: false,
      downloadHash: false,
      listing: false,
      mkdirRmdir: false,
      permissionDenied: false,
      rename: false,
      uploadHash: false,
    },
    cleanup: {
      controlMasterStopped: false,
      fixtureRemoved: false,
      noFixtureProcesses: false,
      portReleased: false,
      serviceDrained: false,
      socketRemoved: false,
      sshdStopped: false,
    },
  }
}

function allChecksPassed(checks) {
  return Object.values(checks).every((section) => Object.values(section).every(Boolean))
}

function sanitizeChecks(checks) {
  const safeChecks = initialChecks()
  for (const [sectionName, section] of Object.entries(safeChecks)) {
    for (const checkName of Object.keys(section)) {
      section[checkName] = checks?.[sectionName]?.[checkName] === true
    }
  }
  return safeChecks
}

function sanitizeFailure(failure) {
  const code = /^[A-Z0-9_]+$/u.test(failure?.code ?? '') ? failure.code : 'UNEXPECTED_FAILURE'
  const stage = /^[a-z0-9-]+$/u.test(failure?.stage ?? '') ? failure.stage : 'unknown'
  return { code, stage }
}

function sanitizeHashes(hashes) {
  const allowedNames = ['seedSource', 'seedDownload', 'uploadSource', 'uploadRoundTrip']
  return Object.fromEntries(allowedNames.flatMap((name) => {
    const value = hashes?.[name]
    return /^[a-f0-9]{64}$/u.test(value ?? '') ? [[name, value]] : []
  }))
}

export function createPrivacySafeReport({
  checks,
  startedAt,
  finishedAt,
  failure = null,
  hashes = null,
}) {
  const safeChecks = sanitizeChecks(checks)
  const safeHashes = sanitizeHashes(hashes)
  const ok = !failure && allChecksPassed(safeChecks)
  const report = {
    schemaVersion: 1,
    suite: 'vincodelab-sftp-loopback',
    classification: 'fixture-reale-locale',
    ok,
    status: ok ? 'passed' : 'failed',
    environment: {
      architecture: process.arch,
      node: process.versions.node,
      platform: process.platform,
      transport: 'OpenSSH loopback non-root',
    },
    timing: {
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      finishedAt: finishedAt.toISOString(),
      startedAt: startedAt.toISOString(),
    },
    checks: safeChecks,
  }
  if (Object.keys(safeHashes).length > 0) report.evidence = { hashes: safeHashes }
  if (!ok) {
    report.failure = sanitizeFailure(failure ?? { code: 'INCOMPLETE_EVIDENCE', stage: 'report' })
  }
  return report
}

async function waitForSshd(port, tracked, timeoutMs, signal) {
  return waitForCondition(async () => {
    if (tracked.closed) return false
    return canConnect(port)
  }, Math.min(timeoutMs, 10_000), signal)
}

async function waitForControlMaster(parameters, tracked, env, timeoutMs, signal, processTracking) {
  return waitForCondition(async () => {
    if (tracked.closed) return false
    const result = await runCommand(SSH_PATH, buildControlCommandArguments({ ...parameters, operation: 'check' }), {
      env,
      ...processTracking,
      signal,
      timeoutMs: 1_000,
    })
    return result.code === 0 && !result.timedOut && !result.aborted
  }, Math.min(timeoutMs, 10_000), signal)
}

async function stopControlMaster(parameters, tracked, env, processTracking) {
  if (!tracked) return true
  if (!tracked.closed) {
    await runCommand(SSH_PATH, buildControlCommandArguments({ ...parameters, operation: 'exit' }), {
      env,
      ...processTracking,
      timeoutMs: 2_000,
    })
  }
  return terminateTrackedProcess(tracked)
}

async function killExactPids(pids) {
  const targets = [...pids].filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid && processAlive(pid))
  for (const pid of targets) {
    try { process.kill(pid, 'SIGTERM') } catch {}
  }
  await waitForCondition(() => targets.every((pid) => !processAlive(pid)), 750)
  for (const pid of targets.filter(processAlive)) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
  await waitForCondition(() => targets.every((pid) => !processAlive(pid)), 750)
}

export async function runLoopbackUat({ timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const startedAt = new Date()
  const checks = initialChecks()
  const hashes = {}
  let activeStage = 'preflight'
  let failure
  let fixtureRoot
  let socketPath
  let port
  let sshdProcess
  let masterProcess
  let sftpService
  let controlParameters
  let environment
  let readOnlyDirectory
  const activeSftpPids = new Set()
  const trackedFixturePids = new Set()
  const trackPid = (pid) => { if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) trackedFixturePids.add(pid) }
  const untrackPid = (pid) => { trackedFixturePids.delete(pid) }
  const processTracking = { onExit: untrackPid, onSpawn: trackPid }
  let sftpSpawnCount = 0

  try {
    if (process.platform !== 'darwin') fail(activeStage, 'MACOS_REQUIRED')
    if (typeof process.getuid !== 'function' || process.getuid() === 0) fail(activeStage, 'NON_ROOT_ACCOUNT_REQUIRED')
    checks.isolation.nonRoot = true
    for (const executable of [SSH_PATH, SFTP_PATH, SSH_KEYGEN_PATH, SSHD_PATH]) await access(executable, fsConstants.X_OK)

    const username = validateUsername(os.userInfo().username)
    port = await reserveHighLoopbackPort()
    checks.isolation.highPort = port >= MINIMUM_HIGH_PORT
    checks.isolation.loopbackOnly = true

    activeStage = 'fixture'
    fixtureRoot = await mkdtemp(FIXTURE_PREFIX)
    ensure(fixtureRoot.startsWith(FIXTURE_PREFIX), activeStage, 'UNSAFE_FIXTURE_ROOT')
    await chmod(fixtureRoot, 0o700)
    const clientHome = path.join(fixtureRoot, 'client-home')
    const temporaryPath = path.join(fixtureRoot, 'tmp')
    const keysPath = path.join(fixtureRoot, 'keys')
    const configPath = path.join(fixtureRoot, 'sshd-config')
    const pidFilePath = path.join(fixtureRoot, 'sshd.pid')
    const knownHostsPath = path.join(fixtureRoot, 'known-hosts')
    const authorizedKeysPath = path.join(fixtureRoot, 'authorized-keys')
    const remoteDirectory = path.join(fixtureRoot, 'remote')
    const localDirectory = path.join(fixtureRoot, 'local')
    const workspaceDirectory = path.join(fixtureRoot, 'workspace')
    socketPath = path.join(fixtureRoot, 'control.sock')
    ensure(Buffer.byteLength(socketPath) < 90, activeStage, 'CONTROL_SOCKET_PATH_TOO_LONG')
    await Promise.all([
      mkdir(clientHome, { mode: 0o700 }),
      mkdir(temporaryPath, { mode: 0o700 }),
      mkdir(keysPath, { mode: 0o700 }),
      mkdir(remoteDirectory, { mode: 0o700 }),
      mkdir(localDirectory, { mode: 0o700 }),
      mkdir(workspaceDirectory, { mode: 0o700 }),
    ])
    const canonicalRemoteRoot = await realpath(remoteDirectory)
    const canonicalWorkspace = await realpath(workspaceDirectory)
    environment = isolatedEnvironment(clientHome, temporaryPath, username)
    checks.isolation.temporaryHome = environment.HOME.startsWith(fixtureRoot)
    checks.isolation.temporaryConfig = configPath.startsWith(fixtureRoot)

    const hostKeyPath = path.join(keysPath, 'host-ed25519')
    const goodKeyPath = path.join(keysPath, 'client-good-ed25519')
    const badKeyPath = path.join(keysPath, 'client-bad-ed25519')
    for (const [keyPath, comment] of [
      [hostKeyPath, 'vincodelab-sftp-uat-host'],
      [goodKeyPath, 'vincodelab-sftp-uat-good'],
      [badKeyPath, 'vincodelab-sftp-uat-bad'],
    ]) {
      const keygen = await runCommand(SSH_KEYGEN_PATH, ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', keyPath], {
        env: environment,
        ...processTracking,
        signal,
        timeoutMs,
      })
      ensure(keygen.code === 0 && !keygen.timedOut && !keygen.aborted, activeStage, 'KEY_GENERATION_FAILED')
    }

    const goodPublicKey = await readFile(`${goodKeyPath}.pub`, 'utf8')
    const hostPublicKey = await readFile(`${hostKeyPath}.pub`, 'utf8')
    const [goodKeyType, goodKeyData] = goodPublicKey.trim().split(/\s+/u)
    ensure(goodKeyType === 'ssh-ed25519' && Boolean(goodKeyData), activeStage, 'CLIENT_PUBLIC_KEY_INVALID')
    await writeFile(authorizedKeysPath, `${goodKeyType} ${goodKeyData} vincodelab-sftp-uat\n`, { mode: 0o600 })
    await writeFile(knownHostsPath, buildKnownHostsLine({ port, publicKey: hostPublicKey }), { mode: 0o600 })
    checks.isolation.hostKeyPinned = true

    const destination = `${username}@${LOOPBACK_HOST}`
    const goodOptions = buildSshClientOptions({ port, identityPath: goodKeyPath, knownHostsPath })
    const isolatedSftpOptions = buildSftpIsolationArguments({
      identityPath: goodKeyPath,
      knownHostsPath,
      port,
      serviceArguments: ['-q', '-b', '-', '-o', `ControlPath=${socketPath}`, '--', destination],
    })
    checks.isolation.noUserSshConfiguration = [goodOptions, isolatedSftpOptions].every((options) => options.includes('/dev/null')
      && options.includes('IdentityAgent=none')
      && options.some((value) => value.startsWith('UserKnownHostsFile=') && value.endsWith(knownHostsPath)))

    await writeFile(configPath, buildSshdConfig({
      authorizedKeysPath,
      hostKeyPath,
      pidFilePath,
      port,
      remoteRoot: canonicalRemoteRoot,
      username,
    }), { mode: 0o600 })

    activeStage = 'sshd-startup'
    const configValidation = await runCommand(SSHD_PATH, ['-t', '-f', configPath], {
      env: environment,
      ...processTracking,
      signal,
      timeoutMs,
    })
    ensure(configValidation.code === 0 && !configValidation.timedOut && !configValidation.aborted, activeStage, 'SSHD_CONFIG_INVALID')
    sshdProcess = startTrackedProcess(SSHD_PATH, ['-D', '-e', '-f', configPath], { env: environment })
    trackPid(sshdProcess.pid)
    ensure(await waitForSshd(port, sshdProcess, timeoutMs, signal), activeStage, 'SSHD_NOT_READY')

    activeStage = 'authentication-bad-key'
    const badAuthentication = await runCommand(SSH_PATH, buildAuthenticationArguments({
      destination,
      identityPath: badKeyPath,
      knownHostsPath,
      port,
    }), {
      env: environment,
      ...processTracking,
      signal,
      timeoutMs: Math.min(timeoutMs, 10_000),
    })
    checks.authentication.badKeyRejected = badAuthentication.code !== 0
      && !badAuthentication.timedOut
      && !badAuthentication.aborted
      && !badAuthentication.spawnFailed
    ensure(checks.authentication.badKeyRejected, activeStage, 'BAD_KEY_NOT_REJECTED')

    activeStage = 'authentication-good-key'
    controlParameters = {
      destination,
      identityPath: goodKeyPath,
      knownHostsPath,
      port,
      socketPath,
    }
    masterProcess = startTrackedProcess(SSH_PATH, buildControlMasterArguments(controlParameters), { env: environment })
    trackPid(masterProcess.pid)
    checks.authentication.goodKeyAccepted = await waitForControlMaster(controlParameters, masterProcess, environment, timeoutMs, signal, processTracking)
    ensure(checks.authentication.goodKeyAccepted, activeStage, 'GOOD_KEY_NOT_ACCEPTED')
    for (const pid of await collectDescendantPids(sshdProcess.pid, environment)) trackPid(pid)

    activeStage = 'sftp-operations'
    const instrumentedSftpSpawn = (executable, args, options) => {
      ensure(executable === SFTP_PATH, activeStage, 'UNEXPECTED_SFTP_EXECUTABLE')
      const isolatedArguments = buildSftpIsolationArguments({
        identityPath: goodKeyPath,
        knownHostsPath,
        port,
        serviceArguments: args,
      })
      const child = spawn(executable, isolatedArguments, {
        ...options,
        cwd: fixtureRoot,
        env: environment,
        shell: false,
      })
      sftpSpawnCount += 1
      if (Number.isInteger(child.pid)) {
        activeSftpPids.add(child.pid)
        trackPid(child.pid)
      }
      child.once('close', () => {
        if (Number.isInteger(child.pid)) {
          activeSftpPids.delete(child.pid)
          untrackPid(child.pid)
        }
      })
      return child
    }
    sftpService = createSftpService({
      killGraceMs: 250,
      maxConcurrentPerConnection: 1,
      spawn: instrumentedSftpSpawn,
      timeoutMs,
    })
    const connection = {
      destination,
      id: 'uat-loopback',
      sftpPath: SFTP_PATH,
      socketPath,
      workspacePath: canonicalWorkspace,
    }
    const seedRemotePath = path.posix.join(canonicalRemoteRoot, 'seed.txt')
    const seedLocalPath = path.join(localDirectory, 'seed.download.txt')
    const uploadSourcePath = path.join(localDirectory, 'upload-source.bin')
    const uploadTemporaryPath = path.posix.join(canonicalRemoteRoot, 'upload.partial')
    const uploadVerificationPath = path.join(localDirectory, 'upload.verify.bin')
    const uploadFinalPath = path.posix.join(canonicalRemoteRoot, 'upload-final.bin')
    const createdDirectoryPath = path.posix.join(canonicalRemoteRoot, 'created-directory')
    await writeFile(seedRemotePath, 'VincodeLab SFTP loopback seed\n', { mode: 0o600 })
    await writeFile(uploadSourcePath, randomBytes(16 * 1024), { mode: 0o600 })

    const initialListing = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.listing = initialListing.some((entry) => entry.name === 'seed.txt' && entry.kind === 'file')
    ensure(checks.sftp.listing, activeStage, 'LISTING_FAILED')

    await sftpService.download(connection, seedRemotePath, seedLocalPath, signal)
    hashes.seedSource = await sha256File(seedRemotePath)
    hashes.seedDownload = await sha256File(seedLocalPath)
    checks.sftp.downloadHash = hashes.seedSource === hashes.seedDownload
    ensure(checks.sftp.downloadHash, activeStage, 'DOWNLOAD_HASH_MISMATCH')

    await sftpService.uploadTemp(connection, uploadSourcePath, uploadTemporaryPath, signal)
    await sftpService.download(connection, uploadTemporaryPath, uploadVerificationPath, signal)
    hashes.uploadSource = await sha256File(uploadSourcePath)
    hashes.uploadRoundTrip = await sha256File(uploadVerificationPath)
    checks.sftp.uploadHash = hashes.uploadSource === hashes.uploadRoundTrip
    ensure(checks.sftp.uploadHash, activeStage, 'UPLOAD_HASH_MISMATCH')

    await sftpService.chmod(connection, uploadTemporaryPath, 0o640, signal)
    const chmodListing = await sftpService.list(connection, canonicalRemoteRoot, signal)
    const chmodEntry = chmodListing.find((entry) => entry.name === 'upload.partial')
    checks.sftp.chmod = chmodEntry?.mode === 0o640 && (await stat(uploadTemporaryPath)).mode % 0o1000 === 0o640
    ensure(checks.sftp.chmod, activeStage, 'CHMOD_FAILED')

    await sftpService.rename(connection, uploadTemporaryPath, uploadFinalPath, signal)
    const renamedListing = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.rename = renamedListing.some((entry) => entry.name === 'upload-final.bin')
      && !renamedListing.some((entry) => entry.name === 'upload.partial')
    ensure(checks.sftp.rename, activeStage, 'RENAME_FAILED')

    await sftpService.mkdir(connection, createdDirectoryPath, signal)
    const listingWithDirectory = await sftpService.list(connection, canonicalRemoteRoot, signal)
    const directoryCreated = listingWithDirectory.some((entry) => entry.name === 'created-directory' && entry.kind === 'directory')
    await sftpService.rmdir(connection, createdDirectoryPath, signal)
    const listingWithoutDirectory = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.mkdirRmdir = directoryCreated && !listingWithoutDirectory.some((entry) => entry.name === 'created-directory')
    ensure(checks.sftp.mkdirRmdir, activeStage, 'MKDIR_RMDIR_FAILED')

    readOnlyDirectory = path.join(canonicalRemoteRoot, 'read-only')
    await mkdir(readOnlyDirectory, { mode: 0o500 })
    const readOnlyStatus = await stat(readOnlyDirectory)
    const deniedTarget = path.posix.join(readOnlyDirectory, 'denied.bin')
    let permissionRejected = false
    try {
      await sftpService.uploadTemp(connection, uploadSourcePath, deniedTarget, signal)
    } catch {
      permissionRejected = true
    }
    const controlListingAfterDenial = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.permissionDenied = permissionRejected
      && readOnlyStatus.uid === process.getuid()
      && readOnlyStatus.mode % 0o1000 === 0o500
      && !(await pathExists(deniedTarget))
      && controlListingAfterDenial.some((entry) => entry.name === 'seed.txt' && entry.kind === 'file')
    ensure(checks.sftp.permissionDenied, activeStage, 'PERMISSION_DENIAL_FAILED')
    await chmod(readOnlyDirectory, 0o700)
    await rm(readOnlyDirectory, { recursive: true })
    readOnlyDirectory = undefined

    const cancellationSourcePath = path.join(canonicalRemoteRoot, 'cancel-source.bin')
    const cancellationTargetPath = path.join(localDirectory, 'cancel-target.bin')
    const cancellationHandle = await open(cancellationSourcePath, 'w', 0o600)
    await cancellationHandle.truncate(CANCEL_FIXTURE_BYTES)
    await cancellationHandle.close()
    const spawnCountBeforeCancellation = sftpSpawnCount
    const cancellationController = new AbortController()
    const cancellationSignal = signal
      ? AbortSignal.any([signal, cancellationController.signal])
      : cancellationController.signal
    const cancellation = sftpService.download(connection, cancellationSourcePath, cancellationTargetPath, cancellationSignal)
    const cancellationOutcome = cancellation.then(
      () => ({ status: 'fulfilled' }),
      (error) => ({ error, status: 'rejected' }),
    )
    let settledCancellationOutcome
    let progressObserved = false
    void cancellationOutcome.then((outcome) => { settledCancellationOutcome = outcome })
    await waitForCondition(async () => {
      if (settledCancellationOutcome) return true
      if (sftpSpawnCount <= spawnCountBeforeCancellation || activeSftpPids.size === 0) return false
      const transferredBytes = await stat(cancellationTargetPath).then((entry) => entry.size, () => 0)
      progressObserved = transferredBytes > 0 && transferredBytes < CANCEL_FIXTURE_BYTES
      return progressObserved
    }, 5_000, signal)
    ensure(progressObserved, activeStage, 'CANCELLATION_PROGRESS_NOT_OBSERVED')
    for (const pid of await collectDescendantPids(sshdProcess.pid, environment)) trackPid(pid)
    cancellationController.abort()
    const cancelledOutcome = settledCancellationOutcome ?? await cancellationOutcome
    const cancellationDrained = await waitForCondition(() => activeSftpPids.size === 0, 2_000, signal)
    const partialSize = await stat(cancellationTargetPath).then((entry) => entry.size, () => 0)
    checks.sftp.cancellation = cancelledOutcome.status === 'rejected'
      && /annullato/u.test(cancelledOutcome.error?.message ?? '')
      && cancellationDrained
      && partialSize > 0
      && partialSize < CANCEL_FIXTURE_BYTES
    ensure(checks.sftp.cancellation, activeStage, 'CANCELLATION_FAILED')
    await sftpService.remove(connection, uploadFinalPath, signal)
  } catch (error) {
    failure = error instanceof UatFailure
      ? { code: error.code, stage: error.stage }
      : { code: 'UNEXPECTED_FAILURE', stage: activeStage }
  } finally {
    activeStage = 'cleanup'
    for (const rootPid of [sshdProcess?.pid, masterProcess?.pid]) {
      try {
        for (const pid of await collectDescendantPids(rootPid, environment)) trackPid(pid)
      } catch {}
    }
    if (readOnlyDirectory) {
      try { await chmod(readOnlyDirectory, 0o700) } catch {}
    }
    if (sftpService) {
      try {
        await sftpService.closeAll()
        await delay(0)
        checks.cleanup.serviceDrained = sftpService.getResourceCounts().queues === 0
          && sftpService.getResourceCounts().operations === 0
          && activeSftpPids.size === 0
      } catch {
        checks.cleanup.serviceDrained = false
      }
    } else {
      checks.cleanup.serviceDrained = activeSftpPids.size === 0
    }
    if (activeSftpPids.size > 0) {
      await killExactPids(activeSftpPids)
      for (const pid of [...activeSftpPids]) {
        if (!processAlive(pid)) {
          activeSftpPids.delete(pid)
          untrackPid(pid)
        }
      }
    }

    try {
      checks.cleanup.controlMasterStopped = await stopControlMaster(controlParameters, masterProcess, environment, processTracking)
    } catch {
      checks.cleanup.controlMasterStopped = await terminateTrackedProcess(masterProcess)
    }
    try {
      checks.cleanup.sshdStopped = await terminateTrackedProcess(sshdProcess)
    } catch {
      checks.cleanup.sshdStopped = false
    }
    for (const pid of [...trackedFixturePids]) if (!processAlive(pid)) untrackPid(pid)
    if (trackedFixturePids.size > 0) await killExactPids(trackedFixturePids)
    for (const pid of [...trackedFixturePids]) if (!processAlive(pid)) untrackPid(pid)
    checks.cleanup.controlMasterStopped = checks.cleanup.controlMasterStopped
      && !processAlive(masterProcess?.pid)
      && !processGroupAlive(masterProcess?.pid)
    checks.cleanup.sshdStopped = checks.cleanup.sshdStopped
      && !processAlive(sshdProcess?.pid)
      && !processGroupAlive(sshdProcess?.pid)
    checks.cleanup.noFixtureProcesses = activeSftpPids.size === 0
      && trackedFixturePids.size === 0
      && !processGroupAlive(masterProcess?.pid)
      && !processGroupAlive(sshdProcess?.pid)
    checks.cleanup.portReleased = port ? !(await canConnect(port)) : true

    if (fixtureRoot?.startsWith(FIXTURE_PREFIX)) {
      try { await rm(fixtureRoot, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 }) } catch {}
    }
    checks.cleanup.fixtureRemoved = fixtureRoot ? !(await pathExists(fixtureRoot)) : true
    checks.cleanup.socketRemoved = socketPath ? !(await pathExists(socketPath)) : true
    if (!allChecksPassed(checks) && !failure) failure = { code: 'INCOMPLETE_EVIDENCE', stage: activeStage }
  }

  return createPrivacySafeReport({
    checks,
    failure,
    finishedAt: new Date(),
    hashes: Object.keys(hashes).length > 0 ? hashes : null,
    startedAt,
  })
}

function usage() {
  return [
    'UAT SFTP loopback isolato per VincodeLab.',
    '',
    'Uso:',
    '  node scripts/uat-sftp-loopback.mjs --run [--timeout-ms 30000] [--output <report.json>]',
    '',
    'La modalità reale richiede macOS e produce esclusivamente JSON privacy-safe su stdout.',
  ].join('\n')
}

async function writeReportAtomically(outputPath, serializedReport) {
  validateAbsolutePath(outputPath, 'Percorso report')
  const temporaryReportPath = `${outputPath}.${process.pid}.tmp`
  try {
    await writeFile(temporaryReportPath, serializedReport, { mode: 0o600 })
    await renameFile(temporaryReportPath, outputPath)
  } finally {
    try { await rm(temporaryReportPath, { force: true }) } catch {}
  }
}

async function main() {
  let options
  try {
    options = parseCliArguments(process.argv.slice(2))
  } catch {
    process.stderr.write(`${usage()}\n`)
    process.exitCode = 2
    return
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (!options.execute) {
    process.stderr.write('Esecuzione reale non avviata: aggiungere --run dopo aver liberato la finestra di profiling Electron.\n')
    process.exitCode = 2
    return
  }

  const interruption = new AbortController()
  const onInterrupt = () => interruption.abort()
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  try {
    const report = await runLoopbackUat({ signal: interruption.signal, timeoutMs: options.timeoutMs })
    const serializedReport = `${JSON.stringify(report, null, 2)}\n`
    if (options.outputPath) {
      try {
        await writeReportAtomically(options.outputPath, serializedReport)
      } catch {
        process.stderr.write('Impossibile salvare il report UAT richiesto.\n')
        process.exitCode = 1
      }
    }
    process.stdout.write(serializedReport)
    if (!report.ok) process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
  }
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntrypoint) await main()
