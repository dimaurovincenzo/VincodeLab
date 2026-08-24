const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const HERDR_PREFLIGHT_TIMEOUT_MS = 1_000
const HERDR_VERSION_OUTPUT_LIMIT_BYTES = 4 * 1024

function validateExecutable(candidate, dependencies = {}) {
  const accessFile = dependencies.accessFile ?? fs.accessSync
  const realpathFile = dependencies.realpathFile ?? fs.realpathSync
  const statFile = dependencies.statFile ?? fs.statSync
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) {
    return Object.freeze({ reason: 'not-executable' })
  }
  try {
    const resolved = realpathFile(candidate)
    const stats = statFile(resolved)
    if (!stats.isFile()) return Object.freeze({ reason: 'not-executable' })
    accessFile(resolved, fs.constants.X_OK)
    return Object.freeze({ executable: resolved })
  } catch (error) {
    return Object.freeze({ reason: error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'missing' : 'not-executable' })
  }
}

function executableFromPath(environment, dependencies = {}) {
  const pathValue = typeof environment?.PATH === 'string' ? environment.PATH : ''
  let invalidCandidate = false
  const includeUserCandidates = dependencies.includeUserCandidates !== false
  const userCandidates = Array.isArray(dependencies.userCandidates) ? dependencies.userCandidates : []

  if (includeUserCandidates && Object.hasOwn(environment ?? {}, 'VINCODELAB_HERDR_PATH')) {
    return validateExecutable(environment.VINCODELAB_HERDR_PATH, dependencies)
  }

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue
    const candidate = path.join(directory, 'herdr')
    const result = validateExecutable(candidate, dependencies)
    if (result.executable) return result
    if (result.reason !== 'missing') invalidCandidate = true
  }

  if (includeUserCandidates) {
    for (const candidate of userCandidates) {
      const result = validateExecutable(candidate, dependencies)
      if (result.executable) return result
      if (result.reason !== 'missing') invalidCandidate = true
    }
  }

  return Object.freeze({ reason: invalidCandidate ? 'not-executable' : 'missing' })
}

function hasValidHerdrVersionOutput(stdout, stderr) {
  const output = `${typeof stdout === 'string' ? stdout : ''}\n${typeof stderr === 'string' ? stderr : ''}`.trim()
  if (!output || Buffer.byteLength(output, 'utf8') > HERDR_VERSION_OUTPUT_LIMIT_BYTES) return false
  return /\bherdr\b[^\r\n]{0,48}\bv?\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?\b/iu.test(output)
}

function preflightHerdr(executable, environment, {
  executeFile = execFile,
  timeoutMs = HERDR_PREFLIGHT_TIMEOUT_MS,
} = {}) {
  if (typeof executeFile !== 'function') throw new TypeError('Executor preflight Herdr non valido.')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) throw new TypeError('Timeout preflight Herdr non valido.')

  return new Promise((resolve) => {
    executeFile(executable, ['--version'], {
      env: environment,
      maxBuffer: HERDR_VERSION_OUTPUT_LIMIT_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const timedOut = error.killed === true || error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM'
        resolve(Object.freeze({ available: false, reason: timedOut ? 'timeout' : 'preflight-failed' }))
        return
      }
      if (!hasValidHerdrVersionOutput(stdout, stderr)) {
        resolve(Object.freeze({ available: false, reason: 'invalid-version-output' }))
        return
      }
      resolve(Object.freeze({ available: true, executable }))
    })
  })
}

function createHerdrRuntimeAdapter({
  executeFile = execFile,
  getEnvironment,
  getHomePath,
  includeUserCandidates = true,
  timeoutMs = HERDR_PREFLIGHT_TIMEOUT_MS,
  ...filesystemDependencies
} = {}) {
  if (typeof getEnvironment !== 'function') throw new TypeError('Provider ambiente Herdr non valido.')
  if (typeof getHomePath !== 'function') throw new TypeError('Provider home Herdr non valido.')

  async function inspect(environment = getEnvironment()) {
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      return Object.freeze({ available: false, reason: 'preflight-failed' })
    }
    const homePath = getHomePath()
    const userCandidates = includeUserCandidates && typeof homePath === 'string' && path.isAbsolute(homePath)
      ? [path.join(homePath, '.local', 'bin', 'herdr')]
      : []
    const resolved = executableFromPath(environment, {
      ...filesystemDependencies,
      includeUserCandidates,
      userCandidates,
    })
    if (!resolved.executable) return Object.freeze({ available: false, reason: resolved.reason })
    return preflightHerdr(resolved.executable, environment, { executeFile, timeoutMs })
  }

  return Object.freeze({ inspect })
}

module.exports = {
  HERDR_PREFLIGHT_TIMEOUT_MS,
  HERDR_VERSION_OUTPUT_LIMIT_BYTES,
  createHerdrRuntimeAdapter,
  executableFromPath,
  hasValidHerdrVersionOutput,
  preflightHerdr,
  validateExecutable,
}
