import { spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

import {
  buildControlCommandArguments,
  DEFAULT_TIMEOUT_MS,
  LOOPBACK_HOST,
  MAXIMUM_PORT,
  MINIMUM_HIGH_PORT,
  SSH_PATH,
} from './config-builders.mjs'
import { fail, UatFailure } from './report.mjs'

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024

export function isolatedEnvironment(homePath, temporaryPath, username) {
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

export function runCommand(executable, args, { env, onExit, onSpawn, timeoutMs, signal } = {}) {
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

export function startTrackedProcess(executable, args, { env }) {
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

export function processGroupAlive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

export function processAlive(pid) {
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

export async function collectDescendantPids(rootPid, env) {
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

export async function waitForCondition(predicate, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new UatFailure('interrupted', 'INTERRUPTED')
    if (await predicate()) return true
    await delay(25)
  }
  return false
}

export async function terminateTrackedProcess(tracked) {
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

export function canConnect(port, timeoutMs = 250) {
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

export async function reserveHighLoopbackPort() {
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

export async function waitForSshd(port, tracked, timeoutMs, signal) {
  return waitForCondition(async () => {
    if (tracked.closed) return false
    return canConnect(port)
  }, Math.min(timeoutMs, 10_000), signal)
}

export async function waitForControlMaster(parameters, tracked, env, timeoutMs, signal, processTracking) {
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

export async function stopControlMaster(parameters, tracked, env, processTracking) {
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

export async function killExactPids(pids) {
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
