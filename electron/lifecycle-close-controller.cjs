const crypto = require('node:crypto')

const CLOSE_REASONS = new Set(['window', 'quit'])
const CLOSE_DECISIONS = new Set(['proceed', 'cancel'])

function isRequestId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\0\r\n]/.test(value)
}

function createLifecycleCloseController({
  sendRequest,
  onProceed,
  onCancel = () => undefined,
  onTimeout,
  onError = () => undefined,
  timeoutMs = 15_000,
  createRequestId = crypto.randomUUID,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof sendRequest !== 'function' || typeof onProceed !== 'function' || typeof onTimeout !== 'function') throw new Error('Lifecycle di chiusura non configurato.')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Timeout lifecycle non valido.')
  let pending

  const requestDto = (request) => ({ requestId: request.requestId, reason: request.reason })

  function reportError(error, request) {
    try { onError(error, requestDto(request)) } catch {
      // onError è l'ultimo confine diagnostico: un failure del reporter non deve
      // sostituire né sbloccare implicitamente la decisione di chiusura fail-closed.
    }
  }

  function deliver(request) {
    try {
      sendRequest(requestDto(request))
    } catch (error) {
      reportError(error, request)
    }
  }

  function request(reason) {
    if (!CLOSE_REASONS.has(reason)) throw new Error('Motivo di chiusura non valido.')
    if (pending) {
      if (reason === 'quit' && pending.reason === 'window') {
        pending.reason = 'quit'
        if (pending.phase === 'waiting') deliver(pending)
      }
      return requestDto(pending)
    }

    const requestId = createRequestId()
    if (!isRequestId(requestId)) throw new Error('Identificatore lifecycle non valido.')
    const current = { requestId, reason, phase: 'waiting', timer: undefined }
    pending = current
    current.timer = setTimer(() => {
      if (pending !== current || current.phase !== 'waiting') return
      current.phase = 'timed-out'
      try {
        Promise.resolve(onTimeout(requestDto(current))).catch((error) => reportError(error, current))
      } catch (error) {
        reportError(error, current)
      }
    }, timeoutMs)
    deliver(current)
    return requestDto(current)
  }

  function finish(requestId, decision, expectedPhase) {
    if (!isRequestId(requestId) || !CLOSE_DECISIONS.has(decision)) return false
    const current = pending
    if (!current || current.requestId !== requestId || current.phase !== expectedPhase) return false
    clearTimer(current.timer)
    pending = undefined
    try {
      if (decision === 'proceed') onProceed(current.reason)
      else onCancel(current.reason)
    } catch (error) {
      reportError(error, current)
    }
    return true
  }

  function respondRenderer(response) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) return false
    if (Object.keys(response).some((key) => key !== 'requestId' && key !== 'decision')) return false
    return finish(response.requestId, response.decision, 'waiting')
  }

  function respondTimeout(requestId, decision) {
    return finish(requestId, decision, 'timed-out')
  }

  function getPending() {
    return pending ? { ...requestDto(pending), phase: pending.phase } : null
  }

  function dispose() {
    if (!pending) return
    clearTimer(pending.timer)
    pending = undefined
  }

  return { dispose, getPending, request, respondRenderer, respondTimeout }
}

module.exports = { createLifecycleCloseController }
