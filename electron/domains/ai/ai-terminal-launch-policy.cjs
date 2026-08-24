const { createPublicError, isPublicError } = require('../errors/public-error.cjs')

const HERDR_STARTUP_WINDOW_MS = 600
const HERDR_FALLBACK_REASONS = new Set([
  'missing',
  'not-executable',
  'timeout',
  'invalid-version-output',
  'preflight-failed',
  'spawn-failed',
  'early-exit',
  'nested-herdr',
  'disabled',
])
const HERDR_IDENTITY_ENVIRONMENT_KEYS = Object.freeze([
  'HERDR_ENV',
  'HERDR_SESSION',
  'HERDR_PANE_ID',
  'HERDR_TAB_ID',
  'HERDR_WORKSPACE_ID',
  'HERDR_BIN_PATH',
  'HERDR_SOCKET_PATH',
])

const PI_NOT_INSTALLED = Object.freeze({
  code: 'PI_NOT_INSTALLED',
  message: 'Pi Coding Agent non è installato. Installalo oppure configura il percorso dell’eseguibile.',
})
const PI_NOT_RUNNABLE = Object.freeze({
  code: 'PI_NOT_RUNNABLE',
  message: 'Pi Coding Agent è presente ma non può essere avviato. Verifica installazione e permessi, quindi riprova.',
})
const AI_TERMINAL_RUNTIME_UNAVAILABLE = Object.freeze({
  code: 'AI_TERMINAL_RUNTIME_UNAVAILABLE',
  message: 'Herdr non è disponibile e Pi Coding Agent non è installato o utilizzabile. Installa almeno uno dei due runtime, quindi riprova.',
})
const HERDR_NOT_RUNNABLE = Object.freeze({
  code: 'HERDR_NOT_RUNNABLE',
  message: 'Herdr è stato rilevato ma non può essere avviato, e Pi diretto non è disponibile come recovery. Verifica Herdr oppure installa Pi Coding Agent.',
})
const HERDR_SESSION_ENDED_DURING_STARTUP = Object.freeze({
  code: 'HERDR_SESSION_ENDED_DURING_STARTUP',
  message: 'Herdr ha mostrato la fleet ma il client si è chiuso durante l’avvio. Ricollega Herdr oppure avvia Pi diretto.',
})
const HERDR_SESSION_ENDED_WITHOUT_FALLBACK = Object.freeze({
  code: 'HERDR_SESSION_ENDED_WITHOUT_FALLBACK',
  message: 'Herdr ha mostrato la fleet ma il client si è chiuso durante l’avvio. Ricollega Herdr; Pi diretto non è disponibile su questo Mac.',
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

function createLaunchDescriptor({ runtime, executable, workspacePath, environment, startupWindowMs, fallbackReason, terminalFailure }) {
  const descriptor = {
    runtime,
    executable,
    args: Object.freeze([]),
    options: Object.freeze({
      name: 'xterm-256color',
      cols: 120,
      rows: 34,
      cwd: workspacePath,
      env: Object.freeze({ ...environment, TERM: 'xterm-256color' }),
    }),
    startupWindowMs,
  }
  if (fallbackReason) descriptor.fallbackReason = fallbackReason
  if (terminalFailure) descriptor.terminalFailure = terminalFailure
  return Object.freeze(descriptor)
}

function withoutHerdrIdentity(environment) {
  const sanitized = { ...environment }
  for (const key of HERDR_IDENTITY_ENVIRONMENT_KEYS) delete sanitized[key]
  return sanitized
}

function createAiTerminalLaunchPolicy({
  environmentForExecutable,
  getEnvironment,
  herdrEnabled = true,
  inspectHerdr,
  resolvePiExecutable,
} = {}) {
  if (typeof environmentForExecutable !== 'function') throw new TypeError('Provider ambiente Terminale AI non valido.')
  if (typeof getEnvironment !== 'function') throw new TypeError('Provider ambiente applicazione non valido.')
  if (typeof inspectHerdr !== 'function') throw new TypeError('Inspector Herdr non valido.')
  if (typeof resolvePiExecutable !== 'function') throw new TypeError('Resolver Pi Terminale AI non valido.')
  if (typeof herdrEnabled !== 'boolean') throw new TypeError('Policy abilitazione Herdr non valida.')

  async function resolveCandidates(workspacePath, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => key !== 'runtime') || (options.runtime !== undefined && options.runtime !== 'pi')) {
      throw new TypeError('Opzioni lancio Terminale AI non valide.')
    }
    let baseEnvironment
    try {
      baseEnvironment = getEnvironment()
    } catch (error) {
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }
    if (!baseEnvironment || typeof baseEnvironment !== 'object' || Array.isArray(baseEnvironment)) {
      throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Ambiente Terminale AI non valido.'))
    }

    let inspection
    if (options.runtime === 'pi') {
      inspection = null
    } else if (!herdrEnabled) {
      inspection = { available: false, reason: 'disabled' }
    } else if (baseEnvironment.HERDR_ENV === '1') {
      inspection = { available: false, reason: 'nested-herdr' }
    } else {
      try {
        inspection = await inspectHerdr(baseEnvironment)
      } catch {
        inspection = { available: false, reason: 'preflight-failed' }
      }
    }

    let piExecutable
    let piFailure = PI_NOT_INSTALLED
    try {
      piExecutable = resolvePiExecutable()
    } catch {
      piFailure = PI_NOT_RUNNABLE
    }
    let launchEnvironment = baseEnvironment
    if (typeof piExecutable === 'string' && piExecutable.length > 0) {
      try {
        launchEnvironment = environmentForExecutable(piExecutable)
      } catch {
        piExecutable = undefined
        piFailure = PI_NOT_RUNNABLE
        launchEnvironment = baseEnvironment
      }
    }
    if (!launchEnvironment || typeof launchEnvironment !== 'object' || Array.isArray(launchEnvironment)) {
      throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Ambiente di lancio Terminale AI non valido.'))
    }

    const piEnvironment = withoutHerdrIdentity(launchEnvironment)
    const piDescriptor = (fallbackReason) => createLaunchDescriptor({
      runtime: 'pi',
      executable: piExecutable,
      workspacePath,
      environment: piEnvironment,
      startupWindowMs: 0,
      fallbackReason,
    })
    if (options.runtime === 'pi') {
      if (!piExecutable) throw publicPiFailure(piFailure)
      return Object.freeze([piDescriptor()])
    }

    const reason = HERDR_FALLBACK_REASONS.has(inspection?.reason) ? inspection.reason : 'preflight-failed'

    if (inspection?.available !== true || typeof inspection.executable !== 'string' || inspection.executable.length === 0) {
      if (!piExecutable) throw publicPiFailure(AI_TERMINAL_RUNTIME_UNAVAILABLE)
      return Object.freeze([piDescriptor(reason)])
    }

    const candidates = [
      createLaunchDescriptor({
        runtime: 'herdr',
        executable: inspection.executable,
        workspacePath,
        environment: launchEnvironment,
        startupWindowMs: HERDR_STARTUP_WINDOW_MS,
        terminalFailure: piExecutable ? undefined : HERDR_NOT_RUNNABLE.code,
      }),
    ]
    if (piExecutable) candidates.push(piDescriptor())
    return Object.freeze(candidates)
  }

  return Object.freeze({ resolveCandidates })
}

module.exports = {
  HERDR_FALLBACK_REASONS,
  HERDR_IDENTITY_ENVIRONMENT_KEYS,
  HERDR_STARTUP_WINDOW_MS,
  AI_TERMINAL_RUNTIME_UNAVAILABLE,
  HERDR_NOT_RUNNABLE,
  HERDR_SESSION_ENDED_DURING_STARTUP,
  HERDR_SESSION_ENDED_WITHOUT_FALLBACK,
  PI_NOT_INSTALLED,
  PI_NOT_RUNNABLE,
  createAiTerminalLaunchPolicy,
  createLaunchDescriptor,
  publicPiFailure,
  withoutHerdrIdentity,
}
