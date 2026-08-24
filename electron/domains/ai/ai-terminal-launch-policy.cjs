const { createPublicError, isPublicError } = require('../errors/public-error.cjs')

const PI_NOT_INSTALLED = Object.freeze({
  code: 'PI_NOT_INSTALLED',
  message: 'Pi Coding Agent non è installato. Installalo oppure configura il percorso dell’eseguibile.',
})
const PI_NOT_RUNNABLE = Object.freeze({
  code: 'PI_NOT_RUNNABLE',
  message: 'Pi Coding Agent è presente ma non può essere avviato. Verifica installazione e permessi, quindi riprova.',
})

function publicPiFailure(definition, cause) {
  if (isPublicError(cause)) return cause
  const error = createPublicError(definition.code, definition.message)
  if (cause) {
    try {
      Object.defineProperty(error, 'cause', { value: cause })
    } catch {
      // Il messaggio pubblico resta valido anche senza la causa tecnica.
    }
  }
  return error
}

function createLaunchDescriptor({ executable, workspacePath, environment, sessionId, statusExtensionPath, statusTransport }) {
  const statusEnabled = typeof sessionId === 'string'
    && typeof statusExtensionPath === 'string'
    && statusExtensionPath.length > 0
    && statusTransport?.socketPath
    && statusTransport?.token
  return Object.freeze({
    runtime: 'pi',
    executable,
    args: Object.freeze(statusEnabled ? ['--extension', statusExtensionPath] : []),
    options: Object.freeze({
      name: 'xterm-256color',
      cols: 120,
      rows: 34,
      cwd: workspacePath,
      env: Object.freeze({
        ...environment,
        TERM: 'xterm-256color',
        ...(statusEnabled ? {
          VINCODELAB_PI_SESSION_ID: sessionId,
          VINCODELAB_PI_STATUS_SOCKET: statusTransport.socketPath,
          VINCODELAB_PI_STATUS_TOKEN: statusTransport.token,
        } : {}),
      }),
    }),
    startupWindowMs: 0,
  })
}

function createAiTerminalLaunchPolicy({
  environmentForExecutable,
  getStatusTransport = async () => null,
  resolvePiExecutable,
  statusExtensionPath,
} = {}) {
  if (typeof environmentForExecutable !== 'function') throw new TypeError('Provider ambiente Terminale AI non valido.')
  if (typeof resolvePiExecutable !== 'function') throw new TypeError('Resolver Pi Terminale AI non valido.')

  async function resolveCandidates(workspacePath, { sessionId } = {}) {
    let executable
    try {
      executable = resolvePiExecutable()
    } catch (error) {
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }
    if (typeof executable !== 'string' || executable.length === 0) throw publicPiFailure(PI_NOT_INSTALLED)

    let environment
    try {
      environment = environmentForExecutable(executable)
    } catch (error) {
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Ambiente di lancio Terminale AI non valido.'))
    }

    let statusTransport = null
    try { statusTransport = await getStatusTransport() } catch { /* Pi resta utilizzabile con stato attività sconosciuto. */ }
    return Object.freeze([createLaunchDescriptor({
      executable,
      workspacePath,
      environment,
      sessionId,
      statusExtensionPath,
      statusTransport,
    })])
  }

  return Object.freeze({ resolveCandidates })
}

module.exports = {
  PI_NOT_INSTALLED,
  PI_NOT_RUNNABLE,
  createAiTerminalLaunchPolicy,
  createLaunchDescriptor,
  publicPiFailure,
}
