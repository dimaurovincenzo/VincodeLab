const ERR_ABORTED = -3
const CORRELATION_ID_PATTERN = /^ERR-[A-F0-9]{6}$/u

const RENDERER_EXIT_REASONS = new Set([
  'abnormal-exit',
  'clean-exit',
  'crashed',
  'integrity-failure',
  'killed',
  'launch-failed',
  'oom',
])

function createRendererRecoveryController({
  chooseRecovery,
  reload,
  isDestroyed,
  isClosing = () => false,
  onError = () => undefined,
}) {
  if (typeof chooseRecovery !== 'function' || typeof reload !== 'function' || typeof isDestroyed !== 'function' || typeof isClosing !== 'function' || typeof onError !== 'function') {
    throw new Error('Recovery del renderer non configurato.')
  }

  let disposed = false
  let incident

  function unavailable() {
    if (disposed) return true
    try {
      return Boolean(isDestroyed() || isClosing())
    } catch (error) {
      reportError(error)
      return true
    }
  }

  function reportError(error) {
    try {
      onError(error)
    } catch {
      // La diagnostica non deve innescare un secondo failure del lifecycle.
    }
  }

  function begin(nextIncident) {
    if (unavailable()) {
      incident = undefined
      return false
    }
    if (incident) {
      // Una scelta ancora aperta appartiene allo stesso incidente e va
      // coalescata. Dopo la richiesta di reload, invece, un nuovo crash/load
      // failure descrive il tentativo di recovery appena fallito.
      if (incident.phase === 'choosing') return incident.promise
      incident = undefined
    }

    const current = {
      details: Object.freeze(nextIncident),
      phase: 'choosing',
      reloadRequested: false,
      promise: undefined,
    }
    incident = current
    current.promise = (async () => {
      try {
        const decision = await chooseRecovery(current.details)
        if (incident !== current || unavailable() || decision !== 'reload') return false
        current.phase = 'reloading'
        current.reloadRequested = true
        await reload()
        if (incident !== current || unavailable()) return false
        current.phase = 'waiting-for-load'
        return true
      } catch (error) {
        // Rilascia prima del feedback: anche un callback diagnostico che
        // pianifica subito un retry non deve riagganciarsi alla failure chiusa.
        if (incident === current) incident = undefined
        reportError(error)
        return false
      } finally {
        // Un reload richiesto con successo resta attivo solo fino al relativo
        // did-finish-load o a un nuovo incidente. Ogni altro esito è terminale.
        if (incident === current && current.phase !== 'waiting-for-load') incident = undefined
      }
    })()
    return current.promise
  }

  function handleProcessGone(details = {}) {
    const reason = RENDERER_EXIT_REASONS.has(details.reason) ? details.reason : 'unknown'
    const nextIncident = { source: 'render-process-gone', reason }
    if (CORRELATION_ID_PATTERN.test(details.correlationId ?? '')) nextIncident.correlationId = details.correlationId
    return begin(nextIncident)
  }

  function handleLoadFailure(details = {}) {
    if (details.isMainFrame !== true || details.errorCode === ERR_ABORTED) return false
    return begin({
      source: 'did-fail-load',
      errorCode: Number.isInteger(details.errorCode) ? details.errorCode : null,
    })
  }

  function handlePreloadFailure(details = {}) {
    const nextIncident = { source: 'preload-error' }
    if (CORRELATION_ID_PATTERN.test(details.correlationId ?? '')) nextIncident.correlationId = details.correlationId
    return begin(nextIncident)
  }

  function handleLoadFinished() {
    if (disposed || !incident) return false
    // Il documento può terminare il caricamento anche se il preload è fallito.
    // In quel caso solo il caricamento successivo al reload conclude il recovery.
    if (incident.details.source === 'preload-error' && incident.phase !== 'waiting-for-load') return false
    incident = undefined
    return true
  }

  function getState() {
    return Object.freeze({
      active: Boolean(incident),
      reloadRequested: Boolean(incident?.reloadRequested),
    })
  }

  function dispose() {
    disposed = true
    incident = undefined
  }

  return Object.freeze({
    dispose,
    getState,
    handleLoadFailure,
    handleLoadFinished,
    handlePreloadFailure,
    handleProcessGone,
  })
}

module.exports = { ERR_ABORTED, createRendererRecoveryController }
