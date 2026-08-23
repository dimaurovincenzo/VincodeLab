const { getApplicationErrorLogMetadata, toApplicationError } = require('./application-error.cjs')

const COPY_RESPONSE = 1
const SAFE_TECHNICAL_NAMES = new Set([
  'AggregateError',
  'DOMException',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
])
const SAFE_TECHNICAL_CODES = new Set([
  'ABORT_ERR',
  'EACCES',
  'EAI_AGAIN',
  'EBUSY',
  'ECANCELED',
  'ECANCELLED',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EEXIST',
  'EHOSTUNREACH',
  'EINVAL',
  'EISDIR',
  'EMFILE',
  'ENAMETOOLONG',
  'ENETDOWN',
  'ENETUNREACH',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'ENOTFOUND',
  'EPERM',
  'EPIPE',
  'EROFS',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'ERR_ABORTED',
  'ERR_CANCELED',
  'ERR_CANCELLED',
  'SQLITE_BUSY',
  'SQLITE_CONSTRAINT',
  'SQLITE_INTERRUPT',
  'SQLITE_LOCKED',
  'SQLITE_READONLY',
])

function safeProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}

function boundedFlush(flushLogs, milliseconds = 750) {
  let timer
  return Promise.race([
    Promise.resolve().then(flushLogs),
    new Promise((resolve) => { timer = setTimeout(resolve, milliseconds) }),
  ]).finally(() => clearTimeout(timer))
}

function diagnosticText(error, incident, origin, timestamp) {
  const candidateName = safeProperty(error, 'name')
  const candidateCode = safeProperty(error, 'code')
  const originalName = typeof candidateName === 'string' && SAFE_TECHNICAL_NAMES.has(candidateName) ? candidateName : 'Error'
  const normalizedCode = typeof candidateCode === 'string' ? candidateCode.trim().toUpperCase() : ''
  const originalCode = SAFE_TECHNICAL_CODES.has(normalizedCode) ? normalizedCode : null
  const lines = [
    `Riferimento: ${incident.correlationId}`,
    `Categoria: ${incident.category}`,
    `Codice: ${incident.publicCode}`,
    `Componente: main`,
    `Operazione: ${incident.operation}`,
    `Origine: ${origin}`,
    `Data: ${timestamp}`,
    `Tipo tecnico: ${originalName}`,
  ]
  if (originalCode) lines.push(`Codice tecnico: ${originalCode}`)
  return lines.join('\n')
}

