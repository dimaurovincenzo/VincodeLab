const {
  internalSftpError,
  toSftpApplicationError,
  validateSftpConnection,
} = require('../../domains/remote/sftp-protocol.cjs')

function createSftpProcessLifecycle({ spawn, timeoutMs, killGraceMs, maxOutputBytes }) {
  function runProcess(connection, batch, { operation, resource, signal } = {}) {
    validateSftpConnection(connection)
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(toSftpApplicationError(internalSftpError('ABORT_ERR', 'Trasferimento annullato.', 'AbortError'), { connection, operation, resource }))
        return
      }
      let closed = false
      let outcomeError
      let killTimer
      let forceCloseTimer
      let timer
      let output = Buffer.alloc(0)
      let errorOutput = Buffer.alloc(0)
      let child
      try {
        child = spawn(connection.sftpPath, [
          '-q', '-b', '-', '-o', `ControlPath=${connection.socketPath}`, '--', connection.destination,
        ], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (error) {
        reject(toSftpApplicationError(internalSftpError('SFTP_SPAWN_FAILED', error instanceof Error ? error.name : 'Spawn SFTP fallito.'), { connection, operation, resource }))
        return
      }
      const cleanup = () => {
        clearTimeout(timer)
        clearTimeout(killTimer)
        clearTimeout(forceCloseTimer)
        signal?.removeEventListener('abort', abort)
        child.stdout.off('data', onStdoutData)
        child.stderr.off('data', onStderrData)
        child.stdin.off('error', onStdinError)
        child.off('error', onError)
        child.off('close', onClose)
      }
      const append = (current, chunk) => {
        const next = Buffer.concat([current, Buffer.from(chunk)])
        if (next.length > maxOutputBytes) {
          terminate(new Error('La risposta SFTP è troppo grande.'))
          return current
        }
        return next
      }
      const kill = (signalName) => {
        try {
          child.kill(signalName)
        } catch {
          // La deadline finale chiude comunque stream e slot della coda.
        }
      }
      const forceClose = () => {
        if (closed) return
        closed = true
        child.stdin.destroy?.()
        child.stdout.destroy?.()
        child.stderr.destroy?.()
        child.unref?.()
        cleanup()
        child.once('error', () => undefined)
        reject(toSftpApplicationError(outcomeError ?? internalSftpError('SFTP_STREAM_INTERRUPTED', 'Stream SFTP interrotto.'), { connection, operation, resource, stderr: errorOutput }))
      }
      const terminate = (error) => {
        if (closed || outcomeError) return
        outcomeError = error
        clearTimeout(timer)
        killTimer = setTimeout(() => {
          if (closed) return
          kill('SIGKILL')
          forceCloseTimer = setTimeout(forceClose, killGraceMs)
        }, killGraceMs)
        kill('SIGTERM')
      }
      const abort = () => {
        terminate(internalSftpError('ABORT_ERR', 'Trasferimento annullato.', 'AbortError'))
      }
      timer = setTimeout(() => {
        terminate(internalSftpError('SFTP_TIMEOUT', 'Operazione SFTP non conclusa nel tempo previsto.', 'TimeoutError'))
      }, timeoutMs)
      const onStdoutData = (chunk) => { if (!outcomeError) output = append(output, chunk) }
      const onStderrData = (chunk) => { if (!outcomeError) errorOutput = append(errorOutput, chunk) }
      const onStdinError = () => terminate(internalSftpError('SFTP_STREAM_INTERRUPTED', 'Scrittura SFTP interrotta.'))
      const onError = () => terminate(internalSftpError('SFTP_SPAWN_FAILED', 'Avvio SFTP non riuscito.'))
      const onClose = (exitCode) => {
        if (closed) return
        closed = true
        cleanup()
        if (outcomeError) reject(toSftpApplicationError(outcomeError, { connection, operation, resource, stderr: errorOutput }))
        else if (exitCode === 0) resolve({ stdout: output.toString('utf8'), stderr: errorOutput.toString('utf8') })
        else reject(toSftpApplicationError(internalSftpError('SFTP_EXIT_NONZERO', `SFTP exit ${Number.isInteger(exitCode) ? exitCode : 'signal'}.`), { connection, operation, resource, stderr: errorOutput }))
      }
      child.stdout.on('data', onStdoutData)
      child.stderr.on('data', onStderrData)
      child.stdin.on('error', onStdinError)
      child.once('error', onError)
      child.once('close', onClose)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        child.stdin.end(`${batch.join('\n')}\n`)
      } catch {
        terminate(internalSftpError('SFTP_STREAM_INTERRUPTED', 'Scrittura SFTP interrotta.'))
      }
      if (signal?.aborted) abort()
    })
  }

  return Object.freeze({ runProcess })
}

module.exports = { createSftpProcessLifecycle }
