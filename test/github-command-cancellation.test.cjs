const assert = require('node:assert/strict')
const { execFile, execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-github-cancel-cache-'))
const previousDataDirectory = process.env.VINCODELAB_DATA_DIR
process.env.VINCODELAB_DATA_DIR = dataDirectory

const { closeDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const { readCache, writeCache } = require('../electron/infrastructure/persistence/workspace-cache.repository.cjs')
const { commandLifecycleError, isCommandCancellation } = require('../electron/domains/github/command-errors.cjs')
const { getCachedResource } = require('../electron/infrastructure/github/github-cache.adapter.cjs')
const { createCommandRunner } = require('../electron/infrastructure/github/command-runner.adapter.cjs')

test.after(() => {
  closeDatabase()
  if (previousDataDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
  else process.env.VINCODELAB_DATA_DIR = previousDataDirectory
  fs.rmSync(dataDirectory, { recursive: true, force: true })
})

const BLOCKED_SCRIPT = 'process.on("SIGTERM", () => {}); process.stdout.write("READY\\n"); setInterval(() => {}, 1000)'

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk) => {
      output += chunk.toString('utf8')
      if (!output.includes('READY')) return
      cleanup()
      resolve()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onClose = (code, signal) => {
      cleanup()
      reject(new Error(`Processo chiuso prima di READY (${code ?? signal}).`))
    }
    const cleanup = () => {
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('close', onClose)
    }
    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

function assertProcessGone(pid) {
  assert.throws(() => process.kill(pid, 0), (error) => error?.code === 'ESRCH')
}

test('execFile riceve AbortSignal, forza il cleanup del processo bloccato e consente retry Git locale', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-cancel-retry-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })

  let executable = process.execPath
  let child
  let ready
  let receivedSignal
  const runner = createCommandRunner({
    execFileImpl(file, args, options, callback) {
      receivedSignal = options.signal
      child = execFile(file, args, options, callback)
      if (file === process.execPath) ready = waitForReady(child)
      return child
    },
    commandConfigurationImpl: () => ({ executable, env: process.env }),
    timeoutMs: 2_000,
    killGraceMs: 25,
  })
  const controller = new AbortController()
  const pending = runner.run('git', ['-e', BLOCKED_SCRIPT, '--', '/private/workspace?token=secret'], workspace, { signal: controller.signal })
  const blockedChild = child
  await ready
  controller.abort()

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'GIT_COMMAND_CANCELLED')
    assert.equal(isCommandCancellation(error), true)
    assert.doesNotMatch(error.message, /private|workspace|token|secret/i)
    return true
  })
  assert.equal(receivedSignal, controller.signal)
  assertProcessGone(blockedChild.pid)

  executable = 'git'
  const recovered = await runner.run('git', ['rev-parse', '--is-inside-work-tree'], workspace)
  assert.equal(recovered, 'true')
})

test('spawn streaming riceve AbortSignal ed esegue TERM poi KILL con esito CANCELLED', async () => {
  let child
  let ready
  let receivedSignal
  const sentSignals = []
  const runner = createCommandRunner({
    spawnImpl(file, args, options) {
      receivedSignal = options.signal
      child = spawn(file, args, options)
      const kill = child.kill.bind(child)
      child.kill = (signal) => {
        sentSignals.push(signal)
        return kill(signal)
      }
      ready = waitForReady(child)
      return child
    },
    commandConfigurationImpl: () => ({ executable: process.execPath, env: process.env }),
    timeoutMs: 2_000,
    killGraceMs: 25,
  })
  const controller = new AbortController()
  const pending = runner.runStreaming('gh', ['-e', BLOCKED_SCRIPT], os.tmpdir(), { maxBytes: 1_024, signal: controller.signal })
  const blockedChild = child
  await ready
  controller.abort()

  await assert.rejects(pending, (error) => error.code === 'GITHUB_COMMAND_CANCELLED')
  assert.equal(receivedSignal, controller.signal)
  assert.ok(sentSignals.includes('SIGTERM'))
  assert.ok(sentSignals.includes('SIGKILL'))
  assertProcessGone(blockedChild.pid)
})

test('timeout resta distinto dalla cancellazione e non espone argomenti privati', async () => {
  let child
  let ready
  const runner = createCommandRunner({
    execFileImpl(file, args, options, callback) {
      child = execFile(file, args, options, callback)
      ready = waitForReady(child)
      return child
    },
    commandConfigurationImpl: () => ({ executable: process.execPath, env: process.env }),
    timeoutMs: 250,
    killGraceMs: 25,
  })
  const pending = runner.run('gh', ['-e', BLOCKED_SCRIPT, '--', 'ghp_non_esporre'], os.tmpdir())
  const blockedChild = child
  await ready

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'GITHUB_COMMAND_TIMEOUT')
    assert.equal(isCommandCancellation(error), false)
    assert.doesNotMatch(error.message, /ghp_|non_esporre/i)
    return true
  })
  assertProcessGone(blockedChild.pid)
})

test('un refresh annullato non usa cache stale e non può sovrascrivere il retry', async () => {
  const workspace = '/tmp/vincodelab-cancelled-cache-workspace'
  const resourceKey = 'github:data'
  writeCache(workspace, resourceKey, { issues: [{ number: 1 }] }, 10, 1_000)
  const firstController = new AbortController()
  let firstLoadStarted
  const started = new Promise((resolve) => { firstLoadStarted = resolve })
  const first = getCachedResource(workspace, resourceKey, 60_000, (signal) => new Promise((resolve, reject) => {
    firstLoadStarted()
    signal.addEventListener('abort', () => reject(commandLifecycleError('gh', 'cancelled')), { once: true })
  }), { force: true, now: 2_000, signal: firstController.signal })
  await started
  firstController.abort()

  const retryController = new AbortController()
  const retry = getCachedResource(workspace, resourceKey, 60_000, async () => ({ issues: [{ number: 2 }] }), {
    force: true,
    now: 2_001,
    signal: retryController.signal,
  })

  await assert.rejects(first, (error) => error.code === 'GITHUB_COMMAND_CANCELLED')
  assert.deepEqual((await retry).data, { issues: [{ number: 2 }] })
  assert.deepEqual(readCache(workspace, resourceKey, 2_002).data, { issues: [{ number: 2 }] })
})