function createFatalErrorExperience({ app, clipboard, dialog, flushLogs, log, now = () => new Date() }) {
  if (!app || !dialog || typeof dialog.showMessageBox !== 'function') throw new TypeError('Dipendenze fatal error non valide.')
  if (typeof flushLogs !== 'function' || typeof log !== 'function') throw new TypeError('Logging fatal error non valido.')

  let activePresentation = null
  let groupedIncidents = 0

  function report(error, options) {
    const incident = toApplicationError(error, {
      code: options.code,
      domain: 'internal',
      message: options.message,
      operation: options.operation,
      recoverable: options.recoverable,
    })
    log('error', options.event, getApplicationErrorLogMetadata(incident))
    return incident
  }

  async function copyDiagnostic(diagnostic) {
    try {
      clipboard?.writeText?.(diagnostic)
      return true
    } catch {
      log('warning', 'fatal_diagnostic_copy_failed')
      return false
    }
  }

  async function present(error, config) {
    if (activePresentation) {
      groupedIncidents += 1
      log('warning', 'fatal_error_grouped', { reason: config.origin })
      return activePresentation
    }

    const task = (async () => {
      const incident = report(error, config)
      if (incident.category === 'cancelled' && config.allowContinue) return 'continue'
      const timestamp = now().toISOString()
      const diagnostic = diagnosticText(error, incident, config.origin, timestamp)
      let copyStatus = ''

      for (;;) {
        let result
        try {
          result = await dialog.showMessageBox({
            type: 'error',
            buttons: config.buttons,
            defaultId: config.defaultId,
            cancelId: config.cancelId,
            noLink: true,
            title: config.title,
            message: config.message,
            detail: `${config.detail}\n\nRiferimento ${incident.correlationId}.${copyStatus}`,
          })
        } catch {
          log('error', 'fatal_error_dialog_failed', getApplicationErrorLogMetadata(incident))
          return config.allowContinue ? 'continue' : 'exit'
        }

        if (result.response !== COPY_RESPONSE) return config.actions[result.response] ?? (config.allowContinue ? 'continue' : 'exit')
        copyStatus = await copyDiagnostic(diagnostic)
          ? '\nLa diagnostica è stata copiata.'
          : '\nGli appunti non sono disponibili; usa il riferimento mostrato.'
      }
    })().catch(() => config.allowContinue ? 'continue' : 'exit').then(async (action) => {
      if (groupedIncidents > 0) log('warning', 'fatal_error_group_summary', { total: groupedIncidents })
      try { await boundedFlush(flushLogs) } catch { /* Il lifecycle non dipende dalla disponibilità del file di log. */ }
      if (action === 'restart') {
        try { app.relaunch() } catch { /* `exit` resta il fallback deterministico. */ }
        app.exit(1)
      } else if (action === 'exit') {
        app.exit(1)
      }
      return action
    }).finally(() => {
      activePresentation = null
      groupedIncidents = 0
    })

    activePresentation = task
    return task
  }

  const handleStartup = (error) => present(error, {
    actions: ['restart', 'copy', 'exit'],
    allowContinue: false,
    buttons: ['Riprova avvio', 'Copia diagnostica', 'Esci'],
    cancelId: 2,
    code: 'APP_STARTUP_FAILED',
    defaultId: 0,
    detail: 'Nessun file del workspace è stato modificato. Puoi riprovare l’avvio oppure copiare una diagnostica sanitizzata.',
    event: 'app_startup_failed',
    message: 'VincodeLab non è riuscito ad avviarsi.',
    operation: 'startup',
    origin: 'startup',
    recoverable: true,
    title: 'Avvio non completato',
  })

  const handleInstallationFailure = (error) => present(error, {
    actions: ['exit', 'copy'],
    allowContinue: false,
    buttons: ['Esci e reinstalla', 'Copia diagnostica'],
    cancelId: 0,
    code: 'APP_INSTALLATION_INCOMPLETE',
    defaultId: 0,
    detail: 'Nessun file del workspace è stato modificato. Scarica nuovamente il pacchetto adatto a questo Mac e sostituisci questa copia dell’app.',
    event: 'app_installation_invalid',
    message: 'Questa installazione non può avviare tutti i componenti essenziali.',
    operation: 'load-bundled-runtime',
    origin: 'bootstrap',
    recoverable: false,
    title: 'Installazione da riparare',
  })

  const handleUncaughtException = (error) => present(error, {
    actions: ['restart', 'copy', 'exit'],
    allowContinue: false,
    buttons: ['Riavvia VincodeLab', 'Copia diagnostica', 'Esci'],
    cancelId: 2,
    code: 'APP_MAIN_PROCESS_CRASH',
    defaultId: 0,
    detail: 'L’interfaccia e i dati già salvati restano sul disco. Riavvia l’applicazione per ripristinare i servizi in uno stato sicuro.',
    event: 'main_uncaught_exception',
    message: 'Un servizio principale si è interrotto.',
    operation: 'uncaught-exception',
    origin: 'uncaughtException',
    recoverable: true,
    title: 'Servizio principale interrotto',
  })

  const handleUnhandledRejection = (error) => present(error, {
    actions: ['continue', 'copy', 'restart'],
    allowContinue: true,
    buttons: ['Continua', 'Copia diagnostica', 'Riavvia VincodeLab'],
    cancelId: 0,
    code: 'APP_UNHANDLED_REJECTION',
    defaultId: 0,
    detail: 'L’operazione è stata confinata. Puoi continuare e riprovare la funzione interessata, oppure riavviare l’applicazione.',
    event: 'main_unhandled_rejection',
    message: 'Un’operazione in background si è interrotta.',
    operation: 'unhandled-rejection',
    origin: 'unhandledRejection',
    recoverable: true,
    title: 'Operazione in background interrotta',
  })

  return { handleInstallationFailure, handleStartup, handleUncaughtException, handleUnhandledRejection }
}

module.exports = { createFatalErrorExperience, diagnosticText }
