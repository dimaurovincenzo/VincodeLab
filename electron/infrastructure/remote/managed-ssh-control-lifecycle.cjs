function createManagedSshControlLifecycle({
  spawn,
  log,
  setTimer,
  clearTimer,
  controlTimeoutMs,
  killGraceMs,
}) {
  function runControl(connection, operation, { signal, timeoutMs = controlTimeoutMs } = {}) {
    if (signal?.aborted) return Promise.resolve(Object.freeze({ ok: false, reason: 'aborted' }))
    let controlPromise
    controlPromise = new Promise((resolve) => {
      let child
      try {
        child = spawn(connection.sshPath, ['-S', connection.socketPath, '-O', operation, '--', connection.destination], {
          shell: false,
          stdio: 'ignore',
        })
      } catch {
        log('warn', 'managed_ssh_control_spawn_failed', {
          connectionId: connection.id,
          operation,
          reason: 'spawn',
        })
        resolve(Object.freeze({ ok: false, reason: 'spawn' }))
        return
      }

      let deadlineTimer
      let killTimer
      let forceTimer
      let settled = false
      let terminationReason
      const clearTimers = () => {
        if (deadlineTimer !== undefined) clearTimer(deadlineTimer)
        if (killTimer !== undefined) clearTimer(killTimer)
        if (forceTimer !== undefined) clearTimer(forceTimer)
      }
      const kill = (signalName) => {
        try {
          child.kill(signalName)
        } catch {
          // Il child può essere già terminato tra il controllo e kill; i timer di
          // chiusura completano comunque il risultato bounded dell'operazione.
        }
      }
      const cleanup = () => {
        clearTimers()
        signal?.removeEventListener('abort', onAbort)
        child.off?.('error', onError)
        child.off?.('close', onClose)
      }
      const settle = (result) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(Object.freeze(result))
      }
      const forceSettle = () => {
        child.stdout?.destroy?.()
        child.stderr?.destroy?.()
        child.stdin?.destroy?.()
        child.once?.('error', () => undefined)
        child.unref?.()
        settle({ ok: false, reason: terminationReason ?? 'timeout' })
      }
      const terminate = (reason) => {
        if (settled || terminationReason) return
        terminationReason = reason
        if (deadlineTimer !== undefined) clearTimer(deadlineTimer)
        deadlineTimer = undefined
        if (reason === 'timeout') log('warn', 'managed_ssh_control_timeout', { connectionId: connection.id, operation })
        kill('SIGTERM')
        killTimer = setTimer(() => {
          kill('SIGKILL')
          forceTimer = setTimer(forceSettle, killGraceMs)
          forceTimer?.unref?.()
        }, killGraceMs)
        killTimer?.unref?.()
      }
      const onAbort = () => terminate('aborted')
      const onError = () => settle({ ok: false, reason: terminationReason ?? 'spawn' })
      const onClose = (exitCode) => {
        if (terminationReason) settle({ ok: false, reason: terminationReason })
        else if (exitCode === 0) settle({ ok: true, reason: 'success' })
        else settle({ ok: false, reason: 'exit' })
      }
      child.once('error', onError)
      child.once('close', onClose)
      signal?.addEventListener('abort', onAbort, { once: true })
      deadlineTimer = setTimer(() => terminate('timeout'), timeoutMs)
      deadlineTimer?.unref?.()
      if (signal?.aborted) onAbort()
    })
    connection.controls.add(controlPromise)
    void controlPromise.then(
      () => connection.controls.delete(controlPromise),
      () => connection.controls.delete(controlPromise),
    )
    return controlPromise
  }

  return Object.freeze({ runControl })
}

module.exports = { createManagedSshControlLifecycle }
