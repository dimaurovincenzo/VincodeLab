const { execFile, spawn } = require('node:child_process')
const { createPublicError } = require('../../domains/errors/public-error.cjs')
const { environmentForGitHubCli, resolveGitHubCliExecutable } = require('./github-cli-executable.adapter.cjs')
const {
  MAX_STREAM_STDERR_BYTES,
  commandFailure,
  commandLifecycleError,
  throwIfAborted,
} = require('../../domains/github/command-errors.cjs')

const COMMAND_OPTIONS = { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }
const COMMAND_KILL_GRACE_MS = 250
const MAX_DIFF_OUTPUT_BYTES = 1024 * 1024
const DIFF_TRUNCATION_NOTICE = '\n\n[Diff troncato: sono disponibili altre modifiche oltre il limite di 1 MiB.]'

function deterministicCommandEnvironment(environment) {
  return { ...environment, LANG: 'C', LC_ALL: 'C' }
}

function commandConfiguration(command) {
  const executable = command === 'gh' ? resolveGitHubCliExecutable() : command
  if (!executable) throw createPublicError('GITHUB_CLI_NOT_FOUND', 'GitHub CLI non è stato trovato.')
  return { executable, env: command === 'gh' ? environmentForGitHubCli(executable) : process.env }
}

function createCommandRunner({
  execFileImpl = execFile,
  spawnImpl = spawn,
  commandConfigurationImpl = commandConfiguration,
  timeoutMs = COMMAND_OPTIONS.timeout,
  killGraceMs = COMMAND_KILL_GRACE_MS,
} = {}) {
  if (typeof execFileImpl !== 'function' || typeof spawnImpl !== 'function' || typeof commandConfigurationImpl !== 'function') throw new Error('Runner processi Git/GitHub non valido.')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 || !Number.isSafeInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > 5_000) {
    throw new Error('Timeout processi Git/GitHub non validi.')
  }

  function terminateChild(child, state, reason, forceSettle) {
    if (state.settled) return
    if (state.terminationReason && !(state.terminationReason === 'truncated' && reason === 'cancelled')) return
    state.terminationReason = reason
    clearTimeout(state.timeoutTimer)
    try { child.kill('SIGTERM') } catch { /* La deadline forzata resta attiva. */ }
    if (state.killTimer) return
    state.killTimer = setTimeout(() => {
      if (state.settled) return
      try { child.kill('SIGKILL') } catch { /* Il force-settle rilascia comunque handle e listener. */ }
      state.forceTimer = setTimeout(forceSettle, killGraceMs)
    }, killGraceMs)
  }

  function run(command, args, cwd, { trim = true, signal } = {}) {
    try {
      throwIfAborted(signal, command, args)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      let executable
      let env
      try {
        ;({ executable, env } = commandConfigurationImpl(command))
        // I classificatori lavorano su stderr strutturalmente stabile: Git e
        // gh non devono cambiare i propri messaggi in base alla lingua dell'app.
        env = deterministicCommandEnvironment(env)
      } catch (error) {
        reject(commandFailure(command, error, '', args))
        return
      }

      const state = { settled: false, terminationReason: null, timeoutTimer: null, killTimer: null, forceTimer: null }
      let child
      const cleanup = () => {
        clearTimeout(state.timeoutTimer)
        clearTimeout(state.killTimer)
        clearTimeout(state.forceTimer)
        signal?.removeEventListener('abort', abort)
        child?.off?.('close', onClose)
      }
      const settle = (error, stdout = '') => {
        if (state.settled) return
        state.settled = true
        cleanup()
        if (error) reject(error)
        else resolve(trim ? stdout.trim() : stdout)
      }
      const forceSettle = () => {
        if (state.settled) return
        child?.stdout?.destroy?.()
        child?.stderr?.destroy?.()
        child?.stdin?.destroy?.()
        child?.once?.('error', () => undefined)
        child?.unref?.()
        settle(commandLifecycleError(command, state.terminationReason === 'cancelled' ? 'cancelled' : 'timeout', args))
      }
      const abort = () => terminateChild(child, state, 'cancelled', forceSettle)
      const onClose = () => {
        if (state.terminationReason) settle(commandLifecycleError(command, state.terminationReason === 'cancelled' ? 'cancelled' : 'timeout', args))
      }
      const callback = (error, stdout = '', stderr = '') => {
        if (state.settled || state.terminationReason) return
        if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
          abort()
          return
        }
        if (error) settle(commandFailure(command, error, stderr, args))
        else settle(null, typeof stdout === 'string' ? stdout : String(stdout))
      }

      try {
        child = execFileImpl(executable, args, {
          cwd,
          encoding: 'utf8',
          env,
          maxBuffer: COMMAND_OPTIONS.maxBuffer,
          windowsHide: true,
          ...(signal ? { signal } : {}),
        }, callback)
      } catch (error) {
        settle(signal?.aborted ? commandLifecycleError(command, 'cancelled', args) : commandFailure(command, error, '', args))
        return
      }
      if (!child || typeof child.kill !== 'function' || typeof child.once !== 'function') {
        settle(commandFailure(command, new Error('Processo comando non valido.'), '', args))
        return
      }
      child.once('close', onClose)
      signal?.addEventListener('abort', abort, { once: true })
      state.timeoutTimer = setTimeout(() => terminateChild(child, state, 'timeout', forceSettle), timeoutMs)
      state.timeoutTimer.unref?.()
      if (signal?.aborted) abort()
    })
  }

  function runStreaming(command, args, cwd, { acceptedExitCodes = [0], delimiterByte = null, maxBytes, maxRecords = Number.POSITIVE_INFINITY, trim = true, signal } = {}) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > COMMAND_OPTIONS.maxBuffer) throw new Error('Limite output comando non valido.')
    try {
      throwIfAborted(signal, command, args)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      let executable
      let env
      try {
        ;({ executable, env } = commandConfigurationImpl(command))
        env = deterministicCommandEnvironment(env)
      } catch (error) {
        reject(commandFailure(command, error, '', args))
        return
      }

      let child
      try {
        child = spawnImpl(executable, args, {
          cwd,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(signal ? { signal } : {}),
        })
      } catch (error) {
        reject(signal?.aborted ? commandLifecycleError(command, 'cancelled', args) : commandFailure(command, error, '', args))
        return
      }
      if (!child || typeof child.kill !== 'function' || typeof child.once !== 'function' || !child.stdout || !child.stderr) {
        reject(commandFailure(command, new Error('Processo comando non valido.'), '', args))
        return
      }

      const stdoutChunks = []
      const stderrChunks = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let records = 0
      let truncated = false
      const state = { settled: false, terminationReason: null, timeoutTimer: null, killTimer: null, forceTimer: null }

      const output = () => {
        const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8')
        return { output: trim ? stdout.trim() : stdout, truncated }
      }
      const cleanup = () => {
        clearTimeout(state.timeoutTimer)
        clearTimeout(state.killTimer)
        clearTimeout(state.forceTimer)
        signal?.removeEventListener('abort', abort)
        child.stdout.off('data', onStdoutData)
        child.stderr.off('data', onStderrData)
        child.off('error', onError)
        child.off('close', onClose)
      }
      const settle = (error, result) => {
        if (state.settled) return
        state.settled = true
        cleanup()
        if (error) reject(error)
        else resolve(result)
      }
      const forceSettle = () => {
        if (state.settled) return
        child.stdout.destroy?.()
        child.stderr.destroy?.()
        child.stdin?.destroy?.()
        child.once('error', () => undefined)
        child.unref?.()
        if (state.terminationReason === 'truncated') settle(null, output())
        else settle(commandLifecycleError(command, state.terminationReason === 'cancelled' ? 'cancelled' : 'timeout', args))
      }
      const abort = () => terminateChild(child, state, 'cancelled', forceSettle)
      const onStdoutData = (value) => {
        if (truncated) return
        const chunk = Buffer.from(value)
        const remaining = maxBytes - stdoutBytes
        const kept = remaining > 0 ? chunk.subarray(0, remaining) : Buffer.alloc(0)
        if (kept.length > 0) {
          stdoutChunks.push(kept)
          stdoutBytes += kept.length
          if (delimiterByte !== null) for (const byte of kept) if (byte === delimiterByte) records += 1
        }
        if (chunk.length > kept.length || stdoutBytes >= maxBytes || records >= maxRecords) {
          truncated = true
          terminateChild(child, state, 'truncated', forceSettle)
        }
      }
      const onStderrData = (value) => {
        const chunk = Buffer.from(value)
        const remaining = MAX_STREAM_STDERR_BYTES - stderrBytes
        if (remaining <= 0) return
        const kept = chunk.subarray(0, remaining)
        stderrChunks.push(kept)
        stderrBytes += kept.length
      }
      const onError = (error) => {
        if (state.terminationReason) return
        if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
          abort()
          return
        }
        settle(commandFailure(command, error, '', args))
      }
      const onClose = (code) => {
        const stderr = Buffer.concat(stderrChunks, stderrBytes).toString('utf8').trim()
        if (state.terminationReason === 'cancelled') settle(commandLifecycleError(command, 'cancelled', args))
        else if (state.terminationReason === 'timeout') settle(commandLifecycleError(command, 'timeout', args))
        else if (!truncated && !acceptedExitCodes.includes(code)) settle(commandFailure(command, undefined, stderr, args))
        else settle(null, output())
      }

      child.stdout.on('data', onStdoutData)
      child.stderr.on('data', onStderrData)
      child.once('error', onError)
      child.once('close', onClose)
      signal?.addEventListener('abort', abort, { once: true })
      state.timeoutTimer = setTimeout(() => terminateChild(child, state, 'timeout', forceSettle), timeoutMs)
      state.timeoutTimer.unref?.()
      if (signal?.aborted) abort()
    })
  }

  return Object.freeze({ run, runStreaming })
}

const commandRunner = createCommandRunner()
const run = (...args) => commandRunner.run(...args)
const runStreaming = (...args) => commandRunner.runStreaming(...args)

async function runBoundedDiff(args, cwd, acceptedExitCodes = [0], { signal } = {}) {
  const result = await runStreaming('git', args, cwd, { acceptedExitCodes, maxBytes: MAX_DIFF_OUTPUT_BYTES, signal })
  return result.truncated ? `${result.output}${DIFF_TRUNCATION_NOTICE}` : result.output
}

module.exports = {
  COMMAND_OPTIONS,
  createCommandRunner,
  run,
  runBoundedDiff,
  runStreaming,
}
