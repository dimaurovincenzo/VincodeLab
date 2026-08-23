const path = require('node:path')
const { fork } = require('node:child_process')

const WORKER_START_TIMEOUT_MS = 10_000
const WORKER_CLOSE_TIMEOUT_MS = 2_000
const activeWorkers = new Set()

function workerError(serialized, fallback) {
  const error = new Error(serialized?.message || fallback)
  error.name = serialized?.name || 'Error'
  if (typeof serialized?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(serialized.code)) error.code = serialized.code
  return error
}

function restoreSqliteBuffers(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value)
  if (Array.isArray(value)) return value.map(restoreSqliteBuffers)
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, restoreSqliteBuffers(nested)]))
}

function terminateWorker(worker, timeoutMs = WORKER_CLOSE_TIMEOUT_MS) {
  if (worker.exitCode !== null || worker.signalCode !== null) return Promise.resolve({ timedOut: false })
  return new Promise((resolve) => {
    let settled = false
    const finish = (timedOut) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.removeListener('exit', onExit)
      resolve({ timedOut })
    }
    const onExit = () => finish(false)
    const timer = setTimeout(() => {
      try { worker.disconnect?.() } catch { /* Il processo è già in teardown. */ }
      try { worker.kill('SIGKILL') } catch { /* Il deadline deve comunque concludere il cleanup. */ }
      finish(true)
    }, timeoutMs)
    timer.unref?.()
    worker.once('exit', onExit)
    try { worker.kill('SIGKILL') } catch { finish(false) }
  })
}

class SqliteWorkerSession {
  constructor(sqlitePath, onClosed = () => undefined) {
    this.closed = false
    this.closePromise = null
    this.nextRequestId = 0
    this.onClosed = onClosed
    this.pending = new Map()
    this.readySettled = false
    this.worker = fork(path.join(__dirname, 'sqlite-database-worker.cjs'), [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    })
    activeWorkers.add(this)
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.readyTimer = setTimeout(() => {
      if (this.readySettled) return
      const error = new Error('database_worker_start_timeout')
      this.settleReady(error)
      void this.close(error)
    }, WORKER_START_TIMEOUT_MS)
    this.worker.on('message', (message) => this.handleMessage(message))
    this.worker.once('error', (error) => this.handleFailure(error))
    this.worker.once('exit', (code, signal) => {
      activeWorkers.delete(this)
      if (!this.closed) this.handleFailure(new Error(`database_worker_exited:${code ?? signal ?? 'unknown'}`))
    })
    try {
      this.worker.send({ type: 'initialize', sqlitePath }, (error) => {
        if (error) this.handleFailure(error)
      })
    } catch (error) {
      this.handleFailure(error)
    }
  }

  settleReady(error) {
    if (this.readySettled) return
    this.readySettled = true
    clearTimeout(this.readyTimer)
    if (error) this.rejectReady(error)
    else this.resolveReady()
  }

  handleMessage(message) {
    if (this.closed) return
    if (message?.type === 'ready') {
      const error = message.error ? workerError(message.error, 'Impossibile aprire SQLite.') : null
      this.settleReady(error)
      if (error) void this.close(error)
      return
    }
    const request = this.pending.get(message?.id)
    if (!request) return
    this.pending.delete(message.id)
    clearTimeout(request.timer)
    request.removeAbortListener()
    if (message.error) request.reject(workerError(message.error, 'Operazione SQLite non riuscita.'))
    else request.resolve(restoreSqliteBuffers(message.result))
  }

  handleFailure(error) {
    if (this.closed) return
    this.settleReady(error)
    void this.close(error)
  }

  ready() {
    return this.readyPromise
  }

  request(operation, payload, { signal, timeoutMs = 30_000 } = {}) {
    if (this.closed) return Promise.reject(new Error('database_session_closed'))
    if (signal?.aborted) return Promise.reject(new Error('database_query_aborted'))
    const id = ++this.nextRequestId
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!this.pending.delete(id)) return
        clearTimeout(timer)
        const error = new Error('database_query_aborted')
        void this.close(error).then(() => reject(error))
      }
      const removeAbortListener = () => signal?.removeEventListener?.('abort', abort)
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        removeAbortListener()
        const error = new Error('database_query_timeout')
        void this.close(error).then(() => reject(error))
      }, timeoutMs)
      this.pending.set(id, { reject, removeAbortListener, resolve, timer })
      signal?.addEventListener?.('abort', abort, { once: true })
      try {
        this.worker.send({ id, operation, payload }, (error) => {
          if (!error || !this.pending.delete(id)) return
          clearTimeout(timer)
          removeAbortListener()
          reject(error)
          this.handleFailure(error)
        })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        removeAbortListener()
        reject(error)
        this.handleFailure(error)
      }
    })
  }

  close(reason = new Error('database_session_closed')) {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.onClosed()
    this.settleReady(reason)
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.removeAbortListener()
      request.reject(reason)
    }
    this.pending.clear()
    this.worker.removeAllListeners('message')
    this.closePromise = terminateWorker(this.worker).then(() => undefined).finally(() => activeWorkers.delete(this))
    return this.closePromise
  }
}

function sqliteWorkerDiagnostics() {
  return {
    activeWorkers: activeWorkers.size,
    pendingRequests: [...activeWorkers].reduce((total, session) => total + session.pending.size, 0),
  }
}

module.exports = { SqliteWorkerSession, sqliteWorkerDiagnostics, terminateWorker }
