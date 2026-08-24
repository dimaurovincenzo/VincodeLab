const { execFile } = require('node:child_process')

const PI_COMMAND_MAX_BUFFER_BYTES = 1024 * 1024

function isPiProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'ESRCH' ? false : null
  }
}

function createPiCommandRunner({
  buildEnvironment,
  executeFile = execFile,
  getEnvironment,
  timeoutMs,
} = {}) {
  if (typeof buildEnvironment !== 'function') throw new TypeError('Builder ambiente comando Pi non valido.')
  if (typeof executeFile !== 'function') throw new TypeError('Executor comando Pi non valido.')
  if (typeof getEnvironment !== 'function') throw new TypeError('Provider ambiente comando Pi non valido.')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) throw new TypeError('Timeout comando Pi non valido.')

  function run(executable, args) {
    return new Promise((resolve, reject) => {
      const environment = buildEnvironment(executable, getEnvironment())
      executeFile(executable, args, {
        env: environment,
        maxBuffer: PI_COMMAND_MAX_BUFFER_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          const failure = new Error('Pi command execution failed.')
          failure.cause = error
          failure.code = error.code
          failure.killed = error.killed
          failure.signal = error.signal
          failure.stdout = stdout
          failure.stderr = stderr
          reject(failure)
          return
        }
        resolve({ stdout, stderr })
      })
    })
  }

  return Object.freeze({ run })
}

module.exports = { PI_COMMAND_MAX_BUFFER_BYTES, createPiCommandRunner, isPiProcessAlive }
